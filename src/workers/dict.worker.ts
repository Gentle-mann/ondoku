/**
 * Dictionary Worker
 * Loads ondoku_dict.db into sql.js, caches bytes in IndexedDB,
 * and handles all lookup queries off the main thread.
 */

import { expose } from 'comlink'
import initSqlJs, { type Database } from 'sql.js'
import type { DictEntry, DictSense, DictStatus, KanjiBreakdown } from '../lib/dictTypes'

const DB_URL = '/dict/ondoku_dict.db'
const IDB_STORE = 'ondoku'
const IDB_KEY = 'dict_db'
const WASM_URL = '/sql-wasm.wasm'

let db: Database | null = null
let status: DictStatus = { state: 'idle', progress: 0 }
let onStatusChange: ((s: DictStatus) => void) | null = null

// ── IndexedDB helpers ────────────────────────────────────────────────────────

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_STORE, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function getFromIDB(): Promise<Uint8Array | null> {
  try {
    const idb = await openIDB()
    return new Promise((resolve) => {
      const tx = idb.transaction(IDB_STORE, 'readonly')
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

async function saveToIDB(data: Uint8Array): Promise<void> {
  try {
    const idb = await openIDB()
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).put(data, IDB_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (e) {
    console.warn('[dict worker] IDB save failed:', e)
  }
}

// ── DB loading ───────────────────────────────────────────────────────────────

function setStatus(s: Partial<DictStatus>) {
  status = { ...status, ...s }
  onStatusChange?.(status)
}

async function fetchWithProgress(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  const reader = res.body!.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    if (total > 0) {
      setStatus({ state: 'downloading', progress: Math.round((loaded / total) * 90) })
    }
  }

  const combined = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.length
  }
  return combined
}

async function init(): Promise<void> {
  if (db) return
  if (status.state === 'ready') return

  try {
    setStatus({ state: 'loading', progress: 0 })

    // 1. Try IndexedDB cache
    let bytes = await getFromIDB()

    if (!bytes) {
      // 2. Download the DB
      setStatus({ state: 'downloading', progress: 0 })
      bytes = await fetchWithProgress(DB_URL)
      // 3. Cache it
      setStatus({ state: 'loading', progress: 90 })
      saveToIDB(bytes) // fire-and-forget
    }

    // 4. Init sql.js with the WASM file
    setStatus({ state: 'loading', progress: 95 })
    const SQL = await initSqlJs({ locateFile: () => WASM_URL })
    db = new SQL.Database(bytes)

    setStatus({ state: 'ready', progress: 100 })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    setStatus({ state: 'error', progress: 0, error: msg })
    throw e
  }
}

// ── Query helpers ────────────────────────────────────────────────────────────

function queryAll<T>(sql: string, params: (string | number)[] = []): T[] {
  if (!db) return []
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const rows: T[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as T)
  }
  stmt.free()
  return rows
}

function queryOne<T>(sql: string, params: (string | number)[] = []): T | null {
  const rows = queryAll<T>(sql, params)
  return rows[0] ?? null
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Find the longest matching dictionary word starting at the beginning of `text`.
 * e.g. text="こんな面白くない世の中に..." → matches "こんな" (3 chars, exists in JMDict)
 * Uses a single SQL query checking substrings of length 1–8 simultaneously.
 */
async function lookupLongest(text: string): Promise<DictEntry | null> {
  await init()
  if (!db || !text) return null

  // Build SUBSTR(?,1,N) candidates for N=1..8, both kanji and reading forms
  const maxLen = Math.min(8, [...text].length)  // handle multi-byte chars properly
  const candidates = Array.from({ length: maxLen }, (_, i) => {
    // slice by code point count, not byte index
    return [...text].slice(0, i + 1).join('')
  })

  // Single query: find the longest form that matches any candidate
  const placeholders = candidates.map(() => '?').join(', ')

  const kRow = queryOne<{ id: number; jlpt: number | null; freq_rank: number | null; matched: string }>(
    `SELECT e.id, e.jlpt, e.freq_rank, kf.form as matched
     FROM entries e
     JOIN kanji_forms kf ON kf.entry_id = e.id
     WHERE kf.form IN (${placeholders})
     ORDER BY LENGTH(kf.form) DESC
     LIMIT 1`,
    candidates
  )

  const rRow = queryOne<{ id: number; jlpt: number | null; freq_rank: number | null; matched: string }>(
    `SELECT e.id, e.jlpt, e.freq_rank, rf.form as matched
     FROM entries e
     JOIN reading_forms rf ON rf.entry_id = e.id
     WHERE rf.form IN (${placeholders})
     ORDER BY LENGTH(rf.form) DESC
     LIMIT 1`,
    candidates
  )

  // Pick whichever matched the longer form
  let best = kRow
  if (rRow && (!best || rRow.matched.length > best.matched.length)) {
    best = rRow
  }

  if (!best) return null

  // Reuse lookupWord logic with the matched surface form
  return lookupWord(best.matched)
}

/**
 * Look up a word by its surface form (kanji or kana).
 * Tries kanji_forms first, then reading_forms.
 */
async function lookupWord(surface: string): Promise<DictEntry | null> {
  await init()
  if (!db) return null

  // Find entry by kanji form or reading form
  const entryRow = queryOne<{ id: number; jlpt: number | null; freq_rank: number | null }>(
    `SELECT e.id, e.jlpt, e.freq_rank
     FROM entries e
     WHERE e.id IN (SELECT entry_id FROM kanji_forms WHERE form = ?)
     LIMIT 1`,
    [surface]
  ) ?? queryOne<{ id: number; jlpt: number | null; freq_rank: number | null }>(
    `SELECT e.id, e.jlpt, e.freq_rank
     FROM entries e
     WHERE e.id IN (SELECT entry_id FROM reading_forms WHERE form = ?)
     LIMIT 1`,
    [surface]
  )

  if (!entryRow) return null

  const id = entryRow.id

  // Kanji forms
  const kforms = queryAll<{ form: string }>('SELECT form FROM kanji_forms WHERE entry_id = ?', [id])
  const rforms = queryAll<{ form: string }>('SELECT form FROM reading_forms WHERE entry_id = ?', [id])

  // Senses
  const senseRows = queryAll<{ pos: string; glosses: string }>(
    'SELECT pos, glosses FROM senses WHERE entry_id = ? LIMIT 6',
    [id]
  )
  const senses: DictSense[] = senseRows.map((r) => ({
    pos: safeParseJSON(r.pos) as string[],
    glosses: safeParseJSON(r.glosses) as string[],
  }))

  // Pitch accent
  const pitchRows = queryAll<{ reading: string; pattern: string }>(
    'SELECT reading, pattern FROM pitch WHERE entry_id = ?',
    [id]
  )

  // Kanji breakdown — look up each unique kanji in the surface
  const kanjiChars = [...new Set([...surface].filter(isKanji))]
  const kanjiBreakdown: KanjiBreakdown[] = kanjiChars.map((ch) => {
    const row = queryOne<{
      literal: string
      meanings: string
      readings_on: string
      readings_kun: string
      jlpt: number | null
    }>('SELECT literal, meanings, readings_on, readings_kun, jlpt FROM kanji_chars WHERE literal = ?', [ch])

    if (!row) return { literal: ch, meanings: [], readings_on: [], readings_kun: [], jlpt: null }
    return {
      literal: row.literal,
      meanings: safeParseJSON(row.meanings) as string[],
      readings_on: safeParseJSON(row.readings_on) as string[],
      readings_kun: safeParseJSON(row.readings_kun) as string[],
      jlpt: row.jlpt ?? null,
    }
  })

  const word = kforms[0]?.form ?? rforms[0]?.form ?? surface

  return {
    id,
    word,
    readings: rforms.map((r) => r.form),
    jlpt: entryRow.jlpt ?? null,
    freqRank: entryRow.freq_rank ?? null,
    senses,
    kanjiBreakdown,
    pitch: pitchRows,
  }
}

/**
 * Look up a single kanji character.
 */
async function lookupKanji(char: string): Promise<KanjiBreakdown | null> {
  await init()
  if (!db) return null

  const row = queryOne<{
    literal: string
    meanings: string
    readings_on: string
    readings_kun: string
    jlpt: number | null
  }>('SELECT literal, meanings, readings_on, readings_kun, jlpt FROM kanji_chars WHERE literal = ?', [char])

  if (!row) return null
  return {
    literal: row.literal,
    meanings: safeParseJSON(row.meanings) as string[],
    readings_on: safeParseJSON(row.readings_on) as string[],
    readings_kun: safeParseJSON(row.readings_kun) as string[],
    jlpt: row.jlpt ?? null,
  }
}

function getStatus(): DictStatus {
  return status
}

function setStatusCallback(cb: (s: DictStatus) => void) {
  onStatusChange = cb
}

// ── Utilities ────────────────────────────────────────────────────────────────

function safeParseJSON(s: string | null): unknown[] {
  if (!s) return []
  try { return JSON.parse(s) } catch { return [] }
}

function isKanji(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0
  return (cp >= 0x4E00 && cp <= 0x9FFF)   // CJK Unified
    || (cp >= 0x3400 && cp <= 0x4DBF)      // CJK Extension A
    || (cp >= 0xF900 && cp <= 0xFAFF)      // CJK Compatibility
}

// Expose the API via Comlink
expose({ lookupWord, lookupLongest, lookupKanji, getStatus, setStatusCallback, init })
