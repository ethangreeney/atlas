import { AnimatePresence, motion } from 'motion/react'
import { GRADES } from '../lib/scheduler'

type Props = { counts: [number, number, number, number]; refs: React.RefObject<(HTMLDivElement | null)[]> }

const MAX_LAYERS = 6

/** Four small stacks the cards fly into. The stack grows with the count; the number ticks when a card lands. */
export function Piles({ counts, refs }: Props) {
  return (
    <div className="flex w-full items-end justify-between px-2">
      {GRADES.map((g, i) => {
        const n = counts[i]
        const layers = Math.max(1, Math.min(n, MAX_LAYERS))
        return (
          <div key={g.key} className="flex flex-col items-center gap-2.5">
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
                  className="absolute inset-0 rounded-lg bg-white transition-opacity duration-300"
                  style={{
                    transform: `translateY(${-depth * 2}px) rotate(${depth % 2 ? 0.8 : -0.6}deg)`,
                    opacity: n === 0 ? 0.5 : 1,
                    boxShadow: '0 0 0 1px rgba(15,15,16,0.07), 0 1px 2px rgba(15,15,16,0.05)',
                  }}
                />
              ))}
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={n}
                  className={`absolute inset-0 flex items-center justify-center text-[13px] font-semibold tabular-nums ${n === 0 ? 'text-ink-3' : 'text-ink'}`}
                  initial={{ scale: 1.3, opacity: 0.3 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 700, damping: 30 }}
                >
                  {n}
                </motion.span>
              </AnimatePresence>
            </div>
            <div className="text-[11px] font-medium text-ink-3">{g.label}</div>
          </div>
        )
      })}
    </div>
  )
}
