import { Check, ExternalLink, Map as MapIcon, Volume2 } from 'lucide-react'
import { motion, useDragControls, useMotionValue, useMotionValueEvent, useSpring, useTransform, type Variants } from 'motion/react'
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
// Debug/filming: ?slow=4 stretches the reveal and fly-away animations 4x.
const SLOW = typeof location !== 'undefined' ? Number(new URLSearchParams(location.search).get('slow')) || 1 : 1
/** How far a finger has to swipe a card (plus a bit for a flick) for it to count. */
const SWIPE = 90
/** The card follows a swiping finger only this much of the way, so it has some weight to it. */
const GIVE = 0.5
const glow = 'pointer-events-none absolute top-[10%] h-[80%] w-24 rounded-full opacity-0 blur-2xl'
const washed = 'pointer-events-none absolute inset-0 -z-10 rounded-3xl opacity-0'
const wash = (to: 'left' | 'right', tone: string) =>
  `linear-gradient(to ${to}, color-mix(in oklab, ${tone} 14%, transparent), transparent 42%)`
/** Taps this soon after the answer comes in are a double tap on Show answer, not a wish to hide it again. */
export const SETTLE_MS = 350

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

/** How things move when the answer comes in: the question settles smaller and higher, the answer rises in under it. */
const GLIDE = '[transition-duration:var(--reveal)] ease-[cubic-bezier(0.3,0.7,0.2,1)] motion-reduce:transition-none'

/** The question side says only what the picture is; the answer side can name it. Hold it, or press its corner button, to see it up close. */
const Flag = ({ file, size, alt }: { file: string; size: 'lg' | 'md'; alt: string }) => (
  <Zoomable file={file} alt={alt} label={ZOOM_LABEL}>
    <img
      src={mediaUrl(file)}
      alt={alt}
      draggable={false}
      {...useHoldToZoom(file, alt)}
      className={`transition-[max-height,max-width] ${GLIDE} ${size === 'lg' ? 'max-h-[min(190px,26dvh)] max-w-[min(300px,70vw)] short:max-h-[min(190px,100cqh_-_56px)]' : 'max-h-[min(96px,14dvh)] max-w-[160px] short:max-h-12'} ${file.includes('-nobox') ? '' : 'img-shadow rounded-[3px]'}`}
    />
  </Zoomable>
)

/** A look-alike's flag, small beside its name; hold it to see it up close too. Decorative otherwise: the name is right there. */
const MiniFlag = ({ file, name }: { file: string; name: string }) => (
  <img src={mediaUrl(file)} alt="" draggable={false} {...useHoldToZoom(file, `Flag of ${name}`)} className="img-shadow max-h-full max-w-full rounded-[2px]" />
)
const MAP_SIZE = {
  lg: 'w-[min(400px,74vw,70dvh)] short:max-w-[min(400px,74vw,100%)] short:max-h-[min(300px,100cqh_-_56px)]',
  md: 'w-[min(230px,48vw)] short:max-w-[min(230px,48vw)] short:max-h-[clamp(24px,100cqh_-_110px,120px)]',
  sm: 'w-[min(190px,40vw)] short:max-w-[min(190px,40vw)] short:max-h-[clamp(24px,100cqh_-_110px,110px)]',
}
const Map = ({ file, size, alt }: { file: string; size: keyof typeof MAP_SIZE; alt: string }) => (
  <Zoomable file={file} alt={alt} label={ZOOM_LABEL}>
    <img
      src={mediaUrl(file)}
      alt={alt}
      draggable={false}
      {...useHoldToZoom(file, alt)}
      // Short screens size maps by the card's height (cqh), so the answer beneath still fits.
      className={`transition-[width,max-width,max-height] ${GLIDE} ${MAP_SIZE[size]} rounded-xl img-shadow img-dim short:w-auto`}
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

/** Folds to nothing, or opens to its content's height, so everything around it glides instead of jumping. */
const Fold = ({ open, rise, children }: { open: boolean; rise?: boolean; children: React.ReactNode }) => (
  <div
    className={`grid w-full transition-[grid-template-rows,opacity] ${GLIDE} ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
    inert={!open}
  >
    {/* Padded inside the fold, so a closed one leaves no gap, and shadows aren't clipped at its edges. */}
    <div className="-mx-3 flex min-h-0 flex-col items-center gap-3 overflow-hidden px-3 short:gap-2">
      <div
        className={`flex w-full flex-col items-center gap-3 short:gap-2 ${rise ? `origin-top pt-4 transition-transform ${GLIDE} short:pt-2 ${open ? 'translate-y-0 scale-100' : 'translate-y-2 scale-[0.96]'}` : ''}`}
      >
        {children}
      </div>
    </div>
  </div>
)

/** A name asked about: big on its own, then small and quieter over the answer, which can say it. */
const Asked = ({ text, small, onSay }: { text: string; small: boolean; onSay: (t: string) => void }) => (
  <div
    className={`text-balance transition-[font-size,color,letter-spacing] ${GLIDE} ${small ? 'text-[15px] font-medium leading-snug tracking-normal text-ink-2' : 'text-[clamp(28px,4.6vw,40px)] font-semibold leading-[1.1] tracking-[-0.02em] text-ink short:text-[24px]'}`}
  >
    {small ? <Say text={text} onSay={onSay} /> : text}
  </div>
)

/** The question, which stays put when the answer comes in: its label folds away and it settles smaller. */
function Question({ card, up, onSay }: { card: DeckCard; up: boolean; onSay: (t: string) => void }) {
  const n = card.note
  const label = (text: string) => (
    <Fold open={!up}>
      <div className="pb-3 short:pb-2">
        <Label>{text}</Label>
      </div>
    </Fold>
  )
  switch (card.type) {
    case 'capital':
      return (
        <>
          {label('Capital of')}
          <Asked text={n.country} small={up} onSay={onSay} />
          {n.countryInfo && (
            <Fold open={!up}>
              <div className="pt-3 short:pt-2">
                <Info>{n.countryInfo}</Info>
              </div>
            </Fold>
          )}
        </>
      )
    case 'country':
      return (
        <>
          {label('Capital')}
          <Asked text={n.capital} small={up} onSay={onSay} />
          {n.capitalHint && (
            <Fold open={!up}>
              <div className="pt-3 short:pt-2">
                <Info>Hint: {n.capitalHint}</Info>
              </div>
            </Fold>
          )}
        </>
      )
    case 'flag':
      return (
        <>
          {label('Flag')}
          {/* Some flags are blurred where they'd spell out the answer; the answer shows them clear. */}
          <Flag file={up ? (n.flagBack ?? n.flag!) : n.flag!} size={up ? 'md' : 'lg'} alt={up ? `Flag of ${n.country}` : 'Flag'} />
        </>
      )
    case 'map':
      return (
        <>
          {label('Location')}
          <Map file={n.map!} size={up ? 'md' : 'lg'} alt={up ? `Map of ${n.country}` : 'Map'} />
        </>
      )
  }
}

/** What rises in under the question. */
function Answer({ card, showMap, onSay }: { card: DeckCard; showMap: boolean; onSay: (t: string) => void }) {
  const n = card.note
  const map = showMap && n.map && card.type !== 'map' ? <Map file={n.map} size="sm" alt={`Map of ${n.country}`} /> : null
  const big = (text: string) => (
    <Big>
      <Say text={text} onSay={onSay} big />
    </Big>
  )
  switch (card.type) {
    case 'capital':
      return (
        <>
          {big(n.capital)}
          <Info>{n.capitalInfo}</Info>
          {map}
        </>
      )
    case 'country':
      return (
        <>
          {big(n.country)}
          <Info>{n.countryInfo}</Info>
          {map}
        </>
      )
    case 'flag':
      return (
        <>
          {big(n.country)}
          <Info>{n.countryInfo}</Info>
          {map}
          <LookAlikes card={card} />
        </>
      )
    case 'map':
      return (
        <>
          {big(n.country)}
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
  /** Swiped right before the answer was shown: already known. */
  onSure: () => void
  /** Where a swipe would land if let go now: a grade, or nothing yet. */
  onLean?: (g: Grade | null) => void
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

const face = 'card-shadow absolute inset-0 flex flex-col items-center justify-center rounded-3xl bg-surface text-center'
/** Scrolls only when the content can't fit, e.g. a long answer with the map on a short screen, and then fades at the
 * edge with more to see. On a wide short screen it keeps clear of the corner tag and buttons. */
const body = (up: boolean) =>
  `flex max-h-full w-full flex-col items-center overflow-y-auto scroll-fade px-8 pt-6 transition-[padding] ${GLIDE} short:pt-3 sm:short:px-24 ${up ? 'pb-10' : 'pb-6 short:pb-3'}`

export function Card({ card, row, flipped, showMap, onFlip, onGrade, onSpeak, onToggleMap, onSure, onLean, input, typed }: Props) {
  const tag = stateTag(row)
  const drag = useDragControls()
  const self = useRef<HTMLDivElement>(null)
  // Once the answer is shown, tapping the card hides it again, to look at the question (a flag, say) full size.
  // Each tap toggles; an even number of them shows the answer.
  const [turns, setTurns] = useState(0)
  const answerUp = flipped && turns % 2 === 0
  // A swipe that doesn't go far enough to grade springs back; its pointer-up mustn't also count as a tap.
  const dragged = useRef(false)
  const shownAt = useRef(0)
  useEffect(() => {
    if (answerUp) shownAt.current = Date.now()
  }, [answerUp])
  // A swiped card tips a little about its foot, easing after the finger rather than snapping to it, and glows on the
  // side it's heading: green for Good, red for Again, or, before the answer's shown, plain for "show me".
  const swipe = useMotionValue(0)
  const lean = useSpring(useTransform(swipe, [-280, 0, 280], [-3.5, 0, 3.5]), { stiffness: 220, damping: 28 })
  const glowRight = useSpring(useTransform(swipe, [16, SWIPE * 1.15], [0, 1]), { stiffness: 260, damping: 32 })
  const glowLeft = useSpring(useTransform(swipe, [-16, -SWIPE * 1.15], [0, 1]), { stiffness: 260, damping: 32 })
  // Right on the question of a card never seen before means it was already known.
  const sure = !flipped && row.state === State.New ? Rating.Easy : Rating.Good
  const toRight = sure === Rating.Easy ? 'var(--color-easy)' : 'var(--color-good)'
  const toLeft = flipped ? 'var(--color-again)' : 'var(--color-ink-3)'
  const leaning = useRef<Grade | null>(null)
  useMotionValueEvent(swipe, 'change', (x) => {
    const g = x > SWIPE ? sure : x < -SWIPE && flipped ? Rating.Again : null
    if (g === leaning.current) return
    leaning.current = g
    onLean?.(g)
  })
  // Once the answer's shown, the answer box lets go of the keyboard so Enter and the number keys grade.
  useEffect(() => {
    if (flipped && document.activeElement instanceof HTMLInputElement && self.current?.contains(document.activeElement)) document.activeElement.blur()
  }, [flipped])
  return (
    <motion.div
      ref={self}
      data-card={card.id}
      data-answer={answerUp || undefined}
      className="absolute inset-0 touch-pan-y short:[container-type:size]"
      style={{ '--reveal': `${0.42 * SLOW}s` } as React.CSSProperties}
      variants={variants}
      initial="enter"
      animate="center"
      exit="exit"
      // Swipe by touch. Right is Good, even before the answer's shown, for a card already known. Left is Again once the
      // answer's up, and before that just shows it. A graded card flies to its pile from where it's let go.
      drag="x"
      dragControls={drag}
      dragListener={false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={GIVE}
      dragSnapToOrigin
      onPointerDown={(e) => e.pointerType !== 'mouse' && !(e.target as Element).closest('input') && drag.start(e)}
      onDragStart={() => {
        dragged.current = true
      }}
      onDrag={(_, { offset }) => swipe.set(offset.x)}
      onDragEnd={(_, { offset, velocity }) => {
        swipe.set(0)
        const dx = offset.x + velocity.x * 0.15
        if (dx > SWIPE) (flipped ? onGrade(Rating.Good) : onSure())
        else if (dx < -SWIPE) (flipped ? onGrade(Rating.Again) : onFlip())
      }}
    >
      {/* The glow behind each side, which shows past the card's edge. */}
      <motion.div aria-hidden style={{ opacity: glowRight, background: toRight }} className={`${glow} -right-4`} />
      <motion.div aria-hidden style={{ opacity: glowLeft, background: toLeft }} className={`${glow} -left-4`} />
      <motion.div
        className={`${face} isolate cursor-pointer select-none`}
        style={{ rotate: lean, originY: 1 }}
        onClick={() => {
          if (dragged.current) return void (dragged.current = false)
          if (!flipped) return onFlip()
          if (Date.now() - shownAt.current > SETTLE_MS) setTurns((t) => t + 1)
        }}
      >
        {/* And a wash of the same colour in from the leading edge. */}
        <motion.div aria-hidden style={{ opacity: glowRight, background: wash('left', toRight) }} className={washed} />
        <motion.div aria-hidden style={{ opacity: glowLeft, background: wash('right', toLeft) }} className={washed} />
        <span className={`absolute left-5 top-4 text-[11px] font-medium ${tag.cls}`}>{tag.label}</span>
        {typed && (
          <span className={`transition-opacity duration-300 ${answerUp ? 'opacity-100' : 'opacity-0'}`}>
            <Result typed={typed} />
          </span>
        )}
        {/* A scroller sets its own touch-action, so it needs pan-y too or a swipe starting on the answer is lost. */}
        <div className={`${body(answerUp)} touch-pan-y`}>
          <Question card={card} up={answerUp} onSay={onSpeak} />
          {input && (
            <Fold open={!flipped}>
              <div className="flex w-full justify-center pt-3 short:pt-2">
                <AnswerInput card={card} input={input} />
              </div>
            </Fold>
          )}
          <Fold open={answerUp} rise>
            <Answer card={card} showMap={showMap} onSay={onSpeak} />
          </Fold>
        </div>
        <div className={`absolute bottom-2.5 right-2.5 flex items-center gap-2 transition-opacity duration-300 ${answerUp ? 'opacity-100' : 'pointer-events-none opacity-0'}`} inert={!answerUp}>
          {card.type !== 'map' && card.note.map && (
            <Action label={showMap ? 'Hide map (M)' : 'Show map (M)'} onClick={onToggleMap}>
              <MapIcon size={16} strokeWidth={1.75} className={showMap ? 'text-ink' : ''} />
            </Action>
          )}
          <Action label="Open in Google Maps (G)" href={mapsUrl(card)}>
            <ExternalLink size={16} strokeWidth={1.75} />
          </Action>
        </div>
      </motion.div>
      <div aria-live="polite" className="sr-only">
        {flipped ? `Answer: ${answerOf(card)}` : ''}
      </div>
    </motion.div>
  )
}
