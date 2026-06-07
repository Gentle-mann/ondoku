import { useReaderStore, type ReaderFontSize } from '../store/readerStore'
import { audioPlayer } from '../lib/audioPlayer'
import { checkClipServer } from '../lib/audioClip'
import { supabase } from '../lib/supabase'
import { scheduleSettingsPush, currentSettingsSnapshot, syncFromCloud } from '../lib/sync'
import { useState, useEffect } from 'react'
import { Loader2, RefreshCw, X } from 'lucide-react'
import { AuthSheet } from './AuthSheet'

const SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5]
const READER_FONT_SIZES: Array<{ value: ReaderFontSize; label: string; size: string }> = [
  { value: 'standard', label: 'Standard', size: '16px' },
  { value: 'large', label: 'Large', size: '18px' },
  { value: 'xlarge', label: 'Extra', size: '20px' },
]

export function SettingsSheet() {
  const {
    showSettings,
    showFurigana,
    intensiveMode,
    playbackRate,
    readerFontSize,
    ankiDeck,
    claudeApiKey,
    cardType,
    userId,
    userEmail,
    lastSyncedAt,
    setShowSettings,
    setShowFurigana,
    setIntensiveMode,
    setPlaybackRate,
    setReaderFontSize,
    setAnkiDeck,
    setClaudeApiKey,
    setCardType,
  } = useReaderStore()

  const [deckInput, setDeckInput] = useState(ankiDeck)
  const [keyInput, setKeyInput] = useState(claudeApiKey)
  const [clipServerUp, setClipServerUp] = useState<boolean | null>(null)
  const [showAuthSheet, setShowAuthSheet] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncNow, setSyncNow] = useState(() => Date.now())

  useEffect(() => {
    if (!showSettings) return
    setClipServerUp(null)
    setSyncNow(Date.now())
    checkClipServer().then(setClipServerUp)
  }, [showSettings])

  useEffect(() => {
    if (!showSettings) return
    const interval = window.setInterval(() => setSyncNow(Date.now()), 60000)
    return () => window.clearInterval(interval)
  }, [showSettings])

  // Keep inputs in sync when pulled from cloud
  useEffect(() => { setDeckInput(ankiDeck) }, [ankiDeck])
  useEffect(() => { setKeyInput(claudeApiKey) }, [claudeApiKey])

  if (!showSettings) return null

  const handleSpeed = (speed: number) => {
    setPlaybackRate(speed)
    audioPlayer.setPlaybackRate(speed)
    scheduleSettingsPush({ ...currentSettingsSnapshot(), playback_speed: speed })
  }

  const handleDeckBlur = () => {
    const trimmed = deckInput.trim()
    if (trimmed) {
      setAnkiDeck(trimmed)
      scheduleSettingsPush({ ...currentSettingsSnapshot(), anki_deck: trimmed })
    } else {
      setDeckInput(ankiDeck)
    }
  }

  const handleKeyBlur = () => {
    const trimmed = keyInput.trim()
    setClaudeApiKey(trimmed)
    scheduleSettingsPush({ ...currentSettingsSnapshot(), claude_api_key: trimmed })
  }

  const handleToggle = (field: 'furigana' | 'intensive', value: boolean) => {
    if (field === 'furigana') {
      setShowFurigana(value)
      scheduleSettingsPush({ ...currentSettingsSnapshot(), show_furigana: value })
    } else {
      setIntensiveMode(value)
      scheduleSettingsPush({ ...currentSettingsSnapshot(), intensive_mode: value })
    }
  }

  const handleCardType = (t: 'sentence' | 'word') => {
    setCardType(t)
    scheduleSettingsPush({ ...currentSettingsSnapshot(), card_type: t })
  }

  const handleReaderFontSize = (size: ReaderFontSize) => {
    setReaderFontSize(size)
  }

  const handleSignOut = async () => {
    await supabase?.auth.signOut()
  }

  const handleManualSync = async () => {
    setSyncing(true)
    await syncFromCloud()
    setSyncing(false)
  }

  const syncLabel = () => {
    if (!lastSyncedAt) return 'Not synced yet'
    const diff = Math.round((syncNow - lastSyncedAt) / 1000)
    if (diff < 60) return 'Synced just now'
    if (diff < 3600) return `Synced ${Math.round(diff / 60)}m ago`
    return `Synced ${Math.round(diff / 3600)}h ago`
  }

  return (
    <>
      <div className="absolute inset-0 bg-black/40 z-20" onClick={() => setShowSettings(false)} />

      <div
        className="absolute bottom-[52px] left-0 right-0 z-30 rounded-t-[16px] overflow-y-auto"
        style={{ backgroundColor: '#1A1A1A', boxShadow: '0 -4px 24px rgba(0,0,0,0.4)', maxHeight: '65dvh' }}
      >
        <div className="flex items-center justify-between pt-4 px-5 pb-2 shrink-0">
          <p className="font-sans text-xs text-muted-foreground uppercase tracking-widest">Settings</p>
          <button
            onClick={() => setShowSettings(false)}
            className="p-1 rounded-full active:opacity-60"
            style={{ backgroundColor: '#2A2A2A' }}
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="px-5 pb-6 flex flex-col gap-5">

          {/* ── Account ─────────────────────────────────────────────────── */}
          <div
            className="rounded-xl px-4 py-3 flex flex-col gap-2"
            style={{ backgroundColor: '#111', border: '1px solid #222' }}
          >
            {userId ? (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-sans text-[13px] text-foreground font-medium">{userEmail}</p>
                    <p className="font-sans text-[11px] text-muted-foreground">{syncLabel()}</p>
                  </div>
                  <button
                    onClick={handleManualSync}
                    disabled={syncing}
                    className="p-1.5 rounded-lg active:opacity-60"
                    style={{ backgroundColor: '#1A1A1A' }}
                    title="Sync now"
                  >
                    {syncing
                      ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      : <RefreshCw className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-sans text-[13px] text-foreground font-medium">Sync across devices</p>
                  <p className="font-sans text-[11px] text-muted-foreground">Sign in to sync settings & progress</p>
                </div>
                <button
                  onClick={() => setShowAuthSheet(true)}
                  className="px-3 py-1.5 rounded-lg font-sans text-[12px] font-medium active:opacity-70"
                  style={{ backgroundColor: '#C8A96E', color: '#111' }}
                >
                  Sign In
                </button>
              </div>
            )}
          </div>

          {/* Furigana */}
          <ToggleRow
            label="Furigana"
            sublabel="Show readings above kanji"
            value={showFurigana}
            onChange={(v) => handleToggle('furigana', v)}
          />

          {/* Reader text size */}
          <div className="flex flex-col gap-2">
            <div>
              <p className="font-sans text-[15px] text-foreground">Reader Text Size</p>
              <p className="font-sans text-[12px] text-muted-foreground">Larger Japanese text for night reading</p>
            </div>
            <div className="flex gap-2">
              {READER_FONT_SIZES.map((option) => (
                <button
                  key={option.value}
                  onClick={() => handleReaderFontSize(option.value)}
                  className="flex-1 py-2 rounded-lg font-sans text-[13px] transition-colors active:opacity-70"
                  aria-pressed={readerFontSize === option.value}
                  style={{
                    backgroundColor: readerFontSize === option.value ? '#C8A96E' : '#2A2A2A',
                    color: readerFontSize === option.value ? '#111' : '#D0CBC2',
                    fontWeight: readerFontSize === option.value ? 600 : 400,
                  }}
                >
                  <span className="block">{option.label}</span>
                  <span className="block text-[11px] opacity-80">{option.size}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Intensive mode */}
          <ToggleRow
            label="Intensive Mode"
            sublabel="Pause after every sentence"
            value={intensiveMode}
            onChange={(v) => handleToggle('intensive', v)}
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
                  onClick={() => handleCardType(t)}
                  className="flex-1 py-2 rounded-lg font-sans text-[13px] transition-colors active:opacity-70 capitalize"
                  style={{
                    backgroundColor: cardType === t ? '#C8A96E' : '#2A2A2A',
                    color: cardType === t ? '#111' : '#D0CBC2',
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
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
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

          {/* Audio clip server status */}
          <div className="flex flex-col gap-1">
            <p className="font-sans text-[15px] text-foreground">Audio Clips</p>
            <p className="font-sans text-[12px] text-muted-foreground">
              Attach the sentence audio to each mined card
            </p>
            <p className="font-sans text-[12px] mt-1" style={{ color: clipServerUp === true ? '#4CAF50' : clipServerUp === false ? '#666' : '#888' }}>
              {clipServerUp === null
                ? '⏳ Checking…'
                : clipServerUp
                  ? '🟢 Audio server running'
                  : '⚪ Audio server offline — python scripts/clip_server.py'}
            </p>
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
                    color: playbackRate === s ? '#111' : '#D0CBC2',
                    fontWeight: playbackRate === s ? 600 : 400,
                  }}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>

          {/* Sign out — at the bottom to avoid accidental taps */}
          {userId && (
            <button
              onClick={handleSignOut}
              className="w-full py-2.5 rounded-xl font-sans text-[13px] active:opacity-60"
              style={{ backgroundColor: '#1A1A1A', color: '#666', border: '1px solid #222' }}
            >
              Sign out
            </button>
          )}
        </div>
      </div>

      {showAuthSheet && <AuthSheet onClose={() => setShowAuthSheet(false)} />}
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
