import { NOTES, type Note } from './deck'
import { normalize } from './answer'

export type LookAlike = { id: string | null; name: string; note: string; flag: string | null }

const BY_NAME = new Map(NOTES.map((n) => [normalize(n.country), n]))

/** Splits on commas outside brackets: "Iceland (blue, red cross), Norway (red, blue cross)". */
const items = (s: string) => {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  return [...out, cur].map((x) => x.trim()).filter(Boolean)
}

/** The flags this one is easily mistaken for, each with how it differs. A name that isn't in the deck keeps just its text. */
export const lookAlikes = (n: Note): LookAlike[] =>
  items(n.flagSimilar ?? '').map((item) => {
    const m = item.match(/^(.*?)\s*\((.*)\)$/)
    const [name, note] = m ? [m[1], m[2]] : [item, '']
    const other = BY_NAME.get(normalize(name))
    const known = other && other.id !== n.id ? other : null
    return { id: known?.id ?? null, name: other?.country ?? name, note, flag: known ? (known.flagBack ?? known.flag) : null }
  })

/** Each place's look-alike flags in the deck, both ways round: Chad's lists Romania, so Romania's gets Chad. */
const PARTNERS = new Map<string, Set<string>>()
const pair = (a: string, b: string) => PARTNERS.set(a, (PARTNERS.get(a) ?? new Set()).add(b))
for (const n of NOTES)
  for (const l of lookAlikes(n))
    if (l.id) {
      pair(n.id, l.id)
      pair(l.id, n.id)
    }
const NONE = new Set<string>()
export const flagPartners = (noteId: string) => PARTNERS.get(noteId) ?? NONE
