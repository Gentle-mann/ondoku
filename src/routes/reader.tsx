import React, { useEffect, useRef, forwardRef, useCallback } from 'react'
import { ChevronLeft, Settings } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { audioPlayer } from '../lib/audioPlayer'
import { useReaderStore } from '../store/readerStore'
import { YANEURA_ALL, findActiveSentence, type AlignedSentence } from '../lib/alignment'
import { DictionarySheet } from '../components/DictionarySheet'
import { AudioBar } from '../components/AudioBar'
import { IntensiveControls } from '../components/IntensiveControls'
import { preloadDict, lookupLongest, onDictStatus } from '../lib/dictService'

const EPISODES = [
  '/audio/yanerura_N1_2_ep01.mp3',
  '/audio/yanerura_N1_2_ep02.mp3',
  '/audio/yanerura_N1_2_ep03.mp3',
  '/audio/yanerura_N1_2_ep04.mp3',
  '/audio/yanerura_N1_2_ep05.mp3',
  '/audio/yanerura_N1_2_ep06.mp3',
  '/audio/yanerura_N1_2_ep07.mp3',
  '/audio/yanerura_N1_2_ep08.mp3',
]

// Pre-compute per-episode slices so findActiveSentence only searches within one file.
// Each entry: { offset: global start index, sentences: AlignedSentence[] }
const EP_SLICES = EPISODES.map((ep) => {
  const file = ep.split('/').pop()!
  const offset = YANEURA_ALL.findIndex((s) => s.file === file)
  const sentences = YANEURA_ALL.filter((s) => s.file === file)
  return { offset, sentences }
})

export function ReaderPage() {
  const navigate = useNavigate()
  const sentenceRefs = useRef<(HTMLParagraphElement | null)[]>([])

  const {
    activeSentenceIndex,
    intensiveMode,
    setIsPlaying,
    setCurrentTime,
    setDuration,
    setActiveSentenceIndex,
    setShowDictionary,
    setSelectedWord,
    setDictEntry,
    setDictLoading,
    setDictStatus,
  } = useReaderStore()

  // Preload dictionary and track status
  useEffect(() => {
    preloadDict()
    const unsub = onDictStatus(setDictStatus)
    return unsub
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const currentEpRef = useRef(0)
  const intensiveModeRef = useRef(intensiveMode)
  useEffect(() => { intensiveModeRef.current = intensiveMode }, [intensiveMode])

  const loadEpisode = useCallback((epIndex: number) => {
    currentEpRef.current = epIndex
    const src = EPISODES[epIndex]
    audioPlayer.load(src)
    audioPlayer.setMediaMetadata({
      title: '屋根裏の散歩者',
      artist: '江戸川乱歩',
      album: `屋根裏の散歩者 N1・N2 — Episode ${epIndex + 1}`,
    })
    setDuration(0)
  }, [setDuration])

  useEffect(() => {
    loadEpisode(0)

    audioPlayer.setOnTimeUpdate((time) => {
      setCurrentTime(time)
      const { offset, sentences } = EP_SLICES[currentEpRef.current]
      const file = EPISODES[currentEpRef.current].split('/').pop()!
      const localIdx = findActiveSentence(sentences, time, file)
      const globalIdx = localIdx !== -1 ? offset + localIdx : -1
      setActiveSentenceIndex(globalIdx)

      if (intensiveModeRef.current && localIdx !== -1) {
        const sentence = sentences[localIdx]
        if (time >= sentence.end - 0.1) {
          audioPlayer.pause()
        }
      }
    })

    audioPlayer.setOnPlayStateChange(setIsPlaying)
    audioPlayer.setOnDurationChange(setDuration)

    audioPlayer.setOnEnded(() => {
      const next = currentEpRef.current + 1
      if (next < EPISODES.length) {
        loadEpisode(next)
        audioPlayer.play()
      }
    })

    return () => {}
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeSentenceIndex >= 0) {
      sentenceRefs.current[activeSentenceIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }
  }, [activeSentenceIndex])

  const handleSentenceSeek = useCallback((sentence: AlignedSentence) => {
    const epIndex = EPISODES.indexOf('/audio/' + sentence.file)
    if (epIndex !== -1 && epIndex !== currentEpRef.current) {
      loadEpisode(epIndex)
      audioPlayer.seekWhenReady(sentence.start)
    } else {
      audioPlayer.seek(sentence.start)
    }
  }, [loadEpisode])

  const handleWordTap = async (word: string) => {
    setSelectedWord(word)
    setDictEntry(null)
    setDictLoading(true)
    setShowDictionary(true)

    const entry = await lookupLongest(word.trim())
    setDictEntry(entry)
    setDictLoading(false)
  }

  return (
    <div className="w-full h-dvh flex flex-col relative overflow-hidden">
      <header className="h-[44px] flex items-center justify-between px-4 shrink-0 z-10">
        <button
          className="p-1 -ml-1 active:opacity-60 transition-opacity"
          onClick={() => navigate({ to: '/' })}
          aria-label="Go back"
        >
          <ChevronLeft className="w-5 h-5 text-muted-foreground" />
        </button>
        <span className="font-sans text-sm text-muted-foreground">第1章</span>
        <button className="p-1 -mr-1 active:opacity-60 transition-opacity" aria-label="Settings">
          <Settings className="w-5 h-5 text-muted-foreground" />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto overflow-x-hidden py-6 scrollbar-hidden">
        <div className="flex flex-col gap-5 w-full max-w-[680px] mx-auto px-6">
          {YANEURA_ALL.map((sentence, index) => (
            <React.Fragment key={sentence.id}>
              {/* Episode divider — show chapter number when file changes */}
              {(index === 0 || YANEURA_ALL[index - 1].file !== sentence.file) && index > 0 && (
                <div className="flex items-center gap-4 py-2">
                  <div className="flex-1 h-px bg-border" />
                  <span className="font-serif text-sm text-muted-foreground">
                    {['一', '二', '三', '四', '五', '六', '七', '八'][EPISODES.indexOf('/audio/' + sentence.file)]}
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              )}
              <SentenceParagraph
                sentence={sentence}
                isActive={index === activeSentenceIndex}
                ref={(el) => { sentenceRefs.current[index] = el }}
                onWordTap={handleWordTap}
                onSeek={handleSentenceSeek}
              />
            </React.Fragment>
          ))}
        </div>
      </main>

      <IntensiveControls />
      <DictionarySheet />
      <AudioBar />
    </div>
  )
}

interface SentenceParagraphProps {
  sentence: AlignedSentence
  isActive: boolean
  onWordTap: (word: string) => void
  onSeek: (sentence: AlignedSentence) => void
}

const SentenceParagraph = forwardRef<HTMLParagraphElement, SentenceParagraphProps>(
  ({ sentence, isActive, onWordTap, onSeek }, ref) => {
    const opacity = isActive ? 1.0 : 0.35
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const didLongPress = useRef(false)

    const handlePointerDown = () => {
      didLongPress.current = false
      longPressTimer.current = setTimeout(() => {
        didLongPress.current = true
        onSeek(sentence)
      }, 500)
    }

    const cancelLongPress = () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current)
        longPressTimer.current = null
      }
    }

    return (
      <div
        className="flex items-start gap-0 w-full"
        onPointerDown={handlePointerDown}
        onPointerUp={cancelLongPress}
        onPointerLeave={cancelLongPress}
        onPointerCancel={cancelLongPress}
      >
        {/* Left margin dot — tap to seek */}
        <button
          className="shrink-0 flex items-center justify-center w-5 mt-[0.6em] self-start"
          style={{ minWidth: '20px' }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onSeek(sentence)}
          aria-label="Seek to sentence"
          tabIndex={-1}
        >
          <span
            className="block w-1.5 h-1.5 rounded-full transition-all duration-300"
            style={{ backgroundColor: isActive ? '#C8A96E' : '#333' }}
          />
        </button>

        <p
          ref={ref}
          className={`font-serif text-[16px] leading-[2] transition-all duration-300 flex-1 ${
            isActive ? 'font-medium' : ''
          }`}
          style={{ opacity }}
          onClickCapture={(e) => {
            // If the long press fired, suppress the click that follows pointerup
            if (didLongPress.current) {
              e.stopPropagation()
              e.preventDefault()
              didLongPress.current = false
            }
          }}
        >
          <SentenceContent sentence={sentence} onWordTap={onWordTap} />
        </p>
      </div>
    )
  }
)
SentenceParagraph.displayName = 'SentenceParagraph'

function SentenceContent({
  sentence,
  onWordTap,
}: {
  sentence: AlignedSentence
  onWordTap: (word: string) => void
}) {
  if (!sentence.furigana || sentence.furigana.length === 0) {
    return <TappableText text={sentence.text} onWordTap={onWordTap} />
  }

  const parts: React.ReactNode[] = []
  let remaining = sentence.text
  let key = 0

  for (const { word, reading } of sentence.furigana) {
    const idx = remaining.indexOf(word)
    if (idx === -1) continue

    if (idx > 0) {
      parts.push(
        <TappableText key={`t${key++}`} text={remaining.slice(0, idx)} onWordTap={onWordTap} />
      )
    }

    parts.push(
      <ruby key={`r${key++}`} className="cursor-pointer" onClick={() => onWordTap(word)}>
        {word}
        <rp>(</rp>
        <rt className="text-[10px] font-normal opacity-70">{reading}</rt>
        <rp>)</rp>
      </ruby>
    )

    remaining = remaining.slice(idx + word.length)
  }

  if (remaining) {
    parts.push(<TappableText key={`t${key++}`} text={remaining} onWordTap={onWordTap} />)
  }

  return <>{parts}</>
}

function TappableText({ text, onWordTap }: { text: string; onWordTap: (w: string) => void }) {
  // Split into Unicode code points so each character is individually tappable.
  // Pass text from the tapped character onward — lookupLongest finds the actual word.
  const chars = [...text]
  return (
    <>
      {chars.map((char, i) => (
        <span
          key={i}
          className="cursor-pointer"
          onClick={() => onWordTap(chars.slice(i).join(''))}
        >
          {char}
        </span>
      ))}
    </>
  )
}
