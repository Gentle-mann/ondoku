// IndexedDB queue for cards mined when Anki is offline (e.g. on mobile).
// Audio base64 is stored alongside the card so it can be uploaded on sync.
// Cards are also mirrored to Supabase so they sync across devices.

import { isAnkiAvailable, storeMediaFile, mineCard } from './ankiConnect'
import { openAppDB } from './db'
import { supabase } from './supabase'

const STORE = 'mining_queue'

export interface QueuedCard {
  id: string              // crypto.randomUUID()
  timestamp: number
  front: string
  back: string            // already contains [sound:filename] if audio present
  sentence: string
  word: string
  jlpt: number | null
  deck: string
  audioFilename: string | null       // sentence audio
  audioBase64: string | null
  wordAudioFilename: string | null   // word-level audio
  wordAudioBase64: string | null
}

// ── Cloud helpers ────────────────────────────────────────────────────────────

async function pushToCloud(card: QueuedCard): Promise<void> {
  if (!supabase) return
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
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
    word_audio_filename: card.wordAudioFilename,
    word_audio_base64: card.wordAudioBase64,
  })
}

async function deleteFromCloud(id: string): Promise<void> {
  if (!supabase) return
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('mining_queue').delete().eq('id', id).eq('user_id', user.id)
  } catch {
    // best-effort — local delete already happened
  }
}

// ── IndexedDB helpers ────────────────────────────────────────────────────────

// Local-only save — used during cloud sync to avoid re-pushing to cloud
export async function addToLocalQueue(card: QueuedCard): Promise<void> {
  const db = await openAppDB()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(card)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  notifyQueueUpdate()
}

export async function addToQueue(card: QueuedCard): Promise<void> {
  await addToLocalQueue(card)
  pushToCloud(card).catch(console.error) // fire-and-forget
}

export async function getQueue(): Promise<QueuedCard[]> {
  const db = await openAppDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () =>
      resolve((req.result ?? []).sort((a, b) => a.timestamp - b.timestamp))
    req.onerror = () => reject(req.error)
  })
}

export async function removeFromQueue(id: string): Promise<void> {
  const db = await openAppDB()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  await deleteFromCloud(id) // awaited so cloud is cleared before caller returns
}

export async function getQueueCount(): Promise<number> {
  const db = await openAppDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).count()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// ── Sync ─────────────────────────────────────────────────────────────────────

export async function syncQueueToAnki(): Promise<{ synced: number; failed: number }> {
  const available = await isAnkiAvailable()
  if (!available) return { synced: 0, failed: 0 }

  const queue = await getQueue()
  let synced = 0
  let failed = 0

  for (const card of queue) {
    try {
      // Upload audio first so [sound:] tags resolve correctly
      if (card.audioFilename && card.audioBase64) {
        await storeMediaFile(card.audioFilename, card.audioBase64)
      }
      if (card.wordAudioFilename && card.wordAudioBase64) {
        await storeMediaFile(card.wordAudioFilename, card.wordAudioBase64)
      }
      await mineCard({
        front: card.front,
        back: card.back,
        sentence: card.sentence,
        word: card.word,
        jlpt: card.jlpt,
        deck: card.deck,
      })
      await removeFromQueue(card.id)
      synced++
    } catch {
      failed++
    }
  }

  notifyQueueUpdate()
  return { synced, failed }
}

// ── Event bus (lightweight cross-component coordination) ─────────────────────

export function notifyQueueUpdate(): void {
  window.dispatchEvent(new Event('ondoku-queue-updated'))
}

export function onQueueUpdate(cb: () => void): () => void {
  window.addEventListener('ondoku-queue-updated', cb)
  return () => window.removeEventListener('ondoku-queue-updated', cb)
}
