import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform, type MotionValue } from 'motion/react'
import { SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ALL_CARDS, mediaUrl } from '../lib/deck'

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

const link = 'text-ink underline decoration-line underline-offset-2 hover:decoration-ink'

const FLAGS = ['brazil', 'japan', 'canada', 'south_africa', 'bhutan']

type Tilt = { x: MotionValue<number>; y: MotionValue<number> }

/** Real flags from the deck, fanned out like a hand of cards. Floats gently and tilts toward the pointer. */
function FlagFan({ tilt }: { tilt: Tilt }) {
  const still = useReducedMotion()
  const mid = (FLAGS.length - 1) / 2
  const rotateY = useSpring(useTransform(tilt.x, [-0.5, 0.5], [-8, 8]), { stiffness: 120, damping: 18 })
  const rotateX = useSpring(useTransform(tilt.y, [-0.5, 0.5], [6, -6]), { stiffness: 120, damping: 18 })
  return (
    <div className="relative h-[60px] scale-[0.8] [perspective:700px] sm:h-[76px] sm:scale-100" aria-hidden>
      <motion.div className="absolute inset-0 [transform-style:preserve-3d]" style={still ? undefined : { rotateX, rotateY }}>
        {FLAGS.map((f, i) => {
          const o = i - mid
          return (
            <motion.div
              key={f}
              className="absolute left-1/2 top-2 -ml-[30px]"
              style={{ zIndex: 10 - Math.abs(o) }}
              initial={{ x: 0, y: 8, rotate: 0, opacity: 0 }}
              animate={{ x: o * 64, y: o * o * 3.5, rotate: o * 7, opacity: 1 }}
              transition={{ delay: 0.08 + Math.abs(o) * 0.04, type: 'spring', stiffness: 260, damping: 22 }}
            >
              <motion.img
                src={mediaUrl(`ug-flag-${f}.svg`)}
                alt=""
                draggable={false}
                className="img-shadow block h-[40px] w-[60px] rounded-[5px] bg-white object-cover"
                style={{ z: 12 - Math.abs(o) * 4 }}
                animate={still ? undefined : { y: [0, -3, 0] }}
                transition={{ duration: 3.2 + (i % 3) * 0.4, repeat: Infinity, ease: 'easeInOut', delay: 0.6 + i * 0.35 }}
                whileHover={still ? undefined : { y: -7, scale: 1.08, transition: { type: 'spring', stiffness: 400, damping: 20 } }}
              />
            </motion.div>
          )
        })}
      </motion.div>
    </div>
  )
}

/** First-visit welcome, reopened from the footer's "How it works". */
export function Welcome() {
  const [open, setOpen] = useState(() => !seen())
  const tilt = { x: useMotionValue(0), y: useMotionValue(0) }
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
      <button
        onClick={() => setOpen(true)}
        className="relative text-[11px] text-ink-3 transition-colors after:absolute after:-inset-x-2 after:-inset-y-3.5 hover:text-ink"
      >
        How it works
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            key="welcome"
            className="fixed inset-0 z-50 flex items-center justify-center whitespace-normal bg-white/70 pad-safe backdrop-blur-sm"
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
              className="card-shadow max-h-full w-[min(420px,100%)] overflow-y-auto rounded-3xl bg-white p-6 text-left sm:p-8"
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
              onPointerMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                tilt.x.set((e.clientX - r.left) / r.width - 0.5)
                tilt.y.set((e.clientY - r.top) / r.height - 0.5)
              }}
              onPointerLeave={() => {
                tilt.x.set(0)
                tilt.y.set(0)
              }}
            >
              <FlagFan tilt={tilt} />

              <h2 id="welcome-title" className="mt-3 text-balance text-[22px] font-semibold sm:mt-5 sm:text-[24px] leading-[1.15] tracking-[-0.025em] text-ink">
                Learn every flag, capital and map.
              </h2>
              <p className="mt-1 text-[13.5px] text-ink-2 sm:mt-1.5 sm:text-[14px]">A few minutes a day is enough.</p>

              <div className="mt-4 space-y-3 text-[13.5px] leading-snug sm:mt-5 sm:space-y-4 sm:text-[14px]">
                <div>
                  <div className="font-medium text-ink">The deck geography fans swear by</div>
                  <p className="mt-0.5 text-ink-2">
                    <a href="https://github.com/anki-geo/ultimate-geography" target="_blank" rel="noreferrer" className={link}>
                      Ultimate Geography
                    </a>
                    . {ALL_CARDS.length} cards, open source since 2016, 1,100+ stars on GitHub.
                  </p>
                </div>
                <div>
                  <div className="font-medium text-ink">The scheduler Anki switched to</div>
                  <p className="mt-0.5 text-ink-2">
                    <a href="https://github.com/open-spaced-repetition/fsrs4anki/wiki/ABC-of-FSRS" target="_blank" rel="noreferrer" className={link}>
                      FSRS
                    </a>{' '}
                    was trained on 700 million real reviews. It brings each card back just before you'd forget it.
                  </p>
                </div>
                <div>
                  <div className="font-medium text-ink">Learn what you want</div>
                  <p className="mt-0.5 text-ink-2">
                    Stick to one region, or just flags, maps or capitals, with the{' '}
                    <SlidersHorizontal size={13} strokeWidth={2} className="inline-block -translate-y-px text-ink" aria-label="filters" /> filters
                    up top. Or learn everything.
                  </p>
                </div>
              </div>

              <div className="mt-5 text-[11px] font-medium uppercase sm:mt-6 tracking-[0.12em] text-ink-3">Grade honestly</div>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13.5px] sm:mt-2.5 sm:gap-y-1.5 sm:text-[14px]">
                {GUIDE.map((g) => (
                  <div key={g.label} className="contents">
                    <dt className={`font-medium ${g.cls}`}>{g.label}</dt>
                    <dd className="text-ink-2">{g.text}</dd>
                  </div>
                ))}
              </dl>

              <button
                onClick={close}
                className="mt-5 flex h-11 w-full sm:mt-7 items-center justify-center gap-2.5 rounded-2xl bg-ink text-[14px] font-medium text-white outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ink/20 focus-visible:ring-offset-2 active:scale-[0.98]"
              >
                Start learning
                <span className="hidden rounded-[5px] border border-white/20 pointer-fine:inline px-[5px] py-[3px] text-[10.5px] leading-none text-white/60">space</span>
              </button>
              <p className="mt-3 text-center text-[12px] text-ink-3">Free. No account needed<span className="hidden sm:inline">, sign in only to sync devices</span>.</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
