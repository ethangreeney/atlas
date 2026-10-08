import { X } from 'lucide-react'
import { motion } from 'motion/react'
import type { DeckCard } from '../lib/deck'
import type { CardRow } from '../lib/db'
import type { FindHandle, FindResult } from '../lib/find/engine'
import { stateTag, variants } from './Card'
import { FindMap } from './FindMap'

/** A tick that draws itself in, once the prompt has cleared. */
const Tick = () => (
  <svg aria-hidden className="find-tick shrink-0" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <path pathLength={1} d="M20 6 9 17l-5-5" />
  </svg>
)

const line = 'absolute inset-x-0 truncate leading-[18px] transition-[opacity,transform] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none'

/** Under the name: what to do, then how it went. The prompt clears before the result comes in, so they never overlap. */
export function FindSub({ card, result }: { card: DeckCard; result: FindResult | null }) {
  const head =
    result?.kind === 'right' ? (
      <>
        <Tick />
        <span className="truncate">Correct</span>
      </>
    ) : result?.kind === 'wrong' ? (
      <>
        <X size={15} strokeWidth={2.5} aria-hidden className="shrink-0" />
        <span className="truncate">That's {result.name}</span>
      </>
    ) : result ? (
      <span className="truncate">Shown in green</span>
    ) : null
  const detail = result?.kind === 'wrong' ? `${card.note.country} is shown in green` : result?.kind === 'shown' ? card.note.countryInfo : ''
  const colour = result?.kind === 'right' ? 'text-good' : result?.kind === 'wrong' ? 'text-again' : 'text-ink-2'
  return (
    <div className="relative h-[38px] w-full" aria-live="polite">
      <div className={`${line} top-[10px] text-[12.5px] font-medium text-ink-3 ${result ? '-translate-y-1 opacity-0 duration-100' : 'duration-200'}`}>Find on the map</div>
      <div
        className={`${line} ${detail ? 'top-0' : 'top-[10px]'} flex items-center justify-center gap-[5px] text-[13.5px] font-medium ${colour} ${result ? `translate-y-0 opacity-100 delay-[60ms] ${result.kind === 'right' ? 'duration-[180ms]' : 'duration-[250ms]'}` : 'translate-y-1 opacity-0 duration-0'}`}
      >
        {head}
      </div>
      <div className={`${line} top-[20px] text-[12.5px] text-ink-3 ${result && detail ? 'translate-y-0 opacity-100 delay-150 duration-[250ms]' : 'translate-y-1 opacity-0 duration-0'}`}>{detail}</div>
    </div>
  )
}

type Props = {
  card: DeckCard
  row: CardRow
  result: FindResult | null
  control: React.RefObject<FindHandle | null>
  onResult: (r: FindResult) => void
  onNext: () => void
}

/**
 * Find on the map: the name over a blank world map. Click the place, at any zoom, to answer. Right counts as Good and
 * moves on by itself; anything else shows where it is and counts as Again.
 */
export function FindCard({ card, row, result, control, onResult, onNext }: Props) {
  const tag = stateTag(row)
  return (
    <motion.div data-card={card.id} className="absolute inset-0" variants={variants} initial="enter" animate="center" exit="exit">
      <div className="card-shadow absolute inset-0 flex flex-col overflow-hidden rounded-3xl bg-surface text-center">
        <span className={`absolute left-5 top-4 z-[1] text-[11px] font-medium ${tag.cls}`}>{tag.label}</span>
        <div className="flex shrink-0 flex-col items-center gap-1 px-6 pb-2.5 pt-[30px] short:pb-1.5 short:pt-4">
          <div className="max-w-full text-balance text-[clamp(24px,4vw,32px)] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">{card.note.country}</div>
          <FindSub card={card} result={result} />
        </div>
        <FindMap
          noteId={card.note.id}
          control={control}
          onResult={onResult}
          onNext={onNext}
          label={`World map. Click or tap ${card.note.country}.`}
          className="min-h-0 flex-1 border-t border-line"
        />
      </div>
    </motion.div>
  )
}
