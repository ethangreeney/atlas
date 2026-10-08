import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import type { Grade } from 'ts-fsrs'
import { GRADES, Rating } from '../lib/scheduler'

type Props = {
  flipped: boolean
  intervals: string[]
  onFlip: () => void
  onGrade: (g: Grade) => void
  disabled: boolean
  /** The grade a typed answer points to; Enter picks it. */
  suggested?: Grade | null
  /** First sight of the card: Easy means "knew it" and sends it a month or two out. */
  isNew?: boolean
  /** A typed answer that was right: Good goes by itself after this many ms, unless something else is chosen first. */
  auto?: number | null
  /** The grade a swipe on the card would give if let go now. */
  leaning?: Grade | null
}

/** Taps this soon after the grades appear are the end of a double tap on Show answer, not a grade. */
const SETTLE_MS = 350

const button =
  'rounded-2xl bg-surface text-ink shadow-[0_0_0_1px_var(--color-edge),0_1px_2px_var(--color-drop)] transition-[box-shadow,transform,background-color] duration-100 hover:bg-subtle hover:shadow-[0_0_0_1px_var(--color-edge-strong),0_1px_2px_var(--color-drop)] active:scale-[0.98] disabled:pointer-events-none'

/** Ring and label colour for the suggested grade (important, to beat the base and hover styles). */
const SUGGESTED = [
  'text-again! shadow-[0_0_0_1.5px_var(--color-again)]!',
  'text-hard! shadow-[0_0_0_1.5px_var(--color-hard)]!',
  'text-good! shadow-[0_0_0_1.5px_var(--color-good)]!',
  'text-easy! shadow-[0_0_0_1.5px_var(--color-easy)]!',
]

export function GradeBar({ flipped, intervals, onFlip, onGrade, disabled, suggested, isNew, auto, leaning }: Props) {
  const shownAt = useRef(0)
  useEffect(() => {
    if (flipped) shownAt.current = Date.now()
  }, [flipped])
  return (
    <div className="relative h-16 w-full short:h-12">
      <AnimatePresence mode="wait" initial={false}>
        {flipped ? (
          <motion.div
            key="grades"
            className="absolute inset-0 grid grid-cols-4 gap-2"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12 }}
          >
            {GRADES.map((g, i) => {
              const knew = isNew && g.grade === Rating.Easy
              return (
                <button
                  key={g.key}
                  disabled={disabled}
                  onClick={() => Date.now() - shownAt.current > SETTLE_MS && onGrade(g.grade)}
                  className={`${button} relative flex flex-col items-center justify-center gap-0.5 overflow-hidden ${(leaning ?? suggested) === g.grade ? SUGGESTED[i] : ''}`}
                >
                  <span className="text-[14px] font-medium">{knew ? 'Knew it' : g.label}</span>
                  <span className="text-[12px] tabular-nums text-ink-3">{knew ? '1–2mo' : intervals[i]}</span>
                  {/* Filling up to the moment Good goes by itself. */}
                  {auto && g.grade === Rating.Good && (
                    <motion.span
                      aria-hidden
                      className="absolute inset-x-0 bottom-0 h-[3px] origin-left bg-good"
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: auto / 1000, ease: 'linear' }}
                    />
                  )}
                </button>
              )
            })}
          </motion.div>
        ) : (
          <motion.button
            key="show"
            onClick={onFlip}
            disabled={disabled}
            className={`${button} absolute inset-0 flex items-center justify-center gap-3 text-[14px] font-medium ${leaning ? SUGGESTED[leaning - 1] : ''}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12 }}
          >
            {/* A swipe right on the question names the pile it's heading for. */}
            {leaning === Rating.Easy ? (
              'Knew it'
            ) : leaning ? (
              'Good'
            ) : (
              <>
                Show answer <kbd className="hidden sm:inline">space</kbd>
              </>
            )}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
