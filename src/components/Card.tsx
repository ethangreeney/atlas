import { motion, type Variants } from 'motion/react'
import { State } from 'ts-fsrs'
import { mediaUrl, type DeckCard } from '../lib/deck'
import type { CardRow } from '../lib/db'

export type ExitTarget = { x: number; y: number; rotate: number }

const EASE = [0.2, 0.8, 0.2, 1] as const
const SLOW = typeof location !== 'undefined' && location.search.includes('slow') ? 10 : 1 // debug: ?slow

const variants: Variants = {
  enter: { opacity: 0, scale: 0.97, y: 12, x: 0, rotate: 0, zIndex: 10 },
  center: { opacity: 1, scale: 1, y: 0, x: 0, rotate: 0, zIndex: 10, transition: { duration: 0.24, ease: EASE } },
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

function Back({ card }: { card: DeckCard }) {
  const n = card.note
  switch (card.type) {
    case 'capital':
      return (
        <>
          <Small>{n.country}</Small>
          <Big>{n.capital}</Big>
          <Info>{n.capitalInfo}</Info>
        </>
      )
    case 'country':
      return (
        <>
          <Small>{n.capital}</Small>
          <Big>{n.country}</Big>
          <Info>{n.countryInfo}</Info>
        </>
      )
    case 'flag':
      return (
        <>
          <Flag file={n.flagBack ?? n.flag!} size="sm" />
          <Big>{n.country}</Big>
          <Info>{n.countryInfo}</Info>
          <Info>{n.flagSimilar ? `Similar to ${n.flagSimilar}` : ''}</Info>
        </>
      )
    case 'map':
      return (
        <>
          <Map file={n.map!} size="sm" />
          <Big>{n.country}</Big>
          <Info>{n.countryInfo}</Info>
        </>
      )
  }
}

type Props = { card: DeckCard; row: CardRow; flipped: boolean; onFlip: () => void }

export function Card({ card, row, flipped, onFlip }: Props) {
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
        transition={{ duration: 0.38, ease: [0.3, 0.7, 0.2, 1] }}
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
          <Back card={card} />
        </div>
      </motion.div>
    </motion.div>
  )
}
