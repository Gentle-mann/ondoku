// Book library — IndexedDB (metadata + sentences) + OPFS (audio files).

import { openAppDB } from './db'
import type { AlignedSentence } from './alignment'

export interface BookMeta {
  id: string
  title: string
  author: string
  audioFilename: string   // filename stored in OPFS under /audio/
  sentenceCount: number
  progress: number        // 0–100 visual progress
  lastTime: number        // last playback position (seconds)
  coverGradient: string
  createdAt: number
}

// Sentences from align_book.py don't have id/file yet — we assign those on addBook
export type AlignedSentenceInput = Omit<AlignedSentence, 'id' | 'file'>

// ── OPFS helpers ─────────────────────────────────────────────────────────────

async function getAudioDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle('audio', { create: true })
}

async function writeAudioToOPFS(bookId: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'mp3'
  const filename = `${bookId}.${ext}`
  const dir = await getAudioDir()
  const handle = await dir.getFileHandle(filename, { create: true })
  const writable = await handle.createWritable()
  await writable.write(file)
  await writable.close()
  return filename
}

export async function getAudioFile(audioFilename: string): Promise<File | null> {
  try {
    const dir = await getAudioDir()
    const handle = await dir.getFileHandle(audioFilename)
    return handle.getFile()
  } catch {
    return null
  }
}

// Store audio for an existing book (e.g., re-uploading on a new device).
// Uses the stored audioFilename so it matches what the book expects.
export async function storeAudioForBook(audioFilename: string, file: File): Promise<void> {
  const dir = await getAudioDir()
  const handle = await dir.getFileHandle(audioFilename, { create: true })
  const writable = await handle.createWritable()
  await writable.write(file)
  await writable.close()
}

export async function deleteAudioFromOPFS(audioFilename: string): Promise<void> {
  try {
    const dir = await getAudioDir()
    await dir.removeEntry(audioFilename)
  } catch {
    // ignore if not found
  }
}

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

export async function addBook(
  meta: Omit<BookMeta, 'id' | 'audioFilename' | 'progress' | 'lastTime' | 'createdAt' | 'coverGradient'>,
  sentences: AlignedSentenceInput[],
  audioFile: File,
): Promise<BookMeta> {
  const id = crypto.randomUUID()
  const gradients = [
    'from-indigo-900 to-indigo-700',
    'from-rose-900 to-rose-700',
    'from-emerald-900 to-emerald-700',
    'from-amber-900 to-amber-700',
    'from-violet-900 to-violet-700',
    'from-cyan-900 to-cyan-700',
  ]
  const coverGradient = gradients[Math.floor(Math.random() * gradients.length)]

  const audioFilename = await writeAudioToOPFS(id, audioFile)

  const bookMeta: BookMeta = {
    id,
    title: meta.title,
    author: meta.author,
    audioFilename,
    sentenceCount: sentences.length,
    progress: 0,
    lastTime: 0,
    coverGradient,
    createdAt: Date.now(),
  }

  // Tag sentences with the book's audio filename
  const taggedSentences: AlignedSentence[] = sentences.map((s, i) => ({
    ...s,
    id: i,
    file: audioFilename,
  }))

  const db = await openAppDB()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['books', 'book_sentences'], 'readwrite')
    tx.objectStore('books').put(bookMeta)
    tx.objectStore('book_sentences').put({ bookId: id, sentences: taggedSentences })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })

  return bookMeta
}

export async function updateSentences(
  bookId: string,
  sentences: AlignedSentence[],
): Promise<void> {
  const db = await openAppDB()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('book_sentences', 'readwrite')
    tx.objectStore('book_sentences').put({ bookId, sentences })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getBooks(): Promise<BookMeta[]> {
  const db = await openAppDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readonly')
    const req = tx.objectStore('books').getAll()
    req.onsuccess = () =>
      resolve((req.result ?? []).sort((a, b) => a.createdAt - b.createdAt))
    req.onerror = () => reject(req.error)
  })
}

export async function getBook(id: string): Promise<BookMeta | null> {
  const db = await openAppDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readonly')
    const req = tx.objectStore('books').get(id)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function getSentences(bookId: string): Promise<AlignedSentence[]> {
  const db = await openAppDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('book_sentences', 'readonly')
    const req = tx.objectStore('book_sentences').get(bookId)
    req.onsuccess = () => resolve(req.result?.sentences ?? [])
    req.onerror = () => reject(req.error)
  })
}

export async function updateBookProgress(
  id: string,
  lastTime: number,
  progress: number,
): Promise<void> {
  const db = await openAppDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readwrite')
    const store = tx.objectStore('books')
    const req = store.get(id)
    req.onsuccess = () => {
      const book = req.result
      if (!book) return resolve()
      store.put({ ...book, lastTime, progress })
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// Restore a book that exists in cloud but has no local audio.
// Creates IndexedDB entries; the audio file must be uploaded separately.
export async function restoreBookFromCloud(
  meta: BookMeta,
  sentences: AlignedSentenceInput[],
): Promise<void> {
  const taggedSentences: AlignedSentence[] = sentences.map((s, i) => ({
    ...s,
    id: i,
    file: meta.audioFilename,
  }))

  const db = await openAppDB()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['books', 'book_sentences'], 'readwrite')
    // Don't overwrite an existing book (e.g. user already has it with audio)
    const check = tx.objectStore('books').get(meta.id)
    check.onsuccess = () => {
      if (!check.result) {
        tx.objectStore('books').put(meta)
        tx.objectStore('book_sentences').put({ bookId: meta.id, sentences: taggedSentences })
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function removeBook(id: string): Promise<void> {
  const meta = await getBook(id)
  if (meta) await deleteAudioFromOPFS(meta.audioFilename)

  const db = await openAppDB()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['books', 'book_sentences'], 'readwrite')
    tx.objectStore('books').delete(id)
    tx.objectStore('book_sentences').delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ── Alignment JSON format (from align_book.py) ───────────────────────────────

export interface AlignmentJSON {
  title: string
  author: string
  sentences: Array<{
    start: number
    end: number
    text: string
    furigana?: { word: string; reading: string }[]
  }>
}

export function parseAlignmentJSON(raw: unknown): AlignmentJSON {
  const obj = raw as Record<string, unknown>
  if (!obj.sentences || !Array.isArray(obj.sentences)) {
    throw new Error('Invalid alignment JSON: missing sentences array')
  }
  return {
    title: String(obj.title ?? 'Untitled'),
    author: String(obj.author ?? 'Unknown'),
    sentences: obj.sentences as AlignmentJSON['sentences'],
  }
}
