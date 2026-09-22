import { AnimatePresence, motion } from 'motion/react'
import type { Grade } from 'ts-fsrs'
import { GRADES } from '../lib/scheduler'

const COLORS = ['bg-again', 'bg-hard', 'bg-good', 'bg-easy']

type Props = { flipped: boolean; intervals: string[]; onFlip: () => void; onGrade: (g: Grade) => void; disabled: boolean }

export function GradeBar({ flipped, intervals, onFlip, onGrade, disabled }: Props) {
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
                className="group flex flex-col items-center justify-center gap-0.5 rounded-2xl border border-line bg-white transition-[background-color,transform] duration-100 hover:bg-neutral-50 active:scale-[0.97] disabled:pointer-events-none"
              >
                <span className="flex items-center gap-1.5 text-[14px] font-medium text-ink">
                  <span className={`h-1.5 w-1.5 rounded-full ${COLORS[i]}`} />
                  {g.label}
                </span>
                <span className="text-[12px] tabular-nums text-ink-3">{intervals[i]}</span>
              </button>
            ))}
          </motion.div>
        ) : (
          <motion.button
            key="show"
            onClick={onFlip}
            disabled={disabled}
            className="absolute inset-0 flex items-center justify-center gap-3 rounded-2xl border border-line bg-white text-[14px] font-medium text-ink transition-[background-color,transform] duration-100 hover:bg-neutral-50 active:scale-[0.99] disabled:pointer-events-none"
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
