import { createEmptyCard, fsrs, type Card } from 'ts-fsrs'
import type { CardRow } from './db'
import { ALL_CARDS, CARD_BY_ID, NOTES, type DeckCard, type Note } from './deck'
import { dayEnd, matchesFilters, PARAMS, Rating, State } from './scheduler'
import type { Settings } from './settings'

/** Anki's line: a card whose interval has reached three weeks is mature. */
export const MATURE_DAYS = 21
export const isMature = (r: CardRow | undefined) => !!r && r.state === State.Review && r.scheduled_days >= MATURE_DAYS

export const CARDS_BY_NOTE = new Map<string, DeckCard[]>()
for (const c of ALL_CARDS) CARDS_BY_NOTE.set(c.note.id, [...(CARDS_BY_NOTE.get(c.note.id) ?? []), c])
export const NOTE_BY_ID = new Map(NOTES.map((n) => [n.id, n]))

export type Mastery = { mature: number; total: number; /** 0 = not started, 1–3 = in progress, 4 = every card mature. */ level: number }

/** How much of each note is mature, in four steps. */
export function mastery(rows: Map<string, CardRow>) {
  const out = new Map<string, Mastery>()
  for (const [id, cards] of CARDS_BY_NOTE) {
    const mature = cards.filter((c) => isMature(rows.get(c.id))).length
    // Cards still being learned count a little, so the map fills in from day one; full colour needs every card mature.
    const learning = cards.filter((c) => { const r = rows.get(c.id); return !!r && r.state !== State.New && !isMature(r) }).length
    const score = (mature + learning * 0.35) / cards.length
    out.set(id, { mature, total: cards.length, level: mature === cards.length ? 4 : score ? Math.min(3, Math.ceil(score * 3)) : 0 })
  }
  return out
}

/** Leeches first, then the cards forgotten most often after being learned. */
export function hardest(rows: Map<string, CardRow>, n = 10) {
  return [...rows.values()]
    .filter((r) => (r.lapses > 0 || r.leech) && CARD_BY_ID.has(r.id))
    .sort((a, b) => Number(!!b.leech) - Number(!!a.leech) || b.lapses - a.lapses || b.difficulty - a.difficulty)
    .slice(0, n)
}

const DAY_MS = 86_400_000
/** Same parameters as the real scheduler, without the random fuzz, so the estimate is steady. */
const steady = fsrs({ ...PARAMS, enable_fuzz: false })

/**
 * A rough look ahead, assuming every answer is Good (real lapses add a little on top):
 * how many days until every new card in the filters has been introduced at the current pace,
 * and the busiest day of reviews between now and a month after that.
 */
export function forecast(rows: Map<string, CardRow>, settings: Settings, now = new Date()) {
  const cards = ALL_CARDS.filter((c) => matchesFilters(c, settings))
  const perNote = new Map<string, number>()
  for (const c of cards) {
    if ((rows.get(c.id)?.state ?? State.New) !== State.New) continue
    perNote.set(c.note.id, (perNote.get(c.note.id) ?? 0) + 1)
  }
  const remaining = [...perNote.values()].reduce((a, b) => a + b, 0)
  const pace = Math.max(1, settings.newPerDay)
  // Only one card per place is introduced a day, so a place with four new cards takes four days at least.
  const days = remaining ? Math.max(Math.ceil(remaining / pace), ...perNote.values()) : 0

  const horizon = Math.min(400, days + 30)
  const load = new Array<number>(horizon).fill(0)
  const today = dayEnd(now)
  const dayOf = (t: Date) => (t < today ? 0 : 1 + Math.floor((+t - +today) / DAY_MS))

  /** Reviews a card will need from `from` on, answered Good each time, by day index. */
  const walk = (card: Card, from: Date, add: (day: number) => void, skipToday: boolean) => {
    let c = card
    let t = from
    for (let i = 0; i < 40; i++) {
      c = steady.next(c, t, Rating.Good).card
      t = new Date(Math.max(+c.due, +t))
      const d = dayOf(t)
      if (d >= horizon) return
      if (d > 0 || !skipToday) add(d)
    }
  }

  for (const c of cards) {
    const r = rows.get(c.id)
    if (!r || r.state === State.New) continue
    const due = new Date(Math.max(+new Date(r.due), +now))
    const d = dayOf(due)
    if (d >= horizon) continue
    load[d]++
    walk(r, due, (x) => load[x]++, false)
  }

  // Every new card follows the same path, so walk one and shift it by the day it's introduced.
  const path: number[] = []
  walk(createEmptyCard(now), now, (d) => path.push(d), true)
  for (let k = 0, left = remaining; left > 0; k++) {
    const n = Math.min(pace, left)
    left -= n
    for (const d of path) if (k + d < horizon) load[k + d] += n
  }

  const peak = Math.min(settings.reviewsPerDay, Math.max(0, ...load))
  return { remaining, days, peak }
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’'.]/g, '')
    .replace(/-/g, ' ')
    .toLowerCase()
    .trim()

const INDEX = NOTES.map((note) => ({
  note,
  country: fold(note.country),
  capitals: note.capital ? note.capital.split(/,\s*/).map(fold) : [],
}))

const rank = (hay: string, q: string) => (hay === q ? 0 : hay.startsWith(q) ? 1 : hay.includes(' ' + q) ? 2 : hay.includes(q) ? 3 : Infinity)

/** Places whose name or capital matches, ignoring accents and punctuation: whole name, then prefix, then word, then anywhere. */
export function search(query: string, limit = 30): Note[] {
  const q = fold(query)
  if (!q) return []
  return INDEX.map((x) => ({ note: x.note, score: Math.min(rank(x.country, q), ...x.capitals.map((c) => rank(c, q) + 0.5)) }))
    .filter((x) => x.score < Infinity)
    .sort((a, b) => a.score - b.score || a.note.country.localeCompare(b.note.country))
    .slice(0, limit)
    .map((x) => x.note)
}
