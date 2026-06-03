import { useState, useEffect } from 'react'
import { Plus } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { BookCard } from '../components/BookCard'
import { AddBookModal } from '../components/AddBookModal'
import { getBooks, getAudioFile, removeBook, type BookMeta } from '../lib/bookLibrary'
import { deleteCloudBook } from '../lib/sync'
import { getAlignStatus, getAlignProgress, onAlignUpdate, resumePendingAlignments } from '../lib/alignmentQueue'

type FilterTab = 'all' | 'reading' | 'finished'

import type { AlignStatus } from '../lib/alignmentQueue'

interface Book {
  id: string
  title: string
  author: string
  knownPercent: number
  progress: number
  isPlaying?: boolean
  coverGradient: string
  audioMissing?: boolean
  alignStatus?: AlignStatus | null
  alignProgress?: number
}

const BUILT_IN: Book[] = [
  {
    id: 'yaneura',
    title: '屋根裏の散歩者',
    author: '江戸川乱歩',
    knownPercent: 94,
    progress: parseInt(localStorage.getItem('ondoku_ep') ?? '0') / 8 * 100,
    coverGradient: 'from-slate-700 to-slate-900',
    audioMissing: false,
  },
]

async function metaToBook(m: BookMeta): Promise<Book> {
  const audioFile = await getAudioFile(m.audioFilename)
  return {
    id: m.id,
    title: m.title,
    author: m.author,
    knownPercent: 0,
    progress: m.progress,
    coverGradient: m.coverGradient,
    audioMissing: audioFile === null,
    alignStatus: getAlignStatus(m.id),
    alignProgress: getAlignProgress(m.id),
  }
}

export function LibraryPage() {
  const [activeTab, setActiveTab] = useState<FilterTab>('all')
  const [showAddModal, setShowAddModal] = useState(false)
  const [userBooks, setUserBooks] = useState<Book[]>([])
  const navigate = useNavigate()

  const loadUserBooks = async () => {
    const metas = await getBooks()
    const books = await Promise.all(metas.map(metaToBook))
    setUserBooks(books)
  }

  useEffect(() => {
    loadUserBooks()
    resumePendingAlignments()  // Restart any alignment jobs that were interrupted
    const onFocus = () => loadUserBooks()
    const unsubAlign = onAlignUpdate(() => loadUserBooks())
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      unsubAlign()
    }
  }, [])

  const tabs: { id: FilterTab; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'reading', label: 'Reading' },
    { id: 'finished', label: 'Finished' },
  ]

  const allBooks = [...BUILT_IN, ...userBooks]

  const filtered = allBooks.filter((b) => {
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
          onClick={() => setShowAddModal(true)}
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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 max-w-[900px]">
          {filtered.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              onClick={() => navigate({ to: '/read/$bookId', params: { bookId: book.id } })}
              onDelete={book.id !== 'yaneura' ? async () => {
                await removeBook(book.id)
                deleteCloudBook(book.id).catch(console.error)
                loadUserBooks()
              } : undefined}
            />
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <p className="font-sans text-sm text-muted-foreground">No books yet</p>
            <button
              onClick={() => setShowAddModal(true)}
              className="font-sans text-sm text-accent underline"
            >
              Add your first book
            </button>
          </div>
        )}
      </div>

      <button
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-accent flex items-center justify-center shadow-lg hover:bg-accent/90 transition-colors active:scale-95"
        aria-label="Add book"
        onClick={() => setShowAddModal(true)}
      >
        <Plus className="w-7 h-7 text-accent-foreground" />
      </button>

      {showAddModal && (
        <AddBookModal
          onClose={() => setShowAddModal(false)}
          onAdded={loadUserBooks}
        />
      )}
    </div>
  )
}
