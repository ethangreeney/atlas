import { useSyncExternalStore } from 'react'
import { KINDS, type CardType, type Kind } from './deck'

export type Settings = {
  regions: string[] // empty = all
  kinds: Kind[] // empty = all
  types: CardType[] // empty = all
  newPerDay: number
  reviewsPerDay: number
  autoplay: boolean
  typeAnswers: boolean
}

const KEY = 'atlas.settings'
const DEFAULTS: Settings = { regions: [], kinds: [], types: [], newPerDay: 20, reviewsPerDay: 200, autoplay: false, typeAnswers: false }

let current: Settings = (() => {
  try {
    const s: Settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
    // Sovereign states, seas and continents used to be region chips; they're kinds now.
    const moved = KINDS.filter((k) => k.tag && s.regions.includes(k.tag))
    if (moved.length) {
      s.regions = s.regions.filter((r) => !moved.some((k) => k.tag === r))
      s.kinds = [...new Set([...s.kinds, ...moved.map((k) => k.id)])]
    }
    return s
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
