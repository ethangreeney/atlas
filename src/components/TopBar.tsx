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
}

const Count = ({ n, label, cls }: { n: number; label: string; cls: string }) => (
  <span className="flex items-baseline gap-1">
    <span className={`text-[13px] font-semibold tabular-nums ${cls}`}>{n}</span>
    <span className="hidden text-[12px] text-ink-3 sm:inline">{label}</span>
  </span>
)

const IconButton = ({
  onClick,
  label,
  active,
  disabled,
  children,
}: {
  onClick: () => void
  label: string
  active?: boolean
  disabled?: boolean
  children: React.ReactNode
}) => (
  <button
    onClick={onClick}
    aria-label={label}
    title={label}
    disabled={disabled}
    className={`relative flex h-9 w-9 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-neutral-100 hover:text-ink disabled:pointer-events-none disabled:opacity-30 ${active ? 'bg-neutral-100 text-ink' : ''}`}
  >
    {children}
  </button>
)

export function TopBar({ queue, learned, canUndo, filtersOpen, filtersActive, onUndo, onToggleFilters, onSynced }: Props) {
  const c = queue?.counts
  return (
    <header className="relative flex h-14 shrink-0 items-center justify-between px-4 sm:px-6">
      <div className="flex items-baseline gap-3">
        <span className="text-[15px] font-semibold tracking-[-0.02em] text-ink">Atlas</span>
        {learned > 0 && (
          <span className="hidden text-[12px] text-ink-3 sm:inline" title="Cards you have answered at least once">
            <span className="tabular-nums">{learned}</span> learned
          </span>
        )}
      </div>
      <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-3 sm:gap-4">
        {c && (
          <>
            <Count n={c.new} label="new" cls="text-easy" />
            <Count n={c.learn} label="learn" cls="text-again" />
            <Count n={c.due} label="due" cls="text-good" />
          </>
        )}
      </div>
      <div className="flex items-center gap-1">
        <IconButton onClick={onUndo} label="Undo (Z)" disabled={!canUndo}>
          <Undo2 size={17} strokeWidth={1.75} />
        </IconButton>
        <IconButton onClick={onToggleFilters} label="Filters" active={filtersOpen}>
          <SlidersHorizontal size={17} strokeWidth={1.75} />
          {filtersActive && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-ink" />}
        </IconButton>
        <Account onSynced={onSynced} />
      </div>
    </header>
  )
}
