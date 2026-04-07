import { RotateCcw, Play, Star } from 'lucide-react'
import { audioPlayer } from '../lib/audioPlayer'
import { useReaderStore } from '../store/readerStore'

export function IntensiveControls() {
  const { isPlaying, intensiveMode, activeSentence, setShowMinePicker } = useReaderStore()

  if (!intensiveMode || isPlaying) return null

  const replayCurrent = () => {
    if (activeSentence) {
      audioPlayer.seek(activeSentence.start)
      audioPlayer.play().catch(console.error)
    }
  }

  return (
    <div
      className="px-6 py-4 flex items-center justify-center gap-4"
      style={{ backgroundColor: '#1A1A1A' }}
    >
      <button
        onClick={replayCurrent}
        className="flex flex-col items-center gap-1.5 px-6 py-3 rounded-xl bg-secondary active:bg-secondary/70 transition-colors min-w-[80px]"
      >
        <RotateCcw className="w-6 h-6 text-foreground" />
        <span className="text-xs text-muted-foreground font-sans">Replay</span>
      </button>

      <button
        onClick={() => audioPlayer.play().catch(console.error)}
        className="flex flex-col items-center gap-1.5 px-8 py-3 rounded-xl bg-foreground active:bg-foreground/80 transition-colors min-w-[90px]"
      >
        <Play className="w-7 h-7 text-background fill-background" />
        <span className="text-xs text-background/80 font-sans">Continue</span>
      </button>

      <button
        onClick={() => setShowMinePicker(true)}
        className="flex flex-col items-center gap-1.5 px-6 py-3 rounded-xl bg-secondary active:bg-secondary/70 transition-colors min-w-[80px]"
        aria-label="Mine word to Anki"
      >
        <Star className="w-6 h-6" style={{ color: '#C8A96E' }} />
        <span className="text-xs font-sans text-muted-foreground">Mine</span>
      </button>
    </div>
  )
}
