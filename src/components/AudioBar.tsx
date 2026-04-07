import { Play, Pause, Grid3X3 } from 'lucide-react'
import { audioPlayer } from '../lib/audioPlayer'
import { useReaderStore } from '../store/readerStore'

export function AudioBar() {
  const {
    isPlaying,
    currentTime,
    duration,
    intensiveMode,
    playbackRate,
    setIntensiveMode,
    setPlaybackRate,
  } = useReaderStore()

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  const togglePlay = () => {
    if (isPlaying) {
      audioPlayer.pause()
    } else {
      audioPlayer.play().catch(console.error)
    }
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const pct = Number(e.target.value) / 100
    audioPlayer.seek(pct * duration)
  }

  const cycleSpeed = () => {
    const speeds = [0.5, 0.75, 1.0, 1.25, 1.5]
    const next = speeds[(speeds.indexOf(playbackRate) + 1) % speeds.length]
    setPlaybackRate(next)
    audioPlayer.setPlaybackRate(next)
  }

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  return (
    <footer
      className="h-[52px] flex items-center gap-3 px-4 shrink-0 z-40"
      style={{ backgroundColor: '#1A1A1A' }}
    >
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

      {/* Speed */}
      <button
        onClick={cycleSpeed}
        className="font-sans text-sm text-foreground shrink-0 w-9 text-center active:opacity-60 transition-opacity"
        aria-label="Playback speed"
      >
        {playbackRate}x
      </button>

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
