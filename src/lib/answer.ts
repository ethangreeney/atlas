import { ALL_CARDS, type DeckCard } from './deck'

export type Verdict = 'right' | 'close' | 'wrong'

/** Other names in common English use for the same country, territory or sea, keyed by the deck's name. The deck's own "also known as" notes are read separately. */
const COUNTRY_ALIASES: Record<string, string[]> = {
  'United States of America': ['United States', 'USA', 'US', 'America'],
  'United Kingdom': ['UK', 'Great Britain', 'Britain', 'United Kingdom of Great Britain and Northern Ireland'],
  'United Arab Emirates': ['UAE', 'Emirates'],
  // "Congo" alone is left out of both: the UN uses it for Brazzaville, the press mostly for Kinshasa.
  'Democratic Republic of the Congo': ['DRC', 'DR Congo', 'Congo-Kinshasa', 'Congo, Democratic Republic of the'],
  'Republic of the Congo': ['Congo-Brazzaville', 'Congo Republic', 'Congo, Republic of the'],
  'Central African Republic': ['CAR'],
  // "Korea" alone is left out of both.
  'South Korea': ['Republic of Korea', 'ROK', 'Korea, South'],
  'North Korea': ["Democratic People's Republic of Korea", 'DPRK', 'Korea, North'],
  'Russia': ['Russian Federation'],
  'Iraq': ['Irak'],
  'China': ["People's Republic of China", 'PRC'],
  'Taiwan': ['Republic of China', 'ROC', 'Chinese Taipei'],
  'Palestine': ['State of Palestine', 'Palestinian Territories'],
  'Sahrawi Arab Democratic Republic': ['SADR', 'Sahrawi Republic'],
  'Northern Cyprus': ['North Cyprus', 'Turkish Republic of Northern Cyprus', 'TRNC'],
  'Vatican City': ['Vatican', 'Holy See', 'Vatican City State'],
  'Federated States of Micronesia': ['Micronesia'],
  'Netherlands': ['Holland'],
  'Ireland': ['Republic of Ireland', 'Éire'],
  'Brunei': ['Brunei Darussalam'],
  'Laos': ['Lao PDR', "Lao People's Democratic Republic"],
  'Syria': ['Syrian Arab Republic'],
  'Moldova': ['Republic of Moldova'],
  'Kyrgyzstan': ['Kyrgyz Republic'],
  'Slovakia': ['Slovak Republic'],
  'Papua New Guinea': ['PNG'],
  // The first island stands for the whole country in everyday English.
  'Bosnia and Herzegovina': ['Bosnia'],
  'Trinidad and Tobago': ['Trinidad'],
  'Antigua and Barbuda': ['Antigua'],
  'Saint Kitts and Nevis': ['Saint Kitts', 'Saint Christopher and Nevis'],
  'Saint Vincent and the Grenadines': ['Saint Vincent'],
  'Northern Ireland': ['N Ireland'],
  'United States Virgin Islands': ['US Virgin Islands', 'USVI'],
  'British Virgin Islands': ['BVI'],
  'Faroe Islands': ['Faroes', 'Faeroe Islands', 'Faeroes'],
  'Falkland Islands': ['Falklands'],
  'Turks and Caicos Islands': ['Turks and Caicos'],
  'Cayman Islands': ['Caymans'],
  'Northern Mariana Islands': ['Northern Marianas'],
  'Åland Islands': ['Åland'],
  'Canary Islands': ['Canaries'],
  'Macau': ['Macao'],
  'Sint Maarten': ['St Maarten'],
  'Kaliningrad Oblast': ['Kaliningrad'],
  'Jeju': ['Jeju Island', 'Jeju-do'],
  'European Union': ['EU'],
  'Balkan Peninsula': ['Balkans'],
  'Gulf of Mexico': ['Gulf of America'],
  'Southern Ocean': ['Antarctic Ocean'],
  'Pacific Ocean': ['Pacific'],
  'Atlantic Ocean': ['Atlantic'],
  'Arctic Ocean': ['Arctic'],
  'Mediterranean Sea': ['Mediterranean'],
  'Caribbean Sea': ['Caribbean'],
  'Baltic Sea': ['Baltic'],
  'Adriatic Sea': ['Adriatic'],
  'Aegean Sea': ['Aegean'],
  'Caspian Sea': ['Caspian'],
  'Persian Gulf': ['Arabian Gulf'],
  // Not "East Sea": Vietnam uses that name for the South China Sea.
  'Sea of Japan': ['Japan Sea'],
  'Hudson Bay': ["Hudson's Bay"],
  'Sea of Galilee': ['Lake Tiberias', 'Lake Kinneret', 'Kinneret'],
  'Celebes Sea': ['Sulawesi Sea'],
  'Strait of Malacca': ['Malacca Strait', 'Straits of Malacca'],
  'Strait of Hormuz': ['Hormuz Strait', 'Straits of Hormuz'],
  'Strait of Gibraltar': ['Gibraltar Strait', 'Straits of Gibraltar'],
}

/** Other spellings of the same capital city, keyed by the deck's country (Jerusalem means different things for Israel and Palestine). Never a different city. */
const CAPITAL_ALIASES: Record<string, string[]> = {
  'United States of America': ['Washington', 'DC', 'District of Columbia', 'Washington, District of Columbia'],
  'Switzerland': ['Berne'],
  'Albania': ['Tiranë'],
  'China': ['Peking'],
  'Mongolia': ['Ulan Bator', 'Ulaan Baatar'],
  'Myanmar': ['Nay Pyi Taw', 'Naypyitaw'],
  'Nepal': ['Katmandu'],
  'Iran': ['Teheran'],
  'Turkmenistan': ['Ashkhabad', 'Ashgabad'],
  'Sri Lanka': ['Kotte', 'Sri Jayawardenepura', 'Sri Jayewardenepura Kotte'],
  'Kosovo': ['Prishtina', 'Prishtinë'],
  'Abkhazia': ['Sokhumi'],
  'Faroe Islands': ['Thorshavn'],
  'Guam': ['Agana', 'Agaña'],
  'Equatorial Guinea': ['Oyala'],
  'Ethiopia': ['Addis Abeba'],
  'Djibouti': ['Djibouti City'],
  'Singapore': ['Singapore City'],
  'Kiribati': ['Tarawa'],
  'Nauru': ['Yaren District'],
  'Seychelles': ['Port Victoria'],
  'Palestine': ['East Jerusalem'],
  'Vatican City': ['Vatican'],
  'San Marino': ['San Marino'],
}

/**
 * Real places that are one slip away from a deck answer but aren't it (Prussia isn't Russia, Lagos isn't Laos),
 * and short forms that could mean more than one answer (Congo, Korea). Typing one is wrong, never a slip.
 */
const NOT_ANSWERS = [
  'Congo', 'Korea', 'Timor', 'Virgin Islands', 'Dominican', 'East Sea', 'Americas', 'Australasia', 'Tasmania', 'North Africa',
  'Cocos Islands', 'Prussia', 'Siberia', 'Iberia', 'Yalta', 'Samos', 'Styria', 'Tainan', 'Ajman', 'Harar', 'Nakuru', 'Samara',
  'Pinsk', 'Praha', 'Karen', 'Lagos', 'Oran', 'Nice', 'Bari', 'Fuji', 'Kiel', 'Nome', 'Jenin', 'Nyala', 'Arawa', 'Atlantis',
]

const WORDS: Record<string, string> = { st: 'saint', ste: 'sainte', mt: 'mount', ft: 'fort', and: '', the: '' }
/** Letters that don't split into a base letter and an accent. */
const LETTERS: Record<string, string> = { ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i' }

/** Case, accents, punctuation, "St."/"Saint", "&"/"and" and "the" all ignored. `spelled` keeps "and" and "the". */
const words = (s: string, spelled = false) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[øæœßłđðþı]/g, (c) => LETTERS[c])
    .replace(/&/g, ' and ')
    .replace(/['’ʻʼ`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (spelled && (w === 'and' || w === 'the') ? w : WORDS[w] ?? w))
    .filter(Boolean)

/** The words above run together, so spacing and hyphens don't matter either. */
export const normalize = (s: string) => words(s).join('')
/** Keeps "and" and "the", so a typo in one ("Trinidad adn Tobago") is still a slip of the full name. */
const spelled = (s: string) => words(s, true).join('')

/** "Also known as Czechia.", "Formerly Zaire.", "Known as Swaziland until 2018.", "Known as Nur-Sultan between 2019 and 2022." */
const alternates = (info: string) =>
  [...info.matchAll(/(?:also known as|officially|formerly known as|formerly|known as|also spelled as)\s+(?:the\s+)?(.+?)(?=\s+(?:until|between|since|from|in|before|after)\b|[.,;:()]|$)/gi)]
    .flatMap((m) => m[1].split(/\s+or\s+/))
    // Only a name, never a clause that slipped through.
    .filter((name) => !/\d/.test(name) && name.split(/\s+/).length <= 5)

/** "Pretoria, Cape Town, Bloemfontein" is three capitals but "Washington, D.C." is one. */
const items = (s: string) => s.split(/,(?!\s*[A-Z]\.)/).map((x) => x.trim()).filter(Boolean)

/** Every name a card accepts, as written. */
function names(card: DeckCard) {
  const n = card.note
  const capital = card.type === 'capital'
  const answer = capital ? n.capital : n.country
  const aliases = (capital ? CAPITAL_ALIASES : COUNTRY_ALIASES)[n.country] ?? []
  return [answer, ...items(answer), ...alternates(capital ? n.capitalInfo : n.countryInfo), ...aliases]
}

/** Every spelling accepted for a card, e.g. any one of South Africa's three capitals. */
export const accepted = (card: DeckCard) => [...new Set(names(card).map(normalize).filter(Boolean))]

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

/** Drops one letter of a doubled pair: "fijji" → "fiji". */
const undoubled = (s: string) => [...s].flatMap((c, i) => (c === s[i + 1] ? [s.slice(0, i) + s.slice(i + 1)] : []))

/** Two neighbouring letters swapped: "Irna" for Iran. */
const swapped = (t: string, a: string) => {
  const i = [...a].findIndex((c, j) => c !== t[j])
  return t.length === a.length && i >= 0 && t[i] === a[i + 1] && t[i + 1] === a[i] && t.slice(i + 2) === a.slice(i + 2)
}

/** Runs of one letter read as one: "Phillipines" and "Philippines" are both "philipines". */
const squeeze = (s: string) => s.replace(/(.)\1+/g, '$1')

/**
 * How many edits a typed answer is from `a`, if that reads as a slip of it rather than another word.
 * Abbreviations must be exact. A four-letter answer only takes a swapped or doubled letter, since any other
 * change to one often lands on a real place (Oran for Iran, Bari for Bali).
 */
function slip(t: string, a: string) {
  if (a.length <= 3) return Infinity
  if (a.length === 4) return swapped(t, a) || undoubled(t).includes(a) || undoubled(a).includes(t) ? 1 : Infinity
  const slack = a.length <= 8 ? 1 : 2
  const near = (x: string, y: string, extra: number) => (Math.abs(x.length - y.length) + extra > slack ? Infinity : distance(x, y) + extra)
  // Getting doubled letters wrong is the commonest misspelling (Morroco, Carribean), so all of that counts as one slip.
  const d = Math.min(near(t, a, 0), squeeze(t) === t && squeeze(a) === a ? Infinity : near(squeeze(t), squeeze(a), 1))
  return d <= slack ? d : Infinity
}

const forms = (capital: boolean) => new Set(ALL_CARDS.filter((c) => (c.type === 'capital') === capital).flatMap(accepted))
const NOT = NOT_ANSWERS.map(normalize)
/** What else a typed place could be: any country-type answer for a country card; for a capital, anything at all, so a misspelt country isn't taken for its capital (Tunisa for Tunis). */
const COUNTRY_RIVALS = [...new Set([...forms(false), ...NOT])]
const KNOWN = new Set([...COUNTRY_RIVALS, ...forms(true)])
const CAPITAL_RIVALS = [...KNOWN]

/** Words that make a different place out of the same name: North Africa isn't a slip of South Africa. */
const QUALIFIERS = new Set(['north', 'south', 'east', 'west', 'northern', 'southern', 'eastern', 'western', 'central', 'upper', 'lower', 'inner', 'outer', 'new', 'great', 'greater', 'little', 'lesser'])

export function check(typed: string, card: DeckCard): Verdict {
  const t = normalize(typed)
  const ok = accepted(card)
  const all = names(card)
  if (!t) return 'wrong'
  if (ok.includes(t)) return 'right'
  // Several answers at once ("Pretoria and Cape Town") count only if every one of them does.
  const parts = typed.split(/\s*(?:[,;/&]|\band\b|\bor\b)\s*/i).filter((p) => normalize(p))
  if (parts.length > 1) {
    const verdicts = parts.map((p) => check(p, card))
    if (verdicts.every((v) => v === 'right')) return 'right'
    if (verdicts.every((v) => v !== 'wrong')) return 'close'
  }
  // Another real place is wrong, not a typo (Iraq for Iran).
  if (KNOWN.has(t)) return 'wrong'
  const qualifiers = words(typed).filter((w) => QUALIFIERS.has(w))
  const kept = spelled(typed)
  const d = Math.min(...all.filter((a) => qualifiers.every((q) => normalize(a).includes(q))).flatMap((a) => [slip(t, normalize(a)), slip(kept, spelled(a))]))
  if (d === Infinity) return 'wrong'
  // A slip at least as near another real answer could be either, so it can't count (Nigera: Niger or Nigeria?).
  const rivals = card.type === 'capital' ? CAPITAL_RIVALS : COUNTRY_RIVALS
  if (rivals.some((r) => !ok.includes(r) && slip(t, r) <= d)) return 'wrong'
  return 'close'
}
