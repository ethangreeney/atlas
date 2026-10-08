import raw from '../data/deck.json'
import outlined from '../data/outline-ids.json'

export type Note = {
  id: string
  country: string
  countryInfo: string
  capital: string
  capitalInfo: string
  capitalHint: string
  flag: string | null
  flagBack: string | null
  flagSimilar: string
  map: string | null
  tags: string[]
}

/** Ultimate Geography's four kinds of card. */
export type CoreType = 'capital' | 'country' | 'flag' | 'map'
export type CardType = CoreType | 'outline'
export const CARD_TYPES: { id: CoreType; label: string; prompt: string }[] = [
  { id: 'capital', label: 'Country → Capital', prompt: 'Capital of' },
  { id: 'country', label: 'Capital → Country', prompt: 'Capital' },
  { id: 'flag', label: 'Flag → Country', prompt: 'Flag' },
  { id: 'map', label: 'Map → Country', prompt: 'Location' },
]
/** Every kind of card, the extra set's included. */
export const TYPE_INFO: { id: CardType; label: string; prompt: string }[] = [...CARD_TYPES, { id: 'outline', label: 'Outline → Country', prompt: 'Outline' }]

/** Ultimate Geography is the deck; the outlines are an extra set made for Atlas, studied only if switched on. */
export type DeckId = 'ug' | 'outlines'
export const DECKS: { id: DeckId; label: string; about?: string }[] = [
  { id: 'ug', label: 'Ultimate Geography' },
  { id: 'outlines', label: 'Outlines', about: 'an extra set beyond Ultimate Geography' },
]

export type DeckCard = { id: string; type: CardType; note: Note }

/** What a note is, from the deck's tags. Everything that isn't a sovereign state, sea or continent is a territory. */
export type Kind = 'sovereign' | 'territory' | 'sea' | 'continent'
export const KINDS: { id: Kind; label: string; tag?: string }[] = [
  { id: 'sovereign', label: 'Countries', tag: 'Sovereign_State' },
  { id: 'territory', label: 'Territories' },
  { id: 'sea', label: 'Seas & oceans', tag: 'Oceans+Seas' },
  { id: 'continent', label: 'Continents', tag: 'Continents' },
]
export const kindOf = (n: Note): Kind => KINDS.find((k) => k.tag && n.tags.includes(k.tag))?.id ?? 'territory'

export const NOTES = raw.notes as Note[]
/** Geographic regions only; the kind tags are filtered separately. */
export const REGIONS = (raw.regions as string[]).filter((r) => !KINDS.some((k) => k.tag === r))
export const DECK_VERSION = raw.version as string

/** Every card in Ultimate Geography: up to four per note, mirroring the Anki templates' conditionals. */
export const ALL_CARDS: DeckCard[] = NOTES.flatMap((note) => {
  const cards: DeckCard[] = []
  if (note.capital) {
    cards.push({ id: `${note.id}:capital`, type: 'capital', note })
    cards.push({ id: `${note.id}:country`, type: 'country', note })
  }
  if (note.flag) cards.push({ id: `${note.id}:flag`, type: 'flag', note })
  if (note.map) cards.push({ id: `${note.id}:map`, type: 'map', note })
  return cards
})

/** The extra set: a country or territory from its shape alone, for the places whose outline gives them away. */
const OUTLINED = new Set(outlined)
export const OUTLINE_CARDS: DeckCard[] = NOTES.filter((n) => OUTLINED.has(n.id)).map((note) => ({ id: `${note.id}:outline`, type: 'outline', note }))

/** Every card there is to study, in either set. */
export const STUDY_CARDS = [...ALL_CARDS, ...OUTLINE_CARDS]
export const deckOf = (c: DeckCard): DeckId => (c.type === 'outline' ? 'outlines' : 'ug')

export const CARD_BY_ID = new Map(STUDY_CARDS.map((c) => [c.id, c]))
/** Ultimate Geography's cards, which the progress headline, sets and mastery count. */
export const CORE_IDS = new Set(ALL_CARDS.map((c) => c.id))

export const mediaUrl = (file: string) => `${import.meta.env.BASE_URL}media/${file}`

/** The text a learner must produce for this card. */
export const answerOf = (c: DeckCard) => (c.type === 'capital' ? c.note.capital : c.note.country)

export const regionLabel = (tag: string) => tag.replace(/_/g, ' ').replace('Oceans+Seas', 'Oceans & Seas')
