import { useShape } from '../lib/outlines'

/** A place's outline, filled in ink and fitted to its box. Until the shapes have loaded, an empty box holds the space. */
export function Outline({ id, label, className }: { id: string; label?: string; className: string }) {
  const shape = useShape(id)
  if (!shape) return <div aria-hidden className={className} />
  const [x0, y0, x1, y1] = shape.box
  const pad = 4
  return (
    <svg
      viewBox={`${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`}
      preserveAspectRatio="xMidYMid meet"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={!label || undefined}
      className={className}
    >
      <path d={shape.d} fillRule="evenodd" className="fill-ink" />
    </svg>
  )
}
