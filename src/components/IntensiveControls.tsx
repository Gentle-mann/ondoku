import { RotateCcw, Play, Star, Check } from 'lucide-react'
import { useState } from 'react'
import { audioPlayer } from '../lib/audioPlayer'
import { useReaderStore } from '../store/readerStore'
import { mineCard, isAnkiAvailable } from '../lib/ankiConnect'

export function IntensiveControls() {
  const { isPlaying, intensiveMode, activeSentence, ankiDeck } = useReaderStore()
  const [mineState, setMineState] = useState<'idle' | 'success' | 'error'>('idle')

  // Only show when paused in intensive mode
  if (!intensiveMode || isPlaying) return null

  const replayCurrent = () => {
    if (activeSentence) {
      audioPlayer.seek(activeSentence.start)
      audioPlayer.play().catch(console.error)
    }
  }

  const continuePlay = () => {
    audioPlayer.play().catch(console.error)
  }

  const handleMine = async () => {
    if (!activeSentence) return
    const available = await isAnkiAvailable()
    if (!available) {
      setMineState('error')
      setTimeout(() => setMineState('idle'), 3000)
      return
    }
    try {
      const front = `<div class="word">${activeSentence.text}</div>`
      const back = `<div class="word">${activeSentence.text}</div>`
      await mineCard({
        front,
        back,
        sentence: activeSentence.text,
        word: activeSentence.text,
        jlpt: null,
        deck: ankiDeck,
      })
      setMineState('success')
      setTimeout(() => setMineState('idle'), 2000)
    } catch {
      setMineState('error')
      setTimeout(() => setMineState('idle'), 3000)
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
        onClick={continuePlay}
        className="flex flex-col items-center gap-1.5 px-8 py-3 rounded-xl bg-foreground active:bg-foreground/80 transition-colors min-w-[90px]"
      >
        <Play className="w-7 h-7 text-background fill-background" />
        <span className="text-xs text-background/80 font-sans">Continue</span>
      </button>

      <button
        onClick={handleMine}
        className="flex flex-col items-center gap-1.5 px-6 py-3 rounded-xl bg-secondary active:bg-secondary/70 transition-colors min-w-[80px]"
        aria-label="Mine sentence to Anki"
      >
        {mineState === 'success' ? (
          <Check className="w-6 h-6" style={{ color: '#4CAF50' }} />
        ) : (
          <Star className="w-6 h-6" style={{ color: mineState === 'error' ? '#ef4444' : '#C8A96E' }} />
        )}
        <span className="text-xs font-sans" style={{ color: mineState === 'success' ? '#4CAF50' : mineState === 'error' ? '#ef4444' : '#999' }}>
          {mineState === 'success' ? 'Added!' : mineState === 'error' ? 'No Anki' : 'Mine'}
        </span>
      </button>
    </div>
  )
}
