import { Check, Flag, Globe, Landmark, MapPin } from 'lucide-react'
import { animate, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { CardType } from '../lib/deck'
import { CONTINENTS, SET_WORD, STRENGTHS, SUBREGIONS, TYPES, WHOLE, regionShort, type DayStat, type DeckSet, type TypeStat } from '../lib/insights'
import { dayKey } from '../lib/scheduler'

/** Fill opacity of the good colour for each step of more; step 0 is empty. Matches the map. */
const SHADE = [0, 0.3, 0.5, 0.75, 1]
const EASE = [0.2, 0.8, 0.2, 1] as const

export const Heading = ({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) => (
  <div className="mb-2.5 flex items-baseline justify-between gap-3">
    <h3 className="text-[12.5px] font-medium text-ink-3">{children}</h3>
    {aside && <span className="text-[11.5px] tabular-nums text-ink-3">{aside}</span>}
  </div>
)

/** Width of an element, kept up to date. */
function useWidth<T extends Element>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(ref.current!)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

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

/** Three headline numbers side by side, each centred in its third. */
export const Numbers = ({ items }: { items: { value: React.ReactNode; label: string; sub?: string }[] }) => (
  <div className="grid grid-cols-3 divide-x divide-line">
    {items.map((x) => (
      <div key={x.label} className="min-w-0 px-2 text-center sm:px-4">
        <div className="whitespace-nowrap text-[22px] font-semibold leading-none tracking-[-0.02em] text-ink tabular-nums sm:text-[24px]">{x.value}</div>
        <div className="mt-1.5 text-[12.5px] leading-snug text-ink-2">{x.label}</div>
        {x.sub && <div className="mt-0.5 text-[11.5px] leading-snug text-ink-3 tabular-nums">{x.sub}</div>}
      </div>
    ))}
  </div>
)

const pad = (n: number) => String(n).padStart(2, '0')
const keyOf = (t: Date) => `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`
const DAY_NAME = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const MONTH = new Intl.DateTimeFormat(undefined, { month: 'short' })
const minutes = (ms: number) => (ms < 60_000 ? 'under a minute' : `${Math.round(ms / 60_000)} min`)
const CELL = 12
const GAP = 3
/** Fewest weeks the grid shows, so a short history still reads as a calendar. */
const MIN_WEEKS = 6
/** The grid takes at most this share of the row, and leaves the heading at least this many px. */
const SHARE = 0.55
const LEFT_MIN = 190

/** Weeks (Monday to Sunday) from the one holding `from` to the one holding `to`, both counted. */
const weeksSpanned = (from: string, to: string) => {
  const monday = (key: string) => {
    const [y, m, d] = key.split('-').map(Number)
    const t = new Date(y, m - 1, d, 12)
    t.setDate(t.getDate() - ((t.getDay() + 6) % 7))
    return +t
  }
  return Math.round((monday(to) - monday(from)) / (7 * 86_400_000)) + 1
}

/**
 * Every day you've studied as a square, darker for more answers, weeks as columns starting Monday, beside the page's
 * heading. It grows with your history, from six weeks up to as many as fit. Point at a day (or tap it) for what you
 * did that day.
 */
export function Heatmap({ days, summary, children }: { days: Map<string, DayStat>; summary: string; children: React.ReactNode }) {
  const [box, width] = useWidth<HTMLDivElement>()
  const [sel, setSel] = useState<string | null>(null)
  const today = dayKey(new Date())
  const first = [...days.keys()].reduce((a, b) => (a < b ? a : b), today)
  const fit = Math.max(1, Math.floor((Math.min(width * SHARE, width - LEFT_MIN) + GAP) / (CELL + GAP)))
  const weeks = Math.min(fit, Math.max(MIN_WEEKS, weeksSpanned(first, today)))
  const [y, m, d] = today.split('-').map(Number)
  const end = new Date(y, m - 1, d, 12)
  const start = new Date(end)
  start.setDate(start.getDate() - ((end.getDay() + 6) % 7) - (weeks - 1) * 7)
  const max = Math.max(1, ...[...days.values()].map((x) => x.answers))
  const level = (n: number) => (n ? Math.min(4, Math.ceil((n / max) * 4)) : 0)
  const cells: { key: string; date: Date; future: boolean }[] = []
  const months: { col: number; label: string }[] = []
  for (let t = new Date(start), i = 0; i < weeks * 7; i++, t.setDate(t.getDate() + 1)) {
    cells.push({ key: keyOf(t), date: new Date(t), future: t > end })
    // A month's name over the first week that starts in it.
    if (i % 7 === 0 && t.getDate() <= 7) months.push({ col: i / 7, label: MONTH.format(t) })
  }
  const gridWidth = weeks * CELL + (weeks - 1) * GAP

  const describe = (key: string) => {
    const c = cells.find((x) => x.key === key)
    const s = days.get(key)
    const name = key === today ? 'Today' : c ? DAY_NAME.format(c.date) : key
    if (!s) return `${name} · no study`
    const parts = [`${s.answers} answer${s.answers === 1 ? '' : 's'}`, `${s.fresh} new`]
    if (s.reviews) parts.push(`${Math.round((s.right / s.reviews) * 100)}% of reviews right`)
    parts.push(minutes(s.ms))
    return `${name} · ${parts.join(' · ')}`
  }

  return (
    <div ref={box} className="flex justify-between gap-5">
      <div className="flex min-w-0 flex-1 flex-col">
        {children}
        <p className="mt-auto pt-3 text-[12px] leading-snug tabular-nums text-ink-3" aria-live="polite">
          {sel ? <span className="text-ink-2">{describe(sel)}</span> : days.has(today) ? describe(today) : summary}
        </p>
      </div>
      {width > 0 ? (
        <div className="shrink-0" style={{ width: gridWidth }}>
          <div className="relative mb-1 h-3.5 text-[10.5px] text-ink-3" aria-hidden>
            {months.map((mo) => (
              <span key={mo.col} className="absolute whitespace-nowrap" style={{ left: mo.col * (CELL + GAP) }}>
                {mo.label}
              </span>
            ))}
          </div>
          <div
            className="grid grid-flow-col"
            style={{ gap: GAP, gridTemplateColumns: `repeat(${weeks}, ${CELL}px)`, gridTemplateRows: `repeat(7, ${CELL}px)` }}
            role="img"
            aria-label={`Answers per day. ${summary}`}
            onPointerLeave={(e) => e.pointerType === 'mouse' && setSel(null)}
          >
            {cells.map((c) => {
              const n = days.get(c.key)?.answers ?? 0
              return (
                <div
                  key={c.key}
                  onPointerEnter={(e) => !c.future && e.pointerType === 'mouse' && setSel(c.key)}
                  onClick={() => !c.future && setSel((s) => (s === c.key ? null : c.key))}
                  className={`relative rounded-[3px] ${c.future ? '' : 'cursor-pointer'} ${c.future ? '' : n ? 'bg-good' : 'bg-muted'} ${
                    sel === c.key ? 'outline-[1.5px] outline-offset-1 outline-ink outline' : c.key === today ? 'outline-1 outline-offset-1 outline-ink-3 outline' : ''
                  }`}
                  style={n ? { opacity: SHADE[level(n)] } : undefined}
                />
              )
            })}
          </div>
        </div>
      ) : (
        <div style={{ height: 18 + 7 * CELL + 6 * GAP }} />
      )}
    </div>
  )
}

const TYPE_META: Record<CardType, { label: string; short: string; Icon: typeof Flag }> = {
  flag: { label: 'Flags', short: 'Flags', Icon: Flag },
  map: { label: 'Maps', short: 'Maps', Icon: MapPin },
  capital: { label: 'Capitals', short: 'Capitals', Icon: Landmark },
  country: { label: 'Countries from capitals', short: 'From capitals', Icon: Globe },
}

/** A kind of card's icon. */
export const TypeIcon = ({ type, size = 14 }: { type: CardType; size?: number }) => {
  const { Icon } = TYPE_META[type]
  return <Icon size={size} strokeWidth={1.75} />
}

/** Per card type: how often you remember one when it comes back. */
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
        return (
          <li key={s.type}>
            <div className="flex items-baseline gap-2 text-[13.5px]">
              <Icon size={14} strokeWidth={1.75} className="shrink-0 translate-y-[2px] text-ink-3" />
              <span className="min-w-0 flex-1 truncate text-ink">{label}</span>
              <span className="shrink-0 tabular-nums">
                <span className="font-semibold text-ink">{r === null ? '–' : `${r}%`}</span>
                <span className="text-[12px] text-ink-3"> remembered</span>
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              {r !== null && <Fill value={r / 100} className={r === best ? 'bg-good' : r === worst ? 'bg-again' : 'bg-ink-3'} delay={i * 0.06} />}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** The map's shades as solid colours, so a check can sit on top at full strength. */
const tint = (step: number) => (step ? mix(SHADE[step]) : undefined)
const mix = (share: number) => `color-mix(in oklab, var(--color-good) ${Math.round(share * 100)}%, var(--color-surface))`
/** A set's colour: grey until started, then greener the more of it is under way (across the map's in-between shades), full once every card is. */
const setColour = (s: DeckSet) => (!s.done ? undefined : mix(s.done === s.cards.length ? 1 : SHADE[1] + (SHADE[3] - SHADE[1]) * (s.done / s.cards.length)))

/** The map's key: grey, then four greens. */
export const Legend = ({ className = '' }: { className?: string }) => (
  <span className={`flex shrink-0 items-center gap-1 ${className}`} aria-hidden>
    <span className="mr-0.5 max-sm:hidden">Less</span>
    {SHADE.map((_, l) => (
      <span key={l} className={`h-2.5 w-2.5 rounded-[3px] ${l ? '' : 'bg-muted-2'}`} style={{ backgroundColor: tint(l) }} />
    ))}
    <span className="ml-0.5 max-sm:hidden">More</span>
  </span>
)

/**
 * Every set as a heat map: regions down the side, kinds of card across, greener the more of the set you've started,
 * with how many cards are left to start in it, or a check once it's all under way. Point at one for its full count;
 * tap it to see its places.
 */
export function SetsGrid({ sets, onOpen }: { sets: Map<string, DeckSet>; onOpen: (key: string) => void }) {
  const [sel, setSel] = useState<string | null>(null)
  const cols = 'minmax(6.5rem,1fr) repeat(4, minmax(2.25rem, 4rem))'
  const all = [...sets.values()].filter((s) => s.region !== WHOLE)
  const finished = all.filter((s) => s.done === s.cards.length).length
  const hovered = sel ? sets.get(sel) : undefined
  const row = (region: string) => (
    <div key={region} className="grid items-center gap-1" style={{ gridTemplateColumns: cols }} role="row">
      <span className={`truncate pr-1 text-[13px] ${region === WHOLE ? 'text-ink' : 'text-ink-2'}`} role="rowheader">
        {regionShort(region)}
      </span>
      {TYPES.map((type) => {
        const s = sets.get(`${region}:${type}`)
        if (!s) return <span key={type} role="cell" />
        const full = s.done === s.cards.length
        return (
          <button
            key={type}
            role="cell"
            data-set={s.key}
            onClick={() => onOpen(s.key)}
            onPointerEnter={(e) => e.pointerType === 'mouse' && setSel(s.key)}
            onFocus={() => setSel(s.key)}
            onBlur={() => setSel((k) => (k === s.key ? null : k))}
            aria-label={`${s.label}: ${s.done} of ${s.cards.length} started`}
            className={`flex h-7 items-center justify-center rounded-md outline-offset-1 ${s.done ? '' : 'bg-muted-2'} ${sel === s.key ? 'outline outline-[1.5px] outline-ink' : ''}`}
            style={{ backgroundColor: setColour(s) }}
          >
            {full ? <Check size={13} strokeWidth={3} className="text-surface" /> : <span className="text-[12px] font-medium tabular-nums text-ink">{s.left.length}</span>}
          </button>
        )
      })}
    </div>
  )
  return (
    <div>
      <div className="mb-4 flex min-h-[1lh] items-center justify-between gap-3 text-[12.5px] tabular-nums text-ink-3" aria-live="polite">
        <span className="min-w-0 truncate">
          {hovered ? (
            <>
              <span className="text-ink-2">
                {regionShort(hovered.region)} · {SET_WORD[hovered.type]}
              </span>{' '}
              · {hovered.done === hovered.cards.length ? `all ${hovered.cards.length} started` : `${hovered.done} of ${hovered.cards.length} started`}
            </>
          ) : (
            `${finished} of ${all.length} finished · numbers are cards left to start`
          )}
        </span>
        <Legend className="max-sm:hidden" />
      </div>
      <div role="table" aria-label="Sets" className="space-y-1" onPointerLeave={(e) => e.pointerType === 'mouse' && setSel(null)}>
        <div className="grid items-end gap-1 pb-1" style={{ gridTemplateColumns: cols }} role="row">
          <span />
          {TYPES.map((t) => {
            const { short, Icon } = TYPE_META[t]
            return (
              <span key={t} className="flex flex-col items-center gap-1 text-balance text-center text-[11px] leading-tight text-ink-3" role="columnheader">
                <Icon size={13} strokeWidth={1.75} />
                {short}
              </span>
            )
          })}
        </div>
        {row(WHOLE)}
        <div className="h-2" />
        {CONTINENTS.map(row)}
        <div className="pb-0.5 pt-3 text-[11.5px] text-ink-3">Within them</div>
        {SUBREGIONS.map(row)}
      </div>
    </div>
  )
}

/**
 * The cards you've answered by how long each would hold if you stopped studying today, as one bar: paler for the
 * ones that would slip within days, darker for the ones that would last. Point at a part for its count.
 */
export function Strength({ counts, month, year }: { counts: number[]; month: number; year: number }) {
  const reduce = useReducedMotion()
  const [sel, setSel] = useState<number | null>(null)
  return (
    <div>
      <motion.div
        className="flex h-2.5 origin-left gap-[2px]"
        initial={reduce ? false : { scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.7, delay: 0.1, ease: EASE }}
        onPointerLeave={() => setSel(null)}
        role="img"
        aria-label={STRENGTHS.map((s, i) => `${counts[i]} ${s.says}`).join(', ')}
      >
        {counts.map(
          (n, i) =>
            n > 0 && (
              <div
                key={i}
                onPointerEnter={() => setSel(i)}
                onClick={() => setSel((s) => (s === i ? null : i))}
                className={`h-full min-w-[3px] rounded-[3px] transition-opacity ${sel !== null && sel !== i ? 'opacity-40' : ''}`}
                style={{ flex: `${n} 1 0`, backgroundColor: tint(i + 1) }}
              />
            ),
        )}
      </motion.div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-3">
        {STRENGTHS.map((s, i) => (
          <span key={s.label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: tint(i + 1) }} />
            {s.label}
            <span className="tabular-nums text-ink-2">{counts[i].toLocaleString()}</span>
          </span>
        ))}
      </div>
      <p className="mt-2 min-h-[2lh] text-balance text-[13px] leading-snug tabular-nums text-ink-2 sm:min-h-[1lh]" aria-live="polite">
        {sel !== null ? (
          <>
            <span className="font-medium text-ink">{counts[sel].toLocaleString()}</span> {STRENGTHS[sel].says}.
          </>
        ) : (
          `If you stopped today you'd still know about ${month.toLocaleString()} in a month, and ${year.toLocaleString()} in a year.`
        )}
      </p>
    </div>
  )
}

const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' })
const WEEKDAY_LONG = new Intl.DateTimeFormat(undefined, { weekday: 'long' })

/** Reviews due each of the next two weeks, as bars. Point at one for its day, count and roughly how long it'll take. */
export function Ahead({ load, cap, perCard }: { load: number[]; cap: number; perCard: number }) {
  const reduce = useReducedMotion()
  const [hover, setHover] = useState<number | null>(null)
  const days = load.slice(0, 14).map((n) => Math.min(n, cap))
  const max = Math.max(1, ...days)
  const peak = days.indexOf(Math.max(...days))
  const date = (i: number) => {
    const t = new Date()
    t.setDate(t.getDate() + i)
    return t
  }
  const name = (i: number) => (i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : WEEKDAY_LONG.format(date(i)))
  const count = (n: number) => `${n} review${n === 1 ? '' : 's'}${n && perCard ? `, about ${Math.max(1, Math.round((n * perCard) / 60_000))} min` : ''}`
  return (
    <div>
      <div className="flex h-24 items-end gap-[3px] pt-4 sm:gap-1" onPointerLeave={() => setHover(null)}>
        {days.map((n, i) => (
          <div
            key={i}
            data-due={n}
            className="relative flex h-full min-w-0 flex-1 cursor-default items-end"
            onPointerEnter={() => setHover(i)}
            onClick={() => setHover((h) => (h === i ? null : i))}
          >
            {(i === 0 || i === 1 || i === peak) && n > 0 && (
              <span className="absolute inset-x-0 text-center text-[10.5px] tabular-nums text-ink-3" style={{ bottom: `calc(${(n / max) * 100}% + 3px)` }}>
                {n}
              </span>
            )}
            <motion.div
              className={`w-full origin-bottom rounded-[4px] transition-colors ${i === 0 ? 'bg-ink' : hover === i ? 'bg-ink-3' : 'bg-muted-2'}`}
              style={{ height: `${Math.max(n ? 6 : 2, (n / max) * 100)}%` }}
              initial={reduce ? false : { scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ duration: 0.5, delay: 0.1 + i * 0.025, ease: EASE }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[3px] sm:gap-1" aria-hidden>
        {days.map((_, i) => (
          <span key={i} className={`min-w-0 flex-1 text-center text-[10.5px] ${i === 0 ? 'font-medium text-ink' : 'text-ink-3'}`}>
            {WEEKDAY.format(date(i))}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[13px] tabular-nums text-ink-2" aria-live="polite">
        {hover !== null ? (
          <>
            <span className="font-medium text-ink">{name(hover)}</span>: {count(days[hover])}
          </>
        ) : (
          <>
            Tomorrow {count(days[1] ?? 0)}
            {peak > 1 && ` · busiest ${WEEKDAY_LONG.format(date(peak))}, ${days[peak]}`}
          </>
        )}
      </p>
    </div>
  )
}

/** Your last few answers on a card, oldest first: red for a miss, green for right. */
export const LastAnswers = ({ ratings }: { ratings: number[] }) => (
  <span className="flex shrink-0 items-center gap-1" aria-label={`Last ${ratings.length}: ${ratings.map((r) => (r === 1 ? 'missed' : 'right')).join(', ')}`}>
    {ratings.map((r, i) => (
      <span key={i} className={`h-2 w-2 rounded-full ${r === 1 ? 'bg-again' : 'bg-good'}`} />
    ))}
  </span>
)
