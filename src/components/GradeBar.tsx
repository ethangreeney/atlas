import { AnimatePresence, motion } from 'motion/react'
import type { Grade } from 'ts-fsrs'
import { GRADES } from '../lib/scheduler'

type Props = {
  flipped: boolean
  intervals: string[]
  onFlip: () => void
  onGrade: (g: Grade) => void
  disabled: boolean
  /** The grade a typed answer points to; Enter picks it. */
  suggested?: Grade | null
}

const button =
  'rounded-2xl bg-surface text-ink shadow-[0_0_0_1px_var(--color-edge),0_1px_2px_var(--color-drop)] transition-[box-shadow,transform,background-color] duration-100 hover:bg-subtle hover:shadow-[0_0_0_1px_var(--color-edge-strong),0_1px_2px_var(--color-drop)] active:scale-[0.98] disabled:pointer-events-none'

/** Ring and label colour for the suggested grade (important, to beat the base and hover styles). */
const SUGGESTED = [
  'text-again! shadow-[0_0_0_1.5px_var(--color-again)]!',
  'text-hard! shadow-[0_0_0_1.5px_var(--color-hard)]!',
  'text-good! shadow-[0_0_0_1.5px_var(--color-good)]!',
  'text-easy! shadow-[0_0_0_1.5px_var(--color-easy)]!',
]

export function GradeBar({ flipped, intervals, onFlip, onGrade, disabled, suggested }: Props) {
  return (
    <div className="relative h-16 w-full">
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
            {GRADES.map((g, i) => (
              <button
                key={g.key}
                disabled={disabled}
                onClick={() => onGrade(g.grade)}
                className={`${button} flex flex-col items-center justify-center gap-0.5 ${suggested === g.grade ? SUGGESTED[i] : ''}`}
              >
                <span className="text-[14px] font-medium">{g.label}</span>
                <span className="text-[12px] tabular-nums text-ink-3">{intervals[i]}</span>
              </button>
            ))}
          </motion.div>
        ) : (
          <motion.button
            key="show"
            onClick={onFlip}
            disabled={disabled}
            className={`${button} absolute inset-0 flex items-center justify-center gap-3 text-[14px] font-medium`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12 }}
          >
            Show answer <kbd className="hidden sm:inline">space</kbd>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
