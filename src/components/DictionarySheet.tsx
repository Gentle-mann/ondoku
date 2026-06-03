import { Plus, Loader2, Check, Wand2, Clock, Languages, BookOpen, Sparkles, Volume2 } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { useReaderStore } from '../store/readerStore'
import type { DictEntry, KanjiBreakdown, KanjiExampleWord } from '../lib/dictTypes'
import type { AlignedSentence } from '../lib/alignment'
import { audioPlayer } from '../lib/audioPlayer'
import { mineCard, storeMediaFile, isAnkiAvailable } from '../lib/ankiConnect'
import { generateCard, buildBasicCard, buildSentenceCard } from '../lib/generateCard'
import { addToQueue } from '../lib/miningQueue'
import { getAudioClip, getAudioClipByFilename } from '../lib/audioClip'

const JLPT_LABEL: Record<number, string> = { 1: 'N1', 2: 'N2', 3: 'N3', 4: 'N4', 5: 'N5' }
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const TRANS_CACHE_PREFIX = 'ondoku_trans_'

type MineState = 'idle' | 'generating' | 'success' | 'queued' | 'error'

export function DictionarySheet() {
  const {
    showDictionary, selectedWord, dictEntry, dictLoading, dictStatus,
    activeSentence, dictSentence, precedingSentences, ankiDeck, claudeApiKey, currentBookId, currentEpIndex,
    setShowDictionary,
  } = useReaderStore()

  // Use the sentence the word was tapped in, falling back to the playing sentence
  const contextSentence = dictSentence ?? activeSentence

  const [wordState, setWordState] = useState<MineState>('idle')
  const [sentenceState, setSentenceState] = useState<MineState>('idle')
  const [translation, setTranslation] = useState<string | null>(null)
  const [translating, setTranslating] = useState(false)
  const [aiFallback, setAiFallback] = useState<string | null>(null)
  const [aiFallbackLoading, setAiFallbackLoading] = useState(false)
  const aiFallbackAbort = useRef<AbortController | null>(null)

  const sentenceText = contextSentence?.text ?? ''

  // Reset translation when sentence changes (restore from cache if available)
  useEffect(() => {
    setTranslating(false)
    const cached = sentenceText ? localStorage.getItem(TRANS_CACHE_PREFIX + sentenceText) : null
    setTranslation(cached)
  }, [sentenceText])

  // Auto-trigger AI fallback when dictionary returns nothing
  useEffect(() => {
    if (dictLoading || dictEntry || !selectedWord || !claudeApiKey || !showDictionary) return

    setAiFallback(null)
    aiFallbackAbort.current?.abort()
    const ctrl = new AbortController()
    aiFallbackAbort.current = ctrl

    const cacheKey = `ondoku_aifb_${selectedWord}_${sentenceText.slice(0, 40)}`
    const cached = localStorage.getItem(cacheKey)
    if (cached) { setAiFallback(cached); return }

    setAiFallbackLoading(true)
    fetch(ANTHROPIC_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 250,
        messages: [{
          role: 'user',
          content: `A Japanese learner tapped on "${selectedWord}" while reading.${precedingSentences.length ? `\nPreceding sentences:\n${precedingSentences.map(s => `「${s}」`).join('\n')}` : ''}${sentenceText ? `\nCurrent sentence: 「${sentenceText}」` : ''}

Explain what "${selectedWord}" means here. Include: reading (hiragana), what type of expression it is (compound verb, conjugation, set phrase, etc.), and its meaning in this specific context. Be concise (3–5 sentences max).`,
        }],
      }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return
        const result = data.content[0].text.trim()
        localStorage.setItem(cacheKey, result)
        setAiFallback(result)
      })
      .catch(() => { /* aborted or failed */ })
      .finally(() => setAiFallbackLoading(false))

    return () => ctrl.abort()
  }, [dictLoading, dictEntry, selectedWord, showDictionary]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset fallback when word changes
  useEffect(() => {
    setAiFallback(null)
    setAiFallbackLoading(false)
  }, [selectedWord])

  const handleTranslate = async () => {
    if (!claudeApiKey || !sentenceText || translating) return

    const cacheKey = TRANS_CACHE_PREFIX + sentenceText
    const cached = localStorage.getItem(cacheKey)
    if (cached) { setTranslation(cached); return }

    setTranslating(true)
    try {
      const res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': claudeApiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 200,
          messages: [{
            role: 'user',
            content: `Translate this Japanese sentence to natural English. Japanese often omits subjects — use the preceding sentences to infer who is acting (it may not be the speaker). Output only the translation, nothing else.${precedingSentences.length ? `\n\nPreceding sentences:\n${precedingSentences.map(s => `「${s}」`).join('\n')}` : ''}\n\nTranslate: 「${sentenceText}」`,
          }],
        }),
      })
      if (res.ok) {
        const data = await res.json()
        const trans = data.content[0].text.trim()
        localStorage.setItem(cacheKey, trans)
        setTranslation(trans)
      }
    } catch {
      // silent fail
    } finally {
      setTranslating(false)
    }
  }

  const handleMine = async (cardType: 'word' | 'sentence') => {
    if (!dictEntry) return
    const setState = cardType === 'word' ? setWordState : setSentenceState
    setState('generating')
    try {
      // 1. Generate card
      let front: string
      let back: string
      if (claudeApiKey) {
        const generated = await generateCard(dictEntry, sentenceText, claudeApiKey)
        back = generated.back
      } else {
        const card = cardType === 'sentence'
          ? buildSentenceCard(dictEntry, sentenceText)
          : buildBasicCard(dictEntry, sentenceText)
        back = card.back
      }

      // Front: sentence card = highlighted sentence, word card = just the kanji
      if (cardType === 'sentence' && sentenceText) {
        const highlighted = sentenceText.replace(
          dictEntry.word,
          `<b style="color:#C8A96E">${dictEntry.word}</b>`
        )
        front = `<div class="sentence-front">${highlighted}</div>`
      } else {
        front = `<div class="word">${dictEntry.word}</div>`
      }

      // 2. Audio clip on back only
      //    sentence card → sentence audio, word card → word audio
      let clipFilename: string | null = null
      let clipBase64: string | null = null

      if (contextSentence) {
        try {
          if (cardType === 'sentence') {
            const clip = currentBookId === 'yaneura'
              ? await getAudioClip(currentEpIndex, contextSentence.start, contextSentence.end)
              : await getAudioClipByFilename(contextSentence.file, contextSentence.start, contextSentence.end)
            if (clip) { clipFilename = clip.filename; clipBase64 = clip.base64 }
          } else {
            const wordTiming = findWordTimingInSentence(contextSentence, dictEntry.word)
            if (wordTiming) {
              const clip = currentBookId === 'yaneura'
                ? await getAudioClip(currentEpIndex, wordTiming.start, wordTiming.end)
                : await getAudioClipByFilename(contextSentence.file, wordTiming.start, wordTiming.end)
              if (clip) { clipFilename = clip.filename; clipBase64 = clip.base64 }
            }
          }
          if (clipFilename) {
            back = `[sound:${clipFilename}]\n${back}`
          }
        } catch { /* optional */ }
      }

      // 3. Send to Anki or queue
      const available = await isAnkiAvailable()
      if (available) {
        if (clipFilename && clipBase64) await storeMediaFile(clipFilename, clipBase64)
        await mineCard({ front, back, sentence: sentenceText, word: dictEntry.word, jlpt: dictEntry.jlpt, deck: ankiDeck })
        setState('success')
      } else {
        await addToQueue({
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          front, back,
          sentence: sentenceText,
          word: dictEntry.word,
          jlpt: dictEntry.jlpt,
          deck: ankiDeck,
          audioFilename: clipFilename,
          audioBase64: clipBase64,
          wordAudioFilename: null,
          wordAudioBase64: null,
        })
        setState('queued')
      }

      setTimeout(() => setState('idle'), 2000)
    } catch {
      setState('error')
      setTimeout(() => setState('idle'), 3000)
    }
  }

  if (!showDictionary) return null

  const isDbLoading = dictStatus.state === 'downloading' || dictStatus.state === 'loading'

  return (
    <>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 z-20" onClick={() => setShowDictionary(false)} />

      {/* Sheet */}
      <div
        className="absolute bottom-[52px] left-0 right-0 z-30 rounded-t-[16px] flex flex-col"
        style={{ backgroundColor: '#1A1A1A', maxHeight: '65%', boxShadow: '0 -4px 24px rgba(0,0,0,0.4)' }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-2 shrink-0">
          <div className="w-9 h-1 rounded-full" style={{ backgroundColor: '#333' }} />
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-2 scrollbar-hidden">
          {/* DB loading */}
          {isDbLoading && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 className="w-6 h-6 text-accent animate-spin" />
              <p className="text-sm font-sans text-muted-foreground">
                {dictStatus.state === 'downloading'
                  ? `Downloading dictionary… ${dictStatus.progress}%`
                  : 'Loading dictionary…'}
              </p>
              {dictStatus.state === 'downloading' && dictStatus.progress > 0 && (
                <div className="w-48 h-1 bg-border rounded-full overflow-hidden">
                  <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${dictStatus.progress}%` }} />
                </div>
              )}
            </div>
          )}

          {/* Looking up */}
          {!isDbLoading && dictLoading && (
            <div className="flex items-center justify-center py-10 gap-2">
              <Loader2 className="w-5 h-5 text-accent animate-spin" />
              <span className="text-sm font-sans text-muted-foreground">Looking up…</span>
            </div>
          )}

          {/* Not found — AI fallback */}
          {!isDbLoading && !dictLoading && !dictEntry && selectedWord && (
            <div className="py-6">
              <p className="font-serif text-[24px] text-foreground mb-3">{selectedWord}</p>
              {aiFallbackLoading ? (
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 animate-pulse" style={{ color: '#C8A96E' }} />
                  <span className="font-sans text-[13px] text-muted-foreground">Looking up with AI…</span>
                </div>
              ) : aiFallback ? (
                <div
                  className="rounded-xl px-4 py-3"
                  style={{ backgroundColor: '#111', border: '1px solid #222' }}
                >
                  <div className="flex items-center gap-1.5 mb-2">
                    <Sparkles className="w-3 h-3" style={{ color: '#C8A96E' }} />
                    <span className="font-sans text-[11px] uppercase tracking-wider" style={{ color: '#C8A96E' }}>AI explanation</span>
                  </div>
                  <p className="font-sans text-[14px] text-foreground leading-relaxed">{aiFallback}</p>
                </div>
              ) : !claudeApiKey ? (
                <p className="font-sans text-[13px] text-muted-foreground">
                  Not found in dictionary.{' '}
                  <span style={{ color: '#666' }}>Add a Claude API key in Settings for AI lookup.</span>
                </p>
              ) : (
                <p className="font-sans text-[13px] text-muted-foreground">Not found in dictionary.</p>
              )}
            </div>
          )}

          {/* Entry found */}
          {!isDbLoading && !dictLoading && dictEntry && (
            <>
              {/* Sentence context */}
              {sentenceText && (
                <SentenceContext
                  sentence={sentenceText}
                  targetWord={dictEntry.word}
                  translation={translation}
                  translating={translating}
                  hasApiKey={!!claudeApiKey}
                  onTranslate={handleTranslate}
                />
              )}
              <EntryView
                entry={dictEntry}
                onPlayWord={contextSentence?.words ? () => {
                  const timing = findWordTimingInSentence(contextSentence, dictEntry.word)
                  if (timing) {
                    // Play just the word: seek, play, stop after word ends
                    audioPlayer.seek(timing.start)
                    audioPlayer.play().catch(console.error)
                    setTimeout(() => {
                      if (audioPlayer.currentTime >= timing.start) {
                        audioPlayer.pause('preview')
                      }
                    }, (timing.end - timing.start + 0.3) * 1000)
                  }
                } : undefined}
              />
            </>
          )}
        </div>

        {/* Action buttons */}
        {dictEntry && (
          <div className="flex border-t shrink-0" style={{ borderColor: '#2A2A2A' }}>
            <MineButton
              label="Word card"
              icon={<Plus className="w-4 h-4" />}
              state={wordState}
              onClick={() => handleMine('word')}
              border
            />
            <MineButton
              label="Sentence card"
              icon={<BookOpen className="w-4 h-4" />}
              state={sentenceState}
              onClick={() => handleMine('sentence')}
            />
          </div>
        )}
      </div>
    </>
  )
}

// ── Sentence context box ──────────────────────────────────────────────────────

function SentenceContext({
  sentence, targetWord, translation, translating, hasApiKey, onTranslate,
}: {
  sentence: string
  targetWord: string
  translation: string | null
  translating: boolean
  hasApiKey: boolean
  onTranslate: () => void
}) {
  const parts = sentence.split(targetWord)

  return (
    <div
      className="rounded-xl px-4 py-3 mb-4"
      style={{ backgroundColor: '#111', border: '1px solid #222' }}
    >
      {/* Sentence with word highlighted */}
      <p className="font-serif text-[15px] leading-relaxed text-foreground mb-2">
        {parts.map((part, i) => (
          <span key={i}>
            {part}
            {i < parts.length - 1 && (
              <span style={{ color: '#C8A96E', fontWeight: 600 }}>{targetWord}</span>
            )}
          </span>
        ))}
      </p>

      {/* Translation or translate button */}
      {translation ? (
        <p className="font-sans text-[12px] italic" style={{ color: '#888' }}>{translation}</p>
      ) : hasApiKey ? (
        <button
          onClick={onTranslate}
          disabled={translating}
          className="flex items-center gap-1.5 active:opacity-60"
        >
          {translating
            ? <Loader2 className="w-3 h-3 animate-spin" style={{ color: '#666' }} />
            : <Languages className="w-3 h-3" style={{ color: '#666' }} />}
          <span className="font-sans text-[12px]" style={{ color: '#666' }}>
            {translating ? 'Translating…' : 'Translate'}
          </span>
        </button>
      ) : null}
    </div>
  )
}

// ── Mine button ───────────────────────────────────────────────────────────────

function MineButton({
  label, icon, state, onClick, border,
}: {
  label: string
  icon: React.ReactNode
  state: MineState
  onClick: () => void
  border?: boolean
}) {
  const isActive = state !== 'idle'
  const color = state === 'success' ? '#4CAF50'
    : state === 'queued' ? '#C8A96E'
    : state === 'error' ? '#ef4444'
    : state === 'generating' ? '#C8A96E'
    : '#999'

  const displayIcon = state === 'success' ? <Check className="w-4 h-4" />
    : state === 'queued' ? <Clock className="w-4 h-4" />
    : state === 'generating' ? <Wand2 className="w-4 h-4 animate-pulse" />
    : icon

  const displayLabel = state === 'success' ? 'Added!'
    : state === 'queued' ? 'Queued'
    : state === 'generating' ? 'Generating…'
    : state === 'error' ? 'Failed'
    : label

  return (
    <button
      className={`flex-1 flex items-center justify-center gap-2 py-3 active:bg-secondary/50 ${border ? 'border-r' : ''}`}
      style={{ borderColor: '#2A2A2A', opacity: isActive ? 0.9 : 1 }}
      onClick={onClick}
      disabled={isActive}
    >
      <span style={{ color }}>{displayIcon}</span>
      <span className="text-[13px] font-sans" style={{ color }}>{displayLabel}</span>
    </button>
  )
}

// ── Entry view ────────────────────────────────────────────────────────────────

function EntryView({ entry, onPlayWord }: { entry: DictEntry; onPlayWord?: () => void }) {
  const primaryReading = entry.readings[0] ?? ''
  const jlptLabel = entry.jlpt ? JLPT_LABEL[entry.jlpt] : null

  return (
    <>
      {/* Word + metadata */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-serif text-[26px] text-foreground leading-tight">{entry.word}</span>
          {onPlayWord && (
            <button
              onClick={onPlayWord}
              className="p-1.5 rounded-full active:opacity-60 transition-opacity"
              style={{ backgroundColor: '#2a2a2a' }}
              aria-label="Play word audio"
            >
              <Volume2 className="w-4 h-4" style={{ color: '#C8A96E' }} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          {jlptLabel && (
            <span
              className="text-[11px] px-1.5 py-0.5 rounded border font-sans"
              style={{ borderColor: '#999', color: '#999' }}
            >
              {jlptLabel}
            </span>
          )}
          {entry.freqRank && (
            <span className="text-[11px] font-sans" style={{ color: '#666' }}>
              #{entry.freqRank.toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {/* Reading */}
      {primaryReading && (
        <div className="flex items-center gap-3 mb-4">
          <span className="text-[18px] font-sans" style={{ color: '#C8A96E' }}>
            {primaryReading}
          </span>
          {entry.readings.length > 1 && (
            <span className="text-[12px] font-sans" style={{ color: '#555' }}>
              +{entry.readings.length - 1} more
            </span>
          )}
        </div>
      )}

      <div className="h-px mb-4" style={{ backgroundColor: '#2A2A2A' }} />

      {/* Senses */}
      <div className="mb-4">
        {entry.senses.slice(0, 3).map((sense, i) => (
          <div key={i} className="mb-3">
            {sense.pos.length > 0 && (
              <span className="text-[11px] font-sans block mb-1" style={{ color: '#666' }}>
                {formatPos(sense.pos[0])}
              </span>
            )}
            {sense.glosses.slice(0, 3).map((g, j) => (
              <p key={j} className="text-[14px] font-sans text-foreground leading-snug">
                {j + 1}. {g}
              </p>
            ))}
          </div>
        ))}
      </div>

      {/* Kanji breakdown */}
      {entry.kanjiBreakdown.length > 0 && (
        <>
          <div className="h-px mb-4" style={{ backgroundColor: '#2A2A2A' }} />
          <div className="space-y-2 mb-4">
            {entry.kanjiBreakdown.map((k) => (
              <KanjiCard key={k.literal} kanji={k} />
            ))}
          </div>
        </>
      )}
    </>
  )
}

function KanjiCard({ kanji }: { kanji: KanjiBreakdown }) {
  const meaning = kanji.rtk?.keyword ?? kanji.meanings[0] ?? ''
  const rtk = kanji.rtk
  const kunReadings = formatKanjiReadings(kanji.readings_kun)
  const onReadings = formatKanjiReadings(kanji.readings_on)

  return (
    <div
      className="rounded-lg px-3 py-2"
      style={{ backgroundColor: '#151515', border: '1px solid #242424' }}
    >
      <div className="flex items-start gap-3">
        <span className="font-serif text-[32px] leading-none text-foreground">{kanji.literal}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {rtk && (
              <span className="text-[10px] font-sans uppercase tracking-wider" style={{ color: '#C8A96E' }}>
                RTK #{rtk.frame}
              </span>
            )}
            <span className="text-[13px] font-sans font-medium text-foreground">
              {meaning.toLowerCase()}
            </span>
          </div>

          {(kunReadings.length > 0 || onReadings.length > 0) && (
            <div className="mt-2 space-y-1.5">
              <KanjiReadingRow label="kun" readings={kunReadings} />
              <KanjiReadingRow label="on" readings={onReadings} />
            </div>
          )}

          {kanji.examples.length > 0 && (
            <div className="mt-2">
              <span className="text-[10px] font-sans uppercase tracking-wider" style={{ color: '#666' }}>
                Examples
              </span>
              <div className="mt-1 space-y-1">
                {kanji.examples.map((example) => (
                  <KanjiExampleItem key={`${kanji.literal}-${example.word}`} example={example} />
                ))}
              </div>
            </div>
          )}

          {rtk?.components.length ? (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {rtk.components.slice(0, 6).map((component) => (
                <span
                  key={component}
                  className="text-[10px] font-sans px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: '#222', color: '#888' }}
                >
                  {component}
                </span>
              ))}
            </div>
          ) : null}

          {rtk?.story && (
            <div className="mt-2">
              <p className="text-[12px] font-sans leading-relaxed break-words" style={{ color: '#BDBDBD' }}>
                {rtk.story}
              </p>
              <span className="text-[10px] font-sans" style={{ color: '#555' }}>
                {rtk.storySource === 'anki' ? 'Your Anki story' : 'Ondoku mnemonic'}
              </span>
            </div>
          )}
        </div>
      </div>
      {!rtk && kanji.meanings.length > 0 && (
        <p className="text-[11px] font-sans mt-1" style={{ color: '#777' }}>
          KANJIDIC: {kanji.meanings.slice(0, 3).join(', ').toLowerCase()}
        </p>
      )}
    </div>
  )
}

function KanjiExampleItem({ example }: { example: KanjiExampleWord }) {
  const reading = example.readings[0]
  const meaning = example.meanings.slice(0, 2).join('; ')
  const jlptLabel = example.jlpt ? JLPT_LABEL[example.jlpt] : null

  return (
    <div
      className="rounded px-2 py-1"
      style={{ backgroundColor: '#1E1E1E', border: '1px solid #292929' }}
    >
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="font-serif text-[14px] text-foreground">{example.word}</span>
        {reading && (
          <span className="text-[11px] font-sans" style={{ color: '#C8A96E' }}>
            {reading}
          </span>
        )}
        {jlptLabel && (
          <span className="text-[9px] font-sans" style={{ color: '#666' }}>
            {jlptLabel}
          </span>
        )}
      </div>
      {meaning && (
        <p className="text-[11px] font-sans leading-snug" style={{ color: '#888' }}>
          {meaning.toLowerCase()}
        </p>
      )}
    </div>
  )
}

function KanjiReadingRow({ label, readings }: { label: string; readings: string[] }) {
  if (readings.length === 0) return null

  return (
    <div className="flex items-start gap-2">
      <span
        className="w-7 shrink-0 text-[10px] font-sans uppercase tracking-wider pt-0.5"
        style={{ color: '#666' }}
      >
        {label}
      </span>
      <div className="flex flex-wrap gap-1">
        {readings.map((reading) => (
          <span
            key={`${label}-${reading}`}
            className="text-[11px] font-sans px-1.5 py-0.5 rounded"
            style={{ backgroundColor: '#222', color: '#BDBDBD' }}
          >
            {reading}
          </span>
        ))}
      </div>
    </div>
  )
}

function formatKanjiReadings(readings: string[]): string[] {
  const cleaned = readings
    .map((reading) => reading.replace(/[.-]/g, '').trim())
    .filter(Boolean)

  return [...new Set(cleaned)]
}

function formatPos(pos: string): string {
  return pos
    .replace("Godan verb with '", '')
    .replace("' ending", ' verb')
    .replace('Ichidan verb', 'verb (る)')
    .replace('noun (common) (futsuumeishi)', 'noun')
    .replace('adjectival nouns or quasi-adjectives (keiyodoshi)', 'na-adj')
    .replace('adjective (keiyoushi)', 'i-adj')
    .replace('adverb (fukushi)', 'adverb')
}

function findWordTimingInSentence(
  sentence: AlignedSentence,
  targetWord: string,
): { start: number; end: number } | null {
  if (!sentence.words || sentence.words.length === 0) return null

  const exact = sentence.words.find((w) => w.text === targetWord)
  if (exact) return { start: exact.start, end: exact.end }

  // Match across consecutive tokens (compound words)
  let accumulated = ''
  let startIdx = -1
  for (let i = 0; i < sentence.words.length; i++) {
    const w = sentence.words[i]
    if (!accumulated && !targetWord.startsWith(w.text)) continue
    if (startIdx === -1) startIdx = i
    accumulated += w.text
    if (accumulated === targetWord) {
      return { start: sentence.words[startIdx].start, end: w.end }
    }
    if (!targetWord.startsWith(accumulated)) {
      accumulated = ''
      startIdx = -1
      if (targetWord.startsWith(w.text)) {
        accumulated = w.text
        startIdx = i
      }
    }
  }
  return null
}
