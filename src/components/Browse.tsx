import { Check, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ALL_CARDS, answerOf, mediaUrl, type CoreType, type DeckCard } from '../lib/deck'
import { restoreFocus, trapTab } from '../lib/focus'
import { CONTINENTS, NESTED, regionShort, WHOLE } from '../lib/insights'
import fame from '../data/fame.json'

/** Where a card stands for today, as the session sees it: already in today's study, or what would bring it in. */
export type Standing = 'today' | 'learn' | 'review'

type Props = {
  /** Open at this set (`Africa:flag`) rather than wherever browsing was left. */
  initial?: string
  standing: (card: DeckCard) => Standing
  onSooner: (card: DeckCard) => void
  onClose: () => void
}

const TABS: { type: CoreType; label: string }[] = [
  { type: 'flag', label: 'Flags' },
  { type: 'map', label: 'Maps' },
  { type: 'capital', label: 'Capitals' },
  { type: 'country', label: 'Countries' },
]
const SEAS = 'Oceans+Seas'
/** The whole deck, each continent, and the seas where there are cards of them (maps only). */
const regionsFor = (type: CoreType) => [WHOLE, ...CONTINENTS, ...(type === 'map' ? [SEAS] : [])]
const regionLabel = (r: string) => (r === WHOLE ? 'All' : r === SEAS ? 'Seas' : regionShort(r))

const FAME = new Map((fame as { id: string }[]).map((p, i) => [p.id, i]))
const byName = new Intl.Collator(undefined, { sensitivity: 'base' })
/** What a card shows face up: the place for a capital card, the capital for a country card. */
const frontText = (c: DeckCard) => (c.type === 'country' ? c.note.capital : c.note.country)
/** Pictures best known first, so the skim slows down where it gets hard; names A to Z, so one is easy to find. */
function order(cards: DeckCard[], type: CoreType) {
  if (type === 'flag' || type === 'map')
    return [...cards].sort((a, b) => (FAME.get(a.note.id) ?? FAME.size) - (FAME.get(b.note.id) ?? FAME.size) || byName.compare(a.note.country, b.note.country))
  return [...cards].sort((a, b) => byName.compare(frontText(a), frontText(b)))
}

const HINT: Record<CoreType, (n: number) => string> = {
  flag: (n) => `${n} flags, best known first. Tap one for its name.`,
  map: (n) => `${n} places, best known first. Tap one for its name.`,
  capital: (n) => `${n} countries, A to Z. Tap one for its capital.`,
  country: (n) => `${n} capitals, A to Z. Tap one for its country.`,
}

const SAVED = 'atlas.browse'
const TOKEN = 'atlas-browse'
const parse = (key: string | null | undefined) => {
  const [region, type] = (key ?? '').split(':')
  return TABS.some((t) => t.type === type) ? { region: region || WHOLE, type: type as CoreType } : null
}
const saved = () => {
  try {
    return parse(localStorage.getItem(SAVED))
  } catch {
    return null
  }
}

/** Every card of a kind, face up in a grid to skim: tap one to turn it over, and bring any you're unsure of into today. */
export default function Browse({ initial, standing, onSooner, onClose }: Props) {
  const start = parse(initial) ?? saved() ?? { region: WHOLE, type: 'flag' as CoreType }
  const [type, setType] = useState<CoreType>(start.type)
  const [region, setRegion] = useState(start.region)
  /** A smaller region it was opened at (the Caribbean, say), kept as a choice beside the continents. */
  const [extra] = useState(regionsFor(start.type).includes(start.region) ? null : start.region)
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const dialogRef = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const opener = useRef<Element | null>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  const regions = useMemo(() => {
    const list = regionsFor(type)
    if (!extra) return list
    const parent = NESTED.find((n) => n.within.includes(extra))?.region
    const at = parent ? list.indexOf(parent) + 1 : list.length
    return [...list.slice(0, at), extra, ...list.slice(at)]
  }, [type, extra])
  const cards = useMemo(() => {
    const of = ALL_CARDS.filter((c) => c.type === type && (region === WHOLE || c.note.tags.includes(region)))
    return order(of, type)
  }, [type, region])

  useEffect(() => {
    try {
      localStorage.setItem(SAVED, `${region}:${type}`)
    } catch {
      // Remembered for this visit only.
    }
  }, [type, region])

  const choose = (t: CoreType, r: string) => {
    // A region without cards of this kind (the seas, for capitals) goes back to the whole deck.
    const keep = ALL_CARDS.some((c) => c.type === t && (r === WHOLE || c.note.tags.includes(r)))
    setType(t)
    setRegion(keep ? r : WHOLE)
    scroller.current?.scrollTo({ top: 0 })
  }
  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const close = () => {
    if (history.state?.atlasBrowse === TOKEN) return history.back()
    restoreFocus(opener.current, dialogRef.current)
    onCloseRef.current()
  }
  const closeRef = useRef(close)
  useEffect(() => {
    closeRef.current = close
  })

  // The phone's back gesture closes it, rather than leaving the app.
  useEffect(() => {
    opener.current ??= document.activeElement
    if (history.state?.atlasBrowse !== TOKEN) history.pushState({ ...history.state, atlasBrowse: TOKEN }, '')
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
      closeRef.current()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [])

  const chip = (on: boolean) =>
    `min-w-0 whitespace-nowrap rounded-full text-[13px] transition-colors sm:shrink-0 sm:px-3.5 ${on ? 'bg-ink font-medium text-on-ink' : 'text-ink-2 hover:bg-muted hover:text-ink'}`
  // As many to a row as can still be told apart at a glance: flags small, maps bigger, names in between.
  const grid = type === 'flag' ? 'grid-cols-3 sm:grid-cols-5' : type === 'map' ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-4'

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
        aria-label="Browse"
        tabIndex={-1}
        className="card-shadow relative flex h-full w-[min(720px,100%)] flex-col overflow-hidden rounded-3xl bg-surface outline-none sm:h-[min(820px,100%)]"
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      >
        {/* The kind of card and the region stay put above what scrolls. */}
        <div className="shrink-0 px-5 pb-3 pt-3 sm:px-8 sm:pt-5">
          <div className="flex items-center justify-between gap-2">
            {/* On a phone the four share the row equally, so they fit beside the close button. */}
            <div role="tablist" aria-label="Cards" className="-ml-1 flex min-w-0 flex-1 gap-0.5 sm:flex-none sm:gap-1">
              {TABS.map((t) => (
                <button key={t.type} role="tab" aria-selected={t.type === type} onClick={() => choose(t.type, region)} className={`h-8 flex-1 pointer-coarse:h-9 sm:flex-none ${chip(t.type === type)}`}>
                  {t.label}
                </button>
              ))}
            </div>
            <button
              onClick={close}
              aria-label="Close (Esc)"
              title="Close (Esc)"
              className="-mr-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-muted hover:text-ink"
            >
              <X size={17} strokeWidth={1.75} />
            </button>
          </div>
          <div role="tablist" aria-label="Region" className="-mx-5 mt-2 flex gap-1 overflow-x-auto px-5 [scrollbar-width:none] sm:-mx-8 sm:px-8 [&::-webkit-scrollbar]:hidden">
            {regions.map((r) => (
              <button
                key={r}
                role="tab"
                aria-selected={r === region}
                onClick={() => choose(type, r)}
                className={`h-7 shrink-0 whitespace-nowrap rounded-full px-3 text-[12.5px] transition-colors pointer-coarse:h-8 ${r === region ? 'bg-muted font-medium text-ink' : 'text-ink-3 hover:text-ink'}`}
              >
                {regionLabel(r)}
              </button>
            ))}
          </div>
        </div>
        {/* Opaque, so the browser can scroll it on the GPU and keep text sharp; see-through, it's redrawn on every frame of a scroll on a Windows screen. */}
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-surface px-5 pb-6 [scrollbar-width:none] sm:px-8 sm:pb-8 [&::-webkit-scrollbar]:hidden">
          <p className="text-[12.5px] text-ink-3">{HINT[type](cards.length)}</p>
          <ul className={`mt-3 grid gap-2 sm:gap-2.5 ${grid}`}>
            {cards.map((c) => (
              <Tile key={c.id} card={c} open={open.has(c.id)} standing={open.has(c.id) ? standing(c) : null} onToggle={() => toggle(c.id)} onSooner={() => onSooner(c)} />
            ))}
          </ul>
        </div>
      </motion.div>
    </motion.div>
  )
}

const TURN = { duration: 0.12 }

/**
 * One card, face up. Tapping turns it over to the answer, with a way to bring it into today; tapping again turns it back.
 * The button that turns it stays put while the faces swap under it, so focus stays on it.
 */
function Tile({ card, open, standing, onToggle, onSooner }: { card: DeckCard; open: boolean; standing: Standing | null; onToggle: () => void; onSooner: () => void }) {
  const answer = answerOf(card)
  const size = card.type === 'flag' ? 'aspect-[5/4] sm:aspect-[4/3]' : card.type === 'map' ? 'aspect-[6/5]' : 'h-[88px] sm:h-24'
  return (
    <li className={`group relative ${size}`}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? `${answer}. Turn back` : card.type === 'flag' ? 'Flag: show the country' : card.type === 'map' ? 'Map: show the place' : `${frontText(card)}: show the answer`}
        className="absolute inset-0 rounded-xl outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-3"
      />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={open ? 'back' : 'front'}
          className={`pointer-events-none absolute inset-0 flex flex-col items-center justify-center overflow-hidden rounded-xl transition-colors ${card.type === 'map' && !open ? '' : 'bg-subtle group-hover:bg-muted'}`}
          initial={{ rotateY: -90 }}
          animate={{ rotateY: 0, transition: { ...TURN, ease: [0.2, 0.8, 0.2, 1] } }}
          exit={{ rotateY: 90, transition: { ...TURN, ease: [0.6, 0, 0.8, 0.4] } }}
          style={{ transformPerspective: 700 }}
        >
          {open ? <Back answer={answer} standing={standing} onSooner={onSooner} /> : <Front card={card} />}
        </motion.div>
      </AnimatePresence>
    </li>
  )
}

function Front({ card }: { card: DeckCard }) {
  const n = card.note
  if (card.type === 'flag')
    return (
      <img
        src={mediaUrl(n.flag!)}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        className={`max-h-[62%] max-w-[76%] ${n.flag!.includes('-nobox') ? '' : 'img-shadow rounded-[2px]'}`}
      />
    )
  if (card.type === 'map') return <img src={mediaUrl(n.map!)} alt="" loading="lazy" decoding="async" draggable={false} className="img-dim h-full w-full rounded-xl object-cover" />
  return <span className="text-balance px-3 text-center text-[14px] font-medium leading-snug text-ink sm:text-[15px]">{frontText(card)}</span>
}

/** The answer in the middle, and what would bring the card into today along the bottom edge, clear of a tap to turn it back. */
function Back({ answer, standing, onSooner }: { answer: string; standing: Standing | null; onSooner: () => void }) {
  return (
    <>
      <span className="flex min-h-0 w-full flex-1 items-center justify-center pt-1.5 sm:pt-2.5">
        <span className="text-balance px-1 text-center text-[12px] font-semibold leading-[1.15] text-ink sm:px-3 sm:text-[14px] sm:leading-[1.2]">{answer}</span>
      </span>
      <span className="mb-1.5 flex h-6 shrink-0 items-center sm:mb-2.5 sm:h-7">
        {standing === 'today' ? (
          <span className="flex items-center gap-1 text-[11px] text-ink-3 sm:text-[12px]">
            <Check size={13} strokeWidth={2.25} /> Due today
          </span>
        ) : (
          standing && (
            <button
              onClick={onSooner}
              className="pointer-events-auto relative h-6 whitespace-nowrap rounded-full border border-line bg-surface px-2 text-[11px] font-medium text-ink-2 transition-colors after:absolute after:-inset-x-1 after:-bottom-1.5 after:top-0 hover:border-edge-strong hover:text-ink sm:h-7 sm:px-3 sm:text-[12px]"
            >
              {standing === 'learn' ? 'Learn today' : 'Review today'}
            </button>
          )
        )}
      </span>
    </>
  )
}
