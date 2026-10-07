import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { animate, motion, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import world from '../data/world.json'
import { db, type CardRow, type RevlogRow } from '../lib/db'
import { ALL_CARDS, answerOf, CARD_BY_ID, CARD_TYPES, kindOf, mediaUrl, NOTES, type CardType, type DeckCard, type Note } from '../lib/deck'
import { restoreFocus, trapTab } from '../lib/focus'
import { SET_WORD, byType, closest, days, forgetting, forgotten, placesStarted, regionShort, recallNow, sets, strength, studyTime, type DeckSet, type Slipping } from '../lib/insights'
import { CARDS_BY_NOTE, forecast, isMature, mastery, NOTE_BY_ID, search, type Mastery } from '../lib/progress'
import { Ahead, CountUp, Fill, Heading, Heatmap, Numbers, SetsGrid, Strength, TypeIcon, Types } from './Insights'
import { dayKey, formatInterval, LEARN_ALL_MAX, matchesFilters, State } from '../lib/scheduler'
import { useSettings } from '../lib/settings'
import { loadStreak } from '../lib/streak'
import { speak } from '../lib/tts'
import { isZoomed, zoom } from '../lib/zoom'
import { Zoomable } from './Zoom'
import { Say } from './Card'

type View = [number, number, number, number]
const WORLD = world as unknown as {
  width: number
  height: number
  shapes: Record<string, string>
  rest: string
  /** Region index, label point x/y and size (side of a square of the same area), in map units. */
  places: Record<string, [number, number, number, number]>
  /** Oceania's places east of 180°, redrawn past the right edge: path and label point. */
  wrap: Record<string, [string, number, number]>
  regions: { name: string; view: View }[]
}
const FULL: View = [0, 0, WORLD.width, WORLD.height]
const OCEANIA = WORLD.regions.findIndex((r) => r.name === 'Oceania')
const REGION_IDS = WORLD.regions.map((_, r) => Object.keys(WORLD.places).filter((id) => WORLD.places[id][0] === r))
/** Each region's land as one path, to tint on hover. */
const REGION_D = REGION_IDS.map((ids) => ids.map((id) => WORLD.shapes[id] ?? '').join(''))
/** Each region's places by name, for the keyboard. */
const REGION_NOTES = REGION_IDS.map((ids) => ids.flatMap((id) => NOTE_BY_ID.get(id) ?? []).sort((a, b) => a.country.localeCompare(b.country)))
/** Tapping the sea within this many map units of a place still picks its region. */
const NEAR = 30
/** Places drawn smaller than this many px across also get a dot; dot and tap-target radii, and the least gap between dots, in px. */
const DOT_BELOW = 9
const DOT_R = 4
const HIT_R = 11
const DOT_GAP = 14
const COUNTRIES = NOTES.filter((n) => kindOf(n) === 'sovereign')
const COUNTRY_IDS = new Set(COUNTRIES.map((n) => n.id))
/** Fill opacity of the good colour for each mastery step; step 0 is plain land. */
const SHADE = [0, 0.3, 0.5, 0.75, 1]
/** How many of the cards most likely forgotten are listed and drilled: the lowest, the ones most worth it. */
const LOWEST = 10
/** Marks the history entry pushed on open, so Back closes the page and closing pops it again. */
const TOKEN = Math.random().toString(36).slice(2)

const TYPE_WORD: Record<CardType, string> = { capital: 'capital', country: 'from its capital', flag: 'flag', map: 'on the map' }

/** "1h 34m", "12m". */
const duration = (ms: number) => {
  const m = Math.round(ms / 60_000)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${pad2(m % 60)}m`
}
const pad2 = (n: number) => String(n).padStart(2, '0')

/** Small flag beside a place's name, or an empty slot of the same size so names line up. */
const Thumb = ({ note, small }: { note: Note; small?: boolean }) => {
  const file = note.flagBack ?? note.flag
  return (
    <span className={`flex shrink-0 items-center justify-center ${small ? 'h-4 w-[22px]' : 'h-5 w-7'}`}>
      {file && (
        <img
          src={mediaUrl(file)}
          alt=""
          draggable={false}
          loading="lazy"
          className={`${small ? 'max-h-4 max-w-[22px]' : 'max-h-5 max-w-7'} ${file.includes('-nobox') ? '' : 'img-shadow rounded-[2px]'}`}
        />
      )}
    </span>
  )
}

/** One side of a card, small: the name, flag or map the question shows, or the answer. */
const Side = ({ card, back }: { card: DeckCard; back?: boolean }) => {
  const n = card.note
  const pic = back ? null : card.type === 'flag' ? n.flag : card.type === 'map' ? n.map : null
  if (pic)
    return (
      <img
        src={mediaUrl(pic)}
        alt={card.type === 'flag' ? 'Flag' : 'Map'}
        draggable={false}
        className={card.type === 'map' ? 'img-shadow img-dim w-full rounded-lg' : `max-h-20 max-w-full ${pic.includes('-nobox') ? '' : 'img-shadow rounded-[3px]'}`}
      />
    )
  return <div className="text-balance text-[15px] font-semibold leading-snug text-ink">{back ? answerOf(card) : card.type === 'country' ? n.capital : n.country}</div>
}

/** The card itself, question over answer, floating over the list beside its row. */
const Peek = ({ card, id, above }: { card: DeckCard; id: string; above: boolean }) => {
  const reduce = useReducedMotion()
  return (
    <motion.div
      id={id}
      initial={reduce ? false : { opacity: 0, y: above ? 4 : -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12 }}
      className={`pointer-events-none absolute left-10 z-20 w-56 rounded-2xl border border-line bg-surface p-3.5 shadow-xl ${above ? 'bottom-full mb-1' : 'top-full mt-1'}`}
    >
      <div className="mb-1.5 text-[11.5px] text-ink-3">{CARD_TYPES.find((t) => t.id === card.type)!.prompt}</div>
      <Side card={card} />
      <div className="my-3 border-t border-line" />
      <Side card={card} back />
    </motion.div>
  )
}

/**
 * The cards you've most likely forgotten, each with FSRS's chance you'd still get it right. Hovering one (tapping it on
 * a phone, or Enter) shows the card, question and answer, without leaving the page.
 */
function Forgotten({ items }: { items: Slipping[] }) {
  const [peek, setPeek] = useState<string | null>(null)
  const list = useRef<HTMLUListElement>(null)
  const mouse = useRef(false)
  // A tap anywhere else puts the card away.
  useEffect(() => {
    if (!peek) return
    const away = (e: PointerEvent) => !list.current?.contains(e.target as Node) && setPeek(null)
    window.addEventListener('pointerdown', away)
    return () => window.removeEventListener('pointerdown', away)
  }, [peek])
  return (
    <ul ref={list} className="-mx-2" onPointerLeave={(e) => e.pointerType === 'mouse' && setPeek(null)}>
      {items.map(({ card: c, recall }, i) => {
        const open = peek === c.id
        return (
          <li key={c.id} className="relative" onPointerEnter={(e) => e.pointerType === 'mouse' && setPeek(c.id)}>
            <button
              aria-expanded={open}
              aria-controls={open ? `peek-${i}` : undefined}
              onPointerDown={(e) => (mouse.current = e.pointerType === 'mouse')}
              // A mouse already shows the card by hovering; a tap or Enter toggles it.
              onClick={(e) => (e.detail === 0 || !mouse.current) && setPeek(open ? null : c.id)}
              onBlur={() => setPeek((p) => (p === c.id ? null : p))}
              className={`flex min-h-10 w-full cursor-default items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors ${open ? 'bg-subtle' : ''}`}
            >
              <Thumb note={c.note} />
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">
                {c.note.country}
                <span className="text-ink-3"> · {TYPE_WORD[c.type]}</span>
              </span>
              <span className="shrink-0 text-[12.5px] tabular-nums text-ink-2" aria-label={`${Math.floor(recall * 100)}% chance you'd get it right`}>
                {Math.floor(recall * 100)}%
              </span>
            </button>
            {open && <Peek card={c} id={`peek-${i}`} above={i >= items.length / 2} />}
          </li>
        )
      })}
    </ul>
  )
}

/** The sets nearest finished, each with the flags of the places still to start. */
function Closest({ items, onOpen }: { items: DeckSet[]; onOpen: (key: string) => void }) {
  return (
    <ul className="-mx-2">
      {items.map((s) => {
        return (
          <li key={s.key}>
            <button
              data-set={s.key}
              onClick={() => onOpen(s.key)}
              title={s.label}
              className="flex min-h-10 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-subtle dash:min-h-[clamp(2rem,4.4vh,2.5rem)] dash:py-1"
            >
              <span className="flex w-7 shrink-0 justify-center text-ink-3">
                <TypeIcon type={s.type} size={15} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">
                {regionShort(s.region)}
                <span className="text-ink-3"> · {SET_WORD[s.type]}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1 max-sm:hidden" aria-hidden>
                {s.left.slice(0, 3).map((c) => (
                  <Thumb key={c.id} note={c.note} small />
                ))}
              </span>
              <span className="w-12 shrink-0 text-right text-[12.5px] tabular-nums text-ink-3">{s.left.length} left</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

const Row = ({ id, onClick, children }: { id: string; onClick: () => void; children: React.ReactNode }) => (
  <li>
    <button data-note={id} onClick={onClick} className="flex min-h-10 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-subtle">
      {children}
    </button>
  </li>
)

function status(r: CardRow | undefined, now: Date) {
  if (!r || r.state === State.New) return { label: 'Unseen', cls: 'text-easy' }
  if (r.state === State.Learning || r.state === State.Relearning) return { label: 'Learning', cls: 'text-again' }
  if (isMature(r)) return { label: 'Mastered', cls: 'text-good' }
  const ms = +new Date(r.due) - +now
  return { label: ms > 0 ? `Due in ${formatInterval(ms)}` : 'Due now', cls: 'text-ink-2' }
}

const DATE = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
/** The day the last new card comes in, `days` days of study from today (today counts as the first). */
const finishDate = (days: number) => {
  const t = new Date()
  t.setDate(t.getDate() + Math.max(0, days - 1))
  return DATE.format(t)
}

/** Interpolates two view boxes of the same aspect as a zoom about a fixed point, so the motion reads as moving in, not sliding. */
function between(a: View, b: View, t: number): View {
  const w = a[2] * (b[2] / a[2]) ** t
  const s = a[2] === b[2] ? t : (w - a[2]) / (b[2] - a[2])
  const h = (w * WORLD.height) / WORLD.width
  return [a[0] + a[2] / 2 + (b[0] + b[2] / 2 - a[0] - a[2] / 2) * s - w / 2, a[1] + a[3] / 2 + (b[1] + b[3] / 2 - a[1] - a[3] / 2) * s - h / 2, w, h]
}

type Dot = { id: string; x: number; y: number }

/** Places too small to tap at this zoom, as dots nudged apart until each one can be tapped on its own. */
function dotsFor(region: number, px: number) {
  const dots: Dot[] = REGION_IDS[region].flatMap((id) => {
    const [, x, y, size] = WORLD.places[id]
    const w = region === OCEANIA ? WORLD.wrap[id] : undefined
    return size * px < DOT_BELOW ? [{ id, x: w ? w[1] : x, y: w ? w[2] : y }] : []
  })
  const min = DOT_GAP / px
  for (let k = 0; k < 60; k++) {
    let moved = false
    for (let i = 0; i < dots.length; i++)
      for (let j = i + 1; j < dots.length; j++) {
        const a = dots[i]
        const b = dots[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.hypot(dx, dy)
        if (d >= min) continue
        const [ux, uy] = d ? [dx / d, dy / d] : [Math.cos(i + j), Math.sin(i + j)]
        const push = (min - d) / 2
        a.x -= ux * push
        a.y -= uy * push
        b.x += ux * push
        b.y += uy * push
        moved = true
      }
    if (!moved) break
  }
  return dots
}

type MapProps = { levels: Map<string, Mastery>; region: number | null; onRegion: (r: number | null) => void; onPick: (id: string) => void }

/** The world by region; tap a region to zoom in, then a country to open it. */
function MasteryMap({ levels, region, onRegion, onPick }: MapProps) {
  const [hover, setHover] = useState<string | null>(null)
  const [hoverRegion, setHoverRegion] = useState<number | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const svgRef = useRef<SVGSVGElement>(null)
  const reduce = useReducedMotion()
  const start = region === null ? FULL : WORLD.regions[region].view
  const view = useRef<View>(start)
  const [initial] = useState(() => start.join(' '))
  const wrapped = region === OCEANIA
  const d = (id: string) => (wrapped && WORLD.wrap[id]?.[0]) || WORLD.shapes[id]

  useEffect(() => {
    const svg = svgRef.current!
    const ro = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }))
    ro.observe(svg)
    return () => ro.disconnect()
  }, [])

  // Glide the view box to the region, or back out to the world.
  useEffect(() => {
    const svg = svgRef.current!
    const from = view.current
    const to = region === null ? FULL : WORLD.regions[region].view
    const set = (v: View) => {
      view.current = v
      svg.setAttribute('viewBox', v.join(' '))
    }
    if (reduce || from.join() === to.join()) return set(to)
    const a = animate(0, 1, { duration: 0.6, ease: [0.4, 0, 0.2, 1], onUpdate: (t) => set(between(from, to, t)) })
    return () => a.stop()
  }, [region, reduce])

  const paths = useMemo(
    () =>
      Object.keys(WORLD.shapes).map((id) => {
        const l = levels.get(id)?.level ?? 0
        return (
          <path
            key={id}
            d={(wrapped && WORLD.wrap[id]?.[0]) || WORLD.shapes[id]}
            data-id={id}
            className={`cursor-pointer ${l ? 'fill-good' : 'fill-muted-2'}`}
            fillOpacity={l ? SHADE[l] : undefined}
          />
        )
      }),
    [levels, wrapped],
  )
  // Pixels per map unit: the drawing fits inside the box, so whichever side runs out first sets the scale.
  const px = region === null || !size.width ? 0 : Math.min(size.width / WORLD.regions[region].view[2], size.height / WORLD.regions[region].view[3])
  const dots = useMemo(() => (region === null || !px ? [] : dotsFor(region, px)), [region, px])

  const count = (ids: string[]) => {
    const own = ids.filter((id) => COUNTRY_IDS.has(id))
    return `${own.filter((id) => levels.get(id)?.level === 4).length} of ${own.length} countries mastered`
  }
  const mastered = COUNTRIES.filter((n) => levels.get(n.id)?.level === 4).length
  // How wide the world is drawn: the box's width, or less when its height runs out first, so the caption lines up with it.
  const drawn = size.height ? Math.min(size.width, (size.height * WORLD.width) / WORLD.height) : undefined
  const hovered = hover ? NOTE_BY_ID.get(hover) : null
  const m = hover ? levels.get(hover) : null
  const shown = region ?? hoverRegion
  const idOf = (e: React.SyntheticEvent) => (e.target as Element).getAttribute('data-id')

  // A hover or focus from the last view doesn't carry into the next.
  const [at, setAt] = useState(region)
  if (at !== region) {
    setAt(region)
    setHover(null)
    setHoverRegion(null)
  }

  /** The region under the pointer: the place it's on, or failing that the nearest one close by. */
  const regionAt = (e: React.PointerEvent | React.MouseEvent) => {
    const id = idOf(e)
    if (id && WORLD.places[id]) return WORLD.places[id][0]
    const ctm = svgRef.current?.getScreenCTM()
    if (!ctm) return null
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
    let best: number | null = null
    let bestD = NEAR
    for (const [r, x, y] of Object.values(WORLD.places)) {
      const dd = Math.hypot(x - p.x, y - p.y)
      if (dd < bestD) [best, bestD] = [r, dd]
    }
    return best
  }

  return (
    <section className="mt-5 [grid-area:map] dash:mt-0 dash:flex dash:min-h-0 dash:flex-col">
      <svg
        ref={svgRef}
        viewBox={initial}
        style={{ '--map-aspect': `${WORLD.width} / ${WORLD.height}`, cursor: region === null && hoverRegion !== null ? 'pointer' : undefined } as React.CSSProperties}
        // Full width on a phone; on a big screen, as big as the space left over allows.
        className="block h-auto w-full touch-manipulation stroke-surface [aspect-ratio:var(--map-aspect)] [stroke-width:0.6px] dash:min-h-0 dash:flex-1 dash:[aspect-ratio:auto] [&_circle]:[vector-effect:non-scaling-stroke] [&_path]:[vector-effect:non-scaling-stroke]"
        role="img"
        aria-label={
          region === null
            ? `World map: ${mastered} of ${COUNTRIES.length} countries mastered`
            : `Map of ${WORLD.regions[region].name}: ${count(REGION_IDS[region])}`
        }
        onPointerMove={(e) => {
          if (region === null) setHoverRegion(regionAt(e))
          else setHover(idOf(e))
        }}
        onPointerLeave={() => {
          setHover(null)
          setHoverRegion(null)
        }}
        onClick={(e) => {
          if (region === null) {
            const r = regionAt(e)
            if (r === null) return
            setHoverRegion(null)
            onRegion(r)
            return
          }
          const id = idOf(e)
          if (!id) return
          setHover(null)
          onPick(id)
        }}
      >
        <path d={WORLD.rest} className="fill-muted-2" />
        {paths}
        {region === null && hoverRegion !== null && <path d={REGION_D[hoverRegion]} className="pointer-events-none fill-ink stroke-none" fillOpacity={0.1} />}
        {hover && d(hover) && <path d={d(hover)} className="pointer-events-none fill-none stroke-ink [stroke-width:1px]" />}
        {region !== null && (
          <motion.g key={region} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: reduce ? 0 : 0.35, duration: 0.25 }}>
            {dots.map(({ id, x, y }) => {
              const l = levels.get(id)?.level ?? 0
              return (
                <g key={id}>
                  <circle
                    cx={x}
                    cy={y}
                    r={DOT_R / px}
                    className={`pointer-events-none ${hover === id ? 'stroke-ink [stroke-width:1px]' : 'stroke-ink-3 [stroke-width:0.75px]'} ${l ? 'fill-good' : 'fill-muted-2'}`}
                    fillOpacity={l ? SHADE[l] : undefined}
                  />
                  <circle cx={x} cy={y} r={HIT_R / px} data-id={id} className="cursor-pointer fill-transparent stroke-none" />
                </g>
              )
            })}
          </motion.g>
        )}
      </svg>
      <div className="mx-auto mt-2 flex w-full items-center justify-between gap-3 text-[12.5px] text-ink-3" style={{ maxWidth: drawn }}>
        <span className="flex min-w-0 items-center">
          {region !== null && (
            <button
              onClick={() => onRegion(null)}
              title="World (Esc)"
              className="relative mr-2 flex shrink-0 items-center text-ink-3 transition-colors after:absolute after:-inset-x-2 after:-inset-y-3 hover:text-ink"
            >
              <ChevronLeft size={15} strokeWidth={1.75} className="-ml-1" /> World
            </button>
          )}
          <span className="min-w-0 truncate">
            {hovered && m ? (
              <>
                <span className="text-ink-2">{hovered.country}</span> · {m.mature} of {m.total} cards mastered
              </>
            ) : shown !== null ? (
              <>
                <span className="text-ink-2">{WORLD.regions[shown].name}</span> · {count(REGION_IDS[shown])}
              </>
            ) : (
              `${mastered} of ${COUNTRIES.length} countries mastered`
            )}
          </span>
        </span>
        {/* On a phone the zoomed caption needs the room. */}
        <span className={`flex shrink-0 items-center gap-1 ${region !== null ? 'max-sm:hidden' : ''}`} aria-hidden>
          <span className="mr-0.5 max-sm:hidden">Less</span>
          {SHADE.map((o, l) => (
            <span key={l} className={`h-2.5 w-2.5 rounded-[3px] ${l ? 'bg-good' : 'bg-muted-2'}`} style={l ? { opacity: o } : undefined} />
          ))}
          <span className="ml-0.5 max-sm:hidden">More</span>
        </span>
      </div>
      {/* For the keyboard: a hidden button per region, then per place once zoomed in. Focus lights it up on the map, as hover does. */}
      <div className="sr-only">
        {region === null
          ? WORLD.regions.map((r, i) => (
              <button
                key={r.name}
                data-region={i}
                onClick={() => {
                  setHoverRegion(null)
                  onRegion(i)
                }}
                onFocus={() => setHoverRegion(i)}
                onBlur={() => setHoverRegion(null)}
              >
                {r.name}: {count(REGION_IDS[i])}
              </button>
            ))
          : REGION_NOTES[region].map((n) => (
              <button
                key={n.id}
                data-place={n.id}
                onClick={() => {
                  setHover(null)
                  onPick(n.id)
                }}
                onFocus={() => setHover(n.id)}
                onBlur={() => setHover(null)}
              >
                {n.country}: {levels.get(n.id)?.mature ?? 0} of {levels.get(n.id)?.total ?? 0} cards mastered
              </button>
            ))}
      </div>
    </section>
  )
}

function Detail({ note, rows, onBack }: { note: Note; rows: Map<string, CardRow>; onBack: () => void }) {
  const now = new Date()
  const flag = note.flagBack ?? note.flag
  const info = [note.countryInfo, note.capitalInfo].filter(Boolean).join(' ')
  return (
    <div>
      <button data-back onClick={onBack} className="-ml-1.5 flex h-8 items-center gap-0.5 rounded-full pl-0.5 pr-2.5 text-[12.5px] text-ink-3 transition-colors hover:bg-muted hover:text-ink">
        <ChevronLeft size={16} strokeWidth={1.75} /> Back
      </button>
      <div className="mt-2 flex flex-col items-center gap-3 text-center">
        {flag && (
          <Zoomable file={flag} alt={`Flag of ${note.country}`}>
            <button onClick={() => zoom({ file: flag, alt: `Flag of ${note.country}` })} tabIndex={-1} className="cursor-zoom-in">
              <img src={mediaUrl(flag)} alt={`Flag of ${note.country}`} draggable={false} className={`max-h-20 max-w-[140px] ${flag.includes('-nobox') ? '' : 'img-shadow rounded-[3px]'}`} />
            </button>
          </Zoomable>
        )}
        <div>
          <div className="text-balance text-[26px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink">
            <Say text={note.country} onSay={speak} big />
          </div>
          {note.capital && (
            <div className="mt-1 text-[15px] font-medium text-ink-2">
              <Say text={note.capital} onSay={speak} />
            </div>
          )}
        </div>
        {info && <p className="max-w-[40ch] text-balance text-[13px] leading-snug text-ink-3">{info}</p>}
        {note.map && (
          <Zoomable file={note.map} alt={`Map of ${note.country}`} className="mt-1 w-[min(320px,100%)]">
            <button onClick={() => zoom({ file: note.map!, alt: `Map of ${note.country}` })} tabIndex={-1} className="block w-full cursor-zoom-in">
              <img src={mediaUrl(note.map)} alt={`Map of ${note.country}`} draggable={false} className="img-shadow img-dim w-full rounded-xl" />
            </button>
          </Zoomable>
        )}
      </div>
      <ul className="mt-6 divide-y divide-line border-y border-line">
        {(CARDS_BY_NOTE.get(note.id) ?? []).map((c) => {
          const r = rows.get(c.id)
          const s = status(r, now)
          return (
            <li key={c.id} className="flex min-h-10 items-center justify-between gap-3 py-2 text-[13.5px]">
              <span className="text-ink-2">{CARD_TYPES.find((t) => t.id === c.type)?.label}</span>
              <span className="flex items-baseline gap-2">
                {r?.leech && <span className="text-[12px] text-again">Leech</span>}
                <span className={`font-medium tabular-nums ${s.cls}`}>{s.label}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * One set: how far along it is, the places not started yet (with a button to learn them), then the rest and where
 * each card stands. On a big screen it sits beside every set; on a phone it's a page of its own.
 */
function SetPane({ set, rows, onPick, onLearn }: { set: DeckSet; rows: Map<string, CardRow>; onPick: (n: Note) => void; onLearn: () => void }) {
  const now = new Date()
  const n = set.cards.length
  const left = new Set(set.left.map((c) => c.id))
  const started = set.cards.filter((c) => !left.has(c.id))
  const list = (cards: DeckCard[], showStatus: boolean) => (
    <ul className="-mx-2 grid grid-cols-1 dash:grid-cols-2 dash:gap-x-3">
      {cards.map((c) => {
        const st = status(rows.get(c.id), now)
        return (
          <Row key={c.id} id={c.note.id} onClick={() => onPick(c.note)}>
            <Thumb note={c.note} />
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">
              {c.note.country}
              {(c.type === 'capital' || c.type === 'country') && c.note.capital && <span className="text-ink-3"> · {c.note.capital}</span>}
            </span>
            {showStatus && <span className={`shrink-0 text-[12px] tabular-nums ${st.cls}`}>{st.label}</span>}
          </Row>
        )
      })}
    </ul>
  )
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 className="text-balance text-[22px] font-semibold leading-[1.15] tracking-[-0.025em] text-ink">{set.label}</h2>
          <p className="mt-1 text-[13.5px] tabular-nums text-ink-2">{set.done === n ? `All ${n} started` : `${set.done} of ${n} started`}</p>
        </div>
        {set.left.length > 0 && (
          <button
            onClick={onLearn}
            className="shrink-0 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-subtle pointer-coarse:py-3"
          >
            {set.left.length === 1 ? 'Learn the one left' : `Learn the ${set.left.length} left`}
          </button>
        )}
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-good" style={{ width: `${(set.done / n) * 100}%` }} />
      </div>
      {set.left.length > 0 && (
        <div className="mt-6">
          <Heading aside={set.left.length}>Not started</Heading>
          {list(set.left, false)}
        </div>
      )}
      {started.length > 0 && (
        <div className="mt-6">
          <Heading aside={started.length}>Started</Heading>
          {list(started, true)}
        </div>
      )}
    </div>
  )
}

/** On a big screen each smaller part of the page sits in its own tile around the map. */
const TILE = 'dash:rounded-2xl dash:border dash:border-line dash:p-[clamp(1rem,2.2vh,1.25rem)]'

const Back = ({ onClick }: { onClick: () => void }) => (
  <button data-back onClick={onClick} className="-ml-1.5 flex h-8 items-center gap-0.5 rounded-full pl-0.5 pr-2.5 text-[12.5px] text-ink-3 transition-colors hover:bg-muted hover:text-ink">
    <ChevronLeft size={16} strokeWidth={1.75} /> Back
  </button>
)

/** Drills the cards most likely forgotten, the lowest first. */
const ReviewSlipping = ({ count, lowest, onClick }: { count: number; lowest: number; onClick: () => void }) => (
  <button onClick={onClick} className="rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-subtle pointer-coarse:py-3">
    Review {count === 1 ? 'it' : count > lowest ? `the lowest ${lowest}` : 'these'} first
  </button>
)

/** True on a screen big enough for the progress page's wide layout: the same test as the `dash` variant in index.css. */
const DASH = '(min-width: 1100px) and (min-height: 700px)'
function useDash() {
  const [dash, setDash] = useState(() => matchMedia(DASH).matches)
  useEffect(() => {
    const q = matchMedia(DASH)
    const on = () => setDash(q.matches)
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])
  return dash
}

type Props = { onClose: () => void; onDrill: (ids: string[]) => void; onLearn: (ids: string[]) => void }

/** Search any place, see mastery on a world map, the streak, what's ahead, and the cards that keep slipping. */
export default function Progress({ onClose, onDrill, onLearn }: Props) {
  const settings = useSettings()
  const [rows, setRows] = useState<Map<string, CardRow> | null>(null)
  const [logs, setLogs] = useState<RevlogRow[] | null>(null)
  const [streak, setStreak] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [detail, setDetail] = useState<Note | null>(null)
  /** The set open, by key, and whether the page of every set is open beneath it. */
  const [openSet, setOpenSet] = useState<string | null>(null)
  const [allSets, setAllSets] = useState(false)
  /** On a big screen the sets page shows one set beside them all: the one picked there. */
  const [pick, setPick] = useState<string | null>(null)
  const dash = useDash()
  /** The cards most likely forgotten, on a page of their own: out of sight until asked for, so drilling them is still recall. */
  const [slipping, setSlipping] = useState(false)
  const [region, setRegion] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])
  /** What had focus before the page opened, to get it back on closing. */
  const opener = useRef<Element | null>(null)
  /** The last input was a key rather than a pointer. */
  const keyed = useRef(false)

  useEffect(() => {
    let live = true
    db.cards
      .toArray()
      .then((all) => live && setRows(new Map(all.map((r) => [r.id, r]))))
      .catch(() => live && setRows(new Map()))
    db.revlog
      .toArray()
      .then((all) => live && setLogs(all))
      .catch(() => live && setLogs([]))
    loadStreak()
      .then((n) => live && setStreak(n))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  // The phone's back gesture closes the page rather than leaving the app.
  useEffect(() => {
    if (history.state?.atlasProgress !== TOKEN) history.pushState({ ...history.state, atlasProgress: TOKEN }, '')
    const onPop = () => {
      restoreFocus(opener.current, dialogRef.current)
      onCloseRef.current()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const close = useCallback(() => {
    if (history.state?.atlasProgress === TOKEN) return history.back()
    restoreFocus(opener.current, dialogRef.current)
    onCloseRef.current()
  }, [])

  // Typing goes straight to search with a keyboard; on a phone the keyboard would cover the map, so wait for a tap.
  useEffect(() => {
    opener.current ??= document.activeElement
    if (matchMedia('(pointer: fine)').matches) inputRef.current?.focus()
    else dialogRef.current?.focus()
  }, [])

  // Escape steps back one level: detail, then the set, then search, then every set, then the zoomed region, then the page itself. Tab stays inside.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      keyed.current = true
      if (isZoomed()) return
      if (e.key === 'Tab') return trapTab(e, dialogRef.current)
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      e.preventDefault()
      if (detail) setDetail(null)
      else if (openSet) setOpenSet(null)
      else if (query) setQuery('')
      else if (allSets) setAllSets(false)
      else if (slipping) setSlipping(false)
      else if (region !== null) setRegion(null)
      else close()
    }
    const onPointer = () => (keyed.current = false)
    window.addEventListener('keydown', onKey, { capture: true })
    window.addEventListener('pointerdown', onPointer, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true })
      window.removeEventListener('pointerdown', onPointer, { capture: true })
    }
  }, [detail, openSet, allSets, slipping, query, region, close])

  // By keyboard, the control just used (a region, World, a place, Back) goes with the view it was in; focus moves to its counterpart.
  const was = useRef({ detail, region, openSet, allSets, slipping })
  useEffect(() => {
    const prev = was.current
    was.current = { detail, region, openSet, allSets, slipping }
    const box = dialogRef.current
    if (!keyed.current || !box || box.contains(document.activeElement)) return
    const id = prev.detail && CSS.escape(prev.detail.id)
    const sel = detail
      ? detail !== prev.detail && '[data-back]'
      : id
        ? `[data-place="${id}"], [data-note="${id}"]`
        : openSet !== prev.openSet
          ? openSet
            ? '[data-back]'
            : `[data-set="${CSS.escape(prev.openSet ?? '')}"]`
          : allSets !== prev.allSets
            ? allSets
              ? '[data-back]'
              : '[data-all-sets]'
            : slipping !== prev.slipping
              ? slipping
                ? '[data-back]'
                : '[data-show-slipping]'
              : region !== prev.region && (region === null ? `[data-region="${prev.region}"]` : '[data-place]')
    if (sel) (box.querySelector<HTMLElement>(sel) ?? box).focus({ preventScroll: true })
  }, [detail, region, openSet, allSets, slipping])

  const searching = query.trim() !== ''
  // Going back (from a place to its set, or to the page) picks up where you'd scrolled to; anywhere new starts at the top.
  const view = detail ? `place:${detail.id}` : openSet ? `set:${openSet}` : searching ? 'search' : allSets ? 'sets' : slipping ? 'slipping' : 'page'
  const depth = (detail ? 1 : 0) + (openSet ? 1 : 0) + (allSets ? 1 : 0) + (slipping ? 1 : 0)
  const scrolled = useRef(new Map<string, number>())
  const shown = useRef({ view, depth })
  useEffect(() => {
    const el = bodyRef.current
    const prev = shown.current
    shown.current = { view, depth }
    if (!el || prev.view === view) return
    const to = depth < prev.depth ? (scrolled.current.get(view) ?? 0) : 0
    // The charts size themselves a frame or two after they appear, so the page may not be tall enough yet.
    let frame = 0
    let tries = 0
    const go = () => {
      el.scrollTop = to
      if (Math.abs(el.scrollTop - to) > 1 && ++tries < 30) frame = requestAnimationFrame(go)
    }
    go()
    return () => cancelAnimationFrame(frame)
  }, [view, depth])

  const results = useMemo(() => search(query), [query])
  const levels = useMemo(() => rows && mastery(rows), [rows])
  const ahead = useMemo(() => {
    if (!rows) return null
    const key = dayKey(new Date())
    const seenToday = new Set((logs ?? []).filter((l) => dayKey(new Date(l.review)) === key).flatMap((l) => CARD_BY_ID.get(l.cardId)?.note.id ?? []))
    return forecast(rows, settings, seenToday)
  }, [rows, logs, settings])
  const learned = useMemo(() => (rows ? [...rows.values()].filter((r) => r.state !== State.New && CARD_BY_ID.has(r.id)).length : 0), [rows])
  const filtered = settings.regions.length > 0 || settings.kinds.length > 0 || settings.types.length > 0
  const insight = useMemo(() => {
    if (!rows || !logs) return null
    const perDay = days(logs)
    const counts = [...perDay.values()].map((d) => d.answers)
    const all = sets(rows)
    const curve = forgetting(rows)
    return {
      days: perDay,
      summary: logs.length
        ? `${logs.length.toLocaleString()} answers over ${counts.length} day${counts.length === 1 ? '' : 's'} · ${Math.max(...counts)} on your best day`
        : 'Your days of study will fill in here',
      recall: recallNow(rows),
      started: placesStarted(rows),
      time: studyTime(logs),
      sets: all,
      closest: closest(all),
      types: byType(rows, logs),
      curve,
      strength: strength(rows),
      slipping: forgotten(rows),
    }
  }, [rows, logs])

  const open = (note: Note | undefined) => note && setDetail(note)
  /** A set from the page: beside every set on a big screen, on a page of its own on a phone. */
  const showSet = (key: string) => {
    if (!dash) return setOpenSet(key)
    setPick(key)
    setAllSets(true)
  }
  /** Adds a set's unstarted cards to today, mixed in with the rest. */
  const learnSet = (set: DeckSet) => {
    onLearn(set.left.map((c) => c.id))
    close()
  }
  const learnAll = () => {
    onLearn(ALL_CARDS.filter((c) => matchesFilters(c, settings)).map((c) => c.id))
    close()
  }
  const lowest = insight?.slipping.slice(0, LOWEST) ?? []
  const drillSlipping = () => {
    onDrill(lowest.map((x) => x.card.id))
    close()
  }

  let body: React.ReactNode = null
  const shownSet = openSet ? insight?.sets.get(openSet) : undefined
  if (detail && rows) body = <Detail note={detail} rows={rows} onBack={() => setDetail(null)} />
  else if (shownSet && rows)
    body = (
      <div>
        <Back onClick={() => setOpenSet(null)} />
        <div className="mt-2">
          <SetPane set={shownSet} rows={rows} onPick={open} onLearn={() => learnSet(shownSet)} />
        </div>
      </div>
    )
  else if (searching)
    body = results.length ? (
      <ul className="-mx-2">
        {results.map((n) => (
          <Row key={n.id} id={n.id} onClick={() => open(n)}>
            <Thumb note={n} />
            <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{n.country}</span>
            {n.capital && <span className="max-w-[45%] truncate text-[13px] text-ink-3">{n.capital}</span>}
          </Row>
        ))}
      </ul>
    ) : (
      <p className="pt-2 text-[13.5px] text-ink-3">Nothing matches “{query.trim()}”.</p>
    )
  else if (allSets && insight && rows && dash) {
    const picked = (pick && insight.sets.get(pick)) || insight.closest[0] || [...insight.sets.values()][0]
    body = (
      <div className="grid h-full grid-cols-[minmax(0,440px)_minmax(0,1fr)] gap-8">
        <div className="min-h-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <SetsGrid sets={insight.sets} onOpen={setPick} selected={picked.key} lead={<Back onClick={() => setAllSets(false)} />} />
        </div>
        <div className={`min-h-0 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${TILE}`}>
          <SetPane key={picked.key} set={picked} rows={rows} onPick={open} onLearn={() => learnSet(picked)} />
        </div>
      </div>
    )
  } else if (allSets && insight)
    body = (
      <div>
        <Back onClick={() => setAllSets(false)} />
        <h2 className="mb-1 mt-2 text-[22px] font-semibold leading-[1.15] tracking-[-0.025em] text-ink">Sets</h2>
        <SetsGrid sets={insight.sets} onOpen={setOpenSet} />
      </div>
    )
  else if (slipping && insight)
    body = (
      <div>
        <Back onClick={() => setSlipping(false)} />
        <h2 className="mt-2 text-[22px] font-semibold leading-[1.15] tracking-[-0.025em] text-ink">Most likely to have forgotten</h2>
        <p className="mt-1 text-[13.5px] tabular-nums text-ink-2">
          {insight.slipping.length === 1 ? 'One card' : `${insight.slipping.length} cards`} below a 90% chance you'd get {insight.slipping.length === 1 ? 'it' : 'them'} right.
        </p>
        <div className="mt-4">
          <ReviewSlipping count={insight.slipping.length} lowest={lowest.length} onClick={drillSlipping} />
        </div>
        <div className="mt-6">
          <Heading aside="chance you'd get it right">Lowest first</Heading>
          <Forgotten items={lowest} />
        </div>
      </div>
    )
  else if (rows && levels && ahead && insight) {
    const done = learned / ALL_CARDS.length
    const n = insight.slipping.length
    body = (
      <div className="dash-grid">
        <div className="[grid-area:head] dash:pt-1">
          <Heatmap days={insight.days} summary={insight.summary}>
            <h2 className="mt-1 text-[22px] font-semibold leading-[1.15] tracking-[-0.025em] text-ink sm:text-[24px] dash:text-[30px]">
              {streak ? `${streak}-day streak` : 'Progress'}
            </h2>
            <p className="mt-1.5 text-[13.5px] tabular-nums text-ink-2">
              {learned.toLocaleString()} of {ALL_CARDS.length.toLocaleString()} cards learned
              {streak === 0 ? ' · study today to start a streak' : ''}
            </p>
            {/* How far through the deck, and when the rest will have come in. */}
            <div className="mt-2.5 h-1.5 max-w-[360px] overflow-hidden rounded-full bg-muted" role="img" aria-label={`${Math.round(done * 100)}% of the deck learned`}>
              <Fill value={done} className="bg-good" />
            </div>
            <p className="mt-2 text-[12.5px] tabular-nums text-ink-3">
              {ahead.remaining > 0 ? (
                <>
                  At {settings.newPerDay} new a day you'll finish {filtered ? 'these cards' : 'the deck'} around {finishDate(ahead.days)}
                  {ahead.remaining <= LEARN_ALL_MAX && (
                    <>
                      {'\u00a0· '}
                      <button
                        data-learn-all
                        onClick={learnAll}
                        className="whitespace-nowrap text-ink-2 underline decoration-line underline-offset-4 transition-colors hover:text-ink hover:decoration-ink-3"
                      >
                        or learn all {ahead.remaining} today
                      </button>
                    </>
                  )}
                </>
              ) : (
                `Every card${filtered ? ' in these filters' : ''} is under way`
              )}
            </p>
            {/* The cards most likely forgotten, only when there are some: the one thing here to act on. */}
            {n > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="flex items-center gap-2 text-[13px] tabular-nums text-ink-2">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-again" aria-hidden />
                  {n === 1 ? 'One card' : `${n} cards`} below a 90% chance you'd get {n === 1 ? 'it' : 'them'} right
                </span>
                <ReviewSlipping count={n} lowest={lowest.length} onClick={drillSlipping} />
                <button data-show-slipping onClick={() => setSlipping(true)} className="text-[13px] text-ink-3 transition-colors hover:text-ink">
                  Show them
                </button>
              </div>
            )}
          </Heatmap>
        </div>

        <div className={`mt-7 [grid-area:stats] dash:mt-0 dash:flex dash:items-center ${TILE}`}>
          <div className="w-full">
            <Numbers
              items={[
                { value: <CountUp to={insight.recall.recalled} />, label: "you'd get right now", sub: `of ${insight.recall.learned.toLocaleString()} started` },
                { value: <CountUp to={insight.started} />, label: 'places started', sub: `of ${NOTES.length}` },
                { value: duration(insight.time.ms), label: 'spent studying', sub: insight.time.perCard ? `${Math.round(insight.time.perCard / 1000)}s a card` : undefined },
              ]}
            />
          </div>
        </div>

        <MasteryMap levels={levels} region={region} onRegion={setRegion} onPick={(id) => open(NOTE_BY_ID.get(id))} />

        <section className={`mt-8 [grid-area:sets] dash:mt-0 ${TILE}`}>
          <Heading
            aside={
              <button
                data-all-sets
                onClick={() => setAllSets(true)}
                className="relative flex items-center text-[12px] text-ink-3 transition-colors after:absolute after:-inset-x-2 after:-inset-y-2.5 hover:text-ink"
              >
                All sets <ChevronRight size={13} strokeWidth={1.75} className="-mr-0.5" />
              </button>
            }
          >
            Closest to finishing
          </Heading>
          {insight.closest.length ? <Closest items={insight.closest} onOpen={showSet} /> : <p className="text-[13.5px] text-ink-3">Every set is under way.</p>}
        </section>

        <section className={`mt-8 [grid-area:kinds] dash:mt-0 dash:flex dash:flex-col ${TILE}`}>
          <Heading>By kind of card</Heading>
          <Types stats={insight.types} className="dash:flex dash:flex-1 dash:flex-col dash:justify-around dash:space-y-0" />
        </section>

        {insight.curve.total > 0 && (
          <section className={`mt-8 [grid-area:last] dash:mt-0 ${TILE}`}>
            <Heading>How long they'll last</Heading>
            <Strength counts={insight.strength} month={insight.curve.month} year={insight.curve.year} />
          </section>
        )}

        <section className={`mt-8 [grid-area:ahead] dash:mt-0 ${TILE}`}>
          <Heading aside="reviews due">Next two weeks</Heading>
          <Ahead load={ahead.load} cap={settings.reviewsPerDay} perCard={insight.time.perCard} />
        </section>
      </div>
    )
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-page/90 pad-safe"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onPointerDown={(e) => e.target === e.currentTarget && close()}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Progress"
        tabIndex={-1}
        className="card-shadow flex h-full w-[min(560px,100%)] flex-col overflow-hidden rounded-3xl bg-surface outline-none sm:h-auto sm:max-h-[min(780px,100%)] sm:min-h-[min(520px,100%)] dash:h-[min(880px,calc(100%-3rem))] dash:max-h-none dash:w-[min(1400px,calc(100%-4rem))]"
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <div className="relative flex w-full shrink-0 items-center gap-2 px-4 pb-2 pt-4 sm:px-6 sm:pt-6 dash:justify-center dash:pt-5">
          <label className="relative flex-1 dash:max-w-[600px]">
            <Search size={15} strokeWidth={1.75} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setDetail(null)
                setOpenSet(null)
                setAllSets(false)
                setSlipping(false)
              }}
              onKeyDown={(e) => e.key === 'Enter' && open(results[0])}
              placeholder="Search a country or capital…"
              aria-label="Search a country or capital"
              autoComplete="off"
              spellCheck={false}
              className="h-10 w-full rounded-full border border-line bg-surface pl-9 pr-4 text-[14px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-ink-3 [&::-webkit-search-cancel-button]:hidden"
            />
          </label>
          <button
            onClick={close}
            aria-label="Close (Esc)"
            title="Close (Esc)"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-muted hover:text-ink dash:absolute dash:right-5 dash:top-5"
          >
            <X size={17} strokeWidth={1.75} />
          </button>
        </div>
        <div
          ref={bodyRef}
          onScroll={(e) => scrolled.current.set(shown.current.view, e.currentTarget.scrollTop)}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-2 [scrollbar-width:none] sm:px-7 sm:pb-8 [&::-webkit-scrollbar]:hidden"
        >
          <div className={view === 'page' || view === 'sets' ? 'dash:h-full' : 'dash:mx-auto dash:max-w-[600px]'}>{body}</div>
        </div>
      </motion.div>
    </motion.div>
  )
}
