import { useState } from 'react'
import { X, Mail, Loader2, CheckCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'

interface AuthSheetProps {
  onClose: () => void
}

type Phase = 'input' | 'sending' | 'sent' | 'error'

export function AuthSheet({ onClose }: AuthSheetProps) {
  const [email, setEmail] = useState('')
  const [phase, setPhase] = useState<Phase>('input')
  const [errorMsg, setErrorMsg] = useState('')

  const handleSend = async () => {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !trimmed.includes('@')) return
    if (!supabase) {
      setErrorMsg('Supabase not configured — add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY')
      setPhase('error')
      return
    }

    setPhase('sending')
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        // Redirect back to the app after clicking the link
        emailRedirectTo: window.location.origin,
      },
    })

    if (error) {
      setErrorMsg(error.message)
      setPhase('error')
    } else {
      setPhase('sent')
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-50" onClick={onClose} />
      <div
        className="fixed bottom-0 left-0 right-0 z-50 rounded-t-[20px]"
        style={{ backgroundColor: '#141414' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full bg-white/20" />
        </div>

        <div className="flex items-center justify-between px-5 py-3">
          <h2 className="font-sans text-[16px] font-semibold text-foreground">Sign In</h2>
          <button onClick={onClose} className="p-1 active:opacity-60">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <div className="px-5 pb-10">
          {phase === 'sent' ? (
            <div className="flex flex-col items-center py-8 gap-3">
              <CheckCircle className="w-10 h-10" style={{ color: '#4CAF50' }} />
              <p className="font-sans text-sm font-medium text-foreground">Check your email</p>
              <p className="font-sans text-[13px] text-muted-foreground text-center max-w-xs">
                We sent a sign-in link to <span className="text-foreground">{email.trim()}</span>.
                Click it to sign in — the app will sync automatically.
              </p>
              <button
                onClick={() => setPhase('input')}
                className="font-sans text-[12px] text-accent underline mt-2"
              >
                Use a different email
              </button>
            </div>
          ) : phase === 'error' ? (
            <div className="flex flex-col items-center py-8 gap-3">
              <p className="font-sans text-sm text-center" style={{ color: '#ef4444' }}>{errorMsg}</p>
              <button
                onClick={() => setPhase('input')}
                className="font-sans text-[12px] text-accent underline"
              >
                Try again
              </button>
            </div>
          ) : (
            <>
              <p className="font-sans text-[13px] text-muted-foreground mb-4">
                Enter your email — we'll send a magic link. No password needed.
                Your settings, progress, and books sync across all your devices.
              </p>

              <div className="flex gap-2">
                <div
                  className="flex-1 flex items-center gap-2 px-3 rounded-xl"
                  style={{ backgroundColor: '#1A1A1A', border: '1px solid #2a2a2a' }}
                >
                  <Mail className="w-4 h-4 shrink-0 text-muted-foreground" />
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                    className="flex-1 py-3 bg-transparent font-sans text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
                    autoFocus
                  />
                </div>
                <button
                  onClick={handleSend}
                  disabled={phase === 'sending' || !email.trim()}
                  className="px-4 py-3 rounded-xl font-sans text-sm font-medium transition-opacity active:opacity-70 flex items-center gap-2"
                  style={{
                    backgroundColor: email.trim() ? '#C8A96E' : '#2a2a2a',
                    color: email.trim() ? '#111' : '#555',
                  }}
                >
                  {phase === 'sending' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    'Send link'
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
