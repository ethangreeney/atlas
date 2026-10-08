import { useEffect, useSyncExternalStore } from 'react'

/** A place's outline: an SVG path, and the box round it to frame it by. */
export type Shape = { d: string; box: [number, number, number, number] }

// Three quarters of a megabyte of paths, so they load only once the outline set is on.
let shapes: Record<string, Shape> | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

export function loadOutlines() {
  loading ??= import('../data/outlines.json').then((m) => {
    shapes = m.default as unknown as Record<string, Shape>
    listeners.forEach((l) => l())
  })
  return loading
}

/** A place's outline, or null for the moment it takes to load. */
export function useShape(noteId: string) {
  const all = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => shapes,
  )
  useEffect(() => {
    void loadOutlines()
  }, [])
  return all?.[noteId] ?? null
}
