import type { CardRow, RevlogRow } from './db'
import { ALL_CARDS, CARD_BY_ID, REGIONS, regionLabel, type CardType, type DeckCard } from './deck'
import { dayKey, scheduler, State } from './scheduler'

const DAY_MS = 86_400_000
const learned = (r: CardRow | undefined): r is CardRow => !!r && r.state !== State.New && CARD_BY_ID.has(r.id)
export const TYPES: CardType[] = ['flag', 'map', 'capital', 'country']

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

/** A gap under five minutes is time on that card (capped at a minute, for a card left on screen); a longer one starts a new sitting. */
const FIRST = 8_000 // the first card of a sitting, which has no gap before it
const gapTime = (gap: number) => (gap < 5 * 60_000 ? Math.min(gap, 60_000) : FIRST)

/** Time spent answering, estimated from the gaps between answers. */
export function studyTime(logs: RevlogRow[]) {
  const t = logs.map((l) => +new Date(l.review)).sort((a, b) => a - b)
  let ms = t.length ? FIRST : 0
  for (let i = 1; i < t.length; i++) ms += gapTime(t[i] - t[i - 1])
  return { ms, perCard: t.length ? ms / t.length : 0 }
}

export type DayStat = { answers: number; fresh: number; reviews: number; right: number; ms: number }

/** Each day (4am rollover): answers, how many were first sights, how many of the rest were right, and time spent. */
export function days(logs: RevlogRow[]) {
  const out = new Map<string, DayStat>()
  const sorted = [...logs].sort((a, b) => +new Date(a.review) - +new Date(b.review))
  let prev = 0
  for (const l of sorted) {
    const t = +new Date(l.review)
    const k = dayKey(new Date(t))
    const d = out.get(k) ?? { answers: 0, fresh: 0, reviews: 0, right: 0, ms: 0 }
    d.answers++
    if (l.state === State.New) d.fresh++
    else {
      d.reviews++
      if (l.rating > 1) d.right++
    }
    d.ms += prev && dayKey(new Date(prev)) === k ? gapTime(t - prev) : FIRST
    out.set(k, d)
    prev = t
  }
  return out
}

export type TypeStat = { type: CardType; learned: number; total: number; reviews: number; recall: number | null }
/** Below this many reviews a type's recall rate is noise. */
const MIN_REVIEWS = 10

/**
 * Per card type: how many are under way, and how often a card that had graduated was still remembered when it came
 * back (the last two months, so it follows how you're doing now).
 */
export function byType(rows: Map<string, CardRow>, logs: RevlogRow[], now = new Date()): TypeStat[] {
  const since = +now - 60 * DAY_MS
  return TYPES.map((type) => {
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

const TYPE_NAME: Record<CardType, string> = { flag: 'flags', map: 'maps', capital: 'capitals', country: 'countries from capitals' }

/** One line naming the kind of card you hold best and the one you forget most, once there's enough to tell. */
export function typeSummary(stats: TypeStat[]) {
  const rated = stats.filter((s) => s.recall !== null).map((s) => ({ type: s.type, pct: Math.round(s.recall! * 100) }))
  if (rated.length < 2) return null
  const top = Math.max(...rated.map((s) => s.pct))
  const low = Math.min(...rated.map((s) => s.pct))
  if (top - low < 3) return `When cards come back for review, you remember about ${top}% of every kind.`
  const names = (pct: number) => rated.filter((s) => s.pct === pct).map((s) => TYPE_NAME[s.type]).join(' and ')
  return `When cards come back for review, you remember ${names(top)} best (${top}%) and ${names(low)} least (${low}%).`
}

/** Regions that read with "the": the Caribbean, the Middle East. */
const THE = new Set(['Caribbean', 'Middle_East', 'European_Union', 'Mediterranean'])
export const placeName = (region: string) => (THE.has(region) ? 'the ' : '') + regionLabel(region)
/** The row that holds every card of a kind, above the regions. */
export const WHOLE = 'All'
const setName = (region: string, type: CardType) => {
  if (region === WHOLE) return { flag: 'All flags', map: 'Every place on the map', capital: 'All capitals', country: 'All countries from their capitals' }[type]
  const r = placeName(region)
  return { flag: `Flags of ${r}`, map: `${r[0].toUpperCase() + r.slice(1)} on the map`, capital: `Capitals of ${r}`, country: `Countries of ${r} from their capitals` }[type]
}

/** Continents first, then the smaller regions inside them. */
export const CONTINENTS = ['Africa', 'Asia', 'Europe', 'North_America', 'Oceania', 'South_America']
export const SUBREGIONS = REGIONS.filter((r) => !CONTINENTS.includes(r))

export type DeckSet = { key: string; label: string; region: string; type: CardType; cards: DeckCard[]; done: number; left: DeckCard[] }

/** Smaller than this, a region's cards of one kind aren't a set. */
const MIN_SET = 5

/**
 * Every set, one region and one kind of card each: all of South America's flags, all the Caribbean's capitals. The
 * whole deck's flags, maps and so on come first.
 */
export function sets(rows: Map<string, CardRow>): Map<string, DeckSet> {
  const out = new Map<string, DeckSet>()
  for (const region of [WHOLE, ...REGIONS])
    for (const type of TYPES) {
      const cards = ALL_CARDS.filter((c) => c.type === type && (region === WHOLE || c.note.tags.includes(region))).sort((a, b) => a.note.country.localeCompare(b.note.country))
      if (cards.length < MIN_SET) continue
      const left = cards.filter((c) => !learned(rows.get(c.id)))
      out.set(`${region}:${type}`, { key: `${region}:${type}`, label: setName(region, type), region, type, cards, done: cards.length - left.length, left })
    }
  return out
}

/** Days from now at which the forgetting curve is sampled: dense early, where it falls fastest. */
const CURVE_DAYS = [0, 1, 2, 3, 4, 5, 7, 10, 14, 21, 30, 45, 60, 90, 120, 180, 240, 300, 365]

/**
 * If you stopped studying now: how many of the cards you've answered FSRS expects you'd still get right, day by day
 * over the next year.
 */
export function forgetting(rows: Map<string, CardRow>, now = new Date()) {
  const cards = [...rows.values()].filter(learned)
  return {
    total: cards.length,
    points: CURVE_DAYS.map((d) => {
      const at = new Date(+now + d * DAY_MS)
      let sum = 0
      for (const r of cards) sum += scheduler.get_retrievability(r, at, false)
      return { days: d, known: sum }
    }),
  }
}

export type Struggle = { row: CardRow; card: DeckCard; last: number[] }

/**
 * The cards giving you trouble lately, rather than ever: missed at least once in your last five answers on them
 * (after the first time you saw it), and not yet a sturdy memory. Most misses first, then the weakest memory.
 */
export function strugglingNow(rows: Map<string, CardRow>, logs: RevlogRow[], n = 10): Struggle[] {
  const byCard = new Map<string, RevlogRow[]>()
  for (const l of logs) if (CARD_BY_ID.has(l.cardId)) byCard.set(l.cardId, [...(byCard.get(l.cardId) ?? []), l])
  const out: (Struggle & { misses: number })[] = []
  for (const [id, list] of byCard) {
    const row = rows.get(id)
    if (!learned(row) || row.stability >= 21) continue
    list.sort((a, b) => +new Date(a.review) - +new Date(b.review))
    const last = list
      .slice(1)
      .slice(-5)
      .map((l) => l.rating)
    const misses = last.filter((r) => r === 1).length
    if (misses) out.push({ row, card: CARD_BY_ID.get(id)!, last, misses })
  }
  return out.sort((a, b) => b.misses - a.misses || a.row.stability - b.row.stability).slice(0, n)
}
