import { Check, ChevronLeft, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { check, settled, type Verdict } from '../lib/answer'
import { db, type TestRow } from '../lib/db'
import { answerOf, kindOf, mediaUrl, regionLabel, type DeckCard } from '../lib/deck'
import { restoreFocus, trapTab } from '../lib/focus'
import fame from '../data/fame.json'
import world from '../data/world.json'
import { NESTED, regionShort, WHOLE } from '../lib/insights'
import { copyResult, shareResult } from '../lib/share'
import { attempts, beats, bestOf, OFFICIAL, saveTest, testDef, TEST_TYPES, type TestDef, type TestType } from '../lib/tests'
import type { FindHandle, FindResult, View as MapView } from '../lib/find/engine'
import { Heading } from './Insights'
import { FindSub } from './FindCard'
import { FindMap, loadFindMap } from './FindMap'
import { Outline } from './Outline'
import { loadOutlines } from '../lib/outlines'

type Answer = { card: DeckCard; verdict: Verdict; typed: string }
type Run = { def: TestDef; order: DeckCard[]; started: number }
type View =
  | { at: 'home' }
  | { at: 'intro'; key: string }
  | { at: 'run'; run: Run }
  | { at: 'done'; def: TestDef; row: TestRow; prior: TestRow[]; answers: Answer[] }

/** Before there's a test of your own to go by, about this long a card; and never less than MIN_PER_CARD, whatever a rushed test says. */
const PER_CARD = 5000
const MIN_PER_CARD = 2000
/** Images of the next few cards load ahead, so each one shows the moment it's reached. */
const AHEAD = 3
/** A right answer that could still grow into another name (Niger, Nigeria) moves on once typing stops this long. */
const PAUSE_MS = 700
/** Keys this soon after a card moves on by itself are the end of its answer typed on, not the start of the next. */
const SPILL_MS = 250
const TOKEN = 'atlas-test'

const pad = (n: number) => String(n).padStart(2, '0')
/** 9:42, or 1:02:05 past an hour. */
export const clock = (ms: number) => {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  return h ? `${h}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`
}
/** Rounded, except that any miss keeps it under 100% (204/205 is 99%), as on the shared image. */
const percent = (r: { right: number; total: number }) => (r.right === r.total ? 100 : Math.min(99, Math.round((r.right / r.total) * 100)))
const DATE = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })

const shuffle = <T,>(a: T[]) => {
  const out = [...a]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** What a card asks about, in words: "France" for its capital, "Paris" for its country, the place for a flag or map. */
const askedAbout = (c: DeckCard) => (c.type === 'country' ? c.note.capital : c.note.country)

type Props = {
  /** Open straight at this test's start, rather than the list of tests. */
  initial?: string
  onClose: () => void
  /** Each answer, as it's given: it counts as a review. */
  onAnswer: (card: DeckCard, verdict: Verdict) => void
}

/** Timed tests over every country in the world, and any region for practice: typed, or clicked on a map. Each answer is a review too. */
export default function Test({ initial, onClose, onAnswer }: Props) {
  const [view, setView] = useState<View>(initial ? { at: 'intro', key: initial } : { at: 'home' })
  const [all, setAll] = useState<TestRow[] | null>(null)
  const [quitting, setQuitting] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  /**
   * A phone only opens its keyboard for a box focused during the tap itself, and the answer box doesn't exist until
   * after it. So the tap focuses this one, which brings the keyboard up, and the answer box takes over from it.
   */
  const primer = useRef<HTMLInputElement>(null)
  const opener = useRef<Element | null>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  // Every test taken, read again whenever the list or a test's start is shown, so a result just saved is in it.
  useEffect(() => {
    if (view.at !== 'home' && view.at !== 'intro') return
    let live = true
    db.tests
      .toArray()
      .then((rows) => live && setAll(rows))
      .catch(() => live && setAll([]))
    return () => {
      live = false
    }
  }, [view.at])

  const close = () => {
    if (history.state?.atlasTest === TOKEN) return history.back()
    restoreFocus(opener.current, dialogRef.current)
    onCloseRef.current()
  }
  const closeRef = useRef(close)
  closeRef.current = close

  // One step back: a test under way asks first; its result or start goes back to the list (or out, if opened at it).
  const back = () => {
    if (view.at === 'run') return setQuitting((q) => !q)
    if (view.at === 'home' || (view.at === 'intro' && initial === view.key)) return close()
    setView({ at: 'home' })
  }
  const backRef = useRef(back)
  backRef.current = back

  // The phone's back gesture steps back too, rather than leaving the app, and never drops a test under way.
  useEffect(() => {
    opener.current ??= document.activeElement
    if (history.state?.atlasTest !== TOKEN) history.pushState({ ...history.state, atlasTest: TOKEN }, '')
    const onPop = () => {
      restoreFocus(opener.current, dialogRef.current)
      onCloseRef.current()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') return trapTab(e, dialogRef.current)
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      backRef.current()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [])

  const byTest = useMemo(() => {
    const m = new Map<string, TestRow[]>()
    for (const r of [...(all ?? [])].sort((a, b) => a.finished - b.finished)) m.set(r.test, [...(m.get(r.test) ?? []), r])
    return m
  }, [all])
  /** Your own pace so far, for how long a test will take. */
  const perCard = useMemo(() => {
    const done = all ?? []
    const cards = done.reduce((n, r) => n + r.total, 0)
    return cards >= 20 ? Math.max(MIN_PER_CARD, done.reduce((n, r) => n + r.ms, 0) / cards) : PER_CARD
  }, [all])

  const start = (def: TestDef) => {
    if (def.type !== 'find') primer.current?.focus({ preventScroll: true })
    setQuitting(false)
    setView({ at: 'run', run: { def, order: shuffle(def.cards), started: Date.now() } })
  }
  const finish = async (run: Run, answers: Answer[]) => {
    // A test left open past a day isn't kept as taking that long (and the server wouldn't take it).
    const ms = Math.min(Date.now() - run.started, 86_400_000)
    const prior = await attempts(run.def.key).catch(() => [] as TestRow[])
    const missed = answers.filter((a) => a.verdict === 'wrong').map((a) => ({ id: a.card.id, typed: a.typed.slice(0, 80) }))
    const row: TestRow = { id: crypto.randomUUID(), test: run.def.key, finished: Date.now(), ms, total: answers.length, right: answers.length - missed.length, missed }
    // Shown whether or not it could be kept.
    await saveTest(row).catch(() => {})
    setView({ at: 'done', def: run.def, row, prior, answers })
  }

  let body: React.ReactNode
  if (view.at === 'home') body = <Home byTest={byTest} perCard={perCard} onPick={(key) => setView({ at: 'intro', key })} />
  else if (view.at === 'intro') {
    const def = testDef(view.key)
    body = def ? <Intro def={def} rows={byTest.get(def.key) ?? []} perCard={perCard} onStart={() => start(def)} /> : null
  } else if (view.at === 'run') {
    // Finding places is clicking on a map, not typing: a runner of its own, with the same bar, clock and quitting.
    const R = view.run.def.type === 'find' ? FindRunner : Runner
    body = (
      <R
        key={view.run.started}
        run={view.run}
        quitting={quitting}
        onAsk={() => setQuitting(true)}
        onQuit={(q) => (q ? setView({ at: 'intro', key: view.run.def.key }) : setQuitting(false))}
        onAnswer={onAnswer}
        onFinish={finish}
      />
    )
  } else body = <Result {...view} onAgain={() => start(view.def)} onDone={() => (initial === view.def.key ? close() : setView({ at: 'home' }))} />

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-page/90 pad-safe"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onPointerDown={(e) => e.target === e.currentTarget && view.at !== 'run' && close()}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Tests"
        tabIndex={-1}
        className="card-shadow relative flex h-full w-[min(720px,100%)] flex-col overflow-hidden rounded-3xl bg-surface outline-none sm:h-[min(820px,100%)]"
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      >
        {/* Back and close stay put above what scrolls. A test under way has its own bar, with the clock. */}
        {view.at !== 'run' && (
          <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-5 sm:h-16 sm:px-8">
            {view.at === 'intro' ? <Back onClick={back} /> : view.at === 'home' ? <Title>Tests</Title> : <span />}
            <button
              onClick={close}
              aria-label="Close (Esc)"
              title="Close (Esc)"
              className="-mr-1.5 flex h-9 w-9 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-muted hover:text-ink"
            >
              <X size={17} strokeWidth={1.75} />
            </button>
          </div>
        )}
        <input ref={primer} aria-hidden tabIndex={-1} className="pointer-events-none fixed left-0 top-0 h-px w-px text-[16px] opacity-0" />
        {/* Opaque, so the browser can scroll it on the GPU and keep text sharp; see-through, it's redrawn on every frame of a scroll on a Windows screen. */}
        <div
          className={`min-h-0 flex-1 overflow-y-auto overscroll-contain bg-surface px-5 pb-6 [scrollbar-width:none] sm:px-8 sm:pb-8 [&::-webkit-scrollbar]:hidden ${view.at === 'run' ? 'pt-5 sm:pt-7' : 'pt-0'}`}
        >
          {body}
        </div>
      </motion.div>
    </motion.div>
  )
}

const Back = ({ onClick, label = 'Back' }: { onClick: () => void; label?: string }) => (
  <button data-back onClick={onClick} className="-ml-1.5 flex h-8 items-center gap-0.5 rounded-full pl-0.5 pr-2.5 text-[12.5px] text-ink-3 transition-colors hover:bg-muted hover:text-ink">
    <ChevronLeft size={16} strokeWidth={1.75} /> {label}
  </button>
)

const Title = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-balance text-[22px] font-semibold leading-[1.15] tracking-[-0.025em] text-ink sm:text-[24px]">{children}</h2>
)

const WORLD = world as unknown as {
  width: number
  height: number
  shapes: Record<string, string>
  rest: string
  /** Region index, label point x/y and size (side of a square of the same area), in map units. */
  places: Record<string, [number, number, number, number]>
  /** Oceania's places east of 180°, redrawn past the right edge: path and label point. */
  wrap: Record<string, [string, number, number]>
  regions: { name: string; view: Box }[]
}
/** Part of the map: x, y, width and height, in map units. */
type Box = [number, number, number, number]
/** All the land there is, the deck's places and the rest, as one path. */
const LAND = WORLD.rest + Object.values(WORLD.shapes).join('') + Object.values(WORLD.wrap).map((w) => w[0]).join('')
const FAME = new Map((fame as { id: string }[]).map((p, i) => [p.id, i]))
/** Best known first, so a preview shows flags and places anyone would recognise. */
const famous = (cards: DeckCard[]) => [...cards].sort((a, b) => (FAME.get(a.note.id) ?? FAME.size) - (FAME.get(b.note.id) ?? FAME.size))
/** Where a place sits, east of 180° on the right-hand side where it's redrawn: x, y and size. */
const spot = (id: string): [number, number, number] => {
  const [, x, y, size] = WORLD.places[id] ?? [0, 0, 0, 0]
  const w = WORLD.wrap[id]
  return w ? [w[1], w[2], size] : [x, y, size]
}
const shapeOf = (id: string) => WORLD.wrap[id]?.[0] ?? WORLD.shapes[id] ?? ''
const PREVIEW = 16 / 10

/** The part of the world a test covers: the whole map, a continent's own framing, or the box round its places. */
function viewOf(def: TestDef, aspect: number): Box {
  const region = def.key.split(':')[0]
  if (region === 'world' || region === WHOLE) return [0, 0, WORLD.width, WORLD.height]
  const own = WORLD.regions.find((r) => r.name === regionLabel(region))
  let [x0, y0, x1, y1] = own ? [own.view[0], own.view[1], own.view[0] + own.view[2], own.view[1] + own.view[3]] : [Infinity, Infinity, -Infinity, -Infinity]
  if (!own)
    for (const c of def.cards) {
      if (!WORLD.places[c.note.id]) continue
      const [x, y, s] = spot(c.note.id)
      ;[x0, y0, x1, y1] = [Math.min(x0, x - s / 2), Math.min(y0, y - s / 2), Math.max(x1, x + s / 2), Math.max(y1, y + s / 2)]
    }
  // Seas aren't on the land map at all: show the whole of it.
  if (x0 === Infinity) return [0, 0, WORLD.width, WORLD.height]
  // Some room round the edge, never so close in that a small region is all sea, then widened or deepened to fit.
  const pad = Math.max(x1 - x0, y1 - y0) * 0.12
  let [w, h] = [Math.max(x1 - x0 + 2 * pad, 90), Math.max(y1 - y0 + 2 * pad, 90 / aspect)]
  if (w / h < aspect) w = h * aspect
  else h = w / aspect
  return [(x0 + x1) / 2 - w / 2, (y0 + y1) / 2 - h / 2, w, h]
}

const DESCRIBE: Record<TestType, string> = {
  flag: 'Name the country from its flag',
  map: 'Name the place shown on the map',
  capital: 'Name the capital of each country',
  country: 'Name the country from its capital',
  outline: 'Name the place from its outline',
  find: 'Click each place on a blank map',
}
const KIND: Record<TestType, string> = { flag: 'Flags', map: 'Map', capital: 'Capitals', country: 'Countries', outline: 'Outlines', find: 'Find' }

/**
 * A picture of what a test asks, from the test's own places: well-known flags; the region's map with one place
 * picked out; its capitals as dots on the land; or the capitals' names. No icons standing in for any of it.
 */
function Preview({ def, className = '' }: { def: TestDef; className?: string }) {
  const view = useMemo(() => viewOf(def, PREVIEW), [def])
  const ids = useMemo(() => def.cards.map((c) => c.note.id), [def])
  const box = `relative overflow-hidden bg-subtle ${className}`
  if (def.type === 'flag') {
    // As near square a block of flags as fits the frame (up to 6 by 4), any short last row centred.
    const cols = Math.min(6, Math.max(3, Math.ceil(Math.sqrt(Math.min(def.cards.length, 24) * 1.07))))
    const shown = famous(def.cards).slice(0, Math.min(24, cols * Math.ceil(24 / cols)))
    return (
      <div className={`${box} flex items-center justify-center px-[8%] py-[6%]`} aria-hidden>
        <div className="flex w-full flex-wrap justify-center gap-y-[5%]">
          {shown.map((c) => (
            <span key={c.id} className="flex aspect-[3/2] items-center justify-center px-[2.5%]" style={{ width: `${100 / cols}%` }}>
              <img src={mediaUrl(c.note.flag!)} alt="" draggable={false} loading="lazy" className="max-h-full max-w-full rounded-[2px] shadow-[0_0_0_0.5px_var(--color-edge-strong)]" />
            </span>
          ))}
        </div>
      </div>
    )
  }
  if (def.type === 'outline')
    // A grid of well-known shapes, in a quiet grey.
    return (
      <div className={`${box} flex items-center justify-center px-[9%] py-[7%]`} aria-hidden>
        <div className="grid h-full w-full grid-cols-5 grid-rows-3 gap-x-[9%] gap-y-[14%]">
          {famous(def.cards)
            .slice(0, 15)
            .map((c) => (
              <Outline key={c.id} id={c.note.id} className="h-full w-full min-w-0 [&_path]:fill-ink-3" />
            ))}
        </div>
      </div>
    )
  if (def.type === 'country')
    return (
      <div className={`${box} p-[6%]`} aria-hidden>
        <p className="flex flex-wrap gap-x-[1em] text-[11.5px] leading-[1.65] text-ink-3 [mask-image:linear-gradient(#000_55%,transparent)]">
          {/* England's capital is the UK's too: each name once. */}
          {[...new Set(famous(def.cards).map((c) => c.note.capital.split(',')[0]))].map((name, i) => (
            <span key={name} className={`whitespace-nowrap ${i % 7 === 2 ? 'text-ink-2' : ''}`}>
              {name}
            </span>
          ))}
        </p>
      </div>
    )
  const stroke = view[2] / 900
  const pick = def.type === 'map' || def.type === 'find' ? famous(def.cards).find((c) => WORLD.places[c.note.id])?.note.id : null
  return (
    <div className={box} aria-hidden>
      <svg viewBox={view.join(' ')} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full">
        <path d={LAND} fill="var(--color-muted-2)" fillRule="evenodd" opacity={def.type === 'capital' ? 0.6 : 1} />
        {def.type === 'map' && (
          <>
            <path d={ids.map(shapeOf).join('')} fill="var(--color-ink-3)" opacity={0.55} stroke="var(--color-subtle)" strokeWidth={stroke} />
            {pick && <path d={shapeOf(pick)} fill="var(--color-ink)" />}
          </>
        )}
        {/* A find test: the place picked out in green, as if just found, ringed if it's too small to see. */}
        {def.type === 'find' && pick && (
          <>
            <path d={shapeOf(pick)} fill="var(--color-good)" />
            {spot(pick)[2] < view[2] * 0.04 && <circle cx={spot(pick)[0]} cy={spot(pick)[1]} r={view[2] * 0.035} fill="none" stroke="var(--color-good)" strokeWidth={view[2] / 260} />}
          </>
        )}
        {def.type === 'capital' &&
          ids.map((id) => {
            const [x, y] = spot(id)
            return <circle key={id} cx={x} cy={y} r={view[2] * 0.0075} fill="var(--color-ink-2)" />
          })}
      </svg>
    </div>
  )
}

/** Every continent, its smaller regions under it once it's picked, and the seas; the world first. */
const SCOPES = [{ id: 'world', label: 'World' }, ...NESTED.map((n) => ({ id: n.region, label: regionShort(n.region) })), { id: 'Oceans+Seas', label: 'Seas' }]
const SCOPE_KEY = 'atlas.testScope'
const savedScope = () => {
  try {
    const s = localStorage.getItem(SCOPE_KEY)
    return s && (SCOPES.some((x) => x.id === s) || NESTED.some((n) => n.within.includes(s))) ? s : 'world'
  } catch {
    return 'world'
  }
}

/** A test as a card: its picture, what it asks, and your best at it (or how long it takes). */
/** A test's tile. An odd one out at the end spans the row, its picture lined up with the column above and the words beside it. */
const Tile = ({ def, rows, perCard, wide, onClick }: { def: TestDef; rows: TestRow[]; perCard: number; wide?: boolean; onClick: () => void }) => {
  const b = bestOf(rows)
  return (
    <li className={wide ? 'col-span-2' : ''}>
      <button
        onClick={onClick}
        className={`group flex h-full w-full rounded-2xl border border-line p-2 text-left transition-colors hover:border-edge-strong hover:bg-subtle ${wide ? 'flex-row' : 'flex-col'}`}
      >
        <Preview def={def} className={`aspect-[16/10] shrink-0 rounded-xl transition-colors group-hover:bg-muted ${wide ? 'w-[calc(50%-13px)] sm:w-[calc(50%-14px)]' : 'w-full'}`} />
        <span className={`flex flex-1 flex-col ${wide ? 'min-w-0 px-1.5 pb-1 pl-[22px] pt-1.5 sm:pl-6' : 'px-1.5 pb-1 pt-2.5'}`}>
          <span className="text-[14px] font-medium leading-snug text-ink">{KIND[def.type]}</span>
          <span className="mt-0.5 text-balance text-[12.5px] leading-snug text-ink-3">{DESCRIBE[def.type]}</span>
          <span className="mt-auto pt-2.5 text-[12.5px] tabular-nums">
            {b ? (
              <>
                <span className="text-ink-3">Best </span>
                <span className="font-medium text-ink">
                  {b.right}/{b.total}
                </span>
                <span className="text-ink-3"> · {clock(b.ms)}</span>
              </>
            ) : (
              <span className="text-ink-3">
                {def.cards.length} cards · {minutes(def.cards.length, perCard)} min
              </span>
            )}
          </span>
        </span>
      </button>
    </li>
  )
}

const minutes = (n: number, perCard: number) => Math.max(1, Math.round((n * perCard) / 60_000))

/** Where, then which test: the world's are the same for everyone; a region's are for practice. */
function Home({ byTest, perCard, onPick }: { byTest: Map<string, TestRow[]>; perCard: number; onPick: (key: string) => void }) {
  const [scope, setScope] = useState(savedScope)
  const choose = (s: string) => {
    setScope(s)
    try {
      localStorage.setItem(SCOPE_KEY, s)
    } catch {
      // Remembered for this visit only.
    }
  }
  const family = NESTED.find((n) => n.region === scope || n.within.includes(scope))
  const defs = useMemo(
    () => (scope === 'world' ? OFFICIAL : TEST_TYPES.flatMap((t) => testDef(`${scope}:${t}`) ?? []).filter((d) => d.cards.length >= 5)),
    [scope],
  )
  const chip = (on: boolean) =>
    `shrink-0 whitespace-nowrap rounded-full px-3.5 text-[13px] transition-colors ${on ? 'bg-ink font-medium text-on-ink' : 'text-ink-2 hover:bg-muted hover:text-ink'}`
  return (
    <div>
      <div role="tablist" aria-label="Where" className="-mx-5 flex gap-1 overflow-x-auto px-5 [scrollbar-width:none] sm:-mx-8 sm:px-8 [&::-webkit-scrollbar]:hidden">
        {SCOPES.map((s) => {
          const on = s.id === scope || s.id === family?.region
          return (
            <button key={s.id} role="tab" aria-selected={on} onClick={() => choose(s.id)} className={`h-8 pointer-coarse:h-9 ${chip(on)}`}>
              {s.label}
            </button>
          )
        })}
      </div>
      {family && family.within.length > 0 && (
        <div role="tablist" aria-label="Region" className="mt-2 flex flex-wrap gap-1">
          {[family.region, ...family.within].map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={r === scope}
              onClick={() => choose(r)}
              className={`h-7 rounded-full px-3 text-[12.5px] transition-colors pointer-coarse:h-8 ${r === scope ? 'bg-muted font-medium text-ink' : 'text-ink-3 hover:text-ink'}`}
            >
              {r === family.region ? `All of ${regionShort(r)}` : regionShort(r)}
            </button>
          ))}
        </div>
      )}
      <p className="mt-3 text-[12.5px] text-ink-3">
        {scope === 'world' ? 'The same countries for everyone, so scores compare.' : scope === 'Oceans+Seas' ? 'For practice.' : 'For practice, with territories included.'}
      </p>
      <ul className="mt-4 grid grid-cols-2 gap-2.5 sm:gap-3">
        {defs.map((d, i) => (
          <Tile key={d.key} def={d} rows={byTest.get(d.key) ?? []} perCard={perCard} wide={i === defs.length - 1 && defs.length % 2 === 1} onClick={() => onPick(d.key)} />
        ))}
      </ul>
    </div>
  )
}

/** A test before it starts: what it covers, your history at it, and the rules. */
function Intro({ def, rows, perCard, onStart }: { def: TestDef; rows: TestRow[]; perCard: number; onStart: () => void }) {
  const n = def.cards.length
  useEffect(() => {
    if (def.type === 'find') void loadFindMap().catch(() => {})
    if (def.type === 'outline') void loadOutlines().catch(() => {})
  }, [def.type])
  return (
    <div className="flex min-h-full flex-col">
      <Preview def={def} className="aspect-[16/9] w-full rounded-2xl" />
      <div className="mt-5">
        <Title>{def.name}</Title>
      </div>
      <p className="mt-1.5 text-[14px] text-ink-2">{DESCRIBE[def.type]}</p>
      <p className="mt-0.5 text-[13px] tabular-nums text-ink-3">
        {n} cards · about {minutes(n, perCard)} min{def.official ? ' · the same for everyone' : ''}
      </p>
      {rows.length > 0 && (
        <div className="mt-6">
          <History rows={rows} />
        </div>
      )}
      <p className="mt-6 max-w-[48ch] text-[13px] leading-relaxed text-ink-3">
        {def.type === 'find'
          ? 'One click for each place, at any zoom: drag to move around the map, and scroll or pinch to zoom in. A right one moves on by itself; a wrong one shows where it really is, and Enter moves on. Enter on its own skips. The clock starts with the first place, and every answer counts as a review.'
          : "A right answer moves on as soon as it's typed. Enter gives anything else, and small spelling slips still count; Enter on its own skips. The clock starts with the first card, and every answer counts as a review."}
      </p>
      <div className="mt-auto pt-8">
        <button
          autoFocus
          onClick={onStart}
          className="h-11 w-full rounded-full bg-ink text-[14px] font-medium text-on-ink transition-opacity hover:opacity-90 pointer-coarse:h-12"
        >
          {rows.length ? 'Start again' : 'Start'}
        </button>
      </div>
    </div>
  )
}


const Label = ({ children }: { children: React.ReactNode }) => <div className="text-[14px] text-ink-3">{children}</div>
const Big = ({ children }: { children: React.ReactNode }) => (
  <div className="text-balance text-[clamp(26px,4.6vw,38px)] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">{children}</div>
)

/** The question side of a card, without hints: the same for everyone. */
function Prompt({ card }: { card: DeckCard }) {
  const n = card.note
  switch (card.type) {
    case 'flag':
      return (
        <img
          src={mediaUrl(n.flag!)}
          alt="Flag"
          draggable={false}
          className={`max-h-[min(190px,24dvh)] max-w-[min(300px,70vw)] ${n.flag!.includes('-nobox') ? '' : 'img-shadow rounded-[3px]'}`}
        />
      )
    case 'map':
      return <img src={mediaUrl(n.map!)} alt="Map" draggable={false} className="img-shadow img-dim max-h-[min(300px,30dvh)] w-auto max-w-[min(420px,76vw)] rounded-xl sm:max-h-[min(300px,34dvh)]" />
    case 'outline':
      return <Outline id={n.id} label="Outline" className="h-[min(220px,26dvh)] w-[min(340px,74vw)]" />
    case 'capital':
      return (
        <>
          <Label>Capital of</Label>
          <Big>{n.country}</Big>
        </>
      )
    case 'country':
      return (
        <>
          <Label>Capital</Label>
          <Big>{n.capital}</Big>
        </>
      )
  }
}

/** The card just answered, under the box: what it was, and what you wrote when that wasn't quite it. */
const Last = ({ a }: { a: Answer }) => {
  const asked = a.card.type === 'capital' || a.card.type === 'country' ? askedAbout(a.card) : null
  const Icon = a.verdict === 'wrong' ? X : Check
  return (
    // Wraps rather than cuts off, so a long name on a phone still ends with what you wrote.
    <span className="max-w-full text-balance text-center text-[13px] leading-snug text-ink-3">
      <Icon size={14} strokeWidth={2.5} className={`mr-2 inline -translate-y-px ${a.verdict === 'right' ? 'text-good' : a.verdict === 'close' ? 'text-hard' : 'text-again'}`} aria-label={a.verdict === 'wrong' ? 'Wrong' : a.verdict === 'close' ? 'Misspelt' : 'Right'} />
      {asked && <>{asked} · </>}
      <span className="text-ink">{answerOf(a.card)}</span>
      {a.verdict !== 'right' && <> · {a.typed ? <>you wrote {a.verdict === 'wrong' ? <s>{a.typed}</s> : a.typed}</> : 'skipped'}</>}
    </span>
  )
}

type RunProps = {
  run: Run
  quitting: boolean
  /** Ask whether to quit. */
  onAsk: () => void
  /** The answer: quit, or keep going. */
  onQuit: (quit: boolean) => void
  onAnswer: (card: DeckCard, verdict: Verdict) => void
  onFinish: (run: Run, answers: Answer[]) => void
}

/** Quit, the test's name, how far through, the clock, and a bar filling up. */
function RunBar({ run, i, onAsk }: { run: Run; i: number; onAsk: () => void }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])
  const total = run.order.length
  return (
    <>
      <div className="flex items-center gap-3">
        <button
          onClick={onAsk}
          aria-label="Quit (Esc)"
          title="Quit (Esc)"
          className="-ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-muted hover:text-ink"
        >
          <X size={17} strokeWidth={1.75} />
        </button>
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{run.def.name}</span>
        <span className="shrink-0 text-[13px] tabular-nums text-ink-3">
          {Math.min(i + 1, total)} of {total}
        </span>
        <span className="w-14 shrink-0 text-right text-[15px] font-medium tabular-nums text-ink" aria-label="Time">
          {clock(now - run.started)}
        </span>
      </div>
      <div className="mt-3 h-1 shrink-0 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-ink transition-[width] duration-300 ease-out" style={{ width: `${(i / total) * 100}%` }} />
      </div>
    </>
  )
}

const QuitAsk = ({ answered, onQuit, className = '' }: { answered: number; onQuit: (quit: boolean) => void; className?: string }) => (
  <div className={`flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center ${className}`}>
    <div className="text-[18px] font-semibold tracking-[-0.02em] text-ink">Quit this test?</div>
    <p className="max-w-[36ch] text-balance text-[13.5px] text-ink-2">The {answered === 1 ? 'answer' : `${answered} answers`} so far still count as reviews, but no score is kept.</p>
    <div className="mt-4 flex gap-2">
      <button autoFocus onClick={() => onQuit(false)} className="rounded-full bg-ink px-5 py-2.5 text-[13.5px] font-medium text-on-ink transition-opacity hover:opacity-90">
        Keep going
      </button>
      <button onClick={() => onQuit(true)} className="rounded-full border border-line px-5 py-2.5 text-[13.5px] font-medium text-ink transition-colors hover:bg-subtle">
        Quit
      </button>
    </div>
  </div>
)

/** A test under way: one card at a time, typed, with the clock running. Answers count the moment they're given. */
function Runner({ run, quitting, onAsk, onQuit, onAnswer, onFinish }: RunProps) {
  const [answers, setAnswers] = useState<Answer[]>([])
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const moved = useRef(0)
  const i = answers.length
  const card = run.order[i]
  const total = run.order.length
  // The next few pictures load while this one's being answered.
  useEffect(() => {
    for (const c of run.order.slice(i + 1, i + 1 + AHEAD)) {
      const file = c.type === 'flag' ? c.note.flag : c.type === 'map' ? c.note.map : null
      if (file) new Image().src = mediaUrl(file)
    }
  }, [i, run.order])
  useEffect(() => {
    if (!quitting) input.current?.focus({ preventScroll: true })
  }, [quitting, i])

  const submit = () => {
    if (!card || done.current || quitting) return
    const typed = text.trim()
    const verdict: Verdict = typed ? check(typed, card) : 'wrong'
    const next = [...answers, { card, verdict, typed }]
    onAnswer(card, verdict)
    setAnswers(next)
    setText('')
    if (next.length === total) {
      done.current = true
      onFinish(run, next)
    }
  }

  // A right answer moves on by itself, so only a wrong or misspelt one needs Enter.
  useEffect(() => {
    const when = card && !quitting ? settled(text, card) : null
    if (when === 'now') {
      moved.current = Date.now()
      submit()
    }
    if (when !== 'soon') return
    const t = setTimeout(submit, PAUSE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, i, quitting])

  const kind = card ? kindOf(card.note) : 'sovereign'
  const placeholder = card?.type === 'capital' ? 'Type the capital' : kind === 'sea' || kind === 'continent' ? 'Type the name' : 'Type the country'
  const last = answers[answers.length - 1]
  return (
    <div className="flex min-h-full flex-col">
      <RunBar run={run} i={i} onAsk={onAsk} />

      {quitting ? (
        <QuitAsk answered={i} onQuit={onQuit} />
      ) : (
        card && (
          // On a phone the card and box sit high, clear of the keyboard; with room to spare they're centred.
          <div className="flex flex-1 flex-col items-center gap-5 pb-6 pt-8 sm:justify-center sm:pt-6 short:gap-3 short:py-3">
            <div
              className="flex min-h-[min(220px,26dvh)] w-full flex-col items-center justify-center gap-3 text-center sm:min-h-[min(240px,30dvh)]"
              onClick={() => input.current?.focus({ preventScroll: true })}
              data-test-card={card.id}
            >
              <Prompt card={card} />
            </div>
            <form
              className="flex w-[min(360px,100%)] flex-col items-center gap-3.5"
              onSubmit={(e) => {
                e.preventDefault()
                submit()
              }}
            >
              <div className="relative w-full">
                <input
                  ref={input}
                  value={text}
                  onChange={(e) => Date.now() - moved.current > SPILL_MS && setText(e.target.value)}
                  placeholder={placeholder}
                  aria-label="Your answer"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="words"
                  spellCheck={false}
                  enterKeyHint="next"
                  className="h-12 w-full select-text rounded-xl border border-line bg-subtle px-[4.5rem] text-center text-[18px] font-medium text-ink outline-none transition-colors placeholder:font-normal placeholder:text-ink-3 focus:border-ink-3 pointer-coarse:h-13"
                />
                <button
                  type="button"
                  onClick={submit}
                  className="absolute inset-y-1.5 right-1.5 flex items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] text-ink-3 transition-colors hover:bg-muted hover:text-ink"
                >
                  {text.trim() ? 'Submit' : 'Skip'}
                  <kbd className="pointer-coarse:hidden">↵</kbd>
                </button>
              </div>
              <div className="flex min-h-5 w-full justify-center" aria-live="polite">
                {last && <Last key={i} a={last} />}
              </div>
            </form>
          </div>
        )
      )}
    </div>
  )
}

/** How long a found place stays up, ticked, before the next: the same beat as in study. */
const FOUND_MS = 420

/**
 * A find test under way: each place's name over the blank map, one click to answer. A right one moves on by itself; a
 * wrong one (or a skip) shows where it was until Next. The map stays where it was left, from one place to the next.
 */
function FindRunner({ run, quitting, onAsk, onQuit, onAnswer, onFinish }: RunProps) {
  const [answers, setAnswers] = useState<Answer[]>([])
  const [result, setResult] = useState<FindResult | null>(null)
  const map = useRef<FindHandle | null>(null)
  const from = useRef<MapView | null>(null)
  const done = useRef(false)
  const i = answers.length
  const card = run.order[i]
  const total = run.order.length
  // A continent's test turns the map to face it; the world's and the seas' start in the middle.
  const face = useMemo(() => (run.def.key.startsWith('world:') || run.def.key.startsWith(WHOLE + ':') || run.def.key.startsWith('Oceans+Seas:') ? undefined : run.def.cards.map((c) => c.note.id)), [run.def])

  const next = (verdict: Verdict) => {
    if (!card || done.current) return
    from.current = map.current?.view() ?? from.current
    const typed = result?.kind === 'wrong' ? result.name : ''
    const all = [...answers, { card, verdict, typed }]
    onAnswer(card, verdict)
    setAnswers(all)
    setResult(null)
    if (all.length === total) {
      done.current = true
      onFinish(run, all)
    }
  }
  const nextRef = useRef(next)
  nextRef.current = next

  // Found: a beat to see the tick, then on.
  useEffect(() => {
    if (result?.kind !== 'right') return
    const t = setTimeout(() => nextRef.current('right'), FOUND_MS)
    return () => clearTimeout(t)
  }, [result])

  useEffect(() => {
    if (quitting) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      if (e.target instanceof HTMLElement && e.target.closest('button') && (e.key === 'Enter' || e.key === ' ')) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        if (!result) map.current?.reveal()
        else if (result.kind !== 'right') nextRef.current('wrong')
      } else if (e.key === '+' || e.key === '=') map.current?.zoom(2)
      else if (e.key === '-' || e.key === '_') map.current?.zoom(0.5)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [quitting, result])

  return (
    <div className="flex min-h-full flex-col">
      <RunBar run={run} i={i} onAsk={onAsk} />
      {card && (
        <div className="relative mt-5 flex min-h-[340px] flex-1 flex-col">
          <div className={`flex flex-1 flex-col ${quitting ? 'invisible' : ''}`}>
            <div className="flex shrink-0 flex-col items-center gap-1 pb-3 text-center" data-test-card={card.id}>
              <div className="max-w-full text-balance text-[clamp(24px,4vw,32px)] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">{card.note.country}</div>
              <FindSub card={card} result={result} />
            </div>
            <FindMap
              noteId={card.note.id}
              control={map}
              tries={1}
              from={from.current}
              face={face}
              escFits={false}
              onResult={setResult}
              onNext={() => result?.kind !== 'right' && next('wrong')}
              label={`World map. Click or tap ${card.note.country}.`}
              className="min-h-[240px] flex-1 rounded-2xl border border-line"
            />
            <div className="flex h-14 shrink-0 items-end justify-center">
              {!result ? (
                <button onClick={() => map.current?.reveal()} className="flex h-9 items-center gap-2 rounded-full pl-3.5 pr-2.5 text-[13px] text-ink-3 transition-colors hover:bg-muted hover:text-ink pointer-coarse:pr-3.5">
                  Skip <kbd className="pointer-coarse:hidden">↵</kbd>
                </button>
              ) : result.kind !== 'right' ? (
                // As in study: a quiet pill, not a call to action.
                <button
                  autoFocus
                  onClick={() => next('wrong')}
                  className="flex h-11 items-center gap-3 rounded-full bg-surface pl-[22px] pr-3.5 text-[14px] font-medium text-ink shadow-[0_0_0_1px_var(--color-edge),0_1px_2px_var(--color-drop)] transition-[box-shadow,background-color,transform] duration-100 hover:bg-subtle hover:shadow-[0_0_0_1px_var(--color-edge-strong),0_1px_2px_var(--color-drop)] active:scale-[0.98] pointer-coarse:pr-[22px]"
                >
                  Next <kbd className="pointer-coarse:hidden">↵</kbd>
                </button>
              ) : null}
            </div>
          </div>
          {quitting && <QuitAsk answered={i} onQuit={onQuit} className="absolute inset-0" />}
        </div>
      )}
    </div>
  )
}

/** Your scores at one test over time, best marked, with each attempt's date, score and time on pointing at it. */
function History({ rows, current }: { rows: TestRow[]; current?: string }) {
  const [sel, setSel] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const best = bestOf(rows)
  const shown = sel === null ? null : rows[sel]
  const H = 88
  const PAD = 8
  /** Room on the right for the scale's two labels, clear of the last (often best) dot. */
  const GUTTER = 40
  const plot = w - GUTTER
  const lo = Math.max(0, Math.min(80, Math.floor((Math.min(...rows.map(percent)) - 5) / 10) * 10))
  const x = (i: number) => (rows.length === 1 ? plot / 2 : PAD + (i * (plot - 2 * PAD)) / (rows.length - 1))
  const y = (p: number) => PAD + ((100 - p) / (100 - lo)) * (H - 2 * PAD)
  return (
    <div>
      <Heading aside={`${rows.length} ${rows.length === 1 ? 'attempt' : 'attempts'}`}>Your scores</Heading>
      <p className="mb-2 min-h-[1lh] text-[13px] tabular-nums text-ink-2" aria-live="polite">
        {shown ? (
          <>
            {DATE.format(new Date(shown.finished))} · <span className="font-medium text-ink">{shown.right}/{shown.total}</span> · {clock(shown.ms)}
          </>
        ) : (
          best && (
            <>
              Best <span className="font-medium text-ink">{best.right}/{best.total}</span> in {clock(best.ms)}, {DATE.format(new Date(best.finished))}
            </>
          )
        )}
      </p>
      <div ref={box} className="relative" onPointerLeave={() => setSel(null)}>
        {w > 0 && (
          <svg width={w} height={H} className="block overflow-visible" role="img" aria-label={`Scores: ${rows.map((r) => `${percent(r)}%`).join(', ')}`}>
            {[100, lo].map((p) => (
              <g key={p}>
                <line x1={0} x2={plot} y1={y(p)} y2={y(p)} stroke="var(--color-line)" />
                <text x={w} y={y(p)} textAnchor="end" dominantBaseline="middle" className="fill-ink-3 text-[10.5px] tabular-nums">
                  {p}%
                </text>
              </g>
            ))}
            {rows.length > 1 && (
              <polyline points={rows.map((r, i) => `${x(i)},${y(percent(r))}`).join(' ')} fill="none" stroke="var(--color-ink-3)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            )}
            {rows.map((r, i) => {
              const isBest = r === best
              const isNow = r.id === current
              return (
                <circle
                  key={r.id}
                  cx={x(i)}
                  cy={y(percent(r))}
                  r={isNow || sel === i ? 5.5 : 4}
                  fill={isBest ? 'var(--color-good)' : 'var(--color-surface)'}
                  stroke={isBest ? 'var(--color-surface)' : 'var(--color-ink-2)'}
                  strokeWidth={isBest ? 2 : 1.5}
                />
              )
            })}
            {rows.map((r, i) => (
              <rect
                key={r.id}
                x={rows.length === 1 ? 0 : x(i) - (plot - 2 * PAD) / (rows.length - 1) / 2}
                y={0}
                width={rows.length === 1 ? plot : (plot - 2 * PAD) / (rows.length - 1)}
                height={H}
                fill="transparent"
                onPointerEnter={() => setSel(i)}
                onPointerDown={() => setSel(i)}
              />
            ))}
          </svg>
        )}
      </div>
    </div>
  )
}

/** A thumbnail of what a missed card asked: its flag or map, or the name it gave. */
const MissThumb = ({ card }: { card: DeckCard }) => {
  if (card.type === 'outline')
    return (
      <span className="flex h-7 w-10 shrink-0 items-center justify-center">
        <Outline id={card.note.id} className="h-6 w-10 [&_path]:fill-ink-2" />
      </span>
    )
  const file = card.type === 'flag' ? card.note.flag : card.type === 'map' || card.type === 'find' ? card.note.map : null
  if (!file) return null
  return (
    <span className="flex h-7 w-10 shrink-0 items-center justify-center">
      <img
        src={mediaUrl(file)}
        alt=""
        draggable={false}
        loading="lazy"
        className={`max-h-7 max-w-10 ${card.type === 'map' || card.type === 'find' ? 'img-dim rounded-[3px]' : file.includes('-nobox') ? '' : 'img-shadow rounded-[2px]'}`}
      />
    </span>
  )
}

/** The score and time, how it compares with before, a way to share it, and the ones missed. */
function Result({ def, row, prior, answers, onAgain, onDone }: { def: TestDef; row: TestRow; prior: TestRow[]; answers: Answer[]; onAgain: () => void; onDone: () => void }) {
  const before = bestOf(prior)
  const first = prior.length === 0
  const best = !first && beats(row, before)
  const missed = answers.filter((a) => a.verdict === 'wrong')
  const [shared, setShared] = useState<string | null>(null)
  const canCopy = typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write
  const input = () => ({ test: def, right: row.right, total: row.total, ms: row.ms, missed: new Set(row.missed.map((m) => m.id)), best, first, date: new Date(row.finished) })
  const share = async () => {
    const r = await shareResult(input()).catch(() => 'cancelled' as const)
    if (r === 'downloaded') setShared('Image saved')
  }
  const copy = async () => setShared((await copyResult(input()).catch(() => false)) ? 'Image copied' : "Couldn't copy the image")
  return (
    <div>
      <div className="text-[13.5px] text-ink-2">{def.name}</div>
      <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-1">
        <div className="text-[clamp(48px,11vw,64px)] font-semibold leading-none tracking-[-0.04em] text-ink tabular-nums">
          {row.right}
          <span className="text-ink-3">/{row.total}</span>
        </div>
        {(best || first) && (
          <span className={`mb-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ${best ? 'bg-good/12 text-good' : 'bg-muted text-ink-2'}`}>{best ? 'New best' : 'First attempt'}</span>
        )}
      </div>
      <p className="mt-2.5 text-[14px] tabular-nums text-ink-2">
        {percent(row)}% · {clock(row.ms)} · {(row.ms / row.total / 1000).toFixed(1)}s a card
      </p>
      {!first && !best && before && (
        <p className="mt-1 text-[13px] tabular-nums text-ink-3">
          Your best is {before.right}/{before.total} in {clock(before.ms)}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <button onClick={share} className="rounded-full bg-ink px-5 py-2.5 text-[13.5px] font-medium text-on-ink transition-opacity hover:opacity-90 pointer-coarse:py-3">
          Share
        </button>
        {canCopy && (
          <button onClick={copy} className="rounded-full border border-line px-4 py-2.5 text-[13.5px] font-medium text-ink transition-colors hover:bg-subtle pointer-coarse:hidden">
            Copy image
          </button>
        )}
        <button onClick={onAgain} className="rounded-full border border-line px-4 py-2.5 text-[13.5px] font-medium text-ink transition-colors hover:bg-subtle pointer-coarse:py-3">
          Try again
        </button>
        <button onClick={onDone} className="px-3 py-2.5 text-[13.5px] text-ink-3 transition-colors hover:text-ink">
          Done
        </button>
        {shared && <span className="text-[12.5px] text-ink-3">{shared}</span>}
      </div>

      {prior.length > 0 && (
        <div className="mt-8">
          <History rows={[...prior, row]} current={row.id} />
        </div>
      )}

      <div className="mt-8">
        <Heading aside={missed.length || undefined}>{missed.length ? 'Missed' : 'Nothing missed'}</Heading>
        {missed.length > 0 && (
          <ul className="divide-y divide-line">
            {missed.map((a) => (
              <li key={a.card.id} className="flex min-h-11 items-center gap-3 py-2 text-[13.5px]">
                <MissThumb card={a.card} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-ink">
                    {a.card.type === 'capital' || a.card.type === 'country' ? (
                      <>
                        <span className="text-ink-3">{askedAbout(a.card)} · </span>
                        {answerOf(a.card)}
                      </>
                    ) : (
                      answerOf(a.card)
                    )}
                  </span>
                  <span className="truncate text-[12px] text-ink-3">{a.typed ? a.card.type === 'find' ? <>Picked {a.typed}</> : <s>{a.typed}</s> : 'Skipped'}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
