import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { dayEnd, formatInterval, GRADES, LEARN_ALL_MAX, type Queue } from '../lib/scheduler'
import { loadStreak } from '../lib/streak'
import { KeepProgress } from './KeepProgress'

const GRADE_CLS = ['text-again', 'text-hard', 'text-good', 'text-easy']
/** How many new cards 'Learn more' adds to the day. */
const MORE = 10

const Screen = ({ children }: { children: React.ReactNode }) => (
  <motion.div
    className="scroll-fade absolute inset-0 flex flex-col items-center justify-center-safe gap-3 overflow-y-auto text-center short:gap-1.5"
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
  >
    {children}
  </motion.div>
)
const Title = ({ children }: { children: React.ReactNode }) => (
  <div className="text-balance text-[clamp(26px,4vw,34px)] font-semibold tracking-[-0.02em] text-ink short:text-[26px]">{children}</div>
)
const Action = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button
    onClick={onClick}
    className="mt-3 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-subtle pointer-coarse:py-3"
  >
    {children}
  </button>
)

type Props = { queue: Queue; learned: number; grades: number[]; onLearnMore: (n: number) => void; onLearnAll: () => void; onOpenProgress: () => void }

export function Done({ queue, learned, grades, onLearnMore, onLearnAll, onOpenProgress }: Props) {
  // Every answer today, the same ones the grade row and piles count (learning steps and Knew it included).
  const answered = grades.reduce((a, b) => a + b, 0)
  const [now, setNow] = useState(Date.now)
  const [streak, setStreak] = useState(0)
  useEffect(() => {
    let live = true
    loadStreak()
      .then((n) => live && setStreak(n))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [queue.done])
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(t)
  }, [])

  const waitMs = queue.nextLearningAt ? +queue.nextLearningAt - now : 0
  const next = queue.nextLearningAt
    ? waitMs > 0 && `next card in ${formatInterval(waitMs)}`
    : queue.nextDue &&
      (queue.dueTomorrow && +queue.nextDue >= +dayEnd(new Date(now))
        ? `${queue.dueTomorrow} review${queue.dueTomorrow === 1 ? '' : 's'} tomorrow`
        : `next review in ${formatInterval(+queue.nextDue - now)}`)
  return (
    <Screen>
      <Title>{queue.nextLearningAt ? 'Take a breath.' : 'Done for today.'}</Title>
      <div className="text-balance text-[14px] text-ink-3">
        {/* Wrap only between phrases, never inside one. */}
        {[`${answered} answer${answered === 1 ? '' : 's'}`, next, `${learned} learned in total`, streak > 1 && `${streak}-day streak`]
          .filter(Boolean)
          .map((t, i) => (
            <span key={i}>
              {i > 0 && '\u00a0· '}
              <span className="whitespace-nowrap">{t}</span>
            </span>
          ))}
      </div>
      {answered > 0 && (
        <div className="flex items-baseline gap-3 text-[13px]">
          {GRADES.map((g, i) => (
            <span key={g.key} className="flex items-baseline gap-1">
              <span className={`font-semibold tabular-nums ${GRADE_CLS[i]}`}>{grades[i]}</span>
              <span className="text-ink-3">{g.label.toLowerCase()}</span>
            </span>
          ))}
        </div>
      )}
      {learned > 0 && (
        <button
          onClick={onOpenProgress}
          className="relative text-[13px] text-ink-3 underline decoration-line underline-offset-4 transition-colors after:absolute after:-inset-x-2 after:-inset-y-3 hover:text-ink hover:decoration-ink-3"
        >
          See your progress
        </button>
      )}
      {/* Ten more, and once the end is in sight every card left at once; with ten or fewer left they're the same thing. */}
      {queue.unstarted > 0 && (
        <div className="flex flex-wrap justify-center gap-x-2">
          {queue.remainingNew > 0 && queue.unstarted > MORE && <Action onClick={() => onLearnMore(MORE)}>Learn {Math.min(MORE, queue.remainingNew)} more</Action>}
          {queue.unstarted <= LEARN_ALL_MAX && <Action onClick={onLearnAll}>Learn all {queue.unstarted} left</Action>}
        </div>
      )}
      <KeepProgress learned={learned} />
    </Screen>
  )
}

/** The filters leave nothing to study, which isn't the same as being done. */
export function Empty({ onReset }: { onReset: () => void }) {
  return (
    <Screen>
      <Title>No cards match these filters.</Title>
      <div className="text-[14px] text-ink-3">Try a different combination, or study everything.</div>
      <Action onClick={onReset}>Reset filters</Action>
    </Screen>
  )
}
