import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { db } from '../lib/db'
import { CARD_BY_ID } from '../lib/deck'
import { dayEnd, formatInterval, GRADES, matchesFilters, State, type Queue } from '../lib/scheduler'
import { useSettings, type Settings } from '../lib/settings'
import { loadStreak } from '../lib/streak'
import { KeepProgress } from './KeepProgress'

const GRADE_CLS = ['text-again', 'text-hard', 'text-good', 'text-easy']

const Screen = ({ children }: { children: React.ReactNode }) => (
  <motion.div
    className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center"
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
  >
    {children}
  </motion.div>
)
const Title = ({ children }: { children: React.ReactNode }) => (
  <div className="text-balance text-[clamp(26px,4vw,34px)] font-semibold tracking-[-0.02em] text-ink">{children}</div>
)
const Action = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button
    onClick={onClick}
    className="mt-3 rounded-full border border-line bg-white px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-neutral-50 pointer-coarse:py-3"
  >
    {children}
  </button>
)

/** When reviews come back, among the cards the filters show: the soonest one, and how many fall due tomorrow. */
function useUpcoming(settings: Settings) {
  const [upcoming, setUpcoming] = useState<{ at: Date; tomorrow: number } | null>(null)
  useEffect(() => {
    let live = true
    void db.cards.toArray().then((rows) => {
      const now = new Date()
      const end = dayEnd(now)
      const tomorrowEnd = dayEnd(end)
      let at: Date | null = null
      let tomorrow = 0
      for (const r of rows) {
        const c = CARD_BY_ID.get(r.id)
        if (r.state === State.New || !c || !matchesFilters(c, settings) || r.due <= now) continue
        if (!at || r.due < at) at = r.due
        if (r.due >= end && r.due < tomorrowEnd) tomorrow++
      }
      if (live) setUpcoming(at ? { at, tomorrow } : null)
    })
    return () => {
      live = false
    }
  }, [settings])
  return upcoming
}

type Props = { queue: Queue; learned: number; grades: number[]; onLearnMore: () => void }

export function Done({ queue, learned, grades, onLearnMore }: Props) {
  const settings = useSettings()
  const upcoming = useUpcoming(settings)
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
    : upcoming &&
      (upcoming.tomorrow && +upcoming.at >= +dayEnd(new Date(now))
        ? `${upcoming.tomorrow} review${upcoming.tomorrow === 1 ? '' : 's'} tomorrow`
        : `next review in ${formatInterval(+upcoming.at - now)}`)
  return (
    <Screen>
      <Title>{queue.nextLearningAt ? 'Take a breath.' : 'Done for today.'}</Title>
      <div className="text-balance text-[14px] text-ink-3">
        {queue.done} card{queue.done === 1 ? '' : 's'} answered
        {next ? ` · ${next}` : ''}
        {` · ${learned} learned in total`}
        {streak > 1 ? ` · ${streak}-day streak` : ''}
      </div>
      {queue.done > 0 && (
        <div className="flex items-baseline gap-3 text-[13px]">
          {GRADES.map((g, i) => (
            <span key={g.key} className="flex items-baseline gap-1">
              <span className={`font-semibold tabular-nums ${GRADE_CLS[i]}`}>{grades[i]}</span>
              <span className="text-ink-3">{g.label.toLowerCase()}</span>
            </span>
          ))}
        </div>
      )}
      {queue.remainingNew > 0 && <Action onClick={onLearnMore}>Learn {Math.min(20, queue.remainingNew)} more</Action>}
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
