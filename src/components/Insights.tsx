import { Flag, Globe, Landmark, MapPin } from 'lucide-react'
import { animate, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { mediaUrl, type CardType, type Note } from '../lib/deck'
import { HORIZONS, type Goal, type MixUp, type TypeStat } from '../lib/insights'
import { dayKey } from '../lib/scheduler'

/** Fill opacity of the good colour for each step of more; step 0 is empty. Matches the map. */
const SHADE = [0, 0.3, 0.5, 0.75, 1]
const EASE = [0.2, 0.8, 0.2, 1] as const

export const Heading = ({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) => (
  <div className="mb-2.5 flex items-baseline justify-between gap-3">
    <h3 className="text-[12.5px] font-medium text-ink-3">{children}</h3>
    {aside && <span className="text-[11.5px] text-ink-3">{aside}</span>}
  </div>
)

/** A bar that grows in from the left when the page opens. */
function Fill({ value, className, delay = 0 }: { value: number; className: string; delay?: number }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={`h-full origin-left rounded-full ${className}`}
      style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      initial={reduce ? false : { scaleX: 0 }}
      animate={{ scaleX: 1 }}
      transition={{ duration: 0.7, delay: 0.1 + delay, ease: EASE }}
    />
  )
}

const pad = (n: number) => String(n).padStart(2, '0')
const keyOf = (t: Date) => `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`
const DAY_NAME = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })

const CELL = 12
const GAP = 3

/** Every day of the last few months as a square, darker for more answers, weeks as columns starting Monday. As many
 * weeks as fit the width. */
export function Heatmap({ days }: { days: Map<string, number> }) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(box.current!)
    return () => ro.disconnect()
  }, [])
  const weeks = Math.max(1, Math.floor((width + GAP) / (CELL + GAP)))
  const today = dayKey(new Date())
  const [y, m, d] = today.split('-').map(Number)
  const end = new Date(y, m - 1, d, 12)
  const start = new Date(end)
  start.setDate(start.getDate() - ((end.getDay() + 6) % 7) - (weeks - 1) * 7)
  const max = Math.max(1, ...days.values())
  const level = (n: number) => (n ? Math.min(4, Math.ceil((n / max) * 4)) : 0)
  const cells: { key: string; n: number; future: boolean; label: string }[] = []
  for (let t = new Date(start), i = 0; i < weeks * 7; i++, t.setDate(t.getDate() + 1)) {
    const key = keyOf(t)
    const n = days.get(key) ?? 0
    cells.push({ key, n, future: t > end, label: `${DAY_NAME.format(t)}: ${n ? `${n} answer${n === 1 ? '' : 's'}` : 'no study'}` })
  }
  return (
    <div
      ref={box}
      className="grid grid-flow-col justify-end"
      style={{ gap: GAP, gridTemplateColumns: `repeat(${weeks}, ${CELL}px)`, gridTemplateRows: `repeat(7, ${CELL}px)` }}
      role="img"
      aria-label={`Answers per day, last ${weeks} weeks`}
    >
      {width > 0 && cells.map((c) => (
        <div
          key={c.key}
          title={c.future ? undefined : c.label}
          className={`rounded-[3px] ${c.future ? '' : c.n ? 'bg-good' : 'bg-muted'} ${c.key === today ? 'ring-1 ring-ink-3 ring-offset-1 ring-offset-surface' : ''}`}
          style={c.n ? { opacity: SHADE[level(c.n)] } : undefined}
        />
      ))}
    </div>
  )
}

/** A number that counts up from zero when the page opens. */
export function CountUp({ to }: { to: number }) {
  const reduce = useReducedMotion()
  const [n, setN] = useState(0)
  useEffect(() => {
    if (reduce) return
    const a = animate(0, to, { duration: 0.9, ease: EASE, onUpdate: (v) => setN(Math.round(v)) })
    return () => a.stop()
  }, [to, reduce])
  return <>{(reduce ? to : n).toLocaleString()}</>
}

export const Stat = ({ value, label, sub }: { value: React.ReactNode; label: string; sub?: React.ReactNode }) => (
  <div className="min-w-0 rounded-2xl border border-line px-3.5 py-3">
    <div className="whitespace-nowrap text-[20px] font-semibold leading-none tracking-[-0.02em] text-ink tabular-nums sm:text-[22px]">{value}</div>
    <div className="mt-1.5 text-[12.5px] leading-snug text-ink-2">{label}</div>
    {sub && <div className="mt-0.5 text-[11.5px] leading-snug text-ink-3 tabular-nums">{sub}</div>}
  </div>
)

/** Sets closest to finished, each with a button that brings its last cards in now. */
export function Goals({ goals, onLearn }: { goals: Goal[]; onLearn: (g: Goal) => void }) {
  return (
    <ul className="space-y-2">
      {goals.map((g, i) => (
        <li key={g.key} className="rounded-2xl border border-line py-3 pl-3.5 pr-2.5">
          <div className="flex items-baseline justify-between gap-3 pr-1">
            <span className="text-[13.5px] font-medium leading-snug text-ink">{g.label}</span>
            <span className="shrink-0 text-[12px] tabular-nums text-ink-3">
              {g.done} of {g.total}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-3">
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
            <Fill value={g.done / g.total} className="bg-good" delay={i * 0.08} />
          </div>
          <button
            onClick={() => onLearn(g)}
            className="shrink-0 rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink transition-colors hover:bg-subtle pointer-coarse:py-2.5"
          >
            {g.left.length === 1 ? 'Learn the last one' : `Learn the last ${g.left.length}`}
          </button>
          </div>
        </li>
      ))}
    </ul>
  )
}

const TYPE_META: Record<CardType, { label: string; Icon: typeof Flag }> = {
  flag: { label: 'Flags', Icon: Flag },
  map: { label: 'Maps', Icon: MapPin },
  capital: { label: 'Capitals', Icon: Landmark },
  country: { label: 'Countries from capitals', Icon: Globe },
}

/** Per card type: how often you remember one when it comes back (the bar), and how many are under way. */
export function Types({ stats }: { stats: TypeStat[] }) {
  // Only a clear best and worst get a colour: one type alone at the top (or bottom) once rounded.
  const shown = stats.flatMap((s) => (s.recall === null ? [] : [Math.round(s.recall * 100)]))
  const only = (v: number) => shown.filter((x) => x === v).length === 1
  const best = shown.length > 1 && only(Math.max(...shown)) ? Math.max(...shown) : null
  const worst = shown.length > 1 && only(Math.min(...shown)) ? Math.min(...shown) : null
  return (
    <ul className="space-y-3.5">
      {stats.map((s, i) => {
        const { label, Icon } = TYPE_META[s.type]
        const r = s.recall === null ? null : Math.round(s.recall * 100)
        const tone = r !== null && r === best ? 'text-good' : r !== null && r === worst ? 'text-again' : 'text-ink'
        return (
          <li key={s.type}>
            <div className="flex items-baseline gap-2">
              <Icon size={14} strokeWidth={1.75} className="shrink-0 translate-y-[2px] text-ink-3" />
              <span className="min-w-0 flex-1 text-[13.5px] text-ink">{label}</span>
              <span className={`text-[15px] font-semibold tabular-nums ${tone}`}>{r === null ? '–' : `${r}%`}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              {r !== null && <Fill value={r / 100} className={r === best ? 'bg-good' : r === worst ? 'bg-again' : 'bg-ink-3'} delay={i * 0.06} />}
            </div>
            <div className="mt-1 text-[11.5px] tabular-nums text-ink-3">
              {r === null ? 'Not enough reviews yet · ' : ''}
              {s.learned} of {s.total} started
            </div>
          </li>
        )
      })}
    </ul>
  )
}

const Mini = ({ note }: { note: Note }) => {
  const file = note.flagBack ?? note.flag
  return file ? (
    <img src={mediaUrl(file)} alt="" draggable={false} loading="lazy" className={`h-7 w-auto max-w-12 ${file.includes('-nobox') ? '' : 'img-shadow rounded-[2px]'}`} />
  ) : null
}

/** Pairs of flags you've mixed up, side by side. */
export function MixUps({ pairs, onPick }: { pairs: MixUp[]; onPick: (n: Note) => void }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {pairs.map(({ missed, other }) => (
        <li key={missed.id + other.id}>
          <button onClick={() => onPick(missed)} className="flex w-full items-center gap-3 rounded-2xl border border-line px-3.5 py-2.5 text-left transition-colors hover:bg-subtle">
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="flex w-12 justify-center">
                <Mini note={missed} />
              </span>
              <span className="flex w-12 justify-center">
                <Mini note={other} />
              </span>
            </span>
            <span className="min-w-0 text-[13px] leading-snug">
              <span className="block truncate text-ink">{missed.country}</span>
              <span className="block truncate text-ink-3">vs {other.country}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

const long = (days: number) =>
  days < 14 ? `${Math.round(days)} days` : days < 60 ? `${Math.round(days / 7)} weeks` : days < 540 ? `${Math.round(days / 30)} months` : `${(days / 365).toFixed(1).replace(/\.0$/, '')} years`

/** Graduated cards by how long they should stay remembered, as one bar. */
export function Horizon({ counts, best }: { counts: number[]; best: { name: string; days: number } | null }) {
  const total = counts.reduce((a, b) => a + b, 0)
  const reduce = useReducedMotion()
  if (!total) return <p className="text-[13.5px] text-ink-3">Once cards graduate from learning, you'll see how long they'll stick.</p>
  return (
    <div>
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full">
        {counts.map((n, i) =>
          n ? (
            <motion.div
              key={i}
              className="h-full origin-left bg-good first:rounded-l-full last:rounded-r-full"
              style={{ flexGrow: n, opacity: SHADE[i + 1] }}
              initial={reduce ? false : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.5, delay: 0.15 + i * 0.12, ease: EASE }}
              title={`${HORIZONS[i].label}: ${n}`}
            />
          ) : null,
        )}
      </div>
      <ul className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-4">
        {HORIZONS.map((h, i) => (
          <li key={h.label} className="flex items-center gap-1.5 text-ink-2">
            <span className="h-2 w-2 shrink-0 rounded-[2px] bg-good" style={{ opacity: SHADE[i + 1] }} />
            <span className="truncate">{h.label}</span>
            <span className="ml-auto tabular-nums text-ink-3 sm:ml-0">{counts[i]}</span>
          </li>
        ))}
      </ul>
      {best && (
        <p className="mt-3 text-[13px] leading-snug text-ink-2">
          Sturdiest memory: <span className="text-ink">{best.name}</span>. You'll very likely still know it in {long(best.days)}.
        </p>
      )}
    </div>
  )
}

const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' })
const WEEKDAY_LONG = new Intl.DateTimeFormat(undefined, { weekday: 'long' })

/** Reviews due each of the next two weeks, as bars. */
export function Ahead({ load, cap }: { load: number[]; cap: number }) {
  const reduce = useReducedMotion()
  const days = load.slice(0, 14).map((n) => Math.min(n, cap))
  const max = Math.max(1, ...days)
  const peak = days.indexOf(Math.max(...days))
  const date = (i: number) => {
    const t = new Date()
    t.setDate(t.getDate() + i)
    return t
  }
  return (
    <div>
      <div className="flex h-24 items-end gap-[3px] pt-4 sm:gap-1">
        {days.map((n, i) => (
          <div key={i} data-due={n} className="relative flex h-full min-w-0 flex-1 items-end" title={`${i ? WEEKDAY_LONG.format(date(i)) : 'Today'}: ${n} review${n === 1 ? '' : 's'}`}>
            {(i === 0 || i === 1 || i === peak) && n > 0 && (
              <span className="absolute inset-x-0 text-center text-[10.5px] tabular-nums text-ink-3" style={{ bottom: `calc(${(n / max) * 100}% + 3px)` }}>
                {n}
              </span>
            )}
            <motion.div
              className={`w-full origin-bottom rounded-[4px] ${i === 0 ? 'bg-ink' : 'bg-muted-2'}`}
              style={{ height: `${Math.max(n ? 6 : 2, (n / max) * 100)}%` }}
              initial={reduce ? false : { scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ duration: 0.5, delay: 0.1 + i * 0.025, ease: EASE }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[3px] sm:gap-1">
        {days.map((_, i) => (
          <span key={i} className={`min-w-0 flex-1 text-center text-[10.5px] ${i === 0 ? 'font-medium text-ink' : 'text-ink-3'}`} aria-hidden>
            {WEEKDAY.format(date(i))}
          </span>
        ))}
      </div>
    </div>
  )
}
