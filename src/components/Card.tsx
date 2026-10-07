import { Check, ExternalLink, Map as MapIcon, Volume2 } from 'lucide-react'
import { motion, useDragControls, type Variants } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Rating, State, type Grade } from 'ts-fsrs'
import type { Verdict } from '../lib/answer'
import { answerOf, kindOf, mediaUrl, type DeckCard } from '../lib/deck'
import type { CardRow } from '../lib/db'
import { lookAlikes } from '../lib/lookalike'
import { useHoldToZoom } from '../lib/zoom'
import { Zoomable } from './Zoom'

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
  <div className="text-[12.5px] font-medium text-ink-3">{children}</div>
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

const ZOOM_LABEL = 'See it up close (F)'

/** The question side says only what the picture is; the answer side can name it. Hold it, or press its corner button, to see it up close. */
const Flag = ({ file, size, alt }: { file: string; size: 'lg' | 'sm'; alt: string }) => (
  <Zoomable file={file} alt={alt} label={ZOOM_LABEL}>
    <img
      src={mediaUrl(file)}
      alt={alt}
      draggable={false}
      {...useHoldToZoom(file, alt)}
      className={`${size === 'lg' ? 'max-h-[min(190px,26dvh)] max-w-[min(300px,70vw)] short:max-h-[min(190px,100cqh_-_56px)]' : 'max-h-16 max-w-[110px] short:max-h-12'} ${file.includes('-nobox') ? '' : 'img-shadow rounded-[3px]'}`}
    />
  </Zoomable>
)

/** A look-alike's flag, small beside its name; hold it to see it up close too. Decorative otherwise: the name is right there. */
const MiniFlag = ({ file, name }: { file: string; name: string }) => (
  <img src={mediaUrl(file)} alt="" draggable={false} {...useHoldToZoom(file, `Flag of ${name}`)} className="img-shadow max-h-full max-w-full rounded-[2px]" />
)
const Map = ({ file, size, alt }: { file: string; size: 'lg' | 'sm'; alt: string }) => (
  <Zoomable file={file} alt={alt} label={ZOOM_LABEL}>
    <img
      src={mediaUrl(file)}
      alt={alt}
      draggable={false}
      {...useHoldToZoom(file, alt)}
      // Short screens size maps by the card's height (cqh), so the answer beneath still fits.
      className={`${size === 'lg' ? 'w-[min(400px,74vw,70dvh)] short:max-w-[min(400px,74vw,100%)] short:max-h-[min(300px,100cqh_-_56px)]' : 'w-[min(190px,40vw)] short:max-w-[min(190px,40vw)] short:max-h-[clamp(24px,100cqh_-_110px,110px)]'} rounded-xl img-shadow img-dim short:w-auto`}
    />
  </Zoomable>
)

/** Flags easily mistaken for this one, small, each with how it differs. */
const LookAlikes = ({ card }: { card: DeckCard }) => {
  const items = lookAlikes(card.note)
  if (!items.length) return null
  const flag = (l: (typeof items)[number]) => l.flag && <MiniFlag file={l.flag} name={l.name} />
  const note = (text: string) => <span className="text-balance text-[12.5px] text-ink-2 first-letter:uppercase short:text-[12px]">{text}</span>
  // Under a hairline: a centred "Looks like", then one look-alike centred on its own, or two as aligned rows.
  return (
    <div className="flex w-full max-w-[400px] flex-col items-center border-t border-line pt-3 text-[13.5px] leading-snug short:pt-2 short:text-[12.5px]">
      <div className="mb-2 text-[12.5px] text-ink-3 short:mb-1">Looks like</div>
      {items.length === 1 ? (
        <div className="flex flex-col items-center gap-0.5 text-center">
          <span className="flex items-center gap-2">
            <span className="flex h-[1.25em] w-7 items-center justify-center">{flag(items[0])}</span>
            <span className="font-medium text-ink">{items[0].name}</span>
          </span>
          {items[0].note && note(items[0].note)}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 short:gap-1.5">
          {items.map((l) => (
            <div key={l.name} className="flex items-start gap-3 text-left">
              <span className="flex h-[1.375em] w-9 shrink-0 items-center justify-center">{flag(l)}</span>
              <span className="flex min-w-0 flex-col">
                <span className="font-medium text-ink">{l.name}</span>
                {l.note && note(l.note)}
              </span>
            </div>
          ))}
        </div>
      )}
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
/** Scrolls only when the content can't fit, e.g. a long answer with the map on a short screen, and then fades at the
 * edge with more to see. On a wide short screen it keeps clear of the corner tag and buttons. */
const body = (shown: boolean) =>
  `flex max-h-full w-full flex-col items-center gap-3 px-8 py-6 short:gap-2 short:py-3 sm:short:px-24 ${shown ? 'overflow-y-auto scroll-fade' : ''}`

export function Card({ card, row, flipped, showMap, onFlip, onGrade, onSpeak, onToggleMap, input, typed }: Props) {
  const tag = stateTag(row)
  const drag = useDragControls()
  const front = useRef<HTMLDivElement>(null)
  // Once the answer is shown, tapping the card turns it over again, to look at the question (a flag, say) full size.
  // Each tap is another half turn the same way round; an even number of them shows the answer.
  const [turns, setTurns] = useState(0)
  const answerUp = flipped && turns % 2 === 0
  // A swipe that doesn't go far enough to grade springs back; its pointer-up mustn't also count as a tap.
  const dragged = useRef(false)
  // Once turned over, the answer box lets go of the keyboard so Enter and the number keys grade.
  useEffect(() => {
    if (flipped && front.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
  }, [flipped])
  return (
    <motion.div
      data-card={card.id}
      className={`absolute inset-0 [perspective:1400px] short:[container-type:size] ${flipped ? 'touch-pan-y' : ''}`}
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
      onDragStart={() => {
        dragged.current = true
      }}
      onDragEnd={(_, { offset, velocity }) => {
        const dx = offset.x + velocity.x * 0.15
        if (dx > SWIPE) onGrade(Rating.Good)
        else if (dx < -SWIPE) onGrade(Rating.Again)
      }}
    >
      <motion.div
        className="relative h-full w-full cursor-pointer select-none [transform-style:preserve-3d]"
        animate={{ rotateY: (flipped ? 180 : 0) + turns * 180 }}
        transition={{ duration: 0.38 * SLOW, ease: [0.3, 0.7, 0.2, 1] }}
        onClick={() => {
          if (dragged.current) return void (dragged.current = false)
          if (flipped) setTurns((t) => t + 1)
          else onFlip()
        }}
      >
        <div ref={front} className={face} inert={answerUp}>
          <span className={`absolute left-5 top-4 text-[11px] font-medium ${tag.cls}`}>{tag.label}</span>
          <div className={body(!answerUp)}>
            <Front card={card} />
            {input && <AnswerInput card={card} input={input} />}
          </div>
        </div>
        <div className={`${face} [transform:rotateY(180deg)]`} inert={!answerUp}>
          <span className={`absolute left-5 top-4 text-[11px] font-medium ${tag.cls}`}>{tag.label}</span>
          {typed && <Result typed={typed} />}
          {/* A scroller sets its own touch-action, so it needs pan-y too or a swipe starting on the answer is lost. */}
          <div className={`${body(answerUp)} touch-pan-y`}>
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
