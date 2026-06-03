// Background alignment queue — tracks books being force-aligned after upload.
// Persists pending jobs to localStorage so they survive page refreshes.

import type { AlignedSentence } from './alignment'
import { updateSentences, getAudioFile } from './bookLibrary'
import { forceAlignUpload } from './audioClip'

export type AlignStatus = 'aligning' | 'done' | 'failed'

interface AlignJob {
  bookId: string
  status: AlignStatus
  audioFilename: string
  progress: number  // 0-100 estimated
}

interface PendingJob {
  bookId: string
  audioFilename: string
  sentences: string[]
  audioSizeBytes: number
}

const STORAGE_KEY = 'ondoku_pending_align'
const jobs = new Map<string, AlignJob>()
const timers = new Map<string, ReturnType<typeof setInterval>>()

export function getAlignStatus(bookId: string): AlignStatus | null {
  const job = jobs.get(bookId)
  if (job) return job.status
  const pending = getPendingJobs()
  if (pending.some((j) => j.bookId === bookId)) return 'aligning'
  return null
}

export function getAlignProgress(bookId: string): number {
  return jobs.get(bookId)?.progress ?? 0
}

export function onAlignUpdate(cb: () => void): () => void {
  window.addEventListener('ondoku-align-update', cb)
  return () => window.removeEventListener('ondoku-align-update', cb)
}

function notify() {
  window.dispatchEvent(new Event('ondoku-align-update'))
}

function getPendingJobs(): PendingJob[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

function savePendingJob(job: PendingJob) {
  const pending = getPendingJobs().filter((j) => j.bookId !== job.bookId)
  pending.push(job)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pending))
}

function removePendingJob(bookId: string) {
  const pending = getPendingJobs().filter((j) => j.bookId !== bookId)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pending))
}

function startProgressTimer(bookId: string, audioSizeBytes: number) {
  // Estimate total time: ~128kbps audio, alignment takes ~1.5x realtime
  const estimatedAudioDuration = audioSizeBytes / (128 * 1024 / 8)  // seconds
  const estimatedAlignTime = Math.max(60, estimatedAudioDuration * 1.5) // seconds, min 60s
  // Add 15s for cold start
  const totalEstimate = estimatedAlignTime + 15
  const startTime = Date.now()

  const timer = setInterval(() => {
    const job = jobs.get(bookId)
    if (!job || job.status !== 'aligning') {
      clearInterval(timer)
      timers.delete(bookId)
      return
    }
    const elapsed = (Date.now() - startTime) / 1000
    // Use asymptotic curve: approaches 95% but never reaches 100%
    const pct = Math.min(95, Math.round((1 - Math.exp(-elapsed / (totalEstimate * 0.4))) * 100))
    job.progress = pct
    notify()
  }, 2000)

  timers.set(bookId, timer)
}

async function runAlignment(
  bookId: string,
  audioFilename: string,
  sentences: string[],
  audioFile: File,
) {
  jobs.set(bookId, { bookId, status: 'aligning', audioFilename, progress: 0 })
  notify()

  startProgressTimer(bookId, audioFile.size)

  try {
    console.log(`[align] Starting alignment for ${bookId} (${sentences.length} sentences, ${(audioFile.size / 1024 / 1024).toFixed(1)}MB audio)`)
    const aligned = await forceAlignUpload(audioFile, sentences)
    if (aligned && Array.isArray(aligned) && aligned.length > 0) {
      const wordCount = aligned.reduce((sum, s) => sum + (s.words?.length ?? 0), 0)
      console.log(`[align] Success: ${aligned.length} sentences, ${wordCount} words`)
      const tagged: AlignedSentence[] = aligned.map((s, i) => ({
        id: i,
        file: audioFilename,
        start: s.start,
        end: s.end,
        text: s.text,
        words: s.words,
      }))
      await updateSentences(bookId, tagged)
      console.log(`[align] Saved to IndexedDB`)
      jobs.set(bookId, { bookId, status: 'done', audioFilename, progress: 100 })
    } else {
      console.warn(`[align] Failed: no results returned`, aligned)
      jobs.set(bookId, { bookId, status: 'failed', audioFilename, progress: 0 })
    }
  } catch (err) {
    console.error(`[align] Error:`, err)
    jobs.set(bookId, { bookId, status: 'failed', audioFilename, progress: 0 })
  }

  // Clean up timer
  const timer = timers.get(bookId)
  if (timer) { clearInterval(timer); timers.delete(bookId) }

  removePendingJob(bookId)
  notify()

  setTimeout(() => {
    jobs.delete(bookId)
    notify()
  }, 5000)
}

export function startBackgroundAlign(
  bookId: string,
  audioFile: File,
  audioFilename: string,
  sentences: string[],
): void {
  // Persist job so it survives refresh
  savePendingJob({ bookId, audioFilename, sentences, audioSizeBytes: audioFile.size })
  runAlignment(bookId, audioFilename, sentences, audioFile)
}

// Resume any pending jobs on page load (audio retrieved from OPFS)
export async function resumePendingAlignments(): Promise<void> {
  const pending = getPendingJobs()
  if (pending.length === 0) return

  for (const job of pending) {
    // Skip if already running
    if (jobs.has(job.bookId)) continue

    const audioFile = await getAudioFile(job.audioFilename)
    if (!audioFile) {
      // Audio not available — remove stale job
      removePendingJob(job.bookId)
      continue
    }

    // getAudioFile returns a File object from OPFS
    runAlignment(job.bookId, job.audioFilename, job.sentences, audioFile)
  }
}
