import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { BookCard } from '../components/BookCard'

type FilterTab = 'all' | 'reading' | 'finished'

interface Book {
  id: string
  title: string
  author: string
  knownPercent: number
  progress: number
  isPlaying?: boolean
  coverGradient: string
}

const DEMO_BOOKS: Book[] = [
  {
    id: 'yaneura',
    title: '屋根裏の散歩者',
    author: '江戸川乱歩',
    knownPercent: 94,
    progress: 18,
    isPlaying: true,
    coverGradient: 'from-slate-700 to-slate-900',
  },
]

export function LibraryPage() {
  const [activeTab, setActiveTab] = useState<FilterTab>('all')
  const navigate = useNavigate()

  const tabs: { id: FilterTab; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'reading', label: 'Reading' },
    { id: 'finished', label: 'Finished' },
  ]

  const filtered = DEMO_BOOKS.filter((b) => {
    if (activeTab === 'reading') return b.progress < 100
    if (activeTab === 'finished') return b.progress === 100
    return true
  })

  return (
    <div className="w-full min-h-dvh flex flex-col">
      <header className="flex items-center justify-between px-5 pt-12 pb-4">
        <h1 className="font-sans text-[22px] font-bold text-foreground">My Library</h1>
        <button
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-secondary transition-colors"
          aria-label="Add book"
        >
          <Plus className="w-6 h-6 text-foreground" />
        </button>
      </header>

      <div className="flex gap-6 px-5 mb-5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`relative pb-2 font-sans text-sm transition-colors ${
              activeTab === tab.id ? 'text-foreground' : 'text-muted-foreground'
            }`}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-full" />
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 px-5 pb-24">
        <div className="grid grid-cols-2 gap-3">
          {filtered.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              onClick={() => navigate({ to: '/read/$bookId', params: { bookId: book.id } })}
            />
          ))}
        </div>
      </div>

      <button
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-accent flex items-center justify-center shadow-lg hover:bg-accent/90 transition-colors active:scale-95"
        aria-label="Add book"
      >
        <Plus className="w-7 h-7 text-accent-foreground" />
      </button>
    </div>
  )
}
