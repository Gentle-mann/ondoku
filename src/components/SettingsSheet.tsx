import { useReaderStore } from '../store/readerStore'
import { audioPlayer } from '../lib/audioPlayer'
import { useState } from 'react'

const SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5]

export function SettingsSheet() {
  const {
    showSettings,
    showFurigana,
    intensiveMode,
    playbackRate,
    ankiDeck,
    claudeApiKey,
    cardType,
    setShowSettings,
    setShowFurigana,
    setIntensiveMode,
    setPlaybackRate,
    setAnkiDeck,
    setClaudeApiKey,
    setCardType,
  } = useReaderStore()

  const [deckInput, setDeckInput] = useState(ankiDeck)
  const [keyInput, setKeyInput] = useState(claudeApiKey)

  if (!showSettings) return null

  const handleSpeed = (speed: number) => {
    setPlaybackRate(speed)
    audioPlayer.setPlaybackRate(speed)
  }

  const handleDeckBlur = () => {
    const trimmed = deckInput.trim()
    if (trimmed) setAnkiDeck(trimmed)
    else setDeckInput(ankiDeck)
  }

  const handleKeyBlur = () => {
    setClaudeApiKey(keyInput.trim())
  }

  return (
    <>
      <div className="absolute inset-0 bg-black/40 z-20" onClick={() => setShowSettings(false)} />

      <div
        className="absolute bottom-[52px] left-0 right-0 z-30 rounded-t-[16px]"
        style={{ backgroundColor: '#1A1A1A', boxShadow: '0 -4px 24px rgba(0,0,0,0.4)' }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-9 h-1 rounded-full" style={{ backgroundColor: '#333' }} />
        </div>

        <div className="px-5 pb-6 flex flex-col gap-5">
          <p className="font-sans text-xs text-muted-foreground uppercase tracking-widest">Settings</p>

          {/* Furigana */}
          <ToggleRow
            label="Furigana"
            sublabel="Show readings above kanji"
            value={showFurigana}
            onChange={setShowFurigana}
          />

          {/* Intensive mode */}
          <ToggleRow
            label="Intensive Mode"
            sublabel="Pause after every sentence"
            value={intensiveMode}
            onChange={setIntensiveMode}
          />

          {/* Card type */}
          <div className="flex flex-col gap-2">
            <div>
              <p className="font-sans text-[15px] text-foreground">Card Type</p>
              <p className="font-sans text-[12px] text-muted-foreground">What goes on the front</p>
            </div>
            <div className="flex gap-2">
              {(['sentence', 'word'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setCardType(t)}
                  className="flex-1 py-2 rounded-lg font-sans text-[13px] transition-colors active:opacity-70 capitalize"
                  style={{
                    backgroundColor: cardType === t ? '#C8A96E' : '#2A2A2A',
                    color: cardType === t ? '#111' : '#999',
                    fontWeight: cardType === t ? 600 : 400,
                  }}
                >
                  {t === 'sentence' ? 'Sentence + word' : 'Word only'}
                </button>
              ))}
            </div>
          </div>

          {/* Anki deck */}
          <div className="flex flex-col gap-1.5">
            <p className="font-sans text-[15px] text-foreground">Anki Deck</p>
            <p className="font-sans text-[12px] text-muted-foreground">Cards go to this deck</p>
            <input
              type="text"
              value={deckInput}
              onChange={(e) => setDeckInput(e.target.value)}
              onBlur={handleDeckBlur}
              onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur())}
              className="w-full rounded-lg px-3 py-2 font-sans text-[14px] text-foreground outline-none"
              style={{ backgroundColor: '#2A2A2A', border: '1px solid #333' }}
              placeholder="Deck name"
            />
          </div>

          {/* Claude API key */}
          <div className="flex flex-col gap-1.5">
            <p className="font-sans text-[15px] text-foreground">Claude API Key</p>
            <p className="font-sans text-[12px] text-muted-foreground">For AI-generated Anki card backs</p>
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onBlur={handleKeyBlur}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              className="w-full rounded-lg px-3 py-2 font-sans text-[14px] text-foreground outline-none"
              style={{ backgroundColor: '#2A2A2A', border: '1px solid #333' }}
              placeholder="sk-ant-..."
            />
            {claudeApiKey && (
              <p className="font-sans text-[11px]" style={{ color: '#4CAF50' }}>✓ Key saved</p>
            )}
          </div>

          {/* Playback speed */}
          <div className="flex flex-col gap-2">
            <div>
              <p className="font-sans text-[15px] text-foreground">Playback Speed</p>
              <p className="font-sans text-[12px] text-muted-foreground">Current: {playbackRate}×</p>
            </div>
            <div className="flex gap-2">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSpeed(s)}
                  className="flex-1 py-2 rounded-lg font-sans text-[13px] transition-colors active:opacity-70"
                  style={{
                    backgroundColor: playbackRate === s ? '#C8A96E' : '#2A2A2A',
                    color: playbackRate === s ? '#111' : '#999',
                    fontWeight: playbackRate === s ? 600 : 400,
                  }}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function ToggleRow({
  label,
  sublabel,
  value,
  onChange,
}: {
  label: string
  sublabel: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="font-sans text-[15px] text-foreground">{label}</p>
        <p className="font-sans text-[12px] text-muted-foreground">{sublabel}</p>
      </div>
      <button
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className="w-12 h-7 rounded-full transition-colors duration-200 relative shrink-0"
        style={{ backgroundColor: value ? '#C8A96E' : '#333' }}
      >
        <span
          className="absolute top-1 w-5 h-5 rounded-full bg-white transition-transform duration-200"
          style={{ transform: value ? 'translateX(22px)' : 'translateX(4px)' }}
        />
      </button>
    </div>
  )
}
