import { NOTES, type DeckCard } from './deck'

export type Verdict = 'right' | 'close' | 'wrong'

/** Common short forms the deck doesn't spell out. */
const ALIASES: Record<string, string[]> = {
  'United States of America': ['United States', 'USA', 'US', 'America'],
  'United Kingdom': ['UK', 'Great Britain', 'Britain'],
  'United Arab Emirates': ['UAE'],
  'Democratic Republic of the Congo': ['DRC', 'DR Congo', 'Congo-Kinshasa'],
  'Republic of the Congo': ['Congo-Brazzaville'],
  'Central African Republic': ['CAR'],
  'Federated States of Micronesia': ['Micronesia'],
  'United States Virgin Islands': ['US Virgin Islands'],
  'Vatican City': ['Vatican'],
  'City of San Marino': ['San Marino'],
}

const WORDS: Record<string, string> = { st: 'saint', ste: 'sainte', mt: 'mount', ft: 'fort', and: '' }

/** Case, accents, punctuation, "St."/"Saint", "&"/"and" and a leading "The" all ignored; spaces dropped. */
export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '')
    .split(' ')
    .map((w) => WORDS[w] ?? w)
    .join('')

/** "Also known as Czechia.", "Formerly Zaire.", "Known as Swaziland until 2018." */
const alternates = (info: string) =>
  [...info.matchAll(/(?:also known as|officially|formerly known as|formerly|known as|also spelled as)\s+(?:the\s+)?(.+?)(?=\s+until\b|[.,;]|$)/gi)].map((m) => m[1])

/** Every spelling accepted for a card, e.g. any one of South Africa's three capitals. */
export function accepted(card: DeckCard) {
  const n = card.note
  const [answer, info] = card.type === 'capital' ? [n.capital, n.capitalInfo] : [n.country, n.countryInfo]
  const parts = answer.includes(',') ? answer.split(',').map((s) => s.trim()) : []
  return [answer, ...parts, ...alternates(info), ...(ALIASES[answer] ?? [])].map(normalize).filter(Boolean)
}

/** Every name in the deck, so typing a different real place is wrong rather than a typo (Iraq for Iran). */
const NAMES = new Set(NOTES.flatMap((n) => [n.country, n.capital, ...n.capital.split(',')]).filter(Boolean).map(normalize))

/** Edit distance counting a swap of neighbours as one. */
function distance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  return d[a.length][b.length]
}

const slack = (len: number) => (len <= 3 ? 0 : len <= 8 ? 1 : 2)

export function check(typed: string, card: DeckCard): Verdict {
  const t = normalize(typed)
  const ok = accepted(card)
  if (ok.includes(t)) return 'right'
  if (t && !NAMES.has(t) && ok.some((a) => distance(t, a) <= slack(a.length))) return 'close'
  return 'wrong'
}
