// Audio clip extraction — two-tier:
//   1. Local clip_server.py  (ffmpeg, lossless, fast)
//   2. Vercel /api/audioclip  (resolves GitHub redirect server-side, Range works)
//      — only for built-in 屋根裏 episodes

import { audioPlayer } from './audioPlayer'

const CLIP_SERVER = 'http://localhost:8766'
const CLIP_ENDPOINT = 'https://ondoku-khaki.vercel.app/api/audioclip'
const EP_FILES = Array.from(
  { length: 8 },
  (_, i) => `yanerura_N1_2_ep${String(i + 1).padStart(2, '0')}.mp3`
)

export interface AudioClip {
  filename: string
  base64: string
}

export async function checkClipServer(): Promise<boolean> {
  try {
    const res = await fetch(CLIP_SERVER, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

// Built-in 屋根裏: epIndex + timestamps
export async function getAudioClip(
  epIndex: number,
  start: number,
  end: number,
): Promise<AudioClip | null> {
  // Tier 1: local Python server (ffmpeg, best quality)
  try {
    const res = await fetch(`${CLIP_SERVER}/clip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ episode: epIndex, start, end }),
      signal: AbortSignal.timeout(10000),
    })
    if (res.ok) {
      const json = await res.json()
      return { filename: json.filename as string, base64: json.data as string }
    }
  } catch {
    // fall through
  }

  // Tier 2: Vercel endpoint handles GitHub redirect + Range server-side
  try {
    const params = new URLSearchParams({
      ep: String(epIndex),
      start: String(start),
      end: String(end),
      duration: String(audioPlayer.duration),
    })
    const res = await fetch(`${CLIP_ENDPOINT}?${params}`, {
      signal: AbortSignal.timeout(25000),
    })
    if (res.ok) {
      const json = await res.json()
      if (json.data) return { filename: json.filename as string, base64: json.data as string }
    }
  } catch {
    // fall through
  }

  return null
}

// User book: clip by filename — try local server, fall back to browser clipping
export async function getAudioClipByFilename(
  audioFilename: string,
  start: number,
  end: number,
): Promise<AudioClip | null> {
  // Tier 1: local Python server
  try {
    const res = await fetch(`${CLIP_SERVER}/clip_file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: audioFilename, start, end }),
      signal: AbortSignal.timeout(10000),
    })
    if (res.ok) {
      const json = await res.json()
      return { filename: json.filename as string, base64: json.data as string }
    }
  } catch {
    // fall through to browser clipping
  }

  // Tier 2: browser-based clipping using Web Audio API
  return clipInBrowser(start, end, audioFilename)
}

// Clip audio in the browser using the currently loaded audio source
async function clipInBrowser(
  start: number,
  end: number,
  filenameHint: string,
): Promise<AudioClip | null> {
  try {
    // Get the audio source URL from the player
    const audioSrc = audioPlayer.getAudioSrc()
    if (!audioSrc) return null

    const response = await fetch(audioSrc)
    const arrayBuffer = await response.arrayBuffer()

    const ctx = new OfflineAudioContext(1, Math.ceil((end - start + 1.5) * 44100), 44100)
    const decoded = await ctx.decodeAudioData(arrayBuffer)

    const padStart = Math.max(0, start - 1.5)
    const padEnd = end + 0.3
    const duration = padEnd - padStart

    const offlineCtx = new OfflineAudioContext(1, Math.ceil(duration * 44100), 44100)
    const source = offlineCtx.createBufferSource()
    source.buffer = decoded
    source.connect(offlineCtx.destination)
    source.start(0, padStart, duration)

    const rendered = await offlineCtx.startRendering()

    // Encode as WAV
    const wavData = encodeWav(rendered)
    const base64 = btoa(String.fromCharCode(...new Uint8Array(wavData)))

    const startMs = Math.round(padStart * 1000)
    const endMs = Math.round(padEnd * 1000)
    const stem = filenameHint.replace(/\.[^.]+$/, '')
    const filename = `ondoku_${stem}_${startMs}_${endMs}.wav`

    return { filename, base64 }
  } catch {
    return null
  }
}

function encodeWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = 1
  const sampleRate = buffer.sampleRate
  const samples = buffer.getChannelData(0)
  const dataLength = samples.length * 2
  const buf = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buf)

  // WAV header
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * 2, true)
  view.setUint16(32, numChannels * 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, dataLength, true)

  // Write samples
  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
    offset += 2
  }
  return buf
}

// Force-align sentences to audio via local Python server (stable-ts)
// Returns upgraded sentences with word-level timestamps, or null if server unavailable
export interface ForceAlignedSentence {
  start: number
  end: number
  text: string
  words: { text: string; start: number; end: number }[]
}

export async function forceAlign(
  audioFilename: string,
  sentences: string[],
): Promise<ForceAlignedSentence[] | null> {
  try {
    const res = await fetch(`${CLIP_SERVER}/force_align`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: audioFilename, sentences }),
      signal: AbortSignal.timeout(600000), // 10 min — alignment is slow
    })
    if (res.ok) {
      return await res.json()
    }
  } catch {
    // server not running or alignment failed — graceful fallback
  }
  return null
}

// Force-align with audio data — tries cloud (Modal) first, then local server
// Compress audio to 8kHz mono 8-bit WAV for upload (~0.5MB per minute)
async function compressAudioForUpload(audioFile: File): Promise<Blob> {
  const buffer = await audioFile.arrayBuffer()
  const audioCtx = new AudioContext({ sampleRate: 8000 })
  const decoded = await audioCtx.decodeAudioData(buffer)
  await audioCtx.close()

  const length = Math.ceil(decoded.duration * 8000)
  const offlineCtx = new OfflineAudioContext(1, length, 8000)
  const source = offlineCtx.createBufferSource()
  source.buffer = decoded
  source.connect(offlineCtx.destination)
  source.start()
  const rendered = await offlineCtx.startRendering()
  const samples = rendered.getChannelData(0)

  // Encode as 8-bit WAV
  const dataLength = samples.length
  const wavBuf = new ArrayBuffer(44 + dataLength)
  const view = new DataView(wavBuf)
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 8000, true)
  view.setUint32(28, 8000, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)
  writeStr(36, 'data')
  view.setUint32(40, dataLength, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setUint8(44 + i, Math.round((s + 1) * 127.5))
  }

  console.log(`[align] Compressed: ${(audioFile.size / 1024 / 1024).toFixed(1)}MB -> ${(wavBuf.byteLength / 1024 / 1024).toFixed(1)}MB (8kHz 8-bit, ${decoded.duration.toFixed(0)}s)`)
  return new Blob([wavBuf], { type: 'audio/wav' })
}

// Modal endpoint — direct chunk-by-chunk alignment
const MODAL_URL = 'https://gentle-mann--ondoku-align-process.modal.run'

// Convert ArrayBuffer to base64
function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

// Slice raw PCM WAV (8kHz 8-bit mono) to a time range
function sliceWav(wavBuf: ArrayBuffer, startSec: number, endSec: number): ArrayBuffer {
  const headerSize = 44
  const sampleRate = 8000
  const startByte = Math.max(headerSize, headerSize + Math.floor(startSec * sampleRate))
  const endByte = Math.min(wavBuf.byteLength, headerSize + Math.ceil(endSec * sampleRate))
  if (endByte <= startByte) return new ArrayBuffer(44)
  const dataBytes = new Uint8Array(wavBuf).slice(startByte, endByte)

  const buf = new ArrayBuffer(headerSize + dataBytes.length)
  const view = new DataView(buf)
  const w = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); view.setUint32(4, 36 + dataBytes.length, true); w(8, 'WAVE'); w(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate, true)
  view.setUint16(32, 1, true); view.setUint16(34, 8, true); w(36, 'data')
  view.setUint32(40, dataBytes.length, true)
  new Uint8Array(buf, headerSize).set(dataBytes)
  return buf
}

export async function forceAlignUpload(
  audioFile: File,
  sentences: string[],
): Promise<ForceAlignedSentence[] | null> {
  // Compress audio
  let wavBuf: ArrayBuffer
  try {
    const blob = await compressAudioForUpload(audioFile)
    wavBuf = await blob.arrayBuffer()
  } catch (err) {
    console.warn('[align] Compression failed:', err)
    return null
  }

  const totalDuration = (wavBuf.byteLength - 44) / 8000
  // 3 sentences per chunk — conservative to ensure all sentences fit in the audio window
  const SENTS_PER_CHUNK = 3
  const numChunks = Math.ceil(sentences.length / SENTS_PER_CHUNK)

  console.log(`[align] ${sentences.length} sentences, ${totalDuration.toFixed(0)}s, ${numChunks} chunks of ${SENTS_PER_CHUNK}`)

  const allResults: ForceAlignedSentence[] = []
  let lastEnd = 0

  for (let c = 0; c < numChunks; c++) {
    const sStart = c * SENTS_PER_CHUNK
    const sEnd = Math.min(sStart + SENTS_PER_CHUNK, sentences.length)
    if (sStart >= sentences.length) break
    const chunkSents = sentences.slice(sStart, sEnd)
    if (chunkSents.length === 0) break

    // Audio: start from last aligned end, give generous range
    const aStart = Math.max(0, lastEnd - 2)
    // Estimate how much audio these sentences need (~12s per sentence average)
    const estimatedDur = chunkSents.length * (totalDuration / sentences.length) + 15
    const aEnd = Math.min(totalDuration, aStart + Math.max(estimatedDur, 30))

    const chunkWav = sliceWav(wavBuf, aStart, aEnd)
    const base64 = bufToBase64(chunkWav)

    console.log(`[align] Chunk ${c + 1}/${numChunks}: ${chunkSents.length} sents, ${aStart.toFixed(0)}-${aEnd.toFixed(0)}s, ${(base64.length / 1024).toFixed(0)}KB`)

    try {
      const res = await fetch(MODAL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'align_chunk', audio: base64, sentences: chunkSents, offset: aStart }),
        signal: AbortSignal.timeout(300000),
      })
      if (res.ok) {
        const data: ForceAlignedSentence[] = await res.json()
        allResults.push(...data)
        if (data.length > 0) lastEnd = data[data.length - 1].end
        console.log(`[align] Chunk ${c + 1}: ${data.length} sentences`)
      } else {
        console.warn(`[align] Chunk ${c + 1} error ${res.status}`)
        for (const s of chunkSents) allResults.push({ start: lastEnd, end: lastEnd + 1, text: s, words: [] })
        lastEnd += chunkSents.length
      }
    } catch (err) {
      console.warn(`[align] Chunk ${c + 1} failed:`, err)
      for (const s of chunkSents) allResults.push({ start: lastEnd, end: lastEnd + 1, text: s, words: [] })
      lastEnd += chunkSents.length
    }
  }

  console.log(`[align] Total: ${allResults.length} sentences`)
  return allResults.length > 0 ? allResults : null
}

// kept for SettingsSheet — checks if local server is up
export { EP_FILES }
