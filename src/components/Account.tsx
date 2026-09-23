import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { getGoogleClientId, signInWithGoogle, signOut, useAuth } from '../lib/auth'
import { resetSyncMarks, syncNow } from '../lib/sync'

type Props = { onSynced: () => void }

/** "Sign in" text button, or the user's avatar with a tiny menu. Hidden entirely when sign-in isn't configured. */
export function Account({ onSynced }: Props) {
  const auth = useAuth()
  const [enabled, setEnabled] = useState(false)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getGoogleClientId().then((id) => setEnabled(!!id))
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  if (!enabled) return null

  const signIn = async () => {
    setBusy(true)
    try {
      await signInWithGoogle()
      resetSyncMarks()
      await syncNow()
      onSynced()
    } catch {
      /* cancelled */
    } finally {
      setBusy(false)
    }
  }

  if (!auth)
    return (
      <button
        onClick={signIn}
        disabled={busy}
        className="h-8 rounded-full px-2 text-[13px] sm:px-3 font-medium text-ink-2 transition-colors hover:bg-neutral-100 hover:text-ink disabled:opacity-50"
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    )

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="Account" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-neutral-100">
        {auth.user.picture ? (
          <img src={auth.user.picture} alt="" referrerPolicy="no-referrer" className="h-6 w-6 rounded-full" />
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-white">
            {(auth.user.name || auth.user.email).slice(0, 1).toUpperCase()}
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="card-shadow absolute right-0 top-11 z-40 w-56 rounded-2xl bg-white p-1.5"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
          >
            <div className="truncate px-2.5 py-2 text-[12px] text-ink-3">{auth.user.email}</div>
            <div className="px-2.5 pb-2 text-[11px] text-ink-3">Progress syncs to this account.</div>
            <button
              onClick={() => {
                signOut()
                resetSyncMarks()
                setOpen(false)
              }}
              className="w-full rounded-xl px-2.5 py-2 text-left text-[13px] font-medium text-ink hover:bg-neutral-100"
            >
              Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
