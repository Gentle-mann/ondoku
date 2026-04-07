import { Volume2, Plus, Sparkles, Loader2 } from 'lucide-react'
import { useReaderStore } from '../store/readerStore'
import type { DictEntry, KanjiBreakdown } from '../lib/dictTypes'

const JLPT_LABEL: Record<number, string> = { 1: 'N1', 2: 'N2', 3: 'N3', 4: 'N4', 5: 'N5' }

export function DictionarySheet() {
  const { showDictionary, selectedWord, dictEntry, dictLoading, dictStatus, setShowDictionary } =
    useReaderStore()

  if (!showDictionary) return null

  const isDbLoading = dictStatus.state === 'downloading' || dictStatus.state === 'loading'

  return (
    <>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 z-20" onClick={() => setShowDictionary(false)} />

      {/* Sheet */}
      <div
        className="absolute bottom-[52px] left-0 right-0 z-30 rounded-t-[16px] flex flex-col"
        style={{
          backgroundColor: '#1A1A1A',
          maxHeight: '65%',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.4)',
        }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-2 shrink-0">
          <div className="w-9 h-1 rounded-full" style={{ backgroundColor: '#333' }} />
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-2 scrollbar-hidden">
          {/* DB still loading first time */}
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
                  <div
                    className="h-full bg-accent rounded-full transition-all"
                    style={{ width: `${dictStatus.progress}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Looking up a word */}
          {!isDbLoading && dictLoading && (
            <div className="flex items-center justify-center py-10 gap-2">
              <Loader2 className="w-5 h-5 text-accent animate-spin" />
              <span className="text-sm font-sans text-muted-foreground">Looking up…</span>
            </div>
          )}

          {/* Not found */}
          {!isDbLoading && !dictLoading && !dictEntry && selectedWord && (
            <div className="py-10 text-center">
              <p className="font-serif text-xl text-foreground mb-2">{selectedWord}</p>
              <p className="text-sm font-sans text-muted-foreground">Not found in dictionary</p>
            </div>
          )}

          {/* Entry found */}
          {!isDbLoading && !dictLoading && dictEntry && (
            <EntryView entry={dictEntry} />
          )}
        </div>

        {/* Action buttons */}
        {dictEntry && (
          <div className="flex border-t shrink-0" style={{ borderColor: '#2A2A2A' }}>
            <button
              className="flex-1 flex items-center justify-center gap-2 py-3 border-r active:bg-secondary/50"
              style={{ borderColor: '#2A2A2A' }}
            >
              <Volume2 className="w-4 h-4" style={{ color: '#C8A96E' }} />
              <span className="text-[13px] font-sans" style={{ color: '#C8A96E' }}>Hear</span>
            </button>
            <button
              className="flex-1 flex items-center justify-center gap-2 py-3 border-r active:bg-secondary/50"
              style={{ borderColor: '#2A2A2A' }}
            >
              <Plus className="w-4 h-4" style={{ color: '#999' }} />
              <span className="text-[13px] font-sans" style={{ color: '#999' }}>Anki</span>
            </button>
            <button className="flex-1 flex items-center justify-center gap-2 py-3 active:bg-secondary/50">
              <Sparkles className="w-4 h-4" style={{ color: '#999' }} />
              <span className="text-[13px] font-sans" style={{ color: '#999' }}>AI</span>
            </button>
          </div>
        )}
      </div>
    </>
  )
}

// ── Entry view ────────────────────────────────────────────────────────────────

function EntryView({ entry }: { entry: DictEntry }) {
  const primaryReading = entry.readings[0] ?? ''
  const jlptLabel = entry.jlpt ? JLPT_LABEL[entry.jlpt] : null

  return (
    <>
      {/* Word + metadata */}
      <div className="flex items-start justify-between mb-2">
        <span className="font-serif text-[26px] text-foreground leading-tight">{entry.word}</span>
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
          <div className="flex flex-wrap gap-2 mb-4">
            {entry.kanjiBreakdown.map((k) => (
              <KanjiPill key={k.literal} kanji={k} />
            ))}
          </div>
        </>
      )}
    </>
  )
}

function KanjiPill({ kanji }: { kanji: KanjiBreakdown }) {
  const reading = kanji.readings_kun[0]?.replace(/[.-].*/, '') ?? kanji.readings_on[0] ?? ''
  const meaning = kanji.meanings[0] ?? ''

  return (
    <div
      className="px-3 py-1.5 rounded-full flex items-center gap-1.5"
      style={{ backgroundColor: '#242424' }}
    >
      <span className="font-serif text-[14px] text-foreground">{kanji.literal}</span>
      {reading && (
        <span className="text-[11px] font-sans" style={{ color: '#666' }}>
          [{reading}]
        </span>
      )}
      {meaning && (
        <span className="text-[11px] font-sans" style={{ color: '#999' }}>
          {meaning.toLowerCase()}
        </span>
      )}
    </div>
  )
}

// Shorten verbose POS strings to display-friendly versions
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
