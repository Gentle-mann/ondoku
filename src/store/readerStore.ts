import { create } from 'zustand'
import type { DictEntry, DictStatus } from '../lib/dictTypes'

interface ReaderState {
  isPlaying: boolean
  currentTime: number
  duration: number
  activeSentenceIndex: number
  intensiveMode: boolean
  playbackRate: number
  showDictionary: boolean
  selectedWord: string | null
  dictEntry: DictEntry | null
  dictLoading: boolean
  dictStatus: DictStatus

  setIsPlaying: (v: boolean) => void
  setCurrentTime: (t: number) => void
  setDuration: (d: number) => void
  setActiveSentenceIndex: (i: number) => void
  setIntensiveMode: (v: boolean) => void
  setPlaybackRate: (r: number) => void
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
  intensiveMode: true,
  playbackRate: 1.0,
  showDictionary: false,
  selectedWord: null,
  dictEntry: null,
  dictLoading: false,
  dictStatus: { state: 'idle', progress: 0 },

  setIsPlaying: (v) => set({ isPlaying: v }),
  setCurrentTime: (t) => set({ currentTime: t }),
  setDuration: (d) => set({ duration: d }),
  setActiveSentenceIndex: (i) => set({ activeSentenceIndex: i }),
  setIntensiveMode: (v) => set({ intensiveMode: v }),
  setPlaybackRate: (r) => set({ playbackRate: r }),
  setShowDictionary: (v) => set({ showDictionary: v }),
  setSelectedWord: (w) => set({ selectedWord: w }),
  setDictEntry: (e) => set({ dictEntry: e }),
  setDictLoading: (v) => set({ dictLoading: v }),
  setDictStatus: (s) => set({ dictStatus: s }),
}))
