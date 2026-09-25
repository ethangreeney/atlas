import raw from '../data/deck.json'

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

export type CardType = 'capital' | 'country' | 'flag' | 'map'
export const CARD_TYPES: { id: CardType; label: string; prompt: string }[] = [
  { id: 'capital', label: 'Country → Capital', prompt: 'Capital of' },
  { id: 'country', label: 'Capital → Country', prompt: 'Capital' },
  { id: 'flag', label: 'Flag → Country', prompt: 'Flag' },
  { id: 'map', label: 'Map → Country', prompt: 'Location' },
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

/** Every card in the deck: up to four per note, mirroring the Anki templates' conditionals. */
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

export const CARD_BY_ID = new Map(ALL_CARDS.map((c) => [c.id, c]))

export const mediaUrl = (file: string) => `${import.meta.env.BASE_URL}media/${file}`

/** The text a learner must produce for this card. */
export const answerOf = (c: DeckCard) => (c.type === 'capital' ? c.note.capital : c.note.country)

export const regionLabel = (tag: string) => tag.replace(/_/g, ' ').replace('Oceans+Seas', 'Oceans & Seas')
