import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { ALL_CARDS } from '../lib/deck'

const SEEN_KEY = 'atlas.welcomed'
const seen = () => {
  try {
    return !!localStorage.getItem(SEEN_KEY)
  } catch {
    return true
  }
}

const GUIDE = [
  { label: 'Again', cls: 'text-again', text: 'Wrong. Even if you nearly had it.' },
  { label: 'Hard', cls: 'text-hard', text: 'Right, but it took effort.' },
  { label: 'Good', cls: 'text-good', text: 'Right.' },
  { label: 'Easy', cls: 'text-easy', text: 'Right, instantly.' },
]

/** First-visit welcome, reopened from the footer's "How it works". */
export function Welcome() {
  const [open, setOpen] = useState(() => !seen())
  const close = () => {
    setOpen(false)
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      /* private mode */
    }
  }

  // While open, swallow keys so they don't flip or grade the card underneath.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      e.stopImmediatePropagation()
      if (e.key === 'Escape' || e.key === 'Enter' || e.code === 'Space') {
        e.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [open])

  return (
    <>
      <button onClick={() => setOpen(true)} className="text-[11px] text-ink-3 transition-colors hover:text-ink">
        How it works
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            key="welcome"
            className="fixed inset-0 z-50 flex items-center justify-center whitespace-normal bg-white/70 p-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onPointerDown={(e) => e.target === e.currentTarget && close()}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="welcome-title"
              className="card-shadow max-h-full w-[min(420px,100%)] overflow-y-auto rounded-3xl bg-white p-7 text-left sm:p-8"
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <h2 id="welcome-title" className="text-[26px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink">
                The whole world,
                <br />
                remembered.
              </h2>

              <div className="mt-5 space-y-2.5 text-[14px] leading-snug text-ink-2">
                <p>
                  <span className="font-medium text-ink">{ALL_CARDS.length} cards.</span> Every flag, capital and location, from the{' '}
                  <a href="https://github.com/anki-geo/ultimate-geography" target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-2 hover:text-ink">
                    Ultimate Geography
                  </a>{' '}
                  deck.
                </p>
                <p>
                  <span className="font-medium text-ink">A few minutes a day.</span> The{' '}
                  <a
                    href="https://github.com/open-spaced-repetition/fsrs4anki/wiki/ABC-of-FSRS"
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-line underline-offset-2 hover:text-ink"
                  >
                    FSRS
                  </a>{' '}
                  scheduler brings each card back just before you'd forget it.
                </p>
                <p>
                  <span className="font-medium text-ink">Free, no account.</span> Sign in only to sync devices.
                </p>
              </div>

              <div className="mt-6 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3">Grade honestly</div>
              <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
                {GUIDE.map((g) => (
                  <div key={g.label} className="contents">
                    <dt className={`font-medium ${g.cls}`}>{g.label}</dt>
                    <dd className="text-ink-2">{g.text}</dd>
                  </div>
                ))}
              </dl>

              <button
                onClick={close}
                autoFocus
                className="mt-7 flex h-11 w-full items-center justify-center gap-2.5 rounded-2xl bg-ink text-[14px] font-medium text-white outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ink/20 focus-visible:ring-offset-2 active:scale-[0.98]"
              >
                Start
                <span className="hidden rounded-[5px] border border-white/20 pointer-fine:inline px-[5px] py-[3px] text-[10.5px] leading-none text-white/60">space</span>
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
