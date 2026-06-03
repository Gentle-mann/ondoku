import { Outlet } from '@tanstack/react-router'
import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { syncFromCloud } from '../lib/sync'
import { useReaderStore } from '../store/readerStore'

export function RootLayout() {
  const { setUserId, setUserEmail } = useReaderStore()

  useEffect(() => {
    if (!supabase) return

    // Restore session on mount (handles magic-link redirect via URL hash too)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUserId(session.user.id)
        setUserEmail(session.user.email ?? null)
        syncFromCloud()
      }
    })

    // Listen for sign-in / sign-out
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user) {
        setUserId(session.user.id)
        setUserEmail(session.user.email ?? null)
        if (event === 'SIGNED_IN') syncFromCloud()
      } else if (event === 'SIGNED_OUT') {
        setUserId(null)
        setUserEmail(null)
      }
    })

    return () => subscription.unsubscribe()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="w-full min-h-dvh bg-background text-foreground">
      <Outlet />
    </div>
  )
}
