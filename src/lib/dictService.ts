/**
 * dictService — main-thread interface to the dictionary Web Worker.
 * Spawns the worker once, exposes typed async functions, and streams
 * download progress into a Zustand-compatible atom.
 */

import { wrap, type Remote } from 'comlink'
import type { DictEntry, DictStatus, KanjiBreakdown } from './dictTypes'

type WorkerAPI = {
  lookupWord(surface: string): Promise<DictEntry | null>
  lookupLongest(text: string): Promise<DictEntry | null>
  lookupKanji(char: string): Promise<KanjiBreakdown | null>
  getStatus(): Promise<DictStatus>
  setStatusCallback(cb: (s: DictStatus) => void): Promise<void>
  init(): Promise<void>
}

let workerAPI: Remote<WorkerAPI> | null = null
let statusListeners: ((s: DictStatus) => void)[] = []

function getWorker(): Remote<WorkerAPI> {
  if (!workerAPI) {
    const worker = new Worker(
      new URL('../workers/dict.worker.ts', import.meta.url),
      { type: 'module' }
    )
    workerAPI = wrap<WorkerAPI>(worker)

    // Forward status updates to all listeners
    // (Comlink can't proxy callbacks directly — we poll instead)
    let lastState = ''
    const poll = setInterval(async () => {
      try {
        const s = await workerAPI!.getStatus()
        if (s.state !== lastState || s.progress > 0) {
          lastState = s.state
          statusListeners.forEach((cb) => cb(s))
          if (s.state === 'ready' || s.state === 'error') {
            clearInterval(poll)
          }
        }
      } catch {
        clearInterval(poll)
      }
    }, 250)
  }
  return workerAPI
}

/** Start loading the DB immediately (call once on app boot). */
export function preloadDict(): void {
  getWorker().init().catch(console.error)
}

/** Subscribe to loading status updates. */
export function onDictStatus(cb: (s: DictStatus) => void): () => void {
  statusListeners.push(cb)
  return () => {
    statusListeners = statusListeners.filter((l) => l !== cb)
  }
}

/**
 * Look up a word by exact surface form (kanji or kana).
 */
export async function lookupWord(surface: string): Promise<DictEntry | null> {
  try {
    return await getWorker().lookupWord(surface)
  } catch (e) {
    console.error('[dictService] lookupWord failed:', e)
    return null
  }
}

/**
 * Find the longest matching dictionary entry starting at the beginning of `text`.
 * Use this for tap-to-lookup on unsegmented Japanese text.
 * e.g. "こんな面白くない..." → looks up "こんな"
 */
export async function lookupLongest(text: string): Promise<DictEntry | null> {
  try {
    return await getWorker().lookupLongest(text)
  } catch (e) {
    console.error('[dictService] lookupLongest failed:', e)
    return null
  }
}

/**
 * Look up a single kanji character.
 */
export async function lookupKanji(char: string): Promise<KanjiBreakdown | null> {
  try {
    return await getWorker().lookupKanji(char)
  } catch (e) {
    console.error('[dictService] lookupKanji failed:', e)
    return null
  }
}
