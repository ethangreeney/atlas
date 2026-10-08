import { animate, AnimatePresence, motion, useReducedMotion, type Variants } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { db } from '../lib/db'
import { answerOf, CARD_BY_ID, mediaUrl, type DeckCard } from '../lib/deck'
import { dayEnd, dayKey, GRADES } from '../lib/scheduler'
import { Outline } from './Outline'

type Counts = [number, number, number, number]
type Props = { counts: Counts; refs: React.RefObject<(HTMLDivElement | null)[]>; onDrill: (ids: string[]) => void }

/** How many cards a pile shows: more as it grows, up to five. The number on top says how many there really are. */
const layersFor = (n: number) => (n < 2 ? 1 : n < 5 ? 2 : n < 12 ? 3 : n < 30 ? 4 : 5)

const COUNT_CLS = ['text-again', 'text-hard', 'text-good', 'text-easy']

/**
 * Top card first. At rest the cards beneath peek out either side, like a hand held loosely; pointed at, the top card
 * lifts as if being picked up and the others fan out further. Every card in the pile moves, turning from the bottom.
 */
const POSE = {
  rest: [
    { x: 0, y: 0, rotate: 0 },
    { x: -1, y: 0, rotate: -4.5 },
    { x: 1, y: 0, rotate: 4 },
    { x: -2, y: 1, rotate: -8.5 },
    { x: 2, y: 1, rotate: 8 },
  ],
  fan: [
    { x: 0, y: -6, rotate: -2 },
    { x: -5, y: -1, rotate: -11 },
    { x: 5, y: -1, rotate: 10 },
    { x: -8, y: 0, rotate: -18 },
    { x: 8, y: 0, rotate: 17 },
  ],
}
const layer: Variants = { rest: (d: number) => POSE.rest[d], fan: (d: number) => POSE.fan[d] }
const SPRING = { type: 'spring', stiffness: 380, damping: 26 } as const

/** A card in a pile today, once however many times it landed there. */
type Item = { card: DeckCard; times: number }
type Open = { grade: number; counts: Counts; items: Item[]; height: number }

/** Today's answers with this grade, newest first. */
async function todays(grade: number): Promise<Item[]> {
  const now = new Date()
  const key = dayKey(now)
  const start = dayEnd(now)
  start.setDate(start.getDate() - 1)
  const logs = await db.revlog.where('review').aboveOrEqual(start).toArray()
  const out = new Map<string, Item>()
  for (const l of logs.sort((a, b) => +new Date(b.review) - +new Date(a.review))) {
    if (l.rating !== grade + 1 || dayKey(new Date(l.review)) !== key) continue
    const card = CARD_BY_ID.get(l.cardId)
    if (!card) continue
    const seen = out.get(card.id)
    if (seen) seen.times++
    else out.set(card.id, { card, times: 1 })
  }
  return [...out.values()]
}

/**
 * Four small stacks the cards fly into, each directly under its grade button, so they need no labels of their own.
 * The stack grows with the count; the number takes the grade's colour and ticks when a card lands. Pointing at one
 * fans it out; tapping it deals today's cards from it across the table.
 */
export function Piles({ counts, refs, onDrill }: Props) {
  const reduce = useReducedMotion()
  const root = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<Open | null>(null)
  // Grading puts away whatever was dealt out: the piles have changed under it.
  const shown = open && open.counts === counts ? open : null
  /** Sends the dealt cards back into their pile; set by whatever is dealt out. */
  const gather = useRef<(() => Promise<unknown>) | null>(null)
  const busy = useRef(false)
  // Stable, so what's dealt out isn't dealt again each time the screen behind it updates.
  const register = useCallback((fn: () => Promise<unknown>) => {
    gather.current = fn
  }, [])

  const close = async () => {
    if (busy.current) return
    busy.current = true
    await gather.current?.()
    gather.current = null
    setOpen(null)
    busy.current = false
  }

  /** Today's cards in each pile, looked up as soon as one is pointed at or touched, so a tap opens it at once. */
  const fetched = useRef<{ counts: Counts; piles: Map<number, Promise<Item[]>> } | null>(null)
  const prefetch = (grade: number) => {
    if (fetched.current?.counts !== counts) fetched.current = { counts, piles: new Map() }
    let items = fetched.current.piles.get(grade)
    if (!items) {
      items = todays(grade)
      fetched.current.piles.set(grade, items)
    }
    return items
  }

  const toggle = async (grade: number) => {
    const was = shown?.grade
    if (shown) await close()
    if (was === grade || busy.current) return
    const items = await prefetch(grade)
    const box = root.current?.getBoundingClientRect()
    if (!items.length || !box) return
    // The table is everything between the top bar and the piles.
    const top = (document.querySelector('header')?.getBoundingClientRect().bottom ?? 0) + 8
    setOpen({ grade, counts, items, height: Math.max(180, box.top - top - 12) })
  }

  useEffect(() => {
    if (!shown) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && void close()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  })

  return (
    <div ref={root} className={`relative grid w-full grid-cols-4 items-end gap-2 short:h-[42px] ${shown ? 'z-30' : ''}`}>
      <AnimatePresence>
        {shown && (
          <motion.div
            key="table"
            aria-hidden
            className="fixed inset-0 bg-page/95"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.15 }}
            onClick={() => void close()}
          />
        )}
      </AnimatePresence>
      {shown && (
        <Dealt
          key={shown.grade}
          {...shown}
          piles={refs}
          register={register}
          onClose={() => void close()}
          onDrill={(ids) => {
            setOpen(null)
            onDrill(ids)
          }}
        />
      )}
      {GRADES.map((g, i) => {
        const n = counts[i]
        const layers = layersFor(n)
        const isOpen = shown?.grade === i
        return (
          <div key={g.key} className="relative flex flex-col items-center">
            <motion.button
              type="button"
              disabled={n === 0}
              aria-label={`${g.label}: ${n} today${n ? '. Show them' : ''}`}
              aria-expanded={n ? isOpen : undefined}
              onClick={() => void toggle(i)}
              onPointerEnter={() => n && void prefetch(i)}
              onPointerDown={() => n && void prefetch(i)}
              onFocus={() => n && void prefetch(i)}
              initial={false}
              animate={isOpen ? 'fan' : 'rest'}
              whileHover={n && !reduce ? 'fan' : undefined}
              whileTap={n && !reduce ? { scale: 0.96 } : undefined}
              className="group relative rounded-lg outline-offset-4 enabled:cursor-pointer"
            >
              <div
                ref={(el) => {
                  refs.current[i] = el
                }}
                className="relative h-10 w-14 short:h-8 short:w-12"
              >
                {Array.from({ length: layers }, (_, l) => layers - 1 - l).map((depth) => (
                  <motion.div
                    key={depth}
                    custom={depth}
                    variants={layer}
                    transition={SPRING}
                    // The cards beneath sit a little in the top one's shade.
                    className={`pile-shadow absolute inset-0 rounded-lg transition-[opacity,box-shadow] duration-300 ${depth ? `pile-under-${depth}` : 'pile-top bg-surface'}`}
                    style={{ opacity: n === 0 ? 0.5 : 1, originY: 1 }}
                  />
                ))}
                {/* The count rides on the top card. */}
                <motion.div custom={0} variants={layer} transition={SPRING} className="absolute inset-0" style={{ originY: 1 }}>
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
                </motion.div>
              </div>
            </motion.button>
          </div>
        )
      })}
    </div>
  )
}

const CARD_W = 100
const CARD_H = 75

const TITLE = [
  (n: number) => `You missed ${n === 1 ? 'this card' : `these ${n}`} today`,
  (n: number) => `${n === 1 ? 'This one was' : `These ${n} were`} hard today`,
  (n: number) => `You got ${n === 1 ? 'this one' : `these ${n}`} right today`,
  (n: number) => `${n === 1 ? 'This one was' : `These ${n} were`} easy today`,
]

/** A small lean for each card, the same every time, so they lie like cards dropped on a table rather than tiles. */
const lean = (id: string) => {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0
  return ((h % 1000) / 1000) * 2.6
}

/**
 * A pile's cards dealt out of it across the space above, newest first. Tap one to turn it over, and again to turn it back.
 * Closing sends them back into the pile.
 */
function Dealt({
  grade,
  items,
  height,
  piles,
  register,
  onClose,
  onDrill,
}: Open & {
  piles: React.RefObject<(HTMLDivElement | null)[]>
  /** Hands the parent a way to send the cards back into the pile. */
  register: (gather: () => Promise<unknown>) => void
  onClose: () => void
  onDrill: (ids: string[]) => void
}) {
  const reduce = useReducedMotion()
  const cards = useRef<(HTMLDivElement | null)[]>([])
  const table = useRef<HTMLDivElement>(null)
  const [turned, setTurned] = useState<ReadonlySet<string>>(new Set())
  const turn = (id: string) =>
    setTurned((t) => {
      const next = new Set(t)
      if (!next.delete(id)) next.add(id)
      return next
    })

  // Where each card lies relative to the pile's middle, measured once laid out: that's where it flies from and back to.
  useLayoutEffect(() => {
    const toPile = (el: HTMLElement) => {
      const p = piles.current[grade]?.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      return p ? { x: p.left + p.width / 2 - (r.left + r.width / 2), y: p.top + p.height / 2 - (r.top + r.height / 2) } : { x: 0, y: 0 }
    }
    const els = cards.current.slice(0, items.length)
    // Only a pile too big for the table scrolls. Measured before any card is moved: one still on its way out of the
    // pile would otherwise count as overflow, and a scrollbar would show (and take a column) where none is needed.
    // (The cards' 3D turn adds a few pixels of phantom overflow, so a near fit counts as a fit.)
    if (table.current) table.current.style.overflowY = table.current.scrollHeight > table.current.clientHeight + 8 ? 'auto' : 'visible'
    const deal = els.map((el, j) => {
      if (!el) return null
      const tilt = lean(items[j].card.id)
      if (reduce) {
        el.style.opacity = '1'
        el.style.transform = `rotate(${tilt}deg)`
        return null
      }
      const from = toPile(el)
      const delay = Math.min(j, 20) * 0.009
      return animate(
        el,
        { x: [from.x, 0], y: [from.y, 0], scale: [0.4, 1], rotate: [0, tilt], opacity: [0, 1] },
        { type: 'spring', stiffness: 560, damping: 38, delay, opacity: { duration: 0.1, delay } },
      )
    })
    register(() => {
      deal.forEach((a) => a?.stop())
      if (reduce) return Promise.resolve()
      const n = els.length
      return Promise.all(
        els.map((el, j) => {
          if (!el) return null
          // From wherever it now sits (the table may have scrolled) back into the pile, last dealt first.
          const r = toPile(el)
          const x = Number(el.style.transform.match(/translateX\((-?[\d.]+)px\)/)?.[1] ?? 0)
          const y = Number(el.style.transform.match(/translateY\((-?[\d.]+)px\)/)?.[1] ?? 0)
          return animate(
            el,
            { x: x + r.x, y: y + r.y, scale: 0.4, rotate: 0, opacity: 0 },
            { duration: 0.18, ease: [0.4, 0, 0.7, 1], delay: Math.min(n - 1 - j, 20) * 0.004, opacity: { duration: 0.08, delay: 0.1 } },
          )
        }),
      )
    })
    return () => deal.forEach((a) => a?.stop())
  }, [grade, items, piles, register, reduce])

  return (
    // Wider than the piles where there's room, so a big pile fits on the table without scrolling.
    <div className="absolute bottom-full left-1/2 mb-3 flex w-[min(calc(100vw-2rem),56rem)] -translate-x-1/2 flex-col" style={{ height }}>
      <div
        ref={table}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-1 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        // The bare table between the cards puts them away too.
        onClick={(e) => !(e.target as Element).closest('button') && onClose()}
      >
        <div className="mt-auto">
          <div className="mb-4 flex flex-col items-center gap-3 text-center">
            <p className="text-[14px] text-ink-2">{TITLE[grade](items.length)}</p>
            {grade === 0 && (
              <button
                onClick={() => onDrill(items.map((x) => x.card.id))}
                className="rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-subtle"
              >
                Go over them again
              </button>
            )}
          </div>
          <div className="grid justify-center gap-x-3 gap-y-3.5 pb-1" style={{ gridTemplateColumns: `repeat(auto-fit, ${CARD_W}px)` }}>
            {items.map(({ card, times }, j) => {
              const up = turned.has(card.id)
              return (
                <div
                  key={card.id}
                  ref={(el) => {
                    cards.current[j] = el
                  }}
                  style={{ width: CARD_W, height: CARD_H, opacity: 0 }}
                  className="relative"
                >
                  <button
                    type="button"
                    onClick={() => turn(card.id)}
                    aria-pressed={up}
                    aria-label={`${card.note.country}, ${card.type}: ${up ? answerOf(card) : 'turn it over'}`}
                    // Pointed at, a card straightens and lifts off the table; pressed, it gives a little. Plain CSS, so
                    // dealing out a big pile isn't held up setting each one up.
                    style={{ '--lean': `${-lean(card.id)}deg` } as React.CSSProperties}
                    className="group h-full w-full cursor-pointer transition-[translate,scale,rotate] duration-150 ease-out [perspective:600px] hover:-translate-y-1.5 hover:scale-[1.04] hover:[rotate:var(--lean)] active:scale-[0.97] motion-reduce:transition-none"
                  >
                    <div
                      className="relative h-full w-full transition-transform duration-[380ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] [transform-style:preserve-3d] motion-reduce:transition-none"
                      style={{ transform: up ? 'rotateY(180deg)' : undefined }}
                    >
                      <Face>
                        <Front card={card} />
                      </Face>
                      <Face back>
                        <span className="text-balance text-[12.5px] font-semibold leading-tight text-ink">{answerOf(card)}</span>
                      </Face>
                    </div>
                    {times > 1 && <span className="absolute right-2 top-1.5 text-[10px] font-medium tabular-nums text-ink-3">×{times}</span>}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

const Face = ({ back, children }: { back?: boolean; children: React.ReactNode }) => (
  <div
    className="mini-shadow backface-hidden absolute inset-0 flex flex-col items-center justify-center gap-0.5 overflow-hidden rounded-xl bg-surface px-2 text-center"
    style={back ? { transform: 'rotateY(180deg)' } : undefined}
  >
    {children}
  </div>
)

/** The question side, small: the flag, the map, or the name it asks about. */
function Front({ card }: { card: DeckCard }) {
  const n = card.note
  if (card.type === 'flag' && n.flag)
    return <img src={mediaUrl(n.flag)} alt="" draggable={false} decoding="async" className={`max-h-[46px] max-w-[74px] ${n.flag.includes('-nobox') ? '' : 'img-shadow rounded-[2px]'}`} />
  if (card.type === 'map' && n.map) return <img src={mediaUrl(n.map)} alt="" draggable={false} decoding="async" className="img-dim max-h-[63px] max-w-[88px] rounded-md" />
  if (card.type === 'outline') return <Outline id={n.id} className="h-[52px] w-[80px]" />
  return (
    <>
      <span className="text-[10px] text-ink-3">{card.type === 'capital' ? 'Capital of' : card.type === 'find' ? 'Find' : 'Capital'}</span>
      <span className="line-clamp-2 text-balance text-[12px] font-medium leading-tight text-ink">{card.type === 'country' ? n.capital : n.country}</span>
    </>
  )
}
