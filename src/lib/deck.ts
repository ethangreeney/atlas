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

export const NOTES = raw.notes as Note[]
export const REGIONS = raw.regions as string[]
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
