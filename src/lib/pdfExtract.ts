// Extract and clean Japanese text from a PDF, split into sentences.

import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'

// Use CDN worker — works in all deployment environments
GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/build/pdf.worker.min.mjs`

// Junk patterns to strip from the extracted text
const JUNK_PATTERNS = [
  /YUYU\s*の日本語\s*Podcast/g,
  /Discord\s*Study\s*Group/g,
  /Youtube/g,
  /YUYU\s*E-book\s*On-line\s*Shop/g,
  /Spotify/g,
  /Apple\s*Podcasts/g,
  /もくじへ戻る/g,
  /屋根裏の散歩者\s*N1[\s\-・]*2/g,
  /N1[\s・]N2\s*レベル/g,
  /[一二三四五六七八九十]章\s*episode\s*\d+[…・\s]*\d*\s*ページ/g,
  /著：[^\n。]+/g,
  /訳：[^\n。]+/g,
  /もくじ/g,
]

// Standalone furigana: short runs of only hiragana (readings placed above kanji in PDF)
const FURIGANA_RE = /^[ぁ-ん]{1,8}$/

const SENTENCE_END_RE = /([。！？])/

export async function extractSentencesFromPdf(file: File): Promise<string[]> {
  const buffer = await file.arrayBuffer()
  const pdf = await getDocument({ data: buffer }).promise

  // Extract text from each page, preserving spatial layout
  const pageTexts: string[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()

    // Group text items by their Y position to reconstruct lines
    const items = content.items
      .filter((item): item is typeof item & { str: string; transform: number[] } =>
        'str' in item && 'transform' in item
      )

    // Sort by Y (descending = top to bottom) then X (left to right)
    items.sort((a, b) => {
      const yDiff = b.transform[5] - a.transform[5]
      if (Math.abs(yDiff) > 3) return yDiff  // Different line
      return a.transform[4] - b.transform[4]  // Same line, left to right
    })

    // Group into lines by Y position
    const lines: string[] = []
    let currentLine = ''
    let lastY = -999

    for (const item of items) {
      const y = item.transform[5]
      if (Math.abs(y - lastY) > 3 && currentLine) {
        lines.push(currentLine.trim())
        currentLine = ''
      }
      currentLine += item.str
      lastY = y
    }
    if (currentLine.trim()) lines.push(currentLine.trim())

    pageTexts.push(lines.join('\n'))
  }

  // Join all pages
  let fullText = pageTexts.join('\n')

  // Remove junk patterns
  for (const pattern of JUNK_PATTERNS) {
    fullText = fullText.replace(pattern, '')
  }

  // Remove page numbers (standalone digits on their own line)
  fullText = fullText.replace(/\n\d{1,3}\n/g, '\n')

  // Remove standalone chapter markers (一, 二, etc. on their own)
  fullText = fullText.replace(/\n[一二三四五六七八九十]\n/g, '\n')

  // Remove standalone furigana lines (short hiragana-only strings)
  const lines = fullText.split('\n')
  const cleanedLines = lines.filter((line) => {
    const trimmed = line.trim()
    if (!trimmed) return false
    if (FURIGANA_RE.test(trimmed)) return false
    return true
  })

  // Join all lines into continuous text
  let text = cleanedLines.join('')

  // Remove typographic spaces between CJK characters
  text = text.replace(/(?<=[一-龥ぁ-んァ-ヶ]) (?=[一-龥ぁ-んァ-ヶ])/g, '')

  // Remove any remaining Latin-only fragments (link URLs, etc.)
  text = text.replace(/https?:\/\/[^\s。]+/g, '')
  text = text.replace(/→\([^)]*\)/g, '')

  // Split at sentence boundaries
  const parts = text.split(SENTENCE_END_RE)
  const sentences: string[] = []
  let current = ''
  for (const part of parts) {
    current += part
    if (SENTENCE_END_RE.test(part)) {
      const s = current.trim()
      if (s) sentences.push(s)
      current = ''
    }
  }
  if (current.trim()) sentences.push(current.trim())

  // Merge split quotes: if a sentence starts with 」, merge with previous
  const merged: string[] = []
  for (const s of sentences) {
    if (s.startsWith('」') && merged.length > 0) {
      merged[merged.length - 1] += s
    } else {
      merged.push(s)
    }
  }

  return merged
}
