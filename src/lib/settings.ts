import { useSyncExternalStore } from 'react'
import type { CardType } from './deck'

export type Settings = {
  regions: string[] // empty = all
  types: CardType[] // empty = all
  muted: boolean
  newPerDay: number
  reviewsPerDay: number
}

const KEY = 'atlas.settings'
const DEFAULTS: Settings = { regions: [], types: [], muted: false, newPerDay: 20, reviewsPerDay: 200 }

let current: Settings = (() => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return DEFAULTS
  }
})()
const listeners = new Set<() => void>()

export const getSettings = () => current
export const setSettings = (patch: Partial<Settings>) => {
  current = { ...current, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    /* private mode */
  }
  listeners.forEach((l) => l())
}
export const useSettings = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    getSettings,
  )
