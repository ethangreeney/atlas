import { AnimatePresence, motion } from 'motion/react'
import { GRADES } from '../lib/scheduler'

const COLORS = ['bg-again', 'bg-hard', 'bg-good', 'bg-easy']

type Props = { counts: [number, number, number, number]; refs: React.RefObject<(HTMLDivElement | null)[]> }

/** Four little stacks the cards fly into. Counts tick when a card lands. */
export function Piles({ counts, refs }: Props) {
  return (
    <div className="flex w-full items-end justify-between px-2">
      {GRADES.map((g, i) => {
        const n = counts[i]
        return (
          <div key={g.key} className="flex flex-col items-center gap-2">
            <div
              ref={(el) => {
                refs.current[i] = el
              }}
              className="relative h-9 w-14"
            >
              {[2, 1, 0].map((layer) => (
                <div
                  key={layer}
                  className="absolute inset-0 rounded-md border border-line bg-white"
                  style={{
                    transform: `translateY(${-layer * 2.5}px) rotate(${(layer - 1) * 1.6 * (n > 0 ? 1 : 0.35)}deg)`,
                    opacity: n > layer ? 1 : 0.35,
                    boxShadow: n > layer ? '0 1px 2px rgba(15,15,16,0.05)' : 'none',
                  }}
                />
              ))}
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={n}
                  className="absolute inset-0 flex items-center justify-center text-[13px] font-semibold tabular-nums text-ink"
                  initial={{ scale: 1.35, opacity: 0.4 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 700, damping: 30 }}
                >
                  {n}
                </motion.span>
              </AnimatePresence>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink-3">
              <span className={`h-1.5 w-1.5 rounded-full ${COLORS[i]}`} />
              {g.label}
            </div>
          </div>
        )
      })}
    </div>
  )
}
