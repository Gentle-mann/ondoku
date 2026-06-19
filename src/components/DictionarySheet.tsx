import { Plus, Loader2, Check, Wand2, Clock, Languages, BookOpen, Sparkles, Volume2, ChevronDown } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { useReaderStore } from '../store/readerStore'
import type { DictEntry, KanjiBreakdown, KanjiExampleWord } from '../lib/dictTypes'
import type { AlignedSentence } from '../lib/alignment'
import { audioPlayer } from '../lib/audioPlayer'
import { mineCard, storeMediaFile, isAnkiAvailable } from '../lib/ankiConnect'
import { generateCard, buildBasicCard, buildSentenceCard } from '../lib/generateCard'
import { addToQueue } from '../lib/miningQueue'
import { getAudioClip, getAudioClipByFilename } from '../lib/audioClip'
import { lookupKanji } from '../lib/dictService'

const JLPT_LABEL: Record<number, string> = { 1: 'N1', 2: 'N2', 3: 'N3', 4: 'N4', 5: 'N5' }
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const TRANS_CACHE_PREFIX = 'ondoku_trans_'
const CLAUDE_RTK_STORY_PREFIX = 'ondoku_claude_rtk_story_'

type MineState = 'idle' | 'generating' | 'success' | 'queued' | 'error'

interface AiFallback {
  reading: string
  wordType: string
  meaning: string
  context: string
}

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
  const [aiFallback, setAiFallback] = useState<AiFallback | null>(null)
  const [aiFallbackLoading, setAiFallbackLoading] = useState(false)
  const [aiKanjiBreakdown, setAiKanjiBreakdown] = useState<KanjiBreakdown[]>([])
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

    const cacheKey = `ondoku_aifb_v2_${selectedWord}_${sentenceText.slice(0, 40)}`
    const cached = localStorage.getItem(cacheKey)
    if (cached) {
      const parsed = parseAiFallback(cached)
      if (parsed) { setAiFallback(parsed); return }
    }

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

Return only valid JSON with these string fields:
{
  "reading": "hiragana reading, or empty if unknown",
  "wordType": "compound verb, conjugation, set phrase, name, slang, etc.",
  "meaning": "plain English meaning of the tapped word or expression",
  "context": "how it is being used in this exact sentence"
}

Keep each value concise and learner-friendly.`,
        }],
      }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return
        const result = parseAiFallback(data.content[0].text.trim())
        if (!result) return
        localStorage.setItem(cacheKey, JSON.stringify(result))
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
    setAiKanjiBreakdown([])
  }, [selectedWord])

  useEffect(() => {
    if (!showDictionary || dictEntry || !selectedWord) return

    let cancelled = false
    const kanji = [...new Set([...selectedWord].filter(isKanji))]
    if (kanji.length === 0) {
      setAiKanjiBreakdown([])
      return
    }

    Promise.all(kanji.map((ch) => lookupKanji(ch))).then((rows) => {
      if (cancelled) return
      setAiKanjiBreakdown(rows.filter((row): row is KanjiBreakdown => !!row))
    })

    return () => { cancelled = true }
  }, [showDictionary, dictEntry, selectedWord])

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
        style={{ backgroundColor: '#202020', maxHeight: '76dvh', boxShadow: '0 -4px 24px rgba(0,0,0,0.45)' }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-2 shrink-0">
          <div className="w-9 h-1 rounded-full" style={{ backgroundColor: '#333' }} />
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-3 scrollbar-hidden">
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
                <AiFallbackView
                  word={selectedWord}
                  fallback={aiFallback}
                  kanjiBreakdown={aiKanjiBreakdown}
                  claudeApiKey={claudeApiKey}
                />
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
                claudeApiKey={claudeApiKey}
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
        <div className="flex border-t shrink-0" style={{ borderColor: '#2A2A2A' }}>
          <button
            onClick={() => setShowDictionary(false)}
            className={`${dictEntry ? 'w-16' : 'flex-1'} h-[52px] flex items-center justify-center active:bg-secondary/50 border-r`}
            style={{ borderColor: dictEntry ? '#2A2A2A' : 'transparent' }}
            aria-label="Close word meaning"
            title="Close"
          >
            <ChevronDown className="w-6 h-6" style={{ color: '#D0CBC2' }} />
          </button>
          {dictEntry && (
            <>
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
            </>
          )}
        </div>
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
      className="rounded-xl px-4 py-3 mb-5"
      style={{ backgroundColor: '#262626', border: '1px solid #3A3A3A' }}
    >
      {/* Sentence with word highlighted */}
      <p className="font-serif text-[17px] leading-relaxed text-foreground mb-3">
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
        <p className="font-sans text-[14px] italic leading-relaxed" style={{ color: '#D0CBC2' }}>{translation}</p>
      ) : hasApiKey ? (
        <button
          onClick={onTranslate}
          disabled={translating}
          className="flex items-center gap-1.5 active:opacity-60"
        >
          {translating
            ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#D0CBC2' }} />
            : <Languages className="w-4 h-4" style={{ color: '#D0CBC2' }} />}
          <span className="font-sans text-[14px]" style={{ color: '#D0CBC2' }}>
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
    : '#D0CBC2'

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
      <span className="text-[14px] font-sans" style={{ color }}>{displayLabel}</span>
    </button>
  )
}

// ── Entry view ────────────────────────────────────────────────────────────────

function EntryView({
  entry,
  claudeApiKey,
  onPlayWord,
}: {
  entry: DictEntry
  claudeApiKey: string
  onPlayWord?: () => void
}) {
  const primaryReading = entry.readings[0] ?? ''
  const jlptLabel = entry.jlpt ? JLPT_LABEL[entry.jlpt] : null

  return (
    <>
      {/* Word + metadata */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-serif text-[32px] text-foreground leading-tight">{entry.word}</span>
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
              className="text-[12px] px-1.5 py-0.5 rounded border font-sans"
              style={{ borderColor: '#D0CBC2', color: '#D0CBC2' }}
            >
              {jlptLabel}
            </span>
          )}
          {entry.freqRank && (
            <span className="text-[12px] font-sans" style={{ color: '#BDB7AE' }}>
              #{entry.freqRank.toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {/* Reading */}
      {primaryReading && (
        <div className="flex items-center gap-3 mb-4">
          <span className="text-[20px] font-sans" style={{ color: '#D9BE7C' }}>
            {primaryReading}
          </span>
          {entry.readings.length > 1 && (
            <span className="text-[13px] font-sans" style={{ color: '#BDB7AE' }}>
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
              <span className="text-[12px] font-sans block mb-1" style={{ color: '#BDB7AE' }}>
                {formatPos(sense.pos[0])}
              </span>
            )}
            {sense.glosses.slice(0, 3).map((g, j) => (
              <p key={j} className="text-[16px] font-sans text-foreground leading-relaxed">
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
              <KanjiCard key={k.literal} kanji={k} claudeApiKey={claudeApiKey} />
            ))}
          </div>
        </>
      )}
    </>
  )
}

function KanjiCard({ kanji, claudeApiKey }: { kanji: KanjiBreakdown; claudeApiKey: string }) {
  const meaning = kanji.rtk?.keyword ?? kanji.meanings[0] ?? ''
  const rtk = kanji.rtk
  const kunReadings = formatKanjiReadings(kanji.readings_kun)
  const onReadings = formatKanjiReadings(kanji.readings_on)
  const canGenerateStory = !!rtk && rtk.storySource !== 'anki' && !!claudeApiKey
  const [claudeStory, setClaudeStory] = useState<string | null>(() => {
    return localStorage.getItem(CLAUDE_RTK_STORY_PREFIX + kanji.literal)
  })
  const [generatingStory, setGeneratingStory] = useState(false)
  const [storyError, setStoryError] = useState(false)

  useEffect(() => {
    setClaudeStory(localStorage.getItem(CLAUDE_RTK_STORY_PREFIX + kanji.literal))
    setStoryError(false)
  }, [kanji.literal])

  const displayedStory = claudeStory ?? rtk?.story
  const storySourceLabel = rtk?.storySource === 'anki'
    ? 'Your Anki story'
    : claudeStory
      ? 'Claude RTK story'
      : 'Ondoku mnemonic'

  const handleGenerateStory = async () => {
    if (!rtk || !claudeApiKey || generatingStory) return

    setGeneratingStory(true)
    setStoryError(false)
    try {
      const response = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': claudeApiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 220,
          messages: [{
            role: 'user',
            content: buildRtkStoryPrompt(kanji, rtk),
          }],
        }),
      })

      if (!response.ok) throw new Error(`Claude request failed: ${response.status}`)
      const data = await response.json()
      const story = parseClaudeStory(data.content?.[0]?.text ?? '')
      if (!story) throw new Error('Claude returned no story')

      localStorage.setItem(CLAUDE_RTK_STORY_PREFIX + kanji.literal, story)
      setClaudeStory(story)
    } catch {
      setStoryError(true)
    } finally {
      setGeneratingStory(false)
    }
  }

  return (
    <div
      className="rounded-lg px-4 py-3"
      style={{ backgroundColor: '#262626', border: '1px solid #3A3A3A' }}
    >
      <div className="flex items-start gap-3">
        <span className="font-serif text-[40px] leading-none text-foreground">{kanji.literal}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {rtk && (
              <span className="text-[12px] font-sans uppercase" style={{ color: '#D9BE7C' }}>
                RTK #{rtk.frame}
              </span>
            )}
            <span className="text-[16px] font-sans font-medium text-foreground">
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
              <span className="text-[12px] font-sans uppercase" style={{ color: '#BDB7AE' }}>
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
                  className="text-[12px] font-sans px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: '#303030', color: '#D0CBC2' }}
                >
                  {component}
                </span>
              ))}
            </div>
          ) : null}

          {displayedStory && (
            <div className="mt-2">
              <p className="text-[14px] font-sans leading-relaxed break-words" style={{ color: '#F0EDE8' }}>
                {displayedStory}
              </p>
              <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                <span className="text-[12px] font-sans" style={{ color: '#BDB7AE' }}>
                  {storySourceLabel}
                </span>
                {canGenerateStory && (
                  <button
                    onClick={handleGenerateStory}
                    disabled={generatingStory}
                    className="inline-flex items-center gap-1.5 rounded px-2 py-1 font-sans text-[12px] active:opacity-70 disabled:opacity-60"
                    style={{ backgroundColor: '#303030', color: '#D9BE7C', border: '1px solid #444' }}
                    aria-label={`Generate RTK story for ${kanji.literal}`}
                  >
                    {generatingStory
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <Wand2 className="w-3 h-3" />}
                    {claudeStory ? 'Regenerate' : 'Generate story'}
                  </button>
                )}
                {storyError && (
                  <span className="text-[12px] font-sans" style={{ color: '#ef4444' }}>
                    Try again
                  </span>
                )}
              </div>
            </div>
          )}
          {rtk?.storyAlt && rtk.storyAlt !== displayedStory && (
            <div className="mt-2">
              <p className="text-[14px] font-sans leading-relaxed break-words" style={{ color: '#F0EDE8' }}>
                {rtk.storyAlt}
              </p>
              <div className="mt-1.5">
                <span className="text-[12px] font-sans" style={{ color: '#BDB7AE' }}>
                  RTK community story
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
      {!rtk && kanji.meanings.length > 0 && (
        <p className="text-[13px] font-sans mt-2" style={{ color: '#BDB7AE' }}>
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
      style={{ backgroundColor: '#303030', border: '1px solid #444' }}
    >
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="font-serif text-[17px] text-foreground">{example.word}</span>
        {reading && (
          <span className="text-[13px] font-sans" style={{ color: '#D9BE7C' }}>
            {reading}
          </span>
        )}
        {jlptLabel && (
          <span className="text-[11px] font-sans" style={{ color: '#BDB7AE' }}>
            {jlptLabel}
          </span>
        )}
      </div>
      {meaning && (
        <p className="text-[13px] font-sans leading-relaxed" style={{ color: '#D0CBC2' }}>
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
        className="w-8 shrink-0 text-[12px] font-sans uppercase pt-0.5"
        style={{ color: '#BDB7AE' }}
      >
        {label}
      </span>
      <div className="flex flex-wrap gap-1">
        {readings.map((reading) => (
          <span
            key={`${label}-${reading}`}
            className="text-[13px] font-sans px-1.5 py-0.5 rounded"
            style={{ backgroundColor: '#303030', color: '#F0EDE8' }}
          >
            {reading}
          </span>
        ))}
      </div>
    </div>
  )
}

function AiFallbackView({
  word,
  fallback,
  kanjiBreakdown,
  claudeApiKey,
}: {
  word: string
  fallback: AiFallback
  kanjiBreakdown: KanjiBreakdown[]
  claudeApiKey: string
}) {
  return (
    <div className="flex flex-col gap-4">
      <div
        className="rounded-xl px-4 py-3"
        style={{ backgroundColor: '#262626', border: '1px solid #3A3A3A' }}
      >
        <div className="flex items-center gap-1.5 mb-3">
          <Sparkles className="w-3.5 h-3.5" style={{ color: '#D9BE7C' }} />
          <span className="font-sans text-[12px] uppercase" style={{ color: '#D9BE7C' }}>AI explanation</span>
        </div>

        <div className="flex items-baseline gap-3 flex-wrap mb-3">
          <span className="font-serif text-[32px] text-foreground leading-tight">{word}</span>
          {fallback.reading && (
            <span className="text-[20px] font-sans" style={{ color: '#D9BE7C' }}>
              {fallback.reading}
            </span>
          )}
        </div>

        {fallback.wordType && (
          <p className="text-[12px] font-sans mb-1" style={{ color: '#BDB7AE' }}>
            {fallback.wordType}
          </p>
        )}
        <p className="text-[16px] font-sans text-foreground leading-relaxed">
          {fallback.meaning}
        </p>

        {fallback.context && (
          <div className="mt-3">
            <p className="text-[12px] font-sans uppercase mb-1" style={{ color: '#BDB7AE' }}>
              Used here
            </p>
            <p className="text-[14px] font-sans leading-relaxed" style={{ color: '#D0CBC2' }}>
              {fallback.context}
            </p>
          </div>
        )}
      </div>

      {kanjiBreakdown.length > 0 && (
        <div>
          <div className="h-px mb-4" style={{ backgroundColor: '#2A2A2A' }} />
          <div className="space-y-2 mb-4">
            {kanjiBreakdown.map((k) => (
              <KanjiCard key={`ai-${k.literal}`} kanji={k} claudeApiKey={claudeApiKey} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function parseAiFallback(raw: string): AiFallback | null {
  try {
    const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
    const parsed = JSON.parse(cleaned) as Partial<AiFallback>
    const meaning = String(parsed.meaning ?? '').trim()
    const context = String(parsed.context ?? '').trim()
    if (!meaning && !context) return null
    return {
      reading: String(parsed.reading ?? '').trim(),
      wordType: String(parsed.wordType ?? '').trim(),
      meaning,
      context,
    }
  } catch {
    const meaning = raw.trim()
    if (!meaning) return null
    return { reading: '', wordType: '', meaning, context: '' }
  }
}

function buildRtkStoryPrompt(
  kanji: KanjiBreakdown,
  rtk: NonNullable<KanjiBreakdown['rtk']>,
): string {
  const components = rtk.components.length
    ? rtk.components.join(', ')
    : 'No explicit primitives are available; use the visible written shape and stroke count.'
  const kanjiMeanings = kanji.meanings.length ? kanji.meanings.join(', ') : 'none listed'

  return `Create one original mnemonic story for a Japanese kanji using Remembering-the-Kanji style principles.

Kanji: ${kanji.literal}
RTK keyword: ${rtk.keyword}
Frame: ${rtk.frame}
Stroke count: ${rtk.strokeCount ?? 'unknown'}
Primitive/component names: ${components}
Dictionary meanings: ${kanjiMeanings}

Standards:
- Make it an original story. Do not copy or paraphrase any Heisig, Koohii, Anki, or public story.
- The story is for recalling how to write the kanji from the RTK keyword.
- Tie the RTK keyword to the primitive/component meanings through one vivid, concrete, memorable scene.
- Use the primitive/component names as props or actors, preferably in the order they appear if that is inferable.
- Do not teach readings, vocabulary, etymology, or historical origin.
- Avoid generic wording like "the mark triggers the keyword" or "write each stroke"; make the image specific.
- Keep it compact: 1-3 sentences, 35-75 words.
- If components are missing, anchor the story in a distinctive visual feature of the kanji and the stroke count.

Return only valid JSON: {"story":"..."}.`
}

function parseClaudeStory(raw: string): string | null {
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  try {
    const parsed = JSON.parse(cleaned) as { story?: unknown }
    const story = String(parsed.story ?? '').trim()
    return story || null
  } catch {
    const story = cleaned.replace(/^["']|["']$/g, '').trim()
    return story || null
  }
}

function isKanji(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0
  return (cp >= 0x4E00 && cp <= 0x9FFF)
    || (cp >= 0x3400 && cp <= 0x4DBF)
    || (cp >= 0xF900 && cp <= 0xFAFF)
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
