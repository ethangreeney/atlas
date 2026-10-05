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

/** Regions that read with "the": the Caribbean, the Middle East. */
const THE = new Set(['Caribbean', 'Middle_East', 'European_Union', 'Mediterranean'])
export const placeName = (region: string) => (THE.has(region) ? 'the ' : '') + regionLabel(region)
/** The row that holds every card of a kind, above the regions. */
export const WHOLE = 'All'
/** A set's region on its own, as a row label: "Caribbean", "Whole deck". */
export const regionShort = (region: string) => (region === WHOLE ? 'Whole deck' : placeName(region).replace(/^the /, ''))
/** A set's kind of card, after its region: "Caribbean · from capitals". */
export const SET_WORD: Record<CardType, string> = { capital: 'capitals', country: 'from capitals', flag: 'flags', map: 'on the map' }
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

/**
 * The sets nearest finished: fewest cards left to start, then furthest along. One whose last cards would finish a set
 * already picked is left out, so Europe's flags and the EU's don't both wait on the same flag.
 */
export function closest(all: Map<string, DeckSet>, n = 3) {
  const out: DeckSet[] = []
  const covered = new Set<string>()
  const open = [...all.values()].filter((s) => s.left.length)
  open.sort((a, b) => a.left.length - b.left.length || b.done / b.cards.length - a.done / a.cards.length)
  for (const s of open) {
    if (s.left.every((c) => covered.has(c.id))) continue
    out.push(s)
    for (const c of s.left) covered.add(c.id)
    if (out.length === n) break
  }
  return out
}

/** If you stopped studying now: how many of the cards you've answered FSRS expects you'd still get right in a month, and in a year. */
export function forgetting(rows: Map<string, CardRow>, now = new Date()) {
  const cards = [...rows.values()].filter(learned)
  const known = (days: number) => {
    const at = new Date(+now + days * DAY_MS)
    let sum = 0
    for (const r of cards) sum += scheduler.get_retrievability(r, at, false)
    return Math.round(sum)
  }
  return { total: cards.length, month: known(30), year: known(365) }
}

/** How long a memory holds before it starts to slip: FSRS stability, the days until recall falls to 90%. */
export const STRENGTHS = [
  { label: 'Days', below: 7, says: 'would start to slip within days' },
  { label: 'Weeks', below: 30, says: 'would hold for weeks' },
  { label: 'Months', below: 365, says: 'would hold for months' },
  { label: 'A year+', below: Infinity, says: 'would hold for a year or more' },
]

/** The cards you've answered, counted by how long each would hold if you stopped studying. */
export function strength(rows: Map<string, CardRow>) {
  const counts = STRENGTHS.map(() => 0)
  for (const r of rows.values()) if (learned(r)) counts[STRENGTHS.findIndex((s) => r.stability < s.below)]++
  return counts
}

/** Below this chance of recall a card has more likely than not slipped from where FSRS meant to catch it (it books each review for 90%). */
export const SLIPPING = 0.9

export type Slipping = { row: CardRow; card: DeckCard; recall: number }

/**
 * The cards you've answered that you're most likely to have forgotten by now: FSRS's chance you'd get each right this
 * minute, lowest first, only those under 90%. A card you've just got right is back near 100%, so it drops off at once.
 */
export function forgotten(rows: Map<string, CardRow>, now = new Date(), n = 10): Slipping[] {
  const out: Slipping[] = []
  for (const r of rows.values()) {
    if (!learned(r)) continue
    const recall = scheduler.get_retrievability(r, now, false)
    if (recall < SLIPPING) out.push({ row: r, card: CARD_BY_ID.get(r.id)!, recall })
  }
  return out.sort((a, b) => a.recall - b.recall || +new Date(a.row.due) - +new Date(b.row.due)).slice(0, n)
}
