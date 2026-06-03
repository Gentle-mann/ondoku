import { useState } from 'react'
import { Loader2, Check, X, Clock } from 'lucide-react'
import { useReaderStore } from '../store/readerStore'
import type { AlignedSentence } from '../lib/alignment'
import { lookupLongest } from '../lib/dictService'
import { mineCard, storeMediaFile, isAnkiAvailable } from '../lib/ankiConnect'
import { generateCard, buildBasicCard } from '../lib/generateCard'
import { getAudioClip, getAudioClipByFilename } from '../lib/audioClip'
import { addToQueue } from '../lib/miningQueue'

type State = 'picking' | 'loading' | 'success' | 'queued' | 'error'

export function MineWordPicker() {
  const {
    showMinePicker,
    activeSentence,
    currentEpIndex,
    currentBookId,
    ankiDeck,
    claudeApiKey,
    cardType,
    setShowMinePicker,
  } = useReaderStore()

  const [state, setState] = useState<State>('picking')
  const [errorMsg, setErrorMsg] = useState('')
  const [audioStatus, setAudioStatus] = useState<'none' | 'ok' | 'failed'>('none')

  if (!showMinePicker || !activeSentence) return null

  const handleClose = () => {
    setState('picking')
    setAudioStatus('none')
    setShowMinePicker(false)
  }

  const handleCharTap = async (chars: string[], fromIndex: number) => {
    const text = chars.slice(fromIndex).join('')
    setState('loading')
    setAudioStatus('none')

    try {
      // ── 1. Dictionary lookup ──────────────────────────────────────────────
      const entry = await lookupLongest(text)
      if (!entry) {
        setErrorMsg('Word not found')
        setState('error')
        setTimeout(() => setState('picking'), 2000)
        return
      }

      // ── 2. Find word timestamps for precise clipping ──────────────────
      const wordTiming = findWordTiming(activeSentence, entry.word)

      // ── 3. Generate card + sentence audio + word audio in parallel ────
      const clipSentence = currentBookId === 'yaneura'
        ? getAudioClip(currentEpIndex, activeSentence.start, activeSentence.end)
        : getAudioClipByFilename(activeSentence.file, activeSentence.start, activeSentence.end)

      const clipWord = wordTiming
        ? (currentBookId === 'yaneura'
            ? getAudioClip(currentEpIndex, wordTiming.start, wordTiming.end)
            : getAudioClipByFilename(activeSentence.file, wordTiming.start, wordTiming.end))
        : Promise.resolve(null)

      const [cardResult, sentenceClipResult, wordClipResult] = await Promise.allSettled([
        claudeApiKey
          ? generateCard(entry, activeSentence.text, claudeApiKey)
          : Promise.resolve(buildBasicCard(entry, activeSentence.text)),
        clipSentence,
        clipWord,
      ])

      if (cardResult.status === 'rejected') throw cardResult.reason

      const { back: rawBack } = cardResult.value
      let back = rawBack + buildFuriganaSection(activeSentence, entry.word)

      // Apply card type
      const front =
        cardType === 'sentence'
          ? buildSentenceFront(activeSentence.text, entry.word)
          : `<div class="word">${entry.word}</div>`

      // Audio on back only for both card types:
      //   sentence card: sentence audio
      //   word card: word audio (the word as spoken in the audiobook)
      const sentenceClip = sentenceClipResult.status === 'fulfilled' ? sentenceClipResult.value : null
      const wordClip = wordClipResult.status === 'fulfilled' ? wordClipResult.value : null
      const clip = cardType === 'sentence' ? sentenceClip : wordClip
      const hasAudio = clip !== null

      const finalFront = front
      const finalBack = clip ? `[sound:${clip.filename}]\n${back}` : back

      // ── 3. Sync or queue ──────────────────────────────────────────────────
      const available = await isAnkiAvailable()

      if (!available) {
        // Anki not reachable — save to local queue for later sync
        await addToQueue({
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          front: finalFront,
          back: finalBack,
          sentence: activeSentence.text,
          word: entry.word,
          jlpt: entry.jlpt,
          deck: ankiDeck,
          audioFilename: clip?.filename ?? null,
          audioBase64: clip?.base64 ?? null,
          wordAudioFilename: null,
          wordAudioBase64: null,
        })
        setAudioStatus(hasAudio ? 'ok' : 'failed')
        setState('queued')
        setTimeout(handleClose, 1800)
        return
      }

      // Anki is available — store audio + add note directly
      let syncedBack = back
      if (clip) {
        try {
          await storeMediaFile(clip.filename, clip.base64)
          syncedBack = `[sound:${clip.filename}]\n${back}`
          setAudioStatus('ok')
        } catch {
          setAudioStatus('failed')
        }
      } else {
        setAudioStatus('failed')
      }

      await mineCard({
        front,
        back: syncedBack,
        sentence: activeSentence.text,
        word: entry.word,
        jlpt: entry.jlpt,
        deck: ankiDeck,
      })

      setState('success')
      setTimeout(handleClose, 1800)
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Failed')
      setState('error')
      setTimeout(() => setState('picking'), 2500)
    }
  }

  const chars = [...activeSentence.text]

  const statusText = () => {
    switch (state) {
      case 'picking': return 'Tap the word to mine'
      case 'loading': return 'Generating card…'
      case 'error':   return errorMsg
      case 'queued':  return `Saved to queue${audioStatus === 'ok' ? ' with audio' : ''}`
      case 'success': return audioStatus === 'ok' ? 'Added with audio!' : 'Added to Anki!'
    }
  }

  return (
    <>
      <div className="absolute inset-0 bg-black/60 z-40" onClick={handleClose} />
      <div
        className="absolute bottom-[52px] left-0 right-0 z-50 rounded-t-[16px] px-5 pt-4 pb-6"
        style={{ backgroundColor: '#1A1A1A', boxShadow: '0 -4px 24px rgba(0,0,0,0.5)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <p className="font-sans text-[13px] text-muted-foreground">{statusText()}</p>
          <button onClick={handleClose} className="p-1 active:opacity-60">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="font-serif text-[18px] leading-[2.2] text-center">
          {state === 'loading' && (
            <div className="flex items-center justify-center py-4 gap-2">
              <Loader2 className="w-5 h-5 text-accent animate-spin" />
              <span className="font-sans text-sm text-muted-foreground">Generating card…</span>
            </div>
          )}
          {state === 'success' && (
            <div className="flex items-center justify-center py-4 gap-2">
              <Check className="w-6 h-6" style={{ color: '#4CAF50' }} />
              <span className="font-sans text-sm" style={{ color: '#4CAF50' }}>
                {audioStatus === 'ok' ? 'Added with audio!' : 'Added to Anki!'}
              </span>
            </div>
          )}
          {state === 'queued' && (
            <div className="flex items-center justify-center py-4 gap-2">
              <Clock className="w-6 h-6" style={{ color: '#C8A96E' }} />
              <span className="font-sans text-sm" style={{ color: '#C8A96E' }}>
                Queued — sync when Anki is open
              </span>
            </div>
          )}
          {(state === 'picking' || state === 'error') &&
            chars.map((char, i) => (
              <span
                key={i}
                className="cursor-pointer rounded px-[1px] transition-colors active:bg-accent/30"
                style={{ color: isJapanese(char) ? '#eee' : '#666' }}
                onClick={() => isJapanese(char) && handleCharTap(chars, i)}
              >
                {char}
              </span>
            ))}
        </div>

        {/* Footer */}
        <p className="font-sans text-[11px] text-muted-foreground text-center mt-3">
          Card:{' '}
          <span style={{ color: '#C8A96E' }}>
            {cardType === 'sentence' ? 'Sentence + word' : 'Word only'}
          </span>
          {' · '}AI:{' '}
          <span style={{ color: claudeApiKey ? '#4CAF50' : '#666' }}>
            {claudeApiKey ? 'on' : 'off'}
          </span>
        </p>
      </div>
    </>
  )
}

function isJapanese(ch: string): boolean {
  const code = ch.charCodeAt(0)
  return (code >= 0x3040 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff)
}

function buildSentenceFront(sentence: string, targetWord: string): string {
  const highlighted = sentence.replace(
    targetWord,
    `<b style="color:#C8A96E;text-decoration:underline">${targetWord}</b>`
  )
  return `<div class="sentence-front">${highlighted}</div>`
}

/**
 * Find the precise start/end timestamps for a word within a sentence
 * using the force-aligned word-level data.
 * If the word spans multiple tokens (e.g. compound), merges their time ranges.
 */
function findWordTiming(
  sentence: AlignedSentence,
  targetWord: string,
): { start: number; end: number } | null {
  if (!sentence.words || sentence.words.length === 0) return null

  // Try exact single-token match first
  const exact = sentence.words.find((w) => w.text === targetWord)
  if (exact) return { start: exact.start, end: exact.end }

  // Try matching across consecutive tokens (compound words)
  let accumulated = ''
  let startIdx = -1
  for (let i = 0; i < sentence.words.length; i++) {
    const w = sentence.words[i]
    // Skip punctuation-only tokens when searching
    if (!accumulated && w.text !== targetWord[0] && !targetWord.startsWith(w.text)) {
      continue
    }

    if (startIdx === -1) startIdx = i
    accumulated += w.text

    if (accumulated === targetWord) {
      return { start: sentence.words[startIdx].start, end: w.end }
    }

    if (!targetWord.startsWith(accumulated)) {
      // Reset — no match from this start position
      accumulated = ''
      startIdx = -1
      // Retry this token as a potential start
      if (targetWord.startsWith(w.text)) {
        accumulated = w.text
        startIdx = i
      }
    }
  }

  return null
}

function buildFuriganaSection(sentence: AlignedSentence, targetWord: string): string {
  const furigana = sentence.furigana
  let inner: string

  if (!furigana || furigana.length === 0) {
    inner = sentence.text
  } else {
    const parts: string[] = []
    let remaining = sentence.text
    for (const { word, reading } of furigana) {
      const idx = remaining.indexOf(word)
      if (idx === -1) continue
      if (idx > 0) parts.push(remaining.slice(0, idx))
      const isTarget = word === targetWord
      parts.push(
        `<ruby${isTarget ? ' style="color:#C8A96E;font-weight:bold"' : ''}>${word}<rp>(</rp><rt style="font-size:0.55em;opacity:0.7">${reading}</rt><rp>)</rp></ruby>`
      )
      remaining = remaining.slice(idx + word.length)
    }
    if (remaining) parts.push(remaining)
    inner = parts.join('')
  }

  return `
<hr>
<div class="section">
  <div class="section-title">読み方</div>
  <div style="font-family:'Hiragino Mincho ProN','Yu Mincho',serif;font-size:15px;line-height:2.2;color:#ccc">${inner}</div>
</div>`
}
