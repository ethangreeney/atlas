import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getGoogleClientId, signInWithGoogle, useAuth } from '../lib/auth'
import { iosBrowserTab } from '../lib/push'

const KEY = 'atlas.keepNudge.dismissed'
const MIN_LEARNED = 20
const link = 'text-ink underline decoration-line underline-offset-2 hover:decoration-ink disabled:opacity-50'

const dismissed = () => {
  try {
    return !!localStorage.getItem(KEY)
  } catch {
    return false
  }
}

/**
 * One quiet line on the Done screen for guests with real progress: it only lives in this browser. Sign in keeps it
 * (App syncs as soon as the account appears); on iOS Safari a Home Screen install also stops it being cleared.
 */
export function KeepProgress({ learned }: { learned: number }) {
  const auth = useAuth()
  const [canSignIn, setCanSignIn] = useState(false)
  const [hidden, setHidden] = useState(dismissed)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void getGoogleClientId().then((id) => setCanSignIn(!!id))
  }, [])

  const homeScreen = iosBrowserTab()
  if (auth || hidden || learned < MIN_LEARNED || (!canSignIn && !homeScreen)) return null

  const signIn = async () => {
    setBusy(true)
    await signInWithGoogle().catch(() => {}) // cancelled
    setBusy(false)
  }

  const dismiss = () => {
    setHidden(true)
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      /* private mode */
    }
  }

  return (
    <div className="mt-2 flex max-w-[min(420px,100%)] items-start gap-1.5 px-4 text-[12.5px] text-ink-3">
      <span className="text-balance">
        Your progress lives only in this browser.{' '}
        {canSignIn ? (
          <>
            <button onClick={signIn} disabled={busy} className={link}>
              Sign in
            </button>{' '}
            to keep it safe{homeScreen ? ', or add Atlas to your Home Screen.' : '.'}
          </>
        ) : (
          'Add Atlas to your Home Screen to keep it safe.'
        )}
      </span>
      <button onClick={dismiss} aria-label="Dismiss" className="-m-1 shrink-0 rounded-full p-1 transition-colors hover:text-ink">
        <X size={13} strokeWidth={2} />
      </button>
    </div>
  )
}
