import { useReaderStore } from '../store/readerStore'
import { audioPlayer } from '../lib/audioPlayer'

const SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5]

export function SettingsSheet() {
  const {
    showSettings,
    showFurigana,
    intensiveMode,
    playbackRate,
    setShowSettings,
    setShowFurigana,
    setIntensiveMode,
    setPlaybackRate,
  } = useReaderStore()

  if (!showSettings) return null

  const handleSpeed = (speed: number) => {
    setPlaybackRate(speed)
    audioPlayer.setPlaybackRate(speed)
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
