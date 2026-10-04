import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { mediaUrl } from '../lib/deck'
import { useZoomed, zoom } from '../lib/zoom'

const EASE = [0.2, 0.8, 0.2, 1] as const
/** Keys that only change another key, which shouldn't close the flag on their own. */
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab'])

/**
 * A flag up close: as large as the screen allows over a dimmed page. A tap, a click or any key puts it away, and that
 * key does nothing else, so Space here never grades the card beneath. Only a press that starts here closes it: lifting
 * the finger that held the flag lands here too, and must leave it open.
 */
export function Zoom() {
  const z = useZoomed()
  const reduce = useReducedMotion()
  /** Width over height, once the image has loaded, so it can be sized to fit whole. */
  const [aspect, setAspect] = useState<number | null>(null)
  const armed = useRef(false)
  const [file, setFile] = useState(z?.file)
  if (file !== z?.file) {
    setFile(z?.file)
    setAspect(null)
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
          className="fixed inset-0 z-[70] flex cursor-zoom-out items-center justify-center bg-page/90 p-6 pad-safe backdrop-blur-md"
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
            onLoad={(e) => setAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight || 1.5)}
            initial={reduce ? false : { scale: 0.94 }}
            animate={{ scale: 1 }}
            exit={reduce ? undefined : { scale: 0.97 }}
            transition={{ duration: 0.22, ease: EASE }}
            className={`h-auto ${z.file.includes('-nobox') ? '' : 'img-shadow rounded-[6px]'}`}
            style={{ width: `min(92vw, 960px, calc(80dvh * ${aspect ?? 1.5}))`, opacity: aspect ? 1 : 0 }}
          />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
