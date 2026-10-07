import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { db } from '../lib/db'
import { ALL_CARDS, mediaUrl, NOTES } from '../lib/deck'

/** How many flags burst out. */
const FLAGS = 48
/** Keys and taps in the first moments are the last answer's, not a wish to close this already. */
const SETTLE_MS = 900
const OUT = [0.15, 0.8, 0.3, 1] as const
const FALL = [0.5, 0, 0.75, 0.4] as const

/** Every card in the deck answered right at least once: its flags burst out from the middle and fall away. */
export function Celebrate({ onClose }: { onClose: () => void }) {
  const calm = useReducedMotion()
  const opened = useRef(Date.now())
  const [stats, setStats] = useState<{ days: number; answers: number } | null>(null)

  useEffect(() => {
    Promise.all([db.revlog.orderBy('review').first(), db.revlog.count()])
      .then(([first, answers]) => setStats({ days: first ? Math.floor((Date.now() - +new Date(first.review)) / 86_400_000) + 1 : 1, answers }))
      .catch(() => {})
  }, [])

  const close = () => Date.now() - opened.current > SETTLE_MS && onClose()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      if (Date.now() - opened.current > SETTLE_MS) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Out in every direction (further along a screen's long side), a little upward, then each falls away at its own pace.
  const flags = useMemo(() => {
    const files = NOTES.flatMap((n) => (n.flag ? [n.flag] : [])).sort(() => Math.random() - 0.5)
    const short = Math.min(innerWidth, innerHeight)
    const wide = Math.min(1.8, Math.max(1, innerWidth / innerHeight))
    const tall = Math.min(1.8, Math.max(1, innerHeight / innerWidth))
    return files.slice(0, FLAGS).map((file, i) => {
      const angle = (i / FLAGS) * Math.PI * 2 + (Math.random() - 0.5) * 0.6
      const dist = short * (0.24 + Math.random() * 0.36)
      return {
        file,
        x: Math.cos(angle) * dist * wide,
        y: Math.sin(angle) * dist * tall - short * 0.1,
        fall: innerHeight * (0.55 + Math.random() * 0.4),
        spin: (Math.random() - 0.5) * 600,
        width: 24 + Math.random() * 24,
        delay: Math.random() * 0.25,
        duration: 2.4 + Math.random() * 1.2,
      }
    })
  }, [])

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-labelledby="celebrate-title"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-page/[0.97] px-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      onClick={close}
    >
      {!calm && (
        <div className="pointer-events-none absolute left-1/2 top-1/2" aria-hidden>
          {flags.map((f, i) => (
            <motion.img
              key={i}
              src={mediaUrl(f.file)}
              alt=""
              draggable={false}
              className="img-shadow absolute max-w-none -translate-x-1/2 -translate-y-1/2 rounded-[3px]"
              style={{ width: f.width }}
              initial={{ opacity: 0, scale: 0.3 }}
              animate={{ x: [0, f.x, f.x * 1.1], y: [0, f.y, f.y + f.fall], rotate: [0, f.spin * 0.4, f.spin], scale: [0.3, 1, 0.85], opacity: [0, 1, 1, 0] }}
              transition={{
                duration: f.duration,
                delay: f.delay,
                times: [0, 0.32, 1],
                ease: [OUT, FALL],
                opacity: { duration: f.duration, delay: f.delay, times: [0, 0.06, 0.75, 1] },
              }}
            />
          ))}
        </div>
      )}
      <motion.div
        className="relative z-10 flex max-w-[520px] flex-col items-center gap-3 text-center"
        initial={{ opacity: 0, y: 14, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: calm ? 0 : 0.35, duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="celebrate-title" className="text-balance text-[clamp(32px,5.5vw,52px)] font-semibold leading-[1.05] tracking-[-0.03em] text-ink">
          You know the world.
        </h2>
        <p className="text-balance text-[15px] text-ink-2">Every one of the {ALL_CARDS.length.toLocaleString()} cards, right at least once.</p>
        <p className="min-h-[1lh] text-[13px] tabular-nums text-ink-3">{stats && `${stats.days} days · ${stats.answers.toLocaleString()} answers`}</p>
        <button
          autoFocus
          onClick={close}
          className="mt-3 rounded-full bg-ink px-5 py-2.5 text-[14px] font-medium text-on-ink transition-opacity hover:opacity-90 pointer-coarse:py-3"
        >
          Keep going
        </button>
      </motion.div>
    </motion.div>
  )
}
