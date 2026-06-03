import { useState } from 'react'
import { Play, Pause, Grid3X3, Moon, X, RotateCcw, SkipBack, Rewind, Gauge } from 'lucide-react'
import { audioPlayer } from '../lib/audioPlayer'
import { useReaderStore } from '../store/readerStore'

const SLEEP_TIMER_PRESETS = [5, 10, 15, 30, 45, 60]

interface AudioBarProps {
  onReplayCurrent: () => void
  onReplayPrevious: () => void
  onReplayBack10: () => void
  onReplaySlowOnce: () => void
}

export function AudioBar({
  onReplayCurrent,
  onReplayPrevious,
  onReplayBack10,
  onReplaySlowOnce,
}: AudioBarProps) {
  const [showSleepTimer, setShowSleepTimer] = useState(false)
  const [showSmartReplay, setShowSmartReplay] = useState(false)

  const {
    isPlaying,
    currentTime,
    duration,
    intensiveMode,
    playbackRate,
    sleepTimerDeadline,
    sleepTimerRemainingMs,
    setIntensiveMode,
    setPlaybackRate,
    setSleepTimerForMinutes,
    clearSleepTimer,
  } = useReaderStore()

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const hasSleepTimer = sleepTimerDeadline !== null

  const togglePlay = () => {
    if (isPlaying) {
      audioPlayer.pause('user')
    } else {
      audioPlayer.play().catch(console.error)
    }
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const pct = Number(e.target.value) / 100
    audioPlayer.seek(pct * duration)
  }

  const cycleSpeed = () => {
    const speeds = [1.0, 0.75, 0.5, 1.25, 1.5]
    const next = speeds[(speeds.indexOf(playbackRate) + 1) % speeds.length]
    setPlaybackRate(next)
    audioPlayer.setPlaybackRate(next)
  }

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const formatSleepRemaining = (ms: number) => {
    const totalMinutes = Math.max(1, Math.ceil(ms / 60000))
    if (totalMinutes < 60) return `${totalMinutes}m`

    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  }

  const chooseSleepTimer = (minutes: number) => {
    setSleepTimerForMinutes(minutes)
    setShowSleepTimer(false)
  }

  const cancelSleepTimer = () => {
    clearSleepTimer()
    setShowSleepTimer(false)
  }

  const runSmartReplay = (action: () => void) => {
    action()
    setShowSmartReplay(false)
  }

  return (
    <footer
      className="relative h-[52px] flex items-center gap-2 px-4 shrink-0 z-40"
      style={{ backgroundColor: '#1A1A1A' }}
    >
      {showSmartReplay && (
        <div
          className="absolute left-0 right-0 bottom-[52px] h-14 px-4 flex items-center justify-center gap-2 border-b border-border"
          style={{ backgroundColor: '#202020' }}
          role="toolbar"
          aria-label="Smart replay controls"
        >
          <button
            onClick={() => runSmartReplay(onReplayCurrent)}
            className="h-10 min-w-16 px-3 rounded-lg bg-secondary flex items-center justify-center gap-1.5 active:bg-secondary/70 transition-colors"
            aria-label="Replay current sentence"
          >
            <RotateCcw className="w-4 h-4 text-foreground" />
            <span className="font-sans text-[12px] text-muted-foreground">Now</span>
          </button>
          <button
            onClick={() => runSmartReplay(onReplayPrevious)}
            className="h-10 min-w-16 px-3 rounded-lg bg-secondary flex items-center justify-center gap-1.5 active:bg-secondary/70 transition-colors"
            aria-label="Replay previous sentence"
          >
            <SkipBack className="w-4 h-4 text-foreground" />
            <span className="font-sans text-[12px] text-muted-foreground">Prev</span>
          </button>
          <button
            onClick={() => runSmartReplay(onReplayBack10)}
            className="h-10 min-w-16 px-3 rounded-lg bg-secondary flex items-center justify-center gap-1.5 active:bg-secondary/70 transition-colors"
            aria-label="Jump back 10 seconds"
          >
            <Rewind className="w-4 h-4 text-foreground" />
            <span className="font-sans text-[12px] text-muted-foreground">10s</span>
          </button>
          <button
            onClick={() => runSmartReplay(onReplaySlowOnce)}
            className="h-10 min-w-16 px-3 rounded-lg bg-secondary flex items-center justify-center gap-1.5 active:bg-secondary/70 transition-colors"
            aria-label="Replay current sentence once at half speed"
          >
            <Gauge className="w-4 h-4 text-foreground" />
            <span className="font-sans text-[12px] text-muted-foreground">0.5x</span>
          </button>
        </div>
      )}

      {/* Play/Pause */}
      <button
        onClick={togglePlay}
        className="w-9 h-9 rounded-full bg-foreground flex items-center justify-center shrink-0 active:scale-95 transition-transform"
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? (
          <Pause className="w-4 h-4 text-background fill-background" />
        ) : (
          <Play className="w-4 h-4 text-background fill-background ml-0.5" />
        )}
      </button>

      {/* Time */}
      <span className="font-sans text-[11px] text-muted-foreground shrink-0 w-9 text-right tabular-nums">
        {formatTime(currentTime)}
      </span>

      {/* Seek Slider */}
      <div className="flex-1 relative flex items-center">
        <div className="w-full h-1 bg-border rounded-full">
          <div
            className="h-full bg-foreground/60 rounded-full transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div
          className="absolute w-3 h-3 bg-white rounded-full shadow-sm pointer-events-none"
          style={{ left: `calc(${progress}% - 6px)` }}
        />
        <input
          type="range"
          min="0"
          max="100"
          step="0.1"
          value={progress}
          onChange={handleSeek}
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
          aria-label="Seek"
        />
      </div>

      {/* Smart Replay */}
      <button
        onClick={() => {
          setShowSmartReplay((v) => !v)
          setShowSleepTimer(false)
        }}
        className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 active:opacity-60 transition-colors ${
          showSmartReplay ? 'bg-accent/15 text-accent' : 'text-muted-foreground'
        }`}
        aria-label="Smart replay"
        aria-expanded={showSmartReplay}
      >
        <RotateCcw className="w-4 h-4" />
      </button>

      {/* Speed */}
      <button
        onClick={cycleSpeed}
        className="font-sans text-sm text-foreground shrink-0 w-9 text-center active:opacity-60 transition-opacity"
        aria-label="Playback speed"
      >
        {playbackRate}x
      </button>

      {/* Sleep Timer */}
      <div className="relative shrink-0">
        <button
          onClick={() => {
            setShowSleepTimer((v) => !v)
            setShowSmartReplay(false)
          }}
          className={`h-8 px-2 rounded-full flex items-center gap-1.5 active:opacity-60 transition-colors ${
            hasSleepTimer ? 'bg-accent/15 text-accent' : 'text-muted-foreground'
          }`}
          aria-label={
            hasSleepTimer
              ? `Sleep timer, ${formatSleepRemaining(sleepTimerRemainingMs)} remaining`
              : 'Sleep timer'
          }
          aria-expanded={showSleepTimer}
        >
          <Moon className="w-4 h-4" />
          {hasSleepTimer && (
            <span className="font-sans text-[11px] tabular-nums leading-none min-w-6">
              {formatSleepRemaining(sleepTimerRemainingMs)}
            </span>
          )}
        </button>

        {showSleepTimer && (
          <div
            className="absolute right-0 bottom-11 w-52 rounded-lg border border-border bg-[#242424] shadow-xl overflow-hidden"
            role="menu"
            aria-label="Sleep timer options"
          >
            <div className="px-3 py-2 font-sans text-[11px] uppercase text-muted-foreground border-b border-border">
              Sleep timer
            </div>
            {SLEEP_TIMER_PRESETS.map((minutes) => (
              <button
                key={minutes}
                onClick={() => chooseSleepTimer(minutes)}
                className="w-full h-9 px-3 flex items-center justify-between font-sans text-sm text-foreground hover:bg-white/5 active:bg-white/10 transition-colors"
                role="menuitem"
              >
                <span>{minutes === 60 ? '1 hour' : `${minutes} minutes`}</span>
              </button>
            ))}
            {hasSleepTimer && (
              <button
                onClick={cancelSleepTimer}
                className="w-full h-9 px-3 flex items-center gap-2 font-sans text-sm text-muted-foreground hover:bg-white/5 active:bg-white/10 transition-colors border-t border-border"
                role="menuitem"
              >
                <X className="w-3.5 h-3.5" />
                <span>Cancel timer</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Intensive Mode Toggle */}
      <button
        className="p-1 -mr-1 active:opacity-60 transition-opacity"
        aria-label="Toggle intensive mode"
        onClick={() => setIntensiveMode(!intensiveMode)}
      >
        <Grid3X3
          className={`w-5 h-5 ${intensiveMode ? 'text-accent' : 'text-muted-foreground'}`}
        />
      </button>
    </footer>
  )
}
