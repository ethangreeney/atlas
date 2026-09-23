import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { PARAMS } from '../lib/scheduler'
import { getSettings } from '../lib/settings'

/** Footer link that opens a short explainer of the scheduler. */
export function About() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="text-[11px] text-ink-3 transition-colors hover:text-ink">
        What is FSRS?
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="card-shadow absolute bottom-8 left-0 z-40 w-[min(400px,calc(100vw-32px))] rounded-2xl bg-white p-5 text-left whitespace-normal"
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className="mb-2 text-[14px] font-semibold tracking-[-0.01em] text-ink">Spaced repetition, tuned to you</div>
            <div className="space-y-2.5 text-[13px] leading-relaxed text-ink-2">
              <p>
                FSRS (Free Spaced Repetition Scheduler) is the open-source algorithm that decides when each card comes back. After every answer it
                re-estimates how hard the card is for you and how fast your memory of it fades, then books the next review for the moment you're
                predicted to have a {Math.round(PARAMS.request_retention * 100)}% chance of still knowing it. Late enough to be efficient, early enough
                not to forget.
              </p>
              <p>
                <span className="text-ink">Again</span> means you got it wrong. <span className="text-ink">Hard</span> means right, but slowly.{' '}
                <span className="text-ink">Good</span> is a normal recall. <span className="text-ink">Easy</span> pushes the card much further out.
                Honest grading is all the algorithm needs.
              </p>
              <p>
                It needs roughly a quarter fewer reviews than Anki's classic scheduler for the same retention. Atlas uses the same FSRS Anki does,
                introduces {getSettings().newPerDay} new cards a day, and keeps a country's flag, map and capital from appearing back to back.
              </p>
            </div>
            <a
              href="https://github.com/open-spaced-repetition/fsrs4anki/wiki/ABC-of-FSRS"
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-[12px] text-ink-3 hover:text-ink"
            >
              Read more →
            </a>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
