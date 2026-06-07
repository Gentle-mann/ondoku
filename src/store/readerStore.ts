import { create } from 'zustand'
import type { DictEntry, DictStatus } from '../lib/dictTypes'
import type { AlignedSentence } from '../lib/alignment'

export const SLEEP_TIMER_STORAGE_KEY = 'ondoku_sleep_timer_deadline'
const READER_FONT_SIZE_STORAGE_KEY = 'ondoku_reader_font_size'

export type ReaderFontSize = 'standard' | 'large' | 'xlarge'

function getStoredReaderFontSize(): ReaderFontSize {
  const raw = localStorage.getItem(READER_FONT_SIZE_STORAGE_KEY)
  if (raw === 'standard' || raw === 'large' || raw === 'xlarge') return raw
  return 'large'
}

function getStoredSleepTimerDeadline(): number | null {
  const raw = localStorage.getItem(SLEEP_TIMER_STORAGE_KEY)
  if (!raw) return null

  const deadline = Number(raw)
  if (!Number.isFinite(deadline) || deadline <= Date.now()) {
    localStorage.removeItem(SLEEP_TIMER_STORAGE_KEY)
    return null
  }

  return deadline
}

interface ReaderState {
  // Auth + sync
  userId: string | null
  userEmail: string | null
  lastSyncedAt: number | null

  isPlaying: boolean
  currentTime: number
  duration: number
  activeSentenceIndex: number
  activeSentence: AlignedSentence | null
  activeWordIndex: number
  precedingSentences: string[]
  intensiveMode: boolean
  playbackRate: number
  ankiDeck: string
  claudeApiKey: string
  cardType: 'sentence' | 'word'
  currentEpIndex: number
  currentBookId: string
  readerFontSize: ReaderFontSize
  showMinePicker: boolean
  showFurigana: boolean
  showSettings: boolean
  showDictionary: boolean
  dictSentence: AlignedSentence | null
  selectedWord: string | null
  dictEntry: DictEntry | null
  dictLoading: boolean
  dictStatus: DictStatus
  sleepTimerDeadline: number | null
  sleepTimerRemainingMs: number

  setIsPlaying: (v: boolean) => void
  setCurrentTime: (t: number) => void
  setDuration: (d: number) => void
  setActiveSentenceIndex: (i: number) => void
  setActiveSentence: (s: AlignedSentence | null) => void
  setActiveWordIndex: (i: number) => void
  setPrecedingSentences: (ss: string[]) => void
  setIntensiveMode: (v: boolean) => void
  setPlaybackRate: (r: number) => void
  setAnkiDeck: (d: string) => void
  setClaudeApiKey: (k: string) => void
  setCardType: (t: 'sentence' | 'word') => void
  setUserId: (id: string | null) => void
  setUserEmail: (e: string | null) => void
  setLastSyncedAt: (t: number | null) => void
  setCurrentEpIndex: (i: number) => void
  setCurrentBookId: (id: string) => void
  setReaderFontSize: (size: ReaderFontSize) => void
  setShowMinePicker: (v: boolean) => void
  setShowFurigana: (v: boolean) => void
  setShowSettings: (v: boolean) => void
  setShowDictionary: (v: boolean) => void
  setDictSentence: (s: AlignedSentence | null) => void
  setSelectedWord: (w: string | null) => void
  setDictEntry: (e: DictEntry | null) => void
  setDictLoading: (v: boolean) => void
  setDictStatus: (s: DictStatus) => void
  setSleepTimer: (deadline: number | null) => void
  setSleepTimerForMinutes: (minutes: number) => void
  setSleepTimerRemainingMs: (ms: number) => void
  clearSleepTimer: () => void
}

export const useReaderStore = create<ReaderState>((set) => ({
  userId: null,
  userEmail: null,
  lastSyncedAt: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  activeSentenceIndex: -1,
  activeSentence: null,
  activeWordIndex: -1,
  precedingSentences: [],
  intensiveMode: localStorage.getItem('ondoku_intensive') !== 'false',
  playbackRate: parseFloat(localStorage.getItem('ondoku_speed') ?? '1.0') || 1.0,
  ankiDeck: localStorage.getItem('ondoku_deck') ?? 'Ondoku',
  claudeApiKey: localStorage.getItem('ondoku_claude_key') ?? '',
  cardType: (localStorage.getItem('ondoku_card_type') as 'sentence' | 'word') ?? 'sentence',
  currentEpIndex: 0,
  currentBookId: 'yaneura',
  readerFontSize: getStoredReaderFontSize(),
  showMinePicker: false,
  showFurigana: localStorage.getItem('ondoku_furigana') !== 'false',
  showSettings: false,
  showDictionary: false,
  dictSentence: null,
  selectedWord: null,
  dictEntry: null,
  dictLoading: false,
  dictStatus: { state: 'idle', progress: 0 },
  sleepTimerDeadline: getStoredSleepTimerDeadline(),
  sleepTimerRemainingMs: 0,

  setIsPlaying: (v) => set({ isPlaying: v }),
  setCurrentTime: (t) => set({ currentTime: t }),
  setDuration: (d) => set({ duration: d }),
  setActiveSentenceIndex: (i) => set({ activeSentenceIndex: i }),
  setActiveSentence: (s) => set({ activeSentence: s }),
  setActiveWordIndex: (i) => set({ activeWordIndex: i }),
  setPrecedingSentences: (ss) => set({ precedingSentences: ss }),
  setIntensiveMode: (v) => {
    localStorage.setItem('ondoku_intensive', String(v))
    set({ intensiveMode: v })
  },
  setPlaybackRate: (r) => {
    localStorage.setItem('ondoku_speed', String(r))
    set({ playbackRate: r })
  },
  setAnkiDeck: (d) => {
    localStorage.setItem('ondoku_deck', d)
    set({ ankiDeck: d })
  },
  setClaudeApiKey: (k) => {
    localStorage.setItem('ondoku_claude_key', k)
    set({ claudeApiKey: k })
  },
  setCardType: (t) => {
    localStorage.setItem('ondoku_card_type', t)
    set({ cardType: t })
  },
  setUserId: (id) => set({ userId: id }),
  setUserEmail: (e) => set({ userEmail: e }),
  setLastSyncedAt: (t) => set({ lastSyncedAt: t }),
  setCurrentEpIndex: (i) => set({ currentEpIndex: i }),
  setCurrentBookId: (id) => set({ currentBookId: id }),
  setReaderFontSize: (size) => {
    localStorage.setItem(READER_FONT_SIZE_STORAGE_KEY, size)
    set({ readerFontSize: size })
  },
  setShowMinePicker: (v) => set({ showMinePicker: v }),
  setShowFurigana: (v) => {
    localStorage.setItem('ondoku_furigana', String(v))
    set({ showFurigana: v })
  },
  setShowSettings: (v) => set({ showSettings: v }),
  setShowDictionary: (v) => set({ showDictionary: v }),
  setDictSentence: (s) => set({ dictSentence: s }),
  setSelectedWord: (w) => set({ selectedWord: w }),
  setDictEntry: (e) => set({ dictEntry: e }),
  setDictLoading: (v) => set({ dictLoading: v }),
  setDictStatus: (s) => set({ dictStatus: s }),
  setSleepTimer: (deadline) => {
    if (deadline && deadline > Date.now()) {
      localStorage.setItem(SLEEP_TIMER_STORAGE_KEY, String(deadline))
      set({
        sleepTimerDeadline: deadline,
        sleepTimerRemainingMs: Math.max(0, deadline - Date.now()),
      })
    } else {
      localStorage.removeItem(SLEEP_TIMER_STORAGE_KEY)
      set({ sleepTimerDeadline: null, sleepTimerRemainingMs: 0 })
    }
  },
  setSleepTimerForMinutes: (minutes) => {
    const deadline = Date.now() + minutes * 60 * 1000
    localStorage.setItem(SLEEP_TIMER_STORAGE_KEY, String(deadline))
    set({
      sleepTimerDeadline: deadline,
      sleepTimerRemainingMs: Math.max(0, deadline - Date.now()),
    })
  },
  setSleepTimerRemainingMs: (ms) => set({ sleepTimerRemainingMs: Math.max(0, ms) }),
  clearSleepTimer: () => {
    localStorage.removeItem(SLEEP_TIMER_STORAGE_KEY)
    set({ sleepTimerDeadline: null, sleepTimerRemainingMs: 0 })
  },
}))
