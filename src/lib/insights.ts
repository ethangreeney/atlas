import type { CardRow, RevlogRow } from './db'
import { ALL_CARDS, CARD_BY_ID, NOTES, REGIONS, regionLabel, type CardType, type DeckCard, type Note } from './deck'
import { lookAlikes } from './lookalike'
import { dayKey, scheduler, State } from './scheduler'

const DAY_MS = 86_400_000
const learned = (r: CardRow | undefined): r is CardRow => !!r && r.state !== State.New && CARD_BY_ID.has(r.id)

/** How many answered cards FSRS expects you'd get right if asked this minute: each card's recall probability, added up. */
export function recallNow(rows: Map<string, CardRow>, now = new Date()) {
  let count = 0
  let recalled = 0
  for (const r of rows.values()) {
    if (!learned(r)) continue
    count++
    recalled += scheduler.get_retrievability(r, now, false)
  }
  return { learned: count, recalled: Math.round(recalled) }
}

/** Places with at least one card answered. */
export const placesStarted = (rows: Map<string, CardRow>) => new Set([...rows.values()].filter(learned).map((r) => CARD_BY_ID.get(r.id)!.note.id)).size

/**
 * Time spent answering, estimated from the gaps between answers: a gap under five minutes is time on that card (a long
 * one capped at a minute, for a card left on screen), and a longer gap starts a new sitting.
 */
export function studyTime(logs: RevlogRow[]) {
  const t = logs.map((l) => +new Date(l.review)).sort((a, b) => a - b)
  const FIRST = 8_000 // the first card of a sitting, which has no gap before it
  let ms = t.length ? FIRST : 0
  for (let i = 1; i < t.length; i++) {
    const gap = t[i] - t[i - 1]
    ms += gap < 5 * 60_000 ? Math.min(gap, 60_000) : FIRST
  }
  return { ms, perCard: t.length ? ms / t.length : 0 }
}

/** Answers per day (4am rollover). */
export function activity(logs: RevlogRow[]) {
  const days = new Map<string, number>()
  for (const l of logs) {
    const k = dayKey(new Date(l.review))
    days.set(k, (days.get(k) ?? 0) + 1)
  }
  return days
}

export type TypeStat = { type: CardType; learned: number; total: number; reviews: number; recall: number | null }

const TYPE_PLURAL: Record<CardType, string> = { flag: 'Flags', map: 'Maps', capital: 'Capitals', country: 'Countries from capitals' }

/** One line saying which card type is strongest and which slips most, once there's enough to tell. */
export function typeSummary(stats: TypeStat[]) {
  const rated = stats.filter((s) => s.recall !== null).map((s) => ({ type: s.type, pct: Math.round(s.recall! * 100) }))
  if (rated.length < 2) return null
  const top = Math.max(...rated.map((s) => s.pct))
  const low = Math.min(...rated.map((s) => s.pct))
  if (top - low < 3) return "You're about as strong on every kind of card."
  const best = rated.filter((s) => s.pct === top)
  const worst = rated.filter((s) => s.pct === low)
  const names = (xs: { type: CardType }[]) => xs.map((s) => TYPE_PLURAL[s.type].toLowerCase()).join(' and ')
  const first = names(best)
  return `${first[0].toUpperCase() + first.slice(1)} are your strongest, and ${names(worst)} slip the most.`
}
/** Below this many reviews a type's recall rate is noise. */
const MIN_REVIEWS = 10

/**
 * Per card type: how many are under way, and how often a card that had graduated was still remembered when it came
 * back (the last two months, so it follows how you're doing now).
 */
export function byType(rows: Map<string, CardRow>, logs: RevlogRow[], now = new Date()): TypeStat[] {
  const since = +now - 60 * DAY_MS
  const types: CardType[] = ['flag', 'map', 'capital', 'country']
  return types.map((type) => {
    const cards = ALL_CARDS.filter((c) => c.type === type)
    const reviews = logs.filter((l) => l.state === State.Review && +new Date(l.review) >= since && CARD_BY_ID.get(l.cardId)?.type === type)
    const right = reviews.filter((l) => l.rating > 1).length
    return {
      type,
      learned: cards.filter((c) => learned(rows.get(c.id))).length,
      total: cards.length,
      reviews: reviews.length,
      recall: reviews.length >= MIN_REVIEWS ? right / reviews.length : null,
    }
  })
}

/** Regions that read with "the": the Caribbean, the Middle East. */
const THE = new Set(['Caribbean', 'Middle_East', 'European_Union', 'Mediterranean'])
const setName = (region: string, type: CardType) => {
  const r = (THE.has(region) ? 'the ' : '') + regionLabel(region)
  return { flag: `Flags of ${r}`, map: `${r[0].toUpperCase() + r.slice(1)} on the map`, capital: `Capitals of ${r}`, country: `Countries of ${r} from their capitals` }[type]
}

export type Goal = { key: string; label: string; region: string; type: CardType; done: number; total: number; left: DeckCard[] }

/**
 * The sets closest to finished: every flag in South America, every capital in the Caribbean. A set is one region and
 * one card type, with at least five cards, started, and not yet finished. Fewest left first.
 */
export function nearlyDone(rows: Map<string, CardRow>, n = 3): Goal[] {
  const out: Goal[] = []
  for (const region of REGIONS) {
    for (const type of ['flag', 'map', 'capital', 'country'] as CardType[]) {
      const cards = ALL_CARDS.filter((c) => c.type === type && c.note.tags.includes(region))
      if (cards.length < 5) continue
      const left = cards.filter((c) => !learned(rows.get(c.id)))
      const done = cards.length - left.length
      if (!done || !left.length) continue
      out.push({ key: `${region}:${type}`, label: setName(region, type), region, type, done, total: cards.length, left })
    }
  }
  // One per region, so the list isn't three takes on the same place.
  const regions = new Set<string>()
  return out
    .sort((a, b) => a.left.length - b.left.length || b.done / b.total - a.done / a.total)
    .filter((g) => !regions.has(g.region) && regions.add(g.region))
    .slice(0, n)
}

/** Sets finished: every card in a region's set answered at least once. */
export function finished(rows: Map<string, CardRow>) {
  let n = 0
  for (const region of REGIONS)
    for (const type of ['flag', 'map', 'capital', 'country'] as CardType[]) {
      const cards = ALL_CARDS.filter((c) => c.type === type && c.note.tags.includes(region))
      if (cards.length >= 5 && cards.every((c) => learned(rows.get(c.id)))) n++
    }
  return n
}

export const HORIZONS = [
  { label: 'Days', max: 7 },
  { label: 'Weeks', max: 30 },
  { label: 'Months', max: 180 },
  { label: 'Half a year+', max: Infinity },
]

/**
 * How long each answered card should stay remembered: its FSRS stability, the time until recall drops to 90%. Also
 * the card that should last longest.
 */
export function horizons(rows: Map<string, CardRow>) {
  const counts = HORIZONS.map(() => 0)
  let best: CardRow | null = null
  for (const r of rows.values()) {
    if (!learned(r) || r.state !== State.Review) continue
    counts[HORIZONS.findIndex((h) => r.stability < h.max)]++
    if (!best || r.stability > best.stability) best = r
  }
  return { counts, best: best && { card: CARD_BY_ID.get(best.id)!, days: best.stability } }
}

export type MixUp = { missed: Note; other: Note }

/**
 * Flags you've forgotten that have a known look-alike in the deck: Chad and Romania, Indonesia and Monaco. Only
 * misses after the first sight count (not knowing a flag yet isn't mixing it up). Most-missed first, each pair once.
 */
export function mixUps(logs: RevlogRow[], n = 4): MixUp[] {
  const misses = new Map<string, number>()
  for (const l of logs) {
    if (l.rating !== 1 || l.state === State.New) continue
    const c = CARD_BY_ID.get(l.cardId)
    if (c?.type === 'flag') misses.set(c.note.id, (misses.get(c.note.id) ?? 0) + 1)
  }
  const byName = new Map(NOTES.map((x) => [x.country, x]))
  const seen = new Set<string>()
  const out: MixUp[] = []
  for (const [id] of [...misses].sort((a, b) => b[1] - a[1])) {
    const missed = NOTES.find((x) => x.id === id)!
    for (const alike of lookAlikes(missed)) {
      const other = alike.flag ? byName.get(alike.name) : undefined
      const key = other && [missed.id, other.id].sort().join()
      if (!other || !key || seen.has(key)) continue
      seen.add(key)
      out.push({ missed, other })
      break
    }
    if (out.length >= n) break
  }
  return out
}
