import { useState } from 'react'
import { X } from 'lucide-react'
import type { AlignStatus } from '../lib/alignmentQueue'

interface Book {
  id: string
  title: string
  author: string
  knownPercent: number
  progress: number
  isPlaying?: boolean
  audioMissing?: boolean
  coverGradient: string
  alignStatus?: AlignStatus | null
  alignProgress?: number
}

interface BookCardProps {
  book: Book
  onClick: () => void
  onDelete?: () => void
}

export function BookCard({ book, onClick, onDelete }: BookCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirmDelete) {
      onDelete?.()
    } else {
      setConfirmDelete(true)
      setTimeout(() => setConfirmDelete(false), 3000)
    }
  }

  return (
    <div
      className="bg-card rounded-xl overflow-hidden cursor-pointer active:opacity-80 transition-opacity"
      onClick={onClick}
    >
      <div className={`relative aspect-[2/3] bg-gradient-to-br ${book.coverGradient}`}>
        {book.alignStatus === 'aligning' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50">
            <div className="relative w-12 h-12 mb-2">
              <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48">
                <circle cx="24" cy="24" r="20" fill="none" stroke="#333" strokeWidth="3" />
                <circle
                  cx="24" cy="24" r="20" fill="none" stroke="#C8A96E" strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={`${(book.alignProgress ?? 0) * 1.257} 125.7`}
                  style={{ transition: 'stroke-dasharray 1s ease-out' }}
                />
              </svg>
              <span
                className="absolute inset-0 flex items-center justify-center text-[11px] font-sans font-medium"
                style={{ color: '#C8A96E' }}
              >
                {book.alignProgress ?? 0}%
              </span>
            </div>
            <span className="text-[10px] font-sans" style={{ color: '#aaa' }}>
              Aligning words…
            </span>
          </div>
        )}
        {book.alignStatus === 'done' && (
          <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-sans font-medium"
            style={{ backgroundColor: '#1a2a1a', color: '#4CAF50', border: '1px solid #2a4a2a' }}>
            Aligned!
          </div>
        )}
        {book.isPlaying && !book.alignStatus && (
          <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-accent text-[10px] font-sans font-medium text-accent-foreground">
            Now Playing
          </div>
        )}
        {book.audioMissing && (
          <div
            className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-sans font-medium"
            style={{ backgroundColor: '#1A1A1A', color: '#C8A96E', border: '1px solid #333' }}
          >
            Audio needed
          </div>
        )}
        {!book.audioMissing && !book.alignStatus && (
          <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-background/70 backdrop-blur-sm">
            <span className="text-[10px] font-sans text-accent">{book.knownPercent}% known</span>
          </div>
        )}

        {/* Delete button — only for user books (onDelete provided) */}
        {onDelete && (
          <button
            onClick={handleDelete}
            className="absolute top-1.5 left-1.5 rounded-full p-1 transition-colors z-10"
            style={{
              backgroundColor: confirmDelete ? '#ef4444' : 'rgba(0,0,0,0.5)',
            }}
            aria-label="Delete book"
          >
            <X className="w-3.5 h-3.5 text-white" />
          </button>
        )}
      </div>
      <div className="p-3">
        <h3 className="font-serif text-sm text-foreground line-clamp-2 leading-snug mb-1">
          {book.title}
        </h3>
        <p className="font-sans text-[11px] text-muted-foreground mb-2">{book.author}</p>
        {confirmDelete ? (
          <p className="text-[11px] font-sans" style={{ color: '#ef4444' }}>
            Tap X again to delete
          </p>
        ) : (
          <div className="h-[3px] bg-border rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all"
              style={{ width: `${book.progress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
