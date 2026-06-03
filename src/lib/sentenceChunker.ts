// Convert Whisper ASR chunks into AlignedSentenceInput records.
// Whisper returns 30s chunks; this splits them at Japanese sentence boundaries
// and assigns time offsets proportionally.

import type { AlignedSentenceInput } from './bookLibrary'

const SENTENCE_END = /([。！？\.\!\?]+)/

interface WhisperChunk {
  text: string
  timestamp: [number, number | null]
}

export function chunksToSentences(chunks: WhisperChunk[]): AlignedSentenceInput[] {
  const sentences: AlignedSentenceInput[] = []

  for (const chunk of chunks) {
    const text = chunk.text.trim()
    if (!text) continue

    const [chunkStart, chunkEnd] = chunk.timestamp
    const end = chunkEnd ?? chunkStart + 5  // fallback if no end timestamp

    // Split chunk text at sentence boundaries
    const parts = splitAtBoundaries(text)
    if (parts.length === 1) {
      sentences.push({ start: round(chunkStart), end: round(end), text: parts[0] })
      continue
    }

    // Distribute chunk time proportionally by character count
    const totalChars = parts.reduce((s, p) => s + p.length, 0)
    const duration = end - chunkStart
    let t = chunkStart
    for (const part of parts) {
      const partEnd = t + duration * (part.length / totalChars)
      sentences.push({ start: round(t), end: round(partEnd), text: part })
      t = partEnd
    }
  }

  // Merge very short segments (<1s) into previous sentence
  return mergeShort(sentences)
}

function splitAtBoundaries(text: string): string[] {
  const result: string[] = []
  const pieces = text.split(SENTENCE_END)
  let current = ''
  for (const piece of pieces) {
    current += piece
    if (SENTENCE_END.test(piece) && current.trim()) {
      result.push(current.trim())
      current = ''
    }
  }
  if (current.trim()) result.push(current.trim())
  return result.filter(Boolean)
}

function mergeShort(sentences: AlignedSentenceInput[]): AlignedSentenceInput[] {
  const MIN_DURATION = 0.8
  const result: AlignedSentenceInput[] = []
  for (const s of sentences) {
    const last = result[result.length - 1]
    if (last && s.end - s.start < MIN_DURATION && s.text.length < 8) {
      // Merge into previous
      result[result.length - 1] = {
        ...last,
        end: s.end,
        text: last.text + s.text,
      }
    } else {
      result.push(s)
    }
  }
  return result
}

function round(n: number) {
  return Math.round(n * 100) / 100
}
