import { Check, ExternalLink, Map as MapIcon, Volume2 } from 'lucide-react'
import { motion, useDragControls, type Variants } from 'motion/react'
import { useEffect, useRef } from 'react'
import { Rating, State, type Grade } from 'ts-fsrs'
import type { Verdict } from '../lib/answer'
import { answerOf, kindOf, mediaUrl, type DeckCard } from '../lib/deck'
import type { CardRow } from '../lib/db'
import { lookAlikes } from '../lib/lookalike'

export type ExitTarget = { x: number; y: number; rotate: number }

const EASE = [0.2, 0.8, 0.2, 1] as const
// Debug/filming: ?slow=4 stretches the flip and fly-away animations 4x.
const SLOW = typeof location !== 'undefined' ? Number(new URLSearchParams(location.search).get('slow')) || 1 : 1
/** How far a flipped card has to be swiped (plus a bit for a flick) to grade it. */
const SWIPE = 90

const variants: Variants = {
  enter: { opacity: 0, scale: 0.97, y: 12, x: 0, rotate: 0, zIndex: 10 },
  center: { opacity: 1, scale: 1, y: 0, x: 0, rotate: 0, zIndex: 10, transition: { duration: 0.24 * SLOW, ease: EASE } },
  exit: (t: ExitTarget | null) =>
    t
      ? {
          zIndex: 20,
          x: t.x,
          y: t.y,
          rotate: t.rotate,
          scale: 0.1,
          opacity: [1, 1, 0.9, 0],
          transition: { duration: 0.46 * SLOW, ease: [0.5, 0, 0.25, 1] as const, opacity: { times: [0, 0.6, 0.85, 1], duration: 0.46 * SLOW } },
        }
      : { opacity: 0, scale: 0.97, transition: { duration: 0.16 } },
}

const stateTag = (row: CardRow) => {
  if (row.leech) return { label: 'Leech', cls: 'text-again' }
  switch (row.state) {
    case State.New:
      return { label: 'New', cls: 'text-easy' }
    case State.Learning:
    case State.Relearning:
      return { label: 'Learning', cls: 'text-again' }
    default:
      return { label: 'Review', cls: 'text-good' }
  }
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">{children}</div>
)
const Big = ({ children }: { children: React.ReactNode }) => (
  <div className="text-balance text-[clamp(28px,4.6vw,40px)] font-semibold short:text-[24px] leading-[1.1] tracking-[-0.02em] text-ink">{children}</div>
)
const Small = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[15px] font-medium text-ink-2">{children}</div>
)
/** A name on the answer side: tap it to hear just that name. The speaker icon sits inline, balanced by an
 * equal spacer on the left so the name stays centred; an absolutely positioned icon makes Safari wrap the name
 * at every space ("St. / John's") when it's set in Inter. */
export const Say = ({ text, onSay, big }: { text: string; onSay: (t: string) => void; big?: boolean }) => {
  const size = big ? 18 : 13
  const gap = big ? 'ml-2' : 'ml-1.5'
  const cut = text.lastIndexOf(' ') + 1
  const [head, last] = [text.slice(0, cut), text.slice(cut)]
  return (
    <span
      role="button"
      tabIndex={0}
      title={`Hear “${text}”`}
      className="group cursor-pointer transition-colors hover:text-ink"
      onClick={(e) => {
        e.stopPropagation()
        onSay(text)
      }}
      // A tap shouldn't leave focus here, or Space would replay the name instead of grading.
      onMouseDown={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        e.stopPropagation()
        onSay(text)
      }}
    >
      <span aria-hidden className={`inline-block ${gap}`} style={{ width: size }} />
      {head}
      {/* The icon stays glued to the last word, so a long name never leaves it alone on its own line. */}
      <span className="whitespace-nowrap">
        {last}
        <Volume2
          size={size}
          strokeWidth={2}
          aria-hidden
          className={`inline-block align-middle -translate-y-[0.08em] text-ink-3 opacity-60 transition-opacity group-hover:opacity-100 ${gap}`}
        />
      </span>
    </span>
  )
}

const Info = ({ children }: { children: React.ReactNode }) =>
  children ? <div className="max-w-[34ch] text-balance text-[13px] leading-snug text-ink-3 short:max-w-[42ch] short:text-[12px]">{children}</div> : null

/** The question side says only what the picture is; the answer side can name it. */
const Flag = ({ file, size, alt }: { file: string; size: 'lg' | 'sm'; alt: string }) => (
  <img
    src={mediaUrl(file)}
    alt={alt}
    draggable={false}
    className={`${size === 'lg' ? 'max-h-[min(190px,26dvh)] max-w-[min(300px,70vw)]' : 'max-h-16 max-w-[110px] short:max-h-12'} ${file.includes('-nobox') ? '' : 'img-shadow rounded-[3px]'}`}
  />
)
const Map = ({ file, size, alt }: { file: string; size: 'lg' | 'sm'; alt: string }) => (
  <img
    src={mediaUrl(file)}
    alt={alt}
    draggable={false}
    className={`${size === 'lg' ? 'w-[min(400px,74vw,70dvh)]' : 'w-[min(190px,40vw)] short:w-[min(130px,40vw)]'} rounded-xl img-shadow img-dim`}
  />
)

/** Flags easily mistaken for this one, small, each with how it differs. */
const LookAlikes = ({ card }: { card: DeckCard }) => {
  const items = lookAlikes(card.note)
  if (!items.length) return null
  return (
    // One quiet panel: the card's own label style, then a line per look-alike (at most two).
    <div className="w-fit max-w-full rounded-2xl bg-muted px-4 py-3 text-left short:px-3 short:py-2">
      <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3 short:mb-1.5">Looks like</div>
      <div className="flex flex-col gap-2 short:gap-1.5">
        {items.map((l) => (
          <div key={l.name} className="flex items-start gap-2.5 text-[13px] leading-snug short:text-[12px]">
            <span className="flex h-[1.375em] w-8 shrink-0 items-center justify-center">
              {l.flag && <img src={mediaUrl(l.flag)} alt={`Flag of ${l.name}`} draggable={false} className="img-shadow max-h-full max-w-full rounded-[2px]" />}
            </span>
            <span className="min-w-0">
              <span className="font-medium text-ink">{l.name}</span>
              {l.note && <span className="text-ink-3"> · {l.note}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export type Typed = { kind: Verdict; text: string }

/** What the learner typed, in the corner of the answer: a tick, a near miss, or their answer struck out. */
const Result = ({ typed }: { typed: Typed }) => (
  <span className="absolute right-5 top-4 max-w-[45%] truncate text-[11px] font-medium">
    {typed.kind === 'right' && <Check size={14} strokeWidth={2.5} aria-label="Correct" className="text-good" />}
    {typed.kind === 'close' && <span className="text-hard">Close — {typed.text}</span>}
    {typed.kind === 'wrong' && <s className="text-again">{typed.text}</s>}
  </span>
)

type Input = { value: string; onChange: (v: string) => void; onSubmit: () => void }

/** A single underline to type the answer into. Focused straight away only where there's a real keyboard. */
const AnswerInput = ({ card, input }: { card: DeckCard; input: Input }) => {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!matchMedia('(pointer: fine)').matches || document.activeElement?.closest('#filters')) return
    ref.current?.focus({ preventScroll: true })
  }, [])
  const kind = kindOf(card.note)
  const placeholder = card.type === 'capital' ? 'Capital…' : kind === 'sea' || kind === 'continent' ? 'Name…' : 'Country…'
  return (
    <input
      ref={ref}
      value={input.value}
      onChange={(e) => input.onChange(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          input.onSubmit()
        } else if (e.key === 'Escape') e.currentTarget.blur()
      }}
      placeholder={placeholder}
      aria-label="Your answer"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="words"
      spellCheck={false}
      enterKeyHint="done"
      className="mt-1 w-[min(260px,80%)] select-text border-b border-line bg-transparent pb-1 text-center text-[17px] font-medium text-ink outline-none transition-colors placeholder:font-normal placeholder:text-ink-3 focus:border-ink-3 short:mt-0"
    />
  )
}

function Front({ card }: { card: DeckCard }) {
  const n = card.note
  switch (card.type) {
    case 'capital':
      return (
        <>
          <Label>Capital of</Label>
          <Big>{n.country}</Big>
          <Info>{n.countryInfo}</Info>
        </>
      )
    case 'country':
      return (
        <>
          <Label>Capital</Label>
          <Big>{n.capital}</Big>
          <Info>{n.capitalHint ? `Hint: ${n.capitalHint}` : ''}</Info>
        </>
      )
    case 'flag':
      return (
        <>
          <Label>Flag</Label>
          <Flag file={n.flag!} size="lg" alt="Flag" />
        </>
      )
    case 'map':
      return (
        <>
          <Label>Location</Label>
          <Map file={n.map!} size="lg" alt="Map" />
        </>
      )
  }
}

function Back({ card, showMap, onSay }: { card: DeckCard; showMap: boolean; onSay: (t: string) => void }) {
  const n = card.note
  const map = showMap && n.map && card.type !== 'map' ? <Map file={n.map} size="sm" alt={`Map of ${n.country}`} /> : null
  switch (card.type) {
    case 'capital':
      return (
        <>
          {map}
          <Small>
            <Say text={n.country!} onSay={onSay} />
          </Small>
          <Big>
            <Say text={n.capital!} onSay={onSay} big />
          </Big>
          <Info>{n.capitalInfo}</Info>
        </>
      )
    case 'country':
      return (
        <>
          {map}
          <Small>
            <Say text={n.capital!} onSay={onSay} />
          </Small>
          <Big>
            <Say text={n.country!} onSay={onSay} big />
          </Big>
          <Info>{n.countryInfo}</Info>
        </>
      )
    case 'flag':
      return (
        <>
          {map ?? <Flag file={n.flagBack ?? n.flag!} size="sm" alt={`Flag of ${n.country}`} />}
          <Big>
            <Say text={n.country!} onSay={onSay} big />
          </Big>
          <Info>{n.countryInfo}</Info>
          <LookAlikes card={card} />
        </>
      )
    case 'map':
      return (
        <>
          <Map file={n.map!} size="sm" alt={`Map of ${n.country}`} />
          <Big>
            <Say text={n.country!} onSay={onSay} big />
          </Big>
          <Info>{n.countryInfo}</Info>
        </>
      )
  }
}

type Props = {
  card: DeckCard
  row: CardRow
  flipped: boolean
  showMap: boolean
  onFlip: () => void
  onGrade: (g: Grade) => void
  onSpeak: (text?: string) => void
  onToggleMap: () => void
  /** Type-answers mode: the text box on the front. */
  input?: Input
  /** Type-answers mode: how the submitted answer compared. */
  typed?: Typed | null
  /** New cards only: skip it as already known. */
  onKnow?: () => void
}

/** Google Maps search for the place this card is about. */
export const mapsUrl = (card: DeckCard) => {
  const q = card.type === 'capital' ? `${card.note.capital}, ${card.note.country}` : card.note.country
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
}

const Action = ({ label, onClick, href, children }: { label: string; onClick?: () => void; href?: string; children: React.ReactNode }) => {
  const cls =
    'relative flex h-8 w-8 items-center justify-center rounded-full text-ink-3 transition-colors after:absolute after:-inset-1.5 hover:bg-muted hover:text-ink'
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" aria-label={label} title={label} className={cls} onClick={(e) => e.stopPropagation()}>
      {children}
    </a>
  ) : (
    <button
      aria-label={label}
      title={label}
      className={cls}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
    >
      {children}
    </button>
  )
}

/** Both faces stay mounted for the 3D flip; the one facing away is inert, so it's neither read out nor tabbable. */
const face = 'backface-hidden card-shadow absolute inset-0 flex flex-col items-center justify-center rounded-3xl bg-surface text-center'
/** Scrolls only when the content can't fit, e.g. a long answer with the map on a short screen. */
const body = (shown: boolean) => `flex max-h-full w-full flex-col items-center gap-3 px-8 py-6 short:gap-2 ${shown ? 'overflow-y-auto' : ''}`

export function Card({ card, row, flipped, showMap, onFlip, onGrade, onSpeak, onToggleMap, input, typed, onKnow }: Props) {
  const tag = stateTag(row)
  const drag = useDragControls()
  const front = useRef<HTMLDivElement>(null)
  // Once turned over, the answer box lets go of the keyboard so Enter and the number keys grade.
  useEffect(() => {
    if (flipped && front.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
  }, [flipped])
  return (
    <motion.div
      className={`absolute inset-0 [perspective:1400px] ${flipped ? 'touch-pan-y' : ''}`}
      variants={variants}
      initial="enter"
      animate="center"
      exit="exit"
      // Swipe a flipped card by touch: left for Again, right for Good. It flies to the pile from where it's let go.
      drag={flipped ? 'x' : false}
      dragControls={drag}
      dragListener={false}
      dragSnapToOrigin
      onPointerDown={(e) => flipped && e.pointerType !== 'mouse' && drag.start(e)}
      onDragEnd={(_, { offset, velocity }) => {
        const dx = offset.x + velocity.x * 0.15
        if (dx > SWIPE) onGrade(Rating.Good)
        else if (dx < -SWIPE) onGrade(Rating.Again)
      }}
    >
      <motion.div
        className={`relative h-full w-full select-none [transform-style:preserve-3d] ${flipped ? '' : 'cursor-pointer'}`}
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ duration: 0.38 * SLOW, ease: [0.3, 0.7, 0.2, 1] }}
        onClick={() => !flipped && onFlip()}
      >
        <div ref={front} className={face} inert={flipped}>
          <span className={`absolute left-5 top-4 text-[11px] font-medium ${tag.cls}`}>{tag.label}</span>
          <div className={body(!flipped)}>
            <Front card={card} />
            {input && <AnswerInput card={card} input={input} />}
          </div>
          {onKnow && (
            <button
              title="I already know this (K)"
              className="absolute bottom-4 right-5 text-[11px] font-medium text-ink-3 transition-colors after:absolute after:-inset-2 hover:text-ink"
              onClick={(e) => {
                e.stopPropagation()
                onKnow()
              }}
            >
              I already know this
            </button>
          )}
        </div>
        <div className={`${face} [transform:rotateY(180deg)]`} inert={!flipped}>
          <span className={`absolute left-5 top-4 text-[11px] font-medium ${tag.cls}`}>{tag.label}</span>
          {typed && <Result typed={typed} />}
          <div className={body(flipped)}>
            <Back card={card} showMap={showMap} onSay={onSpeak} />
          </div>
          <div className="absolute bottom-3 right-3 flex items-center gap-3">
            {card.type !== 'map' && card.note.map && (
              <Action label={showMap ? 'Hide map (M)' : 'Show map (M)'} onClick={onToggleMap}>
                <MapIcon size={16} strokeWidth={1.75} className={showMap ? 'text-ink' : ''} />
              </Action>
            )}
            <Action label="Open in Google Maps (G)" href={mapsUrl(card)}>
              <ExternalLink size={16} strokeWidth={1.75} />
            </Action>
          </div>
        </div>
      </motion.div>
      <div aria-live="polite" className="sr-only">
        {flipped ? `Answer: ${answerOf(card)}` : ''}
      </div>
    </motion.div>
  )
}
