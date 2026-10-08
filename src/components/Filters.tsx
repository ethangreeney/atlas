import { ChevronDown } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ALL_CARDS, CARD_TYPES, DECKS, FIND_CARDS, KINDS, OUTLINE_CARDS, REGIONS, regionLabel, type CoreType, type DeckId, type Kind } from '../lib/deck'
import { countMatching } from '../lib/scheduler'
import { setSettings, useSettings } from '../lib/settings'

const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button
    onClick={onClick}
    aria-pressed={on}
    className={`relative rounded-full border px-2.5 py-1 text-[12.5px] transition-colors after:absolute after:-inset-1 pointer-coarse:py-1.5 ${
      on ? 'border-ink bg-ink font-medium text-on-ink' : 'border-line text-ink-2 hover:border-ink-3 hover:text-ink'
    }`}
  >
    {children}
  </button>
)

const Switch = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button role="switch" aria-checked={on} onClick={onClick} className="flex min-h-10 w-full items-center justify-between gap-4 text-left text-[13.5px] text-ink">
    {children}
    <span className={`relative h-5 w-8 shrink-0 rounded-full transition-colors ${on ? 'bg-ink' : 'bg-muted-2'}`}>
      <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full shadow-sm transition-transform ${on ? 'translate-x-3 bg-on-ink' : 'bg-knob'}`} />
    </span>
  </button>
)

/** What a group is set to, in a few words: "All", "Europe, Asia", "Europe, Asia +2". */
const summary = (labels: string[]) => (!labels.length ? 'All' : labels.length <= 2 ? labels.join(', ') : `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`)

/** One filter, folded to a line that says what it's set to; open, its options. */
const Fold = ({ label, value, open, onToggle, children }: { label: string; value: string[]; open: boolean; onToggle: () => void; children: React.ReactNode }) => (
  <div>
    <button onClick={onToggle} aria-expanded={open} className="group flex min-h-10 w-full items-center gap-3 text-left text-[13.5px]">
      <span className="text-ink">{label}</span>
      <span className={`ml-auto truncate text-[13px] ${value.length ? 'text-ink' : 'text-ink-3'}`}>{summary(value)}</span>
      <ChevronDown size={15} strokeWidth={1.75} className={`shrink-0 text-ink-3 transition-transform duration-200 group-hover:text-ink-2 ${open ? 'rotate-180' : ''}`} />
    </button>
    <div className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`} inert={!open}>
      <div className="min-h-0 overflow-hidden">
        <div className="flex flex-wrap gap-1.5 pb-3 pt-0.5 pointer-coarse:gap-y-2">{children}</div>
      </div>
    </div>
  </div>
)

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

const SIZE: Record<DeckId, number> = { ug: ALL_CARDS.length, outlines: OUTLINE_CARDS.length, find: FIND_CARDS.length }
const PER_DAY = [10, 20, 40]

/** Which sets, then card types, kinds of place and regions: any chip within a group, and every group. */
export function Filters({ onClose }: { onClose: () => void }) {
  const s = useSettings()
  const ref = useRef<HTMLDivElement>(null)
  const count = useMemo(() => countMatching(s), [s])
  // One filter open at a time; the rest stay folded to a line each.
  const [open, setOpen] = useState<'types' | 'kinds' | 'regions' | null>(null)
  const fold = (f: NonNullable<typeof open>) => setOpen((o) => (o === f ? null : f))

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element
      // The toggle button closes the panel itself; treating it as outside would close and reopen it.
      if (ref.current?.contains(t) || t.closest?.('[aria-controls="filters"]')) return
      onClose()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [onClose])

  // Escape closes the panel (in App); focus goes back to the button that opened it rather than dropping to the page.
  // Tabbing out of the panel closes it too, so focus never lands on the card half hidden beneath it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && ref.current?.contains(document.activeElement)) document.querySelector<HTMLElement>('[aria-controls="filters"]')?.focus()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [])

  return (
    <motion.div
      ref={ref}
      id="filters"
      onBlur={(e) => {
        const to = e.relatedTarget
        if (to && !e.currentTarget.contains(to) && !to.closest('[aria-controls="filters"]')) onClose()
      }}
      className="card-shadow absolute right-4 top-14 z-40 max-h-[calc(100%-4.5rem)] w-[min(360px,calc(100%-32px))] overflow-y-auto rounded-2xl bg-surface px-4 pb-2 pt-3 sm:right-6"
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div className="flex h-7 items-baseline justify-between">
        <h2 className="text-[12.5px] font-medium text-ink-3">Study</h2>
        <span aria-live="polite" className={`text-[12.5px] tabular-nums ${count ? 'text-ink-3' : 'text-again'}`}>
          {count ? `${count.toLocaleString()} card${count === 1 ? '' : 's'}` : 'No cards match'}
        </span>
      </div>
      {DECKS.map((d) => (
        <Switch key={d.id} on={s.decks.includes(d.id)} onClick={() => setSettings({ decks: toggle<DeckId>(s.decks, d.id) })}>
          <span className="flex flex-col py-1.5">
            <span>{d.label}</span>
            <span className="text-[12px] text-ink-3">
              {SIZE[d.id].toLocaleString()} cards{d.about && ` · ${d.about}`}
            </span>
          </span>
        </Switch>
      ))}

      <div className="my-2 border-t border-line" />
      {/* Card types are Ultimate Geography's; each extra set has just the one. */}
      {s.decks.includes('ug') && (
        <Fold label="Cards" value={CARD_TYPES.filter((t) => s.types.includes(t.id)).map((t) => t.label)} open={open === 'types'} onToggle={() => fold('types')}>
          <Chip on={!s.types.length} onClick={() => setSettings({ types: [] })}>
            All
          </Chip>
          {CARD_TYPES.map((t) => (
            <Chip key={t.id} on={s.types.includes(t.id)} onClick={() => setSettings({ types: toggle<CoreType>(s.types, t.id) })}>
              {t.label}
            </Chip>
          ))}
        </Fold>
      )}
      <Fold label="Places" value={KINDS.filter((k) => s.kinds.includes(k.id)).map((k) => k.label)} open={open === 'kinds'} onToggle={() => fold('kinds')}>
        <Chip on={!s.kinds.length} onClick={() => setSettings({ kinds: [] })}>
          All
        </Chip>
        {KINDS.map((k) => (
          <Chip key={k.id} on={s.kinds.includes(k.id)} onClick={() => setSettings({ kinds: toggle<Kind>(s.kinds, k.id) })}>
            {k.label}
          </Chip>
        ))}
      </Fold>
      <Fold label="Regions" value={REGIONS.filter((r) => s.regions.includes(r)).map(regionLabel)} open={open === 'regions'} onToggle={() => fold('regions')}>
        <Chip on={!s.regions.length} onClick={() => setSettings({ regions: [] })}>
          All
        </Chip>
        {REGIONS.map((r) => (
          <Chip key={r} on={s.regions.includes(r)} onClick={() => setSettings({ regions: toggle(s.regions, r) })}>
            {regionLabel(r)}
          </Chip>
        ))}
      </Fold>

      <div className="my-2 border-t border-line" />
      <div className="flex min-h-10 items-center justify-between text-[13.5px] text-ink">
        <span id="per-day">New cards a day</span>
        {/* One control with a thumb that slides between the choices. */}
        <div role="radiogroup" aria-labelledby="per-day" className="flex rounded-full bg-muted p-0.5">
          {PER_DAY.map((n) => {
            const on = s.newPerDay === n
            return (
              <button
                key={n}
                role="radio"
                aria-checked={on}
                onClick={() => setSettings({ newPerDay: n })}
                className={`relative h-7 w-10 rounded-full text-[12.5px] tabular-nums transition-colors ${on ? 'font-medium text-ink' : 'text-ink-3 hover:text-ink-2'}`}
              >
                {on && (
                  <motion.span
                    layoutId="per-day"
                    transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                    className="absolute inset-0 rounded-full bg-surface shadow-[0_0_0_1px_var(--color-edge),0_1px_2px_var(--color-drop)] dark:bg-muted-2"
                  />
                )}
                <span className="relative">{n}</span>
              </button>
            )
          })}
        </div>
      </div>
      <Switch on={s.autoplay} onClick={() => setSettings({ autoplay: !s.autoplay })}>
        Auto-play pronunciation
      </Switch>
      <Switch on={s.typeAnswers} onClick={() => setSettings({ typeAnswers: !s.typeAnswers })}>
        Type answers
      </Switch>
    </motion.div>
  )
}
