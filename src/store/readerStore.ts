import { create } from 'zustand'
import type { DictEntry, DictStatus } from '../lib/dictTypes'
import type { AlignedSentence } from '../lib/alignment'

interface ReaderState {
  isPlaying: boolean
  currentTime: number
  duration: number
  activeSentenceIndex: number
  activeSentence: AlignedSentence | null
  intensiveMode: boolean
  playbackRate: number
  showFurigana: boolean
  showSettings: boolean
  showDictionary: boolean
  selectedWord: string | null
  dictEntry: DictEntry | null
  dictLoading: boolean
  dictStatus: DictStatus

  setIsPlaying: (v: boolean) => void
  setCurrentTime: (t: number) => void
  setDuration: (d: number) => void
  setActiveSentenceIndex: (i: number) => void
  setActiveSentence: (s: AlignedSentence | null) => void
  setIntensiveMode: (v: boolean) => void
  setPlaybackRate: (r: number) => void
  setShowFurigana: (v: boolean) => void
  setShowSettings: (v: boolean) => void
  setShowDictionary: (v: boolean) => void
  setSelectedWord: (w: string | null) => void
  setDictEntry: (e: DictEntry | null) => void
  setDictLoading: (v: boolean) => void
  setDictStatus: (s: DictStatus) => void
}

export const useReaderStore = create<ReaderState>((set) => ({
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  activeSentenceIndex: -1,
  activeSentence: null,
  intensiveMode: localStorage.getItem('ondoku_intensive') !== 'false',
  playbackRate: parseFloat(localStorage.getItem('ondoku_speed') ?? '1.0') || 1.0,
  showFurigana: localStorage.getItem('ondoku_furigana') !== 'false',
  showSettings: false,
  showDictionary: false,
  selectedWord: null,
  dictEntry: null,
  dictLoading: false,
  dictStatus: { state: 'idle', progress: 0 },

  setIsPlaying: (v) => set({ isPlaying: v }),
  setCurrentTime: (t) => set({ currentTime: t }),
  setDuration: (d) => set({ duration: d }),
  setActiveSentenceIndex: (i) => set({ activeSentenceIndex: i }),
  setActiveSentence: (s) => set({ activeSentence: s }),
  setIntensiveMode: (v) => {
    localStorage.setItem('ondoku_intensive', String(v))
    set({ intensiveMode: v })
  },
  setPlaybackRate: (r) => {
    localStorage.setItem('ondoku_speed', String(r))
    set({ playbackRate: r })
  },
  setShowFurigana: (v) => {
    localStorage.setItem('ondoku_furigana', String(v))
    set({ showFurigana: v })
  },
  setShowSettings: (v) => set({ showSettings: v }),
  setShowDictionary: (v) => set({ showDictionary: v }),
  setSelectedWord: (w) => set({ selectedWord: w }),
  setDictEntry: (e) => set({ dictEntry: e }),
  setDictLoading: (v) => set({ dictLoading: v }),
  setDictStatus: (s) => set({ dictStatus: s }),
}))
