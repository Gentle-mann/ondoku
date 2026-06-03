// Cloud sync — pushes/pulls settings, progress, and book metadata to/from Supabase.
// All functions are no-ops when supabase is null (env vars not configured).

import { supabase } from './supabase'
import { getBooks, getBook, restoreBookFromCloud } from './bookLibrary'
import { useReaderStore } from '../store/readerStore'
import type { AlignedSentenceInput } from './bookLibrary'
import type { BookMeta } from './bookLibrary'

// ── Types matching the DB schema ──────────────────────────────────────────────

export interface SyncSettings {
  anki_deck: string
  claude_api_key: string
  card_type: string
  show_furigana: boolean
  intensive_mode: boolean
  playback_speed: number
}

export interface SyncProgress {
  book_id: string
  ep_index: number
  playback_time: number
  progress_pct: number
  updated_at: string
}

// ── Settings ──────────────────────────────────────────────────────────────────

export async function pushSettings(s: SyncSettings): Promise<void> {
  if (!supabase) return
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase.from('settings').upsert({
    user_id: user.id,
    ...s,
    updated_at: new Date().toISOString(),
  })
}

export async function pullSettings(): Promise<SyncSettings | null> {
  if (!supabase) return null
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('settings')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  return data as SyncSettings | null
}

let settingsTimer: ReturnType<typeof setTimeout> | null = null
export function scheduleSettingsPush(s: SyncSettings) {
  if (!supabase) return
  if (settingsTimer) clearTimeout(settingsTimer)
  settingsTimer = setTimeout(() => pushSettings(s), 2000)
}

export function currentSettingsSnapshot(): SyncSettings {
  const s = useReaderStore.getState()
  return {
    anki_deck: s.ankiDeck,
    claude_api_key: s.claudeApiKey,
    card_type: s.cardType,
    show_furigana: s.showFurigana,
    intensive_mode: s.intensiveMode,
    playback_speed: s.playbackRate,
  }
}

// ── Progress ──────────────────────────────────────────────────────────────────

export async function pushProgress(
  bookId: string,
  epIndex: number,
  currentTime: number,
  progressPct: number,
): Promise<void> {
  if (!supabase) return
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase.from('progress').upsert({
    user_id: user.id,
    book_id: bookId,
    ep_index: epIndex,
    playback_time: currentTime,
    progress_pct: progressPct,
    updated_at: new Date().toISOString(),
  })
}

let progressTimer: ReturnType<typeof setTimeout> | null = null
export function scheduleProgressPush(
  bookId: string,
  epIndex: number,
  currentTime: number,
  progressPct: number,
) {
  if (!supabase) return
  if (progressTimer) clearTimeout(progressTimer)
  progressTimer = setTimeout(() => pushProgress(bookId, epIndex, currentTime, progressPct), 10000)
}

// Flush any pending progress debounce immediately (call on pause / tab hide)
export function flushProgressPush(
  bookId: string,
  epIndex: number,
  currentTime: number,
  progressPct: number,
) {
  if (!supabase) return
  if (progressTimer) { clearTimeout(progressTimer); progressTimer = null }
  pushProgress(bookId, epIndex, currentTime, progressPct)
}

// ── Books ─────────────────────────────────────────────────────────────────────

export async function pushBook(
  meta: BookMeta,
  sentences: AlignedSentenceInput[],
): Promise<void> {
  if (!supabase) return
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase.from('books').upsert({
    id: meta.id,
    user_id: user.id,
    title: meta.title,
    author: meta.author,
    audio_filename: meta.audioFilename,
    sentence_count: meta.sentenceCount,
    cover_gradient: meta.coverGradient,
    created_at: new Date(meta.createdAt).toISOString(),
    sentences: sentences,
  })
}

export async function deleteCloudBook(id: string): Promise<void> {
  if (!supabase) return
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase.from('books').delete().eq('id', id).eq('user_id', user.id)
}

// ── Full sync on sign-in ──────────────────────────────────────────────────────

export async function syncFromCloud(): Promise<void> {
  if (!supabase) return
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const store = useReaderStore.getState()

  // ── Settings ─────────────────────────────────────────────────────────────
  const remoteSettings = await pullSettings()

  if (remoteSettings) {
    // Apply remote to local
    store.setAnkiDeck(remoteSettings.anki_deck)
    store.setClaudeApiKey(remoteSettings.claude_api_key)
    store.setCardType(remoteSettings.card_type as 'sentence' | 'word')
    store.setShowFurigana(remoteSettings.show_furigana)
    store.setIntensiveMode(remoteSettings.intensive_mode)
    store.setPlaybackRate(remoteSettings.playback_speed)
  } else {
    // First sign-in — push local settings to cloud
    await pushSettings(currentSettingsSnapshot())
  }

  // ── Progress ─────────────────────────────────────────────────────────────
  const { data: progressRows } = await supabase
    .from('progress')
    .select('*')
    .eq('user_id', user.id)

  if (progressRows) {
    for (const row of progressRows as SyncProgress[]) {
      if (row.book_id === 'yaneura') {
        const localTime = parseFloat(localStorage.getItem('ondoku_time') ?? '0') || 0
        // Use whichever position is further ahead
        if (row.playback_time > localTime) {
          localStorage.setItem('ondoku_ep', String(row.ep_index))
          localStorage.setItem('ondoku_time', String(Math.floor(row.playback_time)))
        }
      } else {
        const meta = await getBook(row.book_id)
        if (meta && row.playback_time > meta.lastTime) {
          const { updateBookProgress } = await import('./bookLibrary')
          await updateBookProgress(row.book_id, row.playback_time, row.progress_pct)
        }
      }
    }
  }

  // ── Books ─────────────────────────────────────────────────────────────────
  const { data: cloudBooks } = await supabase
    .from('books')
    .select('*')
    .eq('user_id', user.id)

  if (cloudBooks) {
    const localBooks = await getBooks()
    const localIds = new Set(localBooks.map((b) => b.id))

    for (const row of cloudBooks) {
      if (!localIds.has(row.id)) {
        // Book exists in cloud but not locally — restore metadata + sentences
        // Audio must be re-uploaded by the user on this device
        const meta: BookMeta = {
          id: row.id,
          title: row.title,
          author: row.author,
          audioFilename: row.audio_filename,
          sentenceCount: row.sentence_count,
          progress: 0,
          lastTime: 0,
          coverGradient: row.cover_gradient,
          createdAt: new Date(row.created_at).getTime(),
        }
        await restoreBookFromCloud(meta, row.sentences as AlignedSentenceInput[])
      }
    }
  }

  // ── Mining queue ──────────────────────────────────────────────────────────
  const { data: cloudQueue } = await supabase
    .from('mining_queue')
    .select('*')
    .eq('user_id', user.id)

  const { getQueue, addToLocalQueue } = await import('./miningQueue')
  const localQueue = await getQueue()

  // Push local → cloud (backfills cards queued before sync existed, or after failed push)
  for (const card of localQueue) {
    await supabase.from('mining_queue').upsert({
      id: card.id,
      user_id: user.id,
      queued_at: card.timestamp,
      front: card.front,
      back: card.back,
      sentence: card.sentence,
      word: card.word,
      jlpt: card.jlpt,
      deck: card.deck,
      audio_filename: card.audioFilename,
      audio_base64: card.audioBase64,
    })
  }

  // Pull cloud → local (adds cards queued on other devices)
  if (cloudQueue && cloudQueue.length > 0) {
    const localIds = new Set(localQueue.map((c) => c.id))
    for (const row of cloudQueue) {
      if (!localIds.has(row.id)) {
        await addToLocalQueue({
          id: row.id,
          timestamp: row.queued_at,
          front: row.front,
          back: row.back,
          sentence: row.sentence,
          word: row.word,
          jlpt: row.jlpt,
          deck: row.deck,
          audioFilename: row.audio_filename,
          audioBase64: row.audio_base64,
          wordAudioFilename: row.word_audio_filename ?? null,
          wordAudioBase64: row.word_audio_base64 ?? null,
        })
      }
    }
  }

  store.setLastSyncedAt(Date.now())
}
