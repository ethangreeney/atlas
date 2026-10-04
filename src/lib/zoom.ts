import { useEffect, useRef, useSyncExternalStore } from 'react'

/** The flag shown up close over everything, if any. One at a time, for the whole app. */
export type Zoomed = { file: string; alt: string } | null

let current: Zoomed = null
const listeners = new Set<() => void>()

export const zoom = (z: Zoomed) => {
  current = z
  listeners.forEach((l) => l())
}
export const isZoomed = () => current !== null
export const useZoomed = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )

/** How long a press (mouse or finger) is held to bring a flag up close; anything shorter is still a tap. */
const HOLD_MS = 350
/** Moving further than this many px first is a swipe or a scroll, not a hold. */
const SLOP = 8

/**
 * Handlers for an image: press and hold it to see it up close. The tap that a long press ends with is kept from
 * reaching the card beneath, so it doesn't also turn the card over.
 */
export function useHoldToZoom(file: string | undefined, alt: string) {
  const timer = useRef(0)
  const start = useRef<{ x: number; y: number } | null>(null)
  const held = useRef(false)
  useEffect(() => () => clearTimeout(timer.current), [])
  if (!file) return {}
  const cancel = () => {
    clearTimeout(timer.current)
    start.current = null
  }
  return {
    onPointerDown: (e: React.PointerEvent) => {
      held.current = false
      if (e.button !== 0) return
      start.current = { x: e.clientX, y: e.clientY }
      clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        held.current = true
        start.current = null
        zoom({ file, alt })
      }, HOLD_MS)
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > SLOP) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClick: (e: React.MouseEvent) => {
      if (!held.current) return
      held.current = false
      e.stopPropagation()
    },
    // A long press would otherwise open the phone's save-image menu.
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    style: { WebkitTouchCallout: 'none' } as React.CSSProperties,
  }
}
