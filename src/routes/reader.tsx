import React, { useEffect, useRef, forwardRef, useCallback, useState } from 'react'
import { ChevronLeft, Settings } from 'lucide-react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { audioPlayer } from '../lib/audioPlayer'
import { useReaderStore } from '../store/readerStore'
import { YANEURA_ALL, findActiveSentence, findActiveWord, type AlignedSentence } from '../lib/alignment'
import { DictionarySheet } from '../components/DictionarySheet'
import { AudioBar } from '../components/AudioBar'
import { IntensiveControls } from '../components/IntensiveControls'
import { SettingsSheet } from '../components/SettingsSheet'
import { MineWordPicker } from '../components/MineWordPicker'
import { QueueBanner } from '../components/QueueBanner'
import { preloadDict, lookupLongest, onDictStatus } from '../lib/dictService'
import { getBook, getSentences, getAudioFile, updateBookProgress, storeAudioForBook, type BookMeta } from '../lib/bookLibrary'
import { scheduleProgressPush, flushProgressPush } from '../lib/sync'

// ── Built-in 屋根裏 data ──────────────────────────────────────────────────────

const AUDIO_BASE = 'https://github.com/Gentle-mann/ondoku/releases/download/v1.0'
const YANEURA_EPISODES = [
  `${AUDIO_BASE}/yanerura_N1_2_ep01.mp3`,
  `${AUDIO_BASE}/yanerura_N1_2_ep02.mp3`,
  `${AUDIO_BASE}/yanerura_N1_2_ep03.mp3`,
  `${AUDIO_BASE}/yanerura_N1_2_ep04.mp3`,
  `${AUDIO_BASE}/yanerura_N1_2_ep05.mp3`,
  `${AUDIO_BASE}/yanerura_N1_2_ep06.mp3`,
  `${AUDIO_BASE}/yanerura_N1_2_ep07.mp3`,
  `${AUDIO_BASE}/yanerura_N1_2_ep08.mp3`,
]

const YANEURA_EP_SLICES = YANEURA_EPISODES.map((ep) => {
  const file = ep.split('/').pop()!
  const offset = YANEURA_ALL.findIndex((s) => s.file === file)
  const sentences = YANEURA_ALL.filter((s) => s.file === file)
  return { offset, sentences, file }
})

// ── Types ─────────────────────────────────────────────────────────────────────

interface EpSlice {
  offset: number
  sentences: AlignedSentence[]
  file: string
}

interface BookData {
  sentences: AlignedSentence[]
  episodes: string[]        // audio src URLs (object URLs for user books)
  epSlices: EpSlice[]
  title: string
  isUserBook: boolean
  chapterLabels: string[]   // shown at episode dividers
}

// ── ReaderPage ─────────────────────────────────────────────────────────────────

export function ReaderPage() {
  const navigate = useNavigate()
  const { bookId } = useParams({ from: '/read/$bookId' })

  const [bookData, setBookData] = useState<BookData | null>(null)
  const [missingAudioMeta, setMissingAudioMeta] = useState<BookMeta | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  const sentenceRefs = useRef<(HTMLParagraphElement | null)[]>([])

  const {
    activeSentenceIndex,
    activeSentence,
    activeWordIndex,
    intensiveMode,
    playbackRate,
    showFurigana,
    setIsPlaying,
    setCurrentTime,
    setDuration,
    setActiveSentenceIndex,
    setActiveSentence,
    setActiveWordIndex,
    setPrecedingSentences,
    setShowSettings,
    setShowDictionary,
    setPlaybackRate,
    setSelectedWord,
    setDictEntry,
    setDictLoading,
    setDictStatus,
    setCurrentEpIndex,
    setCurrentBookId,
    sleepTimerDeadline,
    setSleepTimerRemainingMs,
    clearSleepTimer,
  } = useReaderStore()

  // Preload dictionary and track status
  useEffect(() => {
    preloadDict()
    const unsub = onDictStatus(setDictStatus)
    return unsub
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Load book data
  useEffect(() => {
    let cancelled = false

    async function load() {
      if (bookId === 'yaneura') {
        setBookData({
          sentences: YANEURA_ALL,
          episodes: YANEURA_EPISODES,
          epSlices: YANEURA_EP_SLICES,
          title: '屋根裏の散歩者',
          isUserBook: false,
          chapterLabels: ['一', '二', '三', '四', '五', '六', '七', '八'],
        })
      } else {
        const [meta, sentences] = await Promise.all([getBook(bookId), getSentences(bookId)])
        if (cancelled || !meta || sentences.length === 0) return

        // User book: single audio file loaded from OPFS
        const audioFile = await getAudioFile(meta.audioFilename)
        if (cancelled) return

        if (!audioFile) {
          // Audio not on this device yet — show upload prompt
          setMissingAudioMeta(meta)
          return
        }

        setMissingAudioMeta(null)

        // Revoke any old object URL
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
        const objectUrl = URL.createObjectURL(audioFile)
        objectUrlRef.current = objectUrl

        const epSlices: EpSlice[] = [{
          offset: 0,
          sentences,
          file: meta.audioFilename,
        }]

        setBookData({
          sentences,
          episodes: [objectUrl],
          epSlices,
          title: meta.title,
          isUserBook: true,
          chapterLabels: [],
        })
      }
    }

    load()
    return () => { cancelled = true }
  }, [bookId])

  // Revoke object URL on unmount
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    }
  }, [])

  const currentEpRef = useRef(0)
  const intensiveModeRef = useRef(intensiveMode)
  useEffect(() => { intensiveModeRef.current = intensiveMode }, [intensiveMode])
  const lastPausedSentenceRef = useRef(-1)
  const lastTimeRef = useRef(0)
  const lastRenderedTimeRef = useRef(0)
  const activeGlobalIndexRef = useRef(-1)
  const activeWordIndexRef = useRef(-1)
  const lastProgressSaveSecondRef = useRef(-1)
  const backgroundPlaybackWantedRef = useRef(false)
  const lastKnownPlayingRef = useRef(false)
  const playbackRateRef = useRef(playbackRate)
  const slowReplayRef = useRef<{ sentenceEnd: number; originalRate: number } | null>(null)
  useEffect(() => { playbackRateRef.current = playbackRate }, [playbackRate])

  const bookDataRef = useRef<BookData | null>(null)
  useEffect(() => { bookDataRef.current = bookData }, [bookData])

  const restoreSlowReplayRate = useCallback(() => {
    const slowReplay = slowReplayRef.current
    if (!slowReplay) return

    slowReplayRef.current = null
    audioPlayer.setPlaybackRate(slowReplay.originalRate)
    setPlaybackRate(slowReplay.originalRate)
  }, [setPlaybackRate])

  const clearReplayState = useCallback(() => {
    restoreSlowReplayRate()
    lastPausedSentenceRef.current = -1
  }, [restoreSlowReplayRate])

  useEffect(() => {
    if (sleepTimerDeadline === null) return

    const checkSleepTimer = () => {
      const remainingMs = sleepTimerDeadline - Date.now()
      if (remainingMs > 0) {
        setSleepTimerRemainingMs(remainingMs)
        return
      }

      restoreSlowReplayRate()
      if (!audioPlayer.paused && !audioPlayer.ended) {
        audioPlayer.pause('sleep-timer')
      }
      clearSleepTimer()
    }

    checkSleepTimer()
    const timerId = window.setInterval(checkSleepTimer, 1000)
    document.addEventListener('visibilitychange', checkSleepTimer)
    window.addEventListener('focus', checkSleepTimer)
    window.addEventListener('pageshow', checkSleepTimer)

    return () => {
      window.clearInterval(timerId)
      document.removeEventListener('visibilitychange', checkSleepTimer)
      window.removeEventListener('focus', checkSleepTimer)
      window.removeEventListener('pageshow', checkSleepTimer)
    }
  }, [sleepTimerDeadline, setSleepTimerRemainingMs, clearSleepTimer, restoreSlowReplayRate])

  const loadEpisode = useCallback((epIndex: number, episodes: string[], isUserBook: boolean) => {
    currentEpRef.current = epIndex
    setCurrentEpIndex(epIndex)
    setCurrentBookId(bookId)
    const src = episodes[epIndex]
    audioPlayer.load(src)
    if (!isUserBook) {
      audioPlayer.setMediaMetadata({
        title: '屋根裏の散歩者',
        artist: '江戸川乱歩',
        album: `屋根裏の散歩者 N1・N2 — Episode ${epIndex + 1}`,
      })
    }
    setDuration(0)
  }, [bookId, setCurrentEpIndex, setCurrentBookId, setDuration])

  // Setup audio callbacks once book data is ready
  useEffect(() => {
    if (!bookData) return

    const { episodes, epSlices, isUserBook } = bookData

    // Restore saved position
    const savedEp = isUserBook
      ? 0
      : (parseInt(localStorage.getItem('ondoku_ep') ?? '0', 10) || 0)
    const savedTime = isUserBook
      ? parseFloat(localStorage.getItem(`ondoku_time_${bookId}`) ?? '0') || 0
      : parseFloat(localStorage.getItem('ondoku_time') ?? '0') || 0

    const epIndex = Math.min(savedEp, episodes.length - 1)
    loadEpisode(epIndex, episodes, isUserBook)
    if (savedTime > 0) audioPlayer.seekWhenReady(savedTime)
    activeGlobalIndexRef.current = -1
    activeWordIndexRef.current = -1
    lastProgressSaveSecondRef.current = -1
    backgroundPlaybackWantedRef.current = false
    lastKnownPlayingRef.current = false

    audioPlayer.setOnTimeUpdate((time) => {
      // Detect backward seek (e.g. replay) — reset intensive pause tracker
      if (time < lastTimeRef.current - 1) {
        lastPausedSentenceRef.current = -1
      }
      lastTimeRef.current = time
      const { offset, sentences, file } = epSlices[currentEpRef.current]
      const localIdx = findActiveSentence(sentences, time, file)
      const globalIdx = localIdx !== -1 ? offset + localIdx : -1

      // Use the same sentences array that findActiveSentence searched
      const activeSent = localIdx !== -1 ? sentences[localIdx] : null
      // Track active word within the sentence
      const wordIdx = activeSent?.words ? findActiveWord(activeSent.words, time) : -1
      const activeSentenceChanged = globalIdx !== activeGlobalIndexRef.current
      const activeWordChanged = wordIdx !== activeWordIndexRef.current
      const shouldRenderTime =
        Math.abs(time - lastRenderedTimeRef.current) >= 0.05 ||
        activeSentenceChanged ||
        activeWordChanged

      if (shouldRenderTime) {
        setCurrentTime(time)
        lastRenderedTimeRef.current = time
      }
      if (activeSentenceChanged) {
        activeGlobalIndexRef.current = globalIdx
        setActiveSentenceIndex(globalIdx)
        setActiveSentence(activeSent)
      }
      if (activeWordChanged) {
        activeWordIndexRef.current = wordIdx
        setActiveWordIndex(wordIdx)
      }
      if (activeSentenceChanged && globalIdx >= 0) {
        const allSentences = bookDataRef.current?.sentences ?? []
        const preceding = allSentences
          .slice(Math.max(0, globalIdx - 4), globalIdx)
          .map(s => s.text)
        setPrecedingSentences(preceding)
      }

      const slowReplay = slowReplayRef.current
      if (slowReplay && time >= slowReplay.sentenceEnd - 0.05) {
        restoreSlowReplayRate()
      }

      const wholeSecond = Math.floor(time)
      if (wholeSecond > 0 && wholeSecond % 5 === 0 && wholeSecond !== lastProgressSaveSecondRef.current) {
        lastProgressSaveSecondRef.current = wholeSecond
        const totalSentences = bookDataRef.current?.sentences.length ?? 1
        const pct = globalIdx >= 0 ? Math.round((globalIdx / totalSentences) * 100) : 0
        if (isUserBook) {
          localStorage.setItem(`ondoku_time_${bookId}`, String(Math.floor(time)))
          updateBookProgress(bookId, time, pct)
          scheduleProgressPush(bookId, 0, time, pct)
        } else {
          localStorage.setItem('ondoku_ep', String(currentEpRef.current))
          localStorage.setItem('ondoku_time', String(Math.floor(time)))
          scheduleProgressPush('yaneura', currentEpRef.current, time, pct)
        }
      }

      if (
        intensiveModeRef.current &&
        !document.hidden &&
        !backgroundPlaybackWantedRef.current &&
        localIdx !== -1
      ) {
        const sentence = sentences[localIdx]
        // Pause when we reach the end of a sentence we haven't paused for yet.
        // Using sentence.end (not effectiveEnd) so we pause at the actual speech end,
        // not at the start of the next sentence.
        if (time >= sentence.end - 0.15 && lastPausedSentenceRef.current !== localIdx) {
          lastPausedSentenceRef.current = localIdx
          audioPlayer.pause('intensive')
        }
      }
    })

    const flushCurrentProgress = () => {
      const t = audioPlayer.currentTime
      const totalSentences = bookDataRef.current?.sentences.length ?? 1
      const globalIdx = useReaderStore.getState().activeSentenceIndex
      const pct = globalIdx >= 0 ? Math.round((globalIdx / totalSentences) * 100) : 0
      const activeBookId = isUserBook ? bookId : 'yaneura'
      flushProgressPush(activeBookId, currentEpRef.current, t, pct)
    }

    const tryResumeBackgroundPlayback = () => {
      if (!backgroundPlaybackWantedRef.current) return
      if (intensiveModeRef.current) return
      if (!audioPlayer.paused) return
      if (audioPlayer.ended) return
      if (audioPlayer.getLastPauseReason() !== null) return
      audioPlayer.play().catch((err) => {
        console.warn('[reader] background playback resume failed:', err)
      })
    }

    const markBackgroundPlaybackIntent = () => {
      if (!intensiveModeRef.current && (!audioPlayer.paused || lastKnownPlayingRef.current)) {
        backgroundPlaybackWantedRef.current = true
      }
    }

    audioPlayer.setOnPlayStateChange((playing) => {
      lastKnownPlayingRef.current = playing
      setIsPlaying(playing)
      // Flush progress to cloud when paused
      if (!playing) {
        flushCurrentProgress()
        if (document.hidden) {
          tryResumeBackgroundPlayback()
        }
      }
    })
    audioPlayer.setOnDurationChange(setDuration)

    // Flush progress when tab becomes hidden (user switches apps on mobile)
    const onVisibilityChange = () => {
      if (document.hidden) {
        markBackgroundPlaybackIntent()
        flushCurrentProgress()
      } else {
        tryResumeBackgroundPlayback()
        backgroundPlaybackWantedRef.current = false
      }
    }
    const onPageHide = () => {
      markBackgroundPlaybackIntent()
      flushCurrentProgress()
    }
    const onPageShow = () => {
      tryResumeBackgroundPlayback()
      backgroundPlaybackWantedRef.current = false
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('blur', markBackgroundPlaybackIntent)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)

    audioPlayer.setOnEnded(() => {
      restoreSlowReplayRate()
      const next = currentEpRef.current + 1
      if (next < episodes.length) {
        loadEpisode(next, episodes, isUserBook)
        if (!isUserBook) {
          localStorage.setItem('ondoku_ep', String(next))
          localStorage.setItem('ondoku_time', '0')
        }
        audioPlayer.play()
      }
    })

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('blur', markBackgroundPlaybackIntent)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
      restoreSlowReplayRate()
      // Save position on unmount (e.g. navigating away)
      const t = audioPlayer.currentTime
      if (t > 0) {
        if (isUserBook) {
          localStorage.setItem(`ondoku_time_${bookId}`, String(Math.floor(t)))
        } else {
          localStorage.setItem('ondoku_ep', String(currentEpRef.current))
          localStorage.setItem('ondoku_time', String(Math.floor(t)))
        }
      }
      audioPlayer.pause('cleanup')
    }
  }, [bookData]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeSentenceIndex >= 0) {
      sentenceRefs.current[activeSentenceIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }
  }, [activeSentenceIndex])

  const handleSentenceSeek = useCallback((sentence: AlignedSentence) => {
    if (!bookData) return
    clearReplayState()
    const { episodes, epSlices } = bookData
    const epIndex = epSlices.findIndex((s) => s.file === sentence.file)
    if (epIndex !== -1 && epIndex !== currentEpRef.current) {
      // Cross-episode navigation: load new audio, then seek + play.
      loadEpisode(epIndex, episodes, bookData.isUserBook)
      audioPlayer.seekWhenReady(sentence.start)
      audioPlayer.playWhenReady()
    } else {
      audioPlayer.seek(sentence.start)
      audioPlayer.play().catch(console.error)
    }
  }, [bookData, clearReplayState, loadEpisode])

  const handleWordSeek = useCallback((time: number) => {
    clearReplayState()
    audioPlayer.seek(time)
    audioPlayer.play().catch(console.error)
  }, [clearReplayState])

  const replayBack10 = useCallback(() => {
    clearReplayState()
    audioPlayer.seek(Math.max(0, audioPlayer.currentTime - 10))
    audioPlayer.play().catch(console.error)
  }, [clearReplayState])

  const replaySentence = useCallback((sentence: AlignedSentence) => {
    if (!bookData) return
    clearReplayState()
    const { episodes, epSlices } = bookData
    const epIndex = epSlices.findIndex((s) => s.file === sentence.file)
    if (epIndex !== -1 && epIndex !== currentEpRef.current) {
      loadEpisode(epIndex, episodes, bookData.isUserBook)
      audioPlayer.seekWhenReady(sentence.start)
      audioPlayer.playWhenReady()
      return
    }

    audioPlayer.seek(sentence.start)
    audioPlayer.play().catch(console.error)
  }, [bookData, clearReplayState, loadEpisode])

  const replayCurrent = useCallback(() => {
    if (!activeSentence) {
      replayBack10()
      return
    }

    replaySentence(activeSentence)
  }, [activeSentence, replayBack10, replaySentence])

  const replayPrevious = useCallback(() => {
    if (!bookData || activeSentenceIndex <= 0) {
      replayBack10()
      return
    }

    const previous = bookData.sentences[activeSentenceIndex - 1]
    if (!previous) {
      replayBack10()
      return
    }

    replaySentence(previous)
  }, [activeSentenceIndex, bookData, replayBack10, replaySentence])

  const replaySlowOnce = useCallback(() => {
    if (!activeSentence) {
      replayBack10()
      return
    }
    if (!bookData) return

    clearReplayState()
    const originalRate = playbackRateRef.current
    slowReplayRef.current = {
      sentenceEnd: activeSentence.end,
      originalRate,
    }
    audioPlayer.setPlaybackRate(0.5)
    setPlaybackRate(0.5)

    const { episodes, epSlices } = bookData
    const epIndex = epSlices.findIndex((s) => s.file === activeSentence.file)
    if (epIndex !== -1 && epIndex !== currentEpRef.current) {
      loadEpisode(epIndex, episodes, bookData.isUserBook)
      audioPlayer.seekWhenReady(activeSentence.start)
      audioPlayer.playWhenReady()
      return
    }

    audioPlayer.seek(activeSentence.start)
    audioPlayer.play().catch(console.error)
  }, [activeSentence, bookData, clearReplayState, loadEpisode, replayBack10, setPlaybackRate])

  const handleWordTap = async (word: string, sentence?: AlignedSentence) => {
    setSelectedWord(word)
    setDictEntry(null)
    setDictLoading(true)
    setShowDictionary(true)
    // Track which sentence this word belongs to
    if (sentence) {
      useReaderStore.getState().setDictSentence(sentence)
    }

    const entry = await lookupLongest(word.trim())
    setDictEntry(entry)
    setDictLoading(false)
  }

  // ── Missing audio — user needs to re-upload on this device ─────────────────
  if (missingAudioMeta) {
    return (
      <MissingAudioScreen
        meta={missingAudioMeta}
        onBack={() => navigate({ to: '/' })}
        onUploaded={async (file) => {
          await storeAudioForBook(missingAudioMeta.audioFilename, file)
          setMissingAudioMeta(null)
          // Re-trigger book load
          const [meta, sentences] = await Promise.all([
            getBook(bookId),
            getSentences(bookId),
          ])
          if (!meta || sentences.length === 0) return
          if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
          const audioFile = await getAudioFile(meta.audioFilename)
          if (!audioFile) return
          const objectUrl = URL.createObjectURL(audioFile)
          objectUrlRef.current = objectUrl
          setBookData({
            sentences,
            episodes: [objectUrl],
            epSlices: [{ offset: 0, sentences, file: meta.audioFilename }],
            title: meta.title,
            isUserBook: true,
            chapterLabels: [],
          })
        }}
      />
    )
  }

  if (!bookData) {
    return (
      <div className="w-full h-dvh flex items-center justify-center">
        <p className="font-sans text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }

  const { sentences, epSlices, title, chapterLabels } = bookData

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
        <span className="font-sans text-sm text-muted-foreground truncate px-4 max-w-[200px]">
          {title}
        </span>
        <button
          className="p-1 -mr-1 active:opacity-60 transition-opacity"
          onClick={() => setShowSettings(true)}
          aria-label="Settings"
        >
          <Settings className="w-5 h-5 text-muted-foreground" />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto overflow-x-hidden py-6 scrollbar-hidden">
        <div className="flex flex-col gap-5 w-full max-w-[680px] mx-auto px-6">
          {sentences.map((sentence, index) => (
            <React.Fragment key={sentence.id}>
              {/* Episode divider */}
              {index > 0 && sentences[index - 1].file !== sentence.file && (() => {
                const epIdx = epSlices.findIndex((s) => s.file === sentence.file)
                return (
                  <div className="flex items-center gap-4 py-2">
                    <div className="flex-1 h-px bg-border" />
                    <span className="font-serif text-sm text-muted-foreground">
                      {chapterLabels[epIdx] ?? `${epIdx + 1}`}
                    </span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                )
              })()}
              <SentenceParagraph
                sentence={sentence}
                isActive={index === activeSentenceIndex}
                activeWordIndex={index === activeSentenceIndex ? activeWordIndex : -1}
                showFurigana={showFurigana}
                ref={(el) => { sentenceRefs.current[index] = el }}
                onWordTap={handleWordTap}
                onWordSeek={handleWordSeek}
                onSeek={handleSentenceSeek}
              />
            </React.Fragment>
          ))}
        </div>
      </main>

      <IntensiveControls />
      <MineWordPicker />
      <SettingsSheet />
      <DictionarySheet />
      <QueueBanner />
      <AudioBar
        onReplayCurrent={replayCurrent}
        onReplayPrevious={replayPrevious}
        onReplayBack10={replayBack10}
        onReplaySlowOnce={replaySlowOnce}
      />
    </div>
  )
}

// ── SentenceParagraph ─────────────────────────────────────────────────────────

interface SentenceParagraphProps {
  sentence: AlignedSentence
  isActive: boolean
  activeWordIndex: number
  showFurigana: boolean
  onWordTap: (word: string, sentence?: AlignedSentence) => void
  onSeek: (sentence: AlignedSentence) => void
  onWordSeek: (time: number) => void
}

const SentenceParagraph = forwardRef<HTMLParagraphElement, SentenceParagraphProps>(
  ({ sentence, isActive, activeWordIndex, showFurigana, onWordTap, onSeek, onWordSeek }, ref) => {
    const hasWordData = !!(sentence.words && sentence.words.length > 0)
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
          style={{ opacity: hasWordData && isActive ? 1.0 : opacity }}
          onClickCapture={(e) => {
            if (didLongPress.current) {
              e.stopPropagation()
              e.preventDefault()
              didLongPress.current = false
            }
          }}
        >
          <SentenceContent
            sentence={sentence}
            showFurigana={showFurigana}
            onWordTap={onWordTap}
            onWordSeek={onWordSeek}
            activeWordIndex={hasWordData && isActive ? activeWordIndex : -1}
          />
        </p>
      </div>
    )
  }
)
SentenceParagraph.displayName = 'SentenceParagraph'

// ── SentenceContent ───────────────────────────────────────────────────────────

function SentenceContent({
  sentence,
  showFurigana,
  onWordTap,
  onWordSeek,
  activeWordIndex,
}: {
  sentence: AlignedSentence
  showFurigana: boolean
  onWordTap: (word: string, sentence?: AlignedSentence) => void
  onWordSeek: (time: number) => void
  activeWordIndex: number
}) {
  const hasWords = sentence.words && sentence.words.length > 0

  // Word-level highlighting mode
  if (hasWords) {
    const furiganaMap = new Map<string, string>()
    if (showFurigana && sentence.furigana) {
      for (const { word, reading } of sentence.furigana) {
        furiganaMap.set(word, reading)
      }
    }

    return (
      <>
        {sentence.words!.map((w, i) => {
          const spoken = activeWordIndex >= 0 && i <= activeWordIndex
          const reading = furiganaMap.get(w.text)
          // Remove from map so duplicate kanji words get consumed in order
          if (reading) furiganaMap.delete(w.text)

          const style: React.CSSProperties = {
            opacity: spoken ? 1.0 : 0.45,
            transition: 'opacity 0.12s ease-out',
          }

          return (
            <WordSpan
              key={i}
              text={w.text}
              reading={showFurigana ? reading : undefined}
              style={style}
              onTap={() => onWordTap(w.text, sentence)}
              onLongPress={() => onWordSeek(w.start)}
            />
          )
        })}
      </>
    )
  }

  // Fallback: sentence-level (no word data)
  if (!showFurigana || !sentence.furigana || sentence.furigana.length === 0) {
    return <TappableText text={sentence.text} onWordTap={(w) => onWordTap(w, sentence)} />
  }

  const parts: React.ReactNode[] = []
  let remaining = sentence.text
  let key = 0

  for (const { word, reading } of sentence.furigana) {
    const idx = remaining.indexOf(word)
    if (idx === -1) continue

    if (idx > 0) {
      parts.push(
        <TappableText key={`t${key++}`} text={remaining.slice(0, idx)} onWordTap={(w) => onWordTap(w, sentence)} />
      )
    }

    parts.push(
      <ruby key={`r${key++}`} className="cursor-pointer" onClick={() => onWordTap(word, sentence)}>
        {word}
        <rp>(</rp>
        <rt className="text-[10px] font-normal opacity-70">{reading}</rt>
        <rp>)</rp>
      </ruby>
    )

    remaining = remaining.slice(idx + word.length)
  }

  if (remaining) {
    parts.push(<TappableText key={`t${key++}`} text={remaining} onWordTap={(w) => onWordTap(w, sentence)} />)
  }

  return <>{parts}</>
}

function TappableText({ text, onWordTap }: { text: string; onWordTap: (w: string) => void }) {
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

// ── WordSpan — tap for dictionary, long-press to seek ────────────────────────

function WordSpan({
  text,
  reading,
  style,
  onTap,
  onLongPress,
}: {
  text: string
  reading?: string
  style: React.CSSProperties
  onTap: () => void
  onLongPress: () => void
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didLongPressRef = useRef(false)

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation() // prevent sentence-level long-press
    didLongPressRef.current = false
    timerRef.current = setTimeout(() => {
      didLongPressRef.current = true
      onLongPress()
    }, 400)
  }

  const handlePointerUp = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const handleClick = (e: React.MouseEvent) => {
    if (didLongPressRef.current) {
      e.stopPropagation()
      e.preventDefault()
      didLongPressRef.current = false
      return
    }
    onTap()
  }

  if (reading) {
    return (
      <ruby
        className="cursor-pointer"
        style={style}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleClick}
      >
        {text}
        <rp>(</rp>
        <rt className="text-[10px] font-normal opacity-70">{reading}</rt>
        <rp>)</rp>
      </ruby>
    )
  }

  return (
    <span
      className="cursor-pointer"
      style={style}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClick={handleClick}
    >
      {text}
    </span>
  )
}

// ── MissingAudioScreen ────────────────────────────────────────────────────────

function MissingAudioScreen({
  meta,
  onBack,
  onUploaded,
}: {
  meta: BookMeta
  onBack: () => void
  onUploaded: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="w-full h-dvh flex flex-col">
      <header className="h-[44px] flex items-center px-4 shrink-0">
        <button
          className="p-1 -ml-1 active:opacity-60"
          onClick={onBack}
          aria-label="Go back"
        >
          <ChevronLeft className="w-5 h-5 text-muted-foreground" />
        </button>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center px-8 gap-5 text-center">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl"
          style={{ backgroundColor: '#1A1A1A' }}
        >
          🎵
        </div>
        <div>
          <p className="font-serif text-[18px] text-foreground mb-1">{meta.title}</p>
          <p className="font-sans text-sm text-muted-foreground">Audio file needed on this device</p>
        </div>
        <p className="font-sans text-[13px] text-muted-foreground max-w-xs">
          This book was synced from another device. Upload the audio file to start reading.
        </p>
        <p
          className="font-sans text-[12px] px-3 py-1.5 rounded-lg"
          style={{ backgroundColor: '#1A1A1A', color: '#888' }}
        >
          {meta.audioFilename}
        </p>

        <input
          ref={inputRef}
          type="file"
          accept="audio/*,.mp3,.m4a,.ogg,.wav,.flac"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onUploaded(file)
          }}
        />
        <button
          onClick={() => inputRef.current?.click()}
          className="px-6 py-3 rounded-xl font-sans text-sm font-medium"
          style={{ backgroundColor: '#C8A96E', color: '#111' }}
        >
          Upload Audio File
        </button>
      </div>
    </div>
  )
}
