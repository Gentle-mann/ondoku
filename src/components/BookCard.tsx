interface Book {
  id: string
  title: string
  author: string
  knownPercent: number
  progress: number
  isPlaying?: boolean
  coverGradient: string
}

interface BookCardProps {
  book: Book
  onClick: () => void
}

export function BookCard({ book, onClick }: BookCardProps) {
  return (
    <div
      className="bg-card rounded-xl overflow-hidden cursor-pointer active:opacity-80 transition-opacity"
      onClick={onClick}
    >
      <div className={`relative aspect-[2/3] bg-gradient-to-br ${book.coverGradient}`}>
        {book.isPlaying && (
          <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-accent text-[10px] font-sans font-medium text-accent-foreground">
            Now Playing
          </div>
        )}
        <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-background/70 backdrop-blur-sm">
          <span className="text-[10px] font-sans text-accent">{book.knownPercent}% known</span>
        </div>
      </div>
      <div className="p-3">
        <h3 className="font-serif text-sm text-foreground line-clamp-2 leading-snug mb-1">
          {book.title}
        </h3>
        <p className="font-sans text-[11px] text-muted-foreground mb-2">{book.author}</p>
        <div className="h-[3px] bg-border rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all"
            style={{ width: `${book.progress}%` }}
          />
        </div>
      </div>
    </div>
  )
}
