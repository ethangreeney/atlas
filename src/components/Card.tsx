import { ExternalLink, Map as MapIcon, Volume2 } from 'lucide-react'
import { motion, type Variants } from 'motion/react'
import { State } from 'ts-fsrs'
import { mediaUrl, type DeckCard } from '../lib/deck'
import type { CardRow } from '../lib/db'

export type ExitTarget = { x: number; y: number; rotate: number }

const EASE = [0.2, 0.8, 0.2, 1] as const
// Debug/filming: ?slow=4 stretches the flip and fly-away animations 4x.
const SLOW = typeof location !== 'undefined' ? Number(new URLSearchParams(location.search).get('slow')) || 1 : 1

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
  <div className="text-balance text-[clamp(28px,4.6vw,40px)] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">{children}</div>
)
const Small = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[15px] font-medium text-ink-2">{children}</div>
)
/** A name on the answer side: tap it to hear just that name. */
const Say = ({ text, onSay, big }: { text: string; onSay: (t: string) => void; big?: boolean }) => (
  <button
    type="button"
    title={`Hear “${text}”`}
    className="group relative cursor-pointer text-inherit transition-colors hover:text-ink"
    onClick={(e) => {
      e.stopPropagation()
      onSay(text)
    }}
  >
    {text}
    <Volume2
      size={big ? 18 : 13}
      strokeWidth={2}
      aria-hidden
      className={`absolute left-full top-1/2 -translate-y-1/2 text-ink-3 opacity-60 transition-opacity group-hover:opacity-100 ${big ? 'ml-2' : 'ml-1.5'}`}
    />
  </button>
)

const Info = ({ children }: { children: React.ReactNode }) =>
  children ? <div className="max-w-[34ch] text-balance text-[13px] leading-snug text-ink-3">{children}</div> : null

const Flag = ({ file, size }: { file: string; size: 'lg' | 'sm' }) => (
  <img
    src={mediaUrl(file)}
    alt=""
    draggable={false}
    className={`${size === 'lg' ? 'max-h-[min(190px,26vh)] max-w-[min(300px,70vw)]' : 'max-h-16 max-w-[110px]'} ${file.includes('-nobox') ? '' : 'img-shadow rounded-[3px]'}`}
  />
)
const Map = ({ file, size }: { file: string; size: 'lg' | 'sm' }) => (
  <img
    src={mediaUrl(file)}
    alt=""
    draggable={false}
    className={`${size === 'lg' ? 'w-[min(400px,74vw)]' : 'w-[min(190px,40vw)]'} rounded-xl img-shadow`}
  />
)

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
          <Flag file={n.flag!} size="lg" />
        </>
      )
    case 'map':
      return (
        <>
          <Label>Location</Label>
          <Map file={n.map!} size="lg" />
        </>
      )
  }
}

function Back({ card, showMap, onSay }: { card: DeckCard; showMap: boolean; onSay: (t: string) => void }) {
  const n = card.note
  const map = showMap && n.map && card.type !== 'map' ? <Map file={n.map} size="sm" /> : null
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
          {map ?? <Flag file={n.flagBack ?? n.flag!} size="sm" />}
          <Big>
            <Say text={n.country!} onSay={onSay} big />
          </Big>
          <Info>{n.countryInfo}</Info>
          <Info>{n.flagSimilar ? `Similar to ${n.flagSimilar}` : ''}</Info>
        </>
      )
    case 'map':
      return (
        <>
          <Map file={n.map!} size="sm" />
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
  onSpeak: (text?: string) => void
  onToggleMap: () => void
}

/** Google Maps search for the place this card is about. */
export const mapsUrl = (card: DeckCard) => {
  const q = card.type === 'capital' ? `${card.note.capital}, ${card.note.country}` : card.note.country
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
}

const Action = ({ label, onClick, href, children }: { label: string; onClick?: () => void; href?: string; children: React.ReactNode }) => {
  const cls = 'flex h-8 w-8 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-neutral-100 hover:text-ink'
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

export function Card({ card, row, flipped, showMap, onFlip, onSpeak, onToggleMap }: Props) {
  const tag = stateTag(row)
  return (
    <motion.div
      className="absolute inset-0 [perspective:1400px]"
      variants={variants}
      initial="enter"
      animate="center"
      exit="exit"
    >
      <motion.div
        className="relative h-full w-full cursor-pointer select-none [transform-style:preserve-3d]"
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ duration: 0.38 * SLOW, ease: [0.3, 0.7, 0.2, 1] }}
        onClick={() => !flipped && onFlip()}
        role="button"
        aria-label={flipped ? 'Answer' : 'Show answer'}
      >
        <div className="backface-hidden card-shadow absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-3xl bg-white px-8 text-center">
          <span className={`absolute left-5 top-4 text-[11px] font-medium ${tag.cls}`}>{tag.label}</span>
          <Front card={card} />
        </div>
        <div className="backface-hidden card-shadow absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-3xl bg-white px-8 text-center [transform:rotateY(180deg)]">
          <span className={`absolute left-5 top-4 text-[11px] font-medium ${tag.cls}`}>{tag.label}</span>
          <Back card={card} showMap={showMap} onSay={onSpeak} />
          <div className="absolute bottom-3 right-3 flex items-center gap-0.5">
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
    </motion.div>
  )
}
