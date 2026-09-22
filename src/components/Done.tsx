import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { formatInterval, type Queue } from '../lib/scheduler'

type Props = { queue: Queue; onLearnMore: () => void }

export function Done({ queue, onLearnMore }: Props) {
  const [, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(t)
  }, [])

  const waitMs = queue.nextLearningAt ? +queue.nextLearningAt - Date.now() : 0
  return (
    <motion.div
      key="done"
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div className="text-[clamp(26px,4vw,34px)] font-semibold tracking-[-0.02em] text-ink">
        {queue.nextLearningAt ? 'Take a breath.' : 'Done for today.'}
      </div>
      <div className="text-[14px] text-ink-3">
        {queue.done} card{queue.done === 1 ? '' : 's'} answered
        {queue.nextLearningAt && waitMs > 0 ? ` · next card in ${formatInterval(waitMs)}` : ''}
      </div>
      {queue.remainingNew > 0 && (
        <button
          onClick={onLearnMore}
          className="mt-3 rounded-full border border-line bg-white px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-neutral-50"
        >
          Learn {Math.min(20, queue.remainingNew)} more
        </button>
      )}
    </motion.div>
  )
}
