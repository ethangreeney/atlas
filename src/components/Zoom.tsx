import { Maximize2 } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { mediaUrl } from '../lib/deck'
import { useZoomed, zoom } from '../lib/zoom'

const EASE = [0.2, 0.8, 0.2, 1] as const
/** Keys that only change another key, which shouldn't close the flag on their own. */
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab'])

/** Photos and maps are pictures of fixed size: blown up past this many times their own width they only get blurrier. Vector flags have no limit. */
const RASTER_MAX = 2.5

/**
 * A flag or map up close: as large as the screen allows over a dimmed page. A tap, a click or any key puts it away,
 * and that key does nothing else, so Space here never grades the card beneath. Only a press that starts here closes
 * it: lifting the finger that held the image lands here too, and must leave it open.
 */
export function Zoom() {
  const z = useZoomed()
  const reduce = useReducedMotion()
  /** Width over height, and the widest it can go without blurring, once the image has loaded, so it can be sized to fit whole. */
  const [size, setSize] = useState<{ aspect: number; max: number } | null>(null)
  const armed = useRef(false)
  const [file, setFile] = useState(z?.file)
  if (file !== z?.file) {
    setFile(z?.file)
    setSize(null)
  }

  useEffect(() => {
    armed.current = false
    if (!z) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || MODIFIERS.has(e.key)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      zoom(null)
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [z])

  return createPortal(
    <AnimatePresence>
      {z && (
        <motion.div
          key={z.file}
          role="dialog"
          aria-modal="true"
          aria-label={z.alt}
          className="fixed inset-0 z-[70] flex cursor-zoom-out items-center justify-center bg-page/95 p-6 pad-safe"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onPointerDown={() => (armed.current = true)}
          onClick={() => armed.current && zoom(null)}
        >
          <motion.img
            src={mediaUrl(z.file)}
            alt={z.alt}
            draggable={false}
            onLoad={(e) => {
              const { naturalWidth: w, naturalHeight: h } = e.currentTarget
              setSize({ aspect: w / h || 1.5, max: z.file.endsWith('.svg') || !w ? Infinity : w * RASTER_MAX })
            }}
            initial={reduce ? false : { scale: 0.94 }}
            animate={{ scale: 1 }}
            exit={reduce ? undefined : { scale: 0.97 }}
            transition={{ duration: 0.22, ease: EASE }}
            className={`h-auto ${z.file.includes('-map-') ? 'img-shadow img-dim rounded-2xl' : z.file.includes('-nobox') ? '' : 'img-shadow rounded-[6px]'}`}
            style={{
              width: `min(100%, ${size && size.max < Infinity ? `${Math.round(size.max)}px` : '100%'}, calc((100dvh - 3rem) * ${size?.aspect ?? 1.5}))`,
              opacity: size ? 1 : 0,
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/**
 * An image that can be seen up close: hold it, or press the button in its corner, which says so. The button keeps its
 * press and click to itself, so on a card it neither turns the card over nor starts a swipe.
 */
export function Zoomable({ file, alt, label = 'See it up close', className = '', children }: { file: string; alt: string; label?: string; className?: string; children: React.ReactNode }) {
  return (
    <span className={`group/zoom relative inline-flex max-w-full ${className}`}>
      {children}
      <button
        type="button"
        aria-label={label}
        title={label}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          zoom({ file, alt })
        }}
        className="absolute right-1.5 top-1.5 flex h-6 w-6 cursor-zoom-in items-center justify-center rounded-full bg-surface/90 text-ink-2 opacity-60 shadow-sm transition-opacity after:absolute after:-inset-2 hover:text-ink hover:opacity-100 focus-visible:opacity-100 group-hover/zoom:opacity-100 pointer-coarse:opacity-90"
      >
        <Maximize2 size={12} strokeWidth={2} />
      </button>
    </span>
  )
}
