import { useState, useEffect, useRef } from 'react'
import { Loader2, Upload, Check, Clock, Trash2 } from 'lucide-react'
import { getQueueCount, syncQueueToAnki, onQueueUpdate, getQueue, removeFromQueue } from '../lib/miningQueue'
import { isAnkiAvailable } from '../lib/ankiConnect'

export function QueueBanner() {
  const [count, setCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<{ synced: number; failed: number } | null>(null)
  const syncingRef = useRef(false)

  const refresh = async () => {
    const n = await getQueueCount()
    setCount(n)
  }

  // Refresh count whenever queue changes
  useEffect(() => {
    refresh()
    return onQueueUpdate(refresh)
  }, [])

  const clearQueue = async () => {
    const queue = await getQueue()
    for (const card of queue) await removeFromQueue(card.id)
    await refresh()
  }

  const sync = async () => {
    if (syncingRef.current) return
    syncingRef.current = true
    setSyncing(true)
    setResult(null)

    try {
      const r = await syncQueueToAnki()
      if (r.synced > 0 || r.failed > 0) {
        setResult(r)
        setTimeout(() => setResult(null), 3000)
      }
      await refresh()
    } finally {
      syncingRef.current = false
      setSyncing(false)
    }
  }

  // Auto-sync on mount if Anki is already running
  useEffect(() => {
    getQueueCount().then(n => {
      if (n === 0) return
      isAnkiAvailable().then(available => {
        if (available) sync()
      })
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Nothing to show
  if (count === 0 && !result) return null

  const label = result
    ? result.failed === 0
      ? `✓ ${result.synced} card${result.synced !== 1 ? 's' : ''} synced`
      : `${result.synced} synced · ${result.failed} failed`
    : `${count} card${count !== 1 ? 's' : ''} queued`

  return (
    <div
      className="flex items-center justify-between px-5 py-2 font-sans shrink-0"
      style={{ backgroundColor: '#161616', borderTop: '1px solid #222' }}
    >
      <div className="flex items-center gap-2">
        {result ? (
          <Check className="w-3.5 h-3.5" style={{ color: '#4CAF50' }} />
        ) : (
          <Clock className="w-3.5 h-3.5" style={{ color: '#888' }} />
        )}
        <span
          className="text-[12px]"
          style={{ color: result ? '#4CAF50' : '#999' }}
        >
          {label}
        </span>
      </div>

      {!result && (
        <div className="flex items-center gap-2">
          <button
            onClick={sync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[12px] active:opacity-70 transition-opacity"
            style={{ backgroundColor: '#2A2A2A', color: syncing ? '#666' : '#C8A96E' }}
          >
            {syncing ? (
              <><Loader2 className="w-3 h-3 animate-spin" /> Syncing…</>
            ) : (
              <><Upload className="w-3 h-3" /> Sync to Anki</>
            )}
          </button>
          <button
            onClick={clearQueue}
            className="p-1 rounded-lg active:opacity-70"
            style={{ backgroundColor: '#2A2A2A' }}
            title="Clear queue"
          >
            <Trash2 className="w-3 h-3" style={{ color: '#666' }} />
          </button>
        </div>
      )}
    </div>
  )
}
