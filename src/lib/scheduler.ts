import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type Grade } from 'ts-fsrs'
import { ALL_CARDS, type DeckCard } from './deck'
import type { CardRow, DayRow } from './db'
import type { Settings } from './settings'

/** Mirrors the Anki preset chosen for this deck: FSRS, retention 0.90, one 10m learning/relearning step. */
export const PARAMS = generatorParameters({
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: true,
  enable_short_term: true,
  learning_steps: ['10m'],
  relearning_steps: ['10m'],
})
export const scheduler = fsrs(PARAMS)

export const LEECH_THRESHOLD = 8
const ROLLOVER_HOURS = 4 // Anki: "next day starts at 4am"
const LEARN_AHEAD_MS = 20 * 60_000 // Anki: learn ahead limit 20m

const pad = (n: number) => String(n).padStart(2, '0')
/** Local calendar day, with the day rolling over at 4am like Anki. */
export const dayKey = (d: Date) => {
  const t = new Date(d.getTime() - ROLLOVER_HOURS * 3_600_000)
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`
}
export const dayEnd = (d: Date) => {
  const t = new Date(d)
  t.setHours(ROLLOVER_HOURS, 0, 0, 0)
  if (t <= d) t.setDate(t.getDate() + 1)
  return t
}
export const emptyDay = (day: string): DayRow => ({ day, newCount: 0, reviewCount: 0, extraNew: 0, seenNotes: [], grades: [0, 0, 0, 0] })

export const freshRow = (c: DeckCard, now: Date): CardRow => ({ ...createEmptyCard(now), id: c.id, noteId: c.note.id })

// Deterministic per-day shuffle so the queue doesn't reorder itself between grades.
const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export type Queue = {
  current: DeckCard | null
  counts: { new: number; learn: number; due: number }
  /** When nothing is available now but a learning card is due later. */
  nextLearningAt: Date | null
  total: number
  done: number
  /** Unseen new cards left in the current filters, for 'learn more'. */
  remainingNew: number
}

const isLearning = (s: State) => s === State.Learning || s === State.Relearning

export function matchesFilters(c: DeckCard, s: Settings) {
  if (s.types.length && !s.types.includes(c.type)) return false
  if (s.regions.length && !c.note.tags.some((t) => s.regions.includes(t))) return false
  return true
}

export function buildQueue(now: Date, rows: Map<string, CardRow>, settings: Settings, day: DayRow): Queue {
  const end = dayEnd(now)
  const seen = new Set(day.seenNotes)
  const cards = ALL_CARDS.filter((c) => matchesFilters(c, settings))
  const row = (c: DeckCard) => rows.get(c.id) ?? freshRow(c, now)

  const learning = cards
    .filter((c) => isLearning(row(c).state))
    .sort((a, b) => +row(a).due - +row(b).due)

  const reviewBudget = Math.max(0, settings.reviewsPerDay - day.reviewCount)
  const reviews = cards
    .filter((c) => row(c).state === State.Review && row(c).due < end && !seen.has(c.note.id))
    .sort((a, b) => +row(a).due - +row(b).due || hash(a.id + day.day) - hash(b.id + day.day))
    .slice(0, reviewBudget)

  const newBudget = Math.max(0, Math.min(settings.newPerDay + day.extraNew - day.newCount, reviewBudget - reviews.length))
  const seenNew = new Set<string>()
  const fresh = cards
    .filter((c) => row(c).state === State.New && !seen.has(c.note.id))
    .sort((a, b) => hash(a.id + day.day) - hash(b.id + day.day))
    .filter((c) => (seenNew.has(c.note.id) ? false : (seenNew.add(c.note.id), true)))
    .slice(0, newBudget)

  const remainingNew = cards.filter((c) => row(c).state === State.New && !seen.has(c.note.id)).length
  const counts = { new: fresh.length, learn: learning.length, due: reviews.length }
  const done = day.newCount + day.reviewCount
  const total = done + counts.new + counts.due

  // 1. Learning cards that are due now come first.
  const dueLearning = learning.find((c) => row(c).due <= now)
  if (dueLearning) return { current: dueLearning, counts, nextLearningAt: null, total, done, remainingNew }

  // 2. Reviews and new cards, new ones spread evenly through the reviews.
  if (reviews.length || fresh.length) {
    const r = reviews.length
    const n = fresh.length
    const newRank = n ? (0.5 * (r + n)) / n : Infinity
    const current = r === 0 || newRank < 1 ? fresh[0] : reviews[0]
    return { current, counts, nextLearningAt: null, total, done, remainingNew }
  }

  // 3. Nothing else left: show a learning card slightly early, otherwise wait for it.
  const soonest = learning[0]
  if (soonest) {
    const due = row(soonest).due
    if (+due - +now <= LEARN_AHEAD_MS) return { current: soonest, counts, nextLearningAt: null, total, done, remainingNew }
    return { current: null, counts, nextLearningAt: due, total, done, remainingNew }
  }
  return { current: null, counts, nextLearningAt: null, total, done, remainingNew }
}

/** Anki-style interval labels for the four answer buttons. */
export function formatInterval(ms: number) {
  const m = ms / 60_000
  if (m < 1) return '<1m'
  if (m < 60) return `${Math.round(m)}m`
  const h = m / 60
  if (h < 24) return `${Math.round(h)}h`
  const d = h / 24
  if (d < 30) return `${Math.round(d)}d`
  const mo = d / 30
  if (mo < 12) return `${mo < 10 ? mo.toFixed(1).replace(/\.0$/, '') : Math.round(mo)}mo`
  const y = d / 365
  return `${y < 10 ? y.toFixed(1).replace(/\.0$/, '') : Math.round(y)}y`
}

export const GRADES: { grade: Grade; key: string; label: string }[] = [
  { grade: Rating.Again, key: '1', label: 'Again' },
  { grade: Rating.Hard, key: '2', label: 'Hard' },
  { grade: Rating.Good, key: '3', label: 'Good' },
  { grade: Rating.Easy, key: '4', label: 'Easy' },
]

export function previewIntervals(card: Card, now: Date) {
  const p = scheduler.repeat(card, now)
  return GRADES.map((g) => formatInterval(+p[g.grade].card.due - +now))
}

/** Anki's leech rule: tag at the threshold, then every half-threshold after. Never suspend. */
export const becomesLeech = (grade: Grade, lapses: number) =>
  grade === Rating.Again && lapses >= LEECH_THRESHOLD && (lapses - LEECH_THRESHOLD) % Math.ceil(LEECH_THRESHOLD / 2) === 0

export { Rating, State }
