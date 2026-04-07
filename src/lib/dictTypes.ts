export interface KanjiBreakdown {
  literal: string
  meanings: string[]
  readings_on: string[]
  readings_kun: string[]
  jlpt: number | null
}

export interface DictSense {
  pos: string[]      // ["Godan verb with 'mu' ending", "intransitive verb"]
  glosses: string[]  // ["to become misty", "to grow hazy"]
}

export interface DictEntry {
  id: number
  word: string         // primary kanji form (or first reading if kana-only)
  readings: string[]   // all kana readings
  jlpt: number | null  // 1=N1, 5=N5, null=unknown
  freqRank: number | null
  senses: DictSense[]
  kanjiBreakdown: KanjiBreakdown[]
  pitch: { reading: string; pattern: string }[]
}

export interface DictStatus {
  state: 'idle' | 'downloading' | 'loading' | 'ready' | 'error'
  progress: number   // 0–100 during download
  error?: string
}
