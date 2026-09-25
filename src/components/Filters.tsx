import { motion } from 'motion/react'
import { useEffect, useMemo, useRef } from 'react'
import { CARD_TYPES, KINDS, REGIONS, regionLabel, type CardType, type Kind } from '../lib/deck'
import { countMatching } from '../lib/scheduler'
import { setSettings, useSettings } from '../lib/settings'

const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button
    onClick={onClick}
    aria-pressed={on}
    className={`relative rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors after:absolute after:-inset-1 pointer-coarse:py-1.5 ${
      on ? 'border-ink bg-ink text-on-ink' : 'border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink'
    }`}
  >
    {children}
  </button>
)

const Heading = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-2 text-[12.5px] font-medium text-ink-3">{children}</div>
)

const Group = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-4 flex flex-wrap gap-1.5 pointer-coarse:gap-y-2">{children}</div>
)

const Switch = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button role="switch" aria-checked={on} onClick={onClick} className="flex min-h-9 w-full items-center justify-between text-left">
    {children}
    <span className={`relative h-5 w-8 shrink-0 rounded-full transition-colors ${on ? 'bg-ink' : 'bg-muted-2'}`}>
      <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full shadow-sm transition-transform ${on ? 'translate-x-3 bg-on-ink' : 'bg-knob'}`} />
    </span>
  </button>
)

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

/** Card types, kinds of place and regions: any chip within a group, and every group. */
export function Filters({ onClose }: { onClose: () => void }) {
  const s = useSettings()
  const ref = useRef<HTMLDivElement>(null)
  const count = useMemo(() => countMatching(s), [s])

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

  return (
    <motion.div
      ref={ref}
      id="filters"
      className="card-shadow absolute right-4 top-14 z-40 max-h-[calc(100%-4.5rem)] w-[min(380px,calc(100%-32px))] overflow-y-auto rounded-2xl bg-surface p-4 sm:right-6"
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div className="flex items-baseline justify-between">
        <Heading>Cards</Heading>
        <span aria-live="polite" className={`text-[12px] tabular-nums ${count ? 'text-ink-3' : 'text-again'}`}>
          {count ? `${count.toLocaleString()} card${count === 1 ? '' : 's'}` : 'No cards match'}
        </span>
      </div>
      <Group>
        <Chip on={s.types.length === 0} onClick={() => setSettings({ types: [] })}>
          All
        </Chip>
        {CARD_TYPES.map((t) => (
          <Chip key={t.id} on={s.types.includes(t.id)} onClick={() => setSettings({ types: toggle<CardType>(s.types, t.id) })}>
            {t.label}
          </Chip>
        ))}
      </Group>
      <Heading>Places</Heading>
      <Group>
        <Chip on={s.kinds.length === 0} onClick={() => setSettings({ kinds: [] })}>
          All
        </Chip>
        {KINDS.map((k) => (
          <Chip key={k.id} on={s.kinds.includes(k.id)} onClick={() => setSettings({ kinds: toggle<Kind>(s.kinds, k.id) })}>
            {k.label}
          </Chip>
        ))}
      </Group>
      <Heading>Regions</Heading>
      <Group>
        <Chip on={s.regions.length === 0} onClick={() => setSettings({ regions: [] })}>
          All
        </Chip>
        {REGIONS.map((r) => (
          <Chip key={r} on={s.regions.includes(r)} onClick={() => setSettings({ regions: toggle(s.regions, r) })}>
            {regionLabel(r)}
          </Chip>
        ))}
      </Group>
      <div className="border-t border-line pt-2 text-[12px] text-ink-3">
        <div className="flex min-h-9 items-center justify-between">
          <span>New cards per day</span>
          <div className="flex items-center gap-1">
            {[10, 20, 40].map((n) => (
              <Chip key={n} on={s.newPerDay === n} onClick={() => setSettings({ newPerDay: n })}>
                {n}
              </Chip>
            ))}
          </div>
        </div>
        <Switch on={s.autoplay} onClick={() => setSettings({ autoplay: !s.autoplay })}>
          Auto-play pronunciation
        </Switch>
        <Switch on={s.typeAnswers} onClick={() => setSettings({ typeAnswers: !s.typeAnswers })}>
          Type answers
        </Switch>
      </div>
    </motion.div>
  )
}
