import { clipParameters, createEmptyCard, default_w, fsrs, generatorParameters, Rating, State, type Card, type FSRS, type Grade, type ReviewLog } from 'ts-fsrs'
import { ALL_CARDS, kindOf, type DeckCard } from './deck'
import { flagPartners } from './lookalike'
import fame from '../data/fame.json'
import type { CardRow, DayRow } from './db'
import type { Settings } from './settings'

/** Weights fitted to this learner's own review log by the FSRS optimizer (see optimize.ts), when there are any. */
export const WEIGHTS_KEY = 'atlas.fsrs'
export type Fitted = { w: number[]; at: number; reviews: number }
/**
 * Weights FSRS would have to clip (one relearning step, short-term on, as below) can't have come from a fit: a damaged
 * or edited copy would schedule oddly. The optimizer works in float32, so allow for rounding at the bounds.
 */
export const validWeights = (w: unknown): w is number[] =>
  Array.isArray(w) &&
  w.length === 21 &&
  w.every(Number.isFinite) &&
  clipParameters(w, 1, true).every((x, i) => Math.abs(x - w[i]) <= 1e-6 * Math.max(1, Math.abs(w[i])))
export const loadFitted = (): Fitted | null => {
  try {
    const f = JSON.parse(localStorage.getItem(WEIGHTS_KEY) ?? 'null') as Fitted | null
    return f && validWeights(f.w) ? f : null
  } catch {
    return null
  }
}

/** Mirrors the Anki preset chosen for this deck: FSRS, retention 0.90, one 10m learning/relearning step. */
export const PARAMS = generatorParameters({
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: true,
  enable_short_term: true,
  learning_steps: ['10m'],
  relearning_steps: ['10m'],
  ...(loadFitted() && { w: loadFitted()!.w }),
})
export const scheduler = fsrs(PARAMS)

/** Switch to newly fitted weights; cards already scheduled keep their dates, and the next answer uses the new ones. */
export function applyWeights(f: Fitted) {
  try {
    localStorage.setItem(WEIGHTS_KEY, JSON.stringify(f))
  } catch {
    /* private mode: still use them for this visit */
  }
  // Setting parameters rebuilds the whole config from library defaults, so pass everything, not just the weights.
  scheduler.parameters = { ...PARAMS, w: f.w }
}
/** Back to the stock weights (another account's history no longer applies). */
export function resetWeights() {
  try {
    localStorage.removeItem(WEIGHTS_KEY)
  } catch {
    /* storage blocked: nothing saved to remove */
  }
  scheduler.parameters = { ...PARAMS, w: [...default_w] }
}

export const LEECH_THRESHOLD = 8
const ROLLOVER_HOURS = 4 // Anki: "next day starts at 4am"
export const LEARN_AHEAD_MS = 20 * 60_000 // Anki: learn ahead limit 20m

const pad = (n: number) => String(n).padStart(2, '0')
/** Local calendar day, with the day rolling over at 4am like Anki. */
export const dayKey = (d: Date) => {
  const t = new Date(d)
  if (t.getHours() < ROLLOVER_HOURS) t.setDate(t.getDate() - 1)
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`
}
/** The learner's day (4am rollover) as a whole number, for counting days between two times. */
export const dayNumber = (d: Date) => {
  const [y, m, day] = dayKey(d).split('-').map(Number)
  return Date.UTC(y, m - 1, day) / 86_400_000
}

/**
 * FSRS tells a same-day retry from a review a day later by the UTC date, but the learner's day is local and rolls over
 * at 4am: in New Zealand UTC midnight falls at 1pm, so a retry at 1:05 of a card missed at 12:55 counted as a day
 * apart and its memory was overrated. So FSRS is handed the local clock, 4h back, written as UTC: its dates then
 * change exactly when the learner's day does. Times coming back are turned into real ones again.
 */
const offset = (d: Date) => -d.getTimezoneOffset() * 60_000
const ROLLOVER_MS = ROLLOVER_HOURS * 3_600_000
const toLocal = (d: Date) => new Date(+d + offset(d) - ROLLOVER_MS)
const fromLocal = (d: Date) => {
  const wall = +d + ROLLOVER_MS
  return new Date(wall - offset(new Date(wall - offset(new Date(wall)))))
}
const cardIn = <T extends Card>(c: T): T => ({ ...c, due: toLocal(new Date(c.due)), ...(c.last_review && { last_review: toLocal(new Date(c.last_review)) }) })

/** The next state of a card answered `grade` at `now`, and its log entry, counted in the learner's days. */
export function next<T extends Card>(card: T, now: Date, grade: Grade, f: FSRS = scheduler): { card: Card; log: ReviewLog } {
  const r = f.next(cardIn(card), toLocal(now), grade)
  // The log's due is the card's last review (or its due date if it had none), as ts-fsrs records it.
  return { card: { ...r.card, due: fromLocal(r.card.due), last_review: now }, log: { ...r.log, due: new Date(card.last_review ?? card.due), review: now } }
}

/** FSRS's chance the learner would get a card right at `now`, with the days since its last review counted their way. */
export function recall(card: Card, now: Date) {
  if (card.state === State.New || !card.last_review) return 0
  return scheduler.forgetting_curve(Math.max(0, dayNumber(now) - dayNumber(new Date(card.last_review))), +card.stability.toFixed(8))
}

/** Local 4am that ends the day containing `d`; the day starts at the previous local 4am, which isn't always 24h earlier. */
export const dayEnd = (d: Date) => {
  const t = new Date(d)
  t.setHours(ROLLOVER_HOURS, 0, 0, 0)
  if (t <= d) t.setDate(t.getDate() + 1)
  return t
}
/**
 * One card per place a day, so one doesn't give another away: a review whose place has already come up today waits
 * for tomorrow. But only once: a review already due on an earlier day comes anyway.
 */
export const waitsForTomorrow = (r: Card, placeSeen: boolean, now: Date) => {
  if (r.state !== State.Review || !placeSeen) return false
  const start = dayEnd(now)
  start.setDate(start.getDate() - 1)
  return +new Date(r.due) >= +start
}

export const emptyDay = (day: string): DayRow => ({ day, newCount: 0, reviewCount: 0, extraNew: 0, seenNotes: [], grades: [0, 0, 0, 0], updated: 0 })

export const freshRow = (c: DeckCard, now: Date): CardRow => ({ ...createEmptyCard(now), id: c.id, noteId: c.note.id, updated: 0 })

// Deterministic per-day shuffle so the queue doesn't reorder itself between grades.
const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Per-browser salt so every learner gets their own card order. */
const SEED = (() => {
  const key = 'atlas.seed'
  try {
    const stored = localStorage.getItem(key)
    if (stored) return stored
    const fresh = Math.random().toString(36).slice(2)
    localStorage.setItem(key, fresh)
    return fresh
  } catch {
    return Math.random().toString(36).slice(2)
  }
})()

/** Well-known countries whose flag and map cards go first for a brand-new learner, for easy early wins. */
const STARTERS = new Set([
  'France', 'Japan', 'United States of America', 'Brazil', 'Australia', 'Italy', 'Canada', 'Germany', 'China', 'India',
  'Egypt', 'Mexico', 'United Kingdom', 'Spain', 'Russia', 'New Zealand', 'South Africa', 'Argentina', 'Greece', 'Ireland',
])
/** How many cards a learner grades before the warm-up ends. */
const WARMUP_CARDS = 6
/** Places from best known to least, ranked by hand (scripts/build-fame.ts slots in new ones), so new cards start with ones people know. */
const FAME = new Map((fame as { id: string }[]).map((p, i) => [p.id, i]))
/** How far, in places, a new card can drift from its fame rank, so each day still mixes regions and card types. */
const FAME_SPREAD = 40

export type Queue = {
  current: DeckCard | null
  counts: { new: number; learn: number; due: number }
  /** When nothing is available now but a learning card is due later. */
  nextLearningAt: Date | null
  total: number
  done: number
  /** New cards in the current filters that could still come today (one per place), for 'learn more'. */
  remainingNew: number
  /** How far today's new cards already run past their limits (one lowered since, say): 'learn more' makes it up first. */
  newOver: number
  /** For the done screen: the soonest a card in the filters comes back, and how many reviews come tomorrow. */
  nextDue: Date | null
  dueTomorrow: number
}

const isLearning = (s: State) => s === State.Learning || s === State.Relearning

/** Any of the chosen options within a group, and every group. */
export function matchesFilters(c: DeckCard, s: Settings) {
  if (s.types.length && !s.types.includes(c.type)) return false
  if (s.kinds.length && !s.kinds.includes(kindOf(c.note))) return false
  if (s.regions.length && !c.note.tags.some((t) => s.regions.includes(t))) return false
  return true
}

export const countMatching = (s: Settings) => ALL_CARDS.filter((c) => matchesFilters(c, s)).length

export function buildQueue(now: Date, rows: Map<string, CardRow>, settings: Settings, day: DayRow): Queue {
  const end = dayEnd(now)
  const seen = new Set(day.seenNotes)
  const cards = ALL_CARDS.filter((c) => matchesFilters(c, settings))
  const row = (c: DeckCard) => rows.get(c.id) ?? freshRow(c, now)
  const rank = (c: DeckCard) => hash(c.id + day.day + SEED)

  const learning = cards
    .filter((c) => isLearning(row(c).state))
    .sort((a, b) => +row(a).due - +row(b).due)

  const reviewBudget = Math.max(0, settings.reviewsPerDay - day.reviewCount)
  let reviews = cards.filter((c) => row(c).state === State.Review && row(c).due < end && !waitsForTomorrow(row(c), seen.has(c.note.id), now))
  // More due than the day's limit: keep the ones most likely still remembered. They're the cheapest to save, and the
  // rest need relearning either way (FSRS sort-order simulations).
  if (reviews.length > reviewBudget) {
    const chance = new Map(reviews.map((c) => [c.id, recall(row(c), now)]))
    reviews = reviews.sort((a, b) => chance.get(b.id)! - chance.get(a.id)!).slice(0, reviewBudget)
  }
  // Order doesn't matter for memory when everything gets done, so shuffle (the same way all day): a fixed order
  // would let one answer cue the next.
  reviews.sort((a, b) => rank(a) - rank(b))

  // New cards count against the review limit too, as in Anki, so a heavy review day leaves room for fewer. 'Learn more'
  // raises both limits, so it's honoured even once the reviews have used up the day.
  const newLeft = Math.min(settings.newPerDay, reviewBudget - reviews.length) + day.extraNew - day.newCount
  const newBudget = Math.max(0, newLeft)
  const newOver = Math.max(0, -newLeft)
  const seenNew = new Set<string>()
  let graded = 0
  for (const r of rows.values()) if (r.state !== State.New) graded++
  const warmup = graded < WARMUP_CARDS
  // A flag whose look-alike you've started comes next, so Chad's arrives while Romania's is fresh, not weeks later.
  const started = (noteId: string) => (rows.get(`${noteId}:flag`)?.state ?? State.New) !== State.New
  const paired = (c: DeckCard) => c.type === 'flag' && [...flagPartners(c.note.id)].some(started)
  const tier = (c: DeckCard) => (warmup && (c.type === 'flag' || c.type === 'map') && STARTERS.has(c.note.country) ? 0 : paired(c) ? 1 : 2)
  const fameKey = (c: DeckCard) => (FAME.get(c.note.id) ?? FAME.size) + (rank(c) / 2 ** 32) * FAME_SPREAD
  // One card per place a day, so this is also how many new cards could still come today. A place with a review due
  // today gives that its turn; its next new card comes another day.
  const reviewing = new Set(reviews.map((c) => c.note.id))
  const unseen = cards
    .filter((c) => row(c).state === State.New && !seen.has(c.note.id) && !reviewing.has(c.note.id))
    .sort((a, b) => tier(a) - tier(b) || fameKey(a) - fameKey(b))
    .filter((c) => (seenNew.has(c.note.id) ? false : (seenNew.add(c.note.id), true)))
  const fresh = unseen.slice(0, newBudget)

  const counts = { new: fresh.length, learn: learning.length, due: reviews.length }
  const done = day.newCount + day.reviewCount
  const total = done + counts.new + counts.due
  const base = { counts, total, done, remainingNew: unseen.length, newOver, nextDue: null, dueTomorrow: 0 }

  /** For the done screen. A review due today that didn't make the queue (over the limit, or its place seen) waits for tomorrow. */
  const upcoming = () => {
    const tomorrowEnd = dayEnd(end)
    let nextDue: Date | null = null
    let dueTomorrow = 0
    for (const c of cards) {
      const r = rows.get(c.id)
      if (!r || r.state === State.New) continue
      const at = r.state === State.Review && r.due < end ? end : r.due
      if (at <= now) continue
      if (!nextDue || at < nextDue) nextDue = at
      if (at >= end && at < tomorrowEnd) dueTomorrow++
    }
    return { nextDue, dueTomorrow: Math.min(dueTomorrow, settings.reviewsPerDay) }
  }

  // 1. Learning cards that are due now come first.
  const dueLearning = learning.find((c) => row(c).due <= now)
  if (dueLearning) return { ...base, current: dueLearning, nextLearningAt: null }

  // 2. Reviews and new cards, new ones spread evenly through the day: new card k goes in the middle of its share.
  // Counting from today's answers keeps the pattern steady from one answer to the next.
  if (reviews.length || fresh.length) {
    const slot = ((day.newCount + 0.5) * total) / (day.newCount + fresh.length)
    const current = fresh.length && (!reviews.length || done >= Math.floor(slot)) ? fresh[0] : reviews[0]
    return { ...base, current, nextLearningAt: null }
  }

  // 3. Nothing else left: show a learning card slightly early, otherwise wait for it.
  const soonest = learning[0]
  if (soonest) {
    const due = row(soonest).due
    if (+due - +now <= LEARN_AHEAD_MS) return { ...base, current: soonest, nextLearningAt: null }
    return { ...base, ...upcoming(), current: null, nextLearningAt: due }
  }
  return { ...base, ...upcoming(), current: null, nextLearningAt: null }
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
  return GRADES.map((g) => formatInterval(+next(card, now, g.grade).card.due - +now))
}

/** Anki's leech rule: tag at the threshold, then every half-threshold after. Never suspend. */
export const becomesLeech = (grade: Grade, lapses: number) =>
  grade === Rating.Again && lapses >= LEECH_THRESHOLD && (lapses - LEECH_THRESHOLD) % Math.ceil(LEECH_THRESHOLD / 2) === 0

export { Rating, State }
