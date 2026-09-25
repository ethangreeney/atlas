import { AnimatePresence, motion } from 'motion/react'
import { GRADES } from '../lib/scheduler'

type Props = { counts: [number, number, number, number]; refs: React.RefObject<(HTMLDivElement | null)[]> }

const MAX_LAYERS = 6

const COUNT_CLS = ['text-again', 'text-hard', 'text-good', 'text-easy']

/**
 * Four small stacks the cards fly into, each directly under its grade button, so they need no labels of their own.
 * The stack grows with the count; the number takes the grade's colour and ticks when a card lands.
 */
export function Piles({ counts, refs }: Props) {
  return (
    <div className="grid w-full grid-cols-4 items-end gap-2">
      {GRADES.map((g, i) => {
        const n = counts[i]
        const layers = Math.max(1, Math.min(n, MAX_LAYERS))
        return (
          <div key={g.key} className="flex flex-col items-center" aria-label={`${g.label}: ${n}`}>
            <div
              ref={(el) => {
                refs.current[i] = el
              }}
              className="relative h-10 w-14"
              style={{ marginTop: (layers - 1) * 2 }}
            >
              {Array.from({ length: layers }, (_, layer) => layers - 1 - layer).map((depth) => (
                <div
                  key={depth}
                  className="pile-shadow absolute inset-0 rounded-lg bg-surface transition-opacity duration-300"
                  style={{
                    transform: `translateY(${-depth * 2}px) rotate(${depth % 2 ? 0.8 : -0.6}deg)`,
                    opacity: n === 0 ? 0.5 : 1,
                  }}
                />
              ))}
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={n}
                  className={`absolute inset-0 flex items-center justify-center text-[13px] font-semibold tabular-nums ${n === 0 ? 'text-ink-3' : COUNT_CLS[i]}`}
                  initial={{ scale: 1.3, opacity: 0.3 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 700, damping: 30 }}
                >
                  {n}
                </motion.span>
              </AnimatePresence>
            </div>
          </div>
        )
      })}
    </div>
  )
}
