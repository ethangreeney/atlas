import { SlidersHorizontal, Undo2 } from 'lucide-react'
import type { Queue } from '../lib/scheduler'
import { Account } from './Account'

type Props = {
  queue: Queue | null
  learned: number
  canUndo: boolean
  filtersOpen: boolean
  filtersActive: boolean
  onUndo: () => void
  onToggleFilters: () => void
  onSynced: () => void
  onOpenProgress: () => void
  /** Size of the drill under way, 0 when studying normally. */
  drilling: number
  onExitDrill: () => void
}

const Count = ({ n, label, cls }: { n: number; label: string; cls: string }) => (
  <span className="flex items-baseline gap-1">
    <span className={`text-[13px] font-semibold tabular-nums ${cls}`}>{n}</span>
    <span className="text-[12px] text-ink-3">{label}</span>
  </span>
)

const IconButton = ({
  onClick,
  label,
  active,
  disabled,
  controls,
  children,
}: {
  onClick: () => void
  label: string
  active?: boolean
  disabled?: boolean
  /** Id of the panel this button opens and closes. */
  controls?: string
  children: React.ReactNode
}) => (
  <button
    onClick={onClick}
    aria-label={label}
    title={label}
    disabled={disabled}
    aria-controls={controls}
    aria-expanded={controls ? !!active : undefined}
    className={`relative flex h-9 w-9 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-muted hover:text-ink disabled:pointer-events-none disabled:opacity-30 ${active ? 'bg-muted text-ink' : ''}`}
  >
    {children}
  </button>
)

/** Phone top bar: the counts take the place of the wordmark. */
const InlineCounts = ({ c }: { c: NonNullable<Queue['counts']> }) => (
  <div className="flex items-baseline gap-3 sm:hidden">
    <Count n={c.new} label="new" cls="text-easy" />
    <Count n={c.learn} label="learning" cls="text-again" />
    <Count n={c.due} label="review" cls="text-good" />
  </div>
)

/** Stands in for the counts while drilling the hardest cards. */
const Drilling = ({ n, onExit }: { n: number; onExit: () => void }) => (
  <span className="flex items-baseline gap-1.5 whitespace-nowrap text-[12px] text-ink-3">
    <span className="text-ink-2">Drilling {n} hardest</span>·
    <button onClick={onExit} className="relative font-medium text-ink-2 transition-colors after:absolute after:-inset-x-2 after:-inset-y-3 hover:text-ink">
      Exit
    </button>
  </span>
)

export function TopBar({ queue, learned, canUndo, filtersOpen, filtersActive, onUndo, onToggleFilters, onSynced, onOpenProgress, drilling, onExitDrill }: Props) {
  const c = queue?.counts
  return (
    <header className="relative flex h-14 shrink-0 items-center justify-between gap-2 px-4 sm:px-6">
      {drilling > 0 ? (
        <span className="sm:hidden">
          <Drilling n={drilling} onExit={onExitDrill} />
        </span>
      ) : (
        c && <InlineCounts c={c} />
      )}
      <div className="hidden shrink-0 items-baseline gap-3 sm:flex">
        <span className="text-[15px] font-semibold tracking-[-0.02em] text-ink">Atlas</span>
        {learned > 0 && (
          <button
            onClick={onOpenProgress}
            className="relative hidden text-[12px] text-ink-3 transition-colors after:absolute after:-inset-x-2 after:-inset-y-3 hover:text-ink sm:inline"
            title="Progress (P)"
          >
            <span className="tabular-nums">{learned}</span> learned
          </button>
        )}
      </div>
      <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-4 sm:flex">
        {drilling > 0 ? (
          <Drilling n={drilling} onExit={onExitDrill} />
        ) : c && (
          <>
            <Count n={c.new} label="new" cls="text-easy" />
            <Count n={c.learn} label="learning" cls="text-again" />
            <Count n={c.due} label="review" cls="text-good" />
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center sm:gap-1">
        <IconButton onClick={onUndo} label="Undo (Z)" disabled={!canUndo}>
          <Undo2 size={17} strokeWidth={1.75} />
        </IconButton>
        <IconButton onClick={onToggleFilters} label="Filters" active={filtersOpen} controls="filters">
          <SlidersHorizontal size={17} strokeWidth={1.75} />
          {filtersActive && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-ink" />}
        </IconButton>
        <Account onSynced={onSynced} />
      </div>
    </header>
  )
}
