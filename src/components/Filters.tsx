import { motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { CARD_TYPES, REGIONS, regionLabel, type CardType } from '../lib/deck'
import { setSettings, useSettings } from '../lib/settings'

const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button
    onClick={onClick}
    className={`rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors ${
      on ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink-2 hover:border-ink-3 hover:text-ink'
    }`}
  >
    {children}
  </button>
)

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

export function Filters({ onClose }: { onClose: () => void }) {
  const s = useSettings()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [onClose])

  return (
    <motion.div
      ref={ref}
      className="card-shadow absolute right-4 top-14 z-40 w-[min(380px,calc(100vw-32px))] rounded-2xl bg-white p-4 sm:right-6"
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">Cards</div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        <Chip on={s.types.length === 0} onClick={() => setSettings({ types: [] })}>
          All
        </Chip>
        {CARD_TYPES.map((t) => (
          <Chip key={t.id} on={s.types.includes(t.id)} onClick={() => setSettings({ types: toggle<CardType>(s.types, t.id) })}>
            {t.label}
          </Chip>
        ))}
      </div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">Regions</div>
      <div className="flex flex-wrap gap-1.5">
        <Chip on={s.regions.length === 0} onClick={() => setSettings({ regions: [] })}>
          All
        </Chip>
        {REGIONS.map((r) => (
          <Chip key={r} on={s.regions.includes(r)} onClick={() => setSettings({ regions: toggle(s.regions, r) })}>
            {regionLabel(r)}
          </Chip>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-[12px] text-ink-3">
        <span>New cards per day</span>
        <div className="flex items-center gap-1">
          {[10, 20, 40].map((n) => (
            <Chip key={n} on={s.newPerDay === n} onClick={() => setSettings({ newPerDay: n })}>
              {n}
            </Chip>
          ))}
        </div>
      </div>
    </motion.div>
  )
}
