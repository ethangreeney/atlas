// Our corrections to Ultimate Geography, applied on top of every pull (scripts/sync-deck.ts) so an update can't undo
// them. Drop an entry once the deck itself has caught up. Each says what changed, when, and where it's from.

/** Text fields to replace, by the deck's English place name. */
export const FIELDS: Record<string, Partial<Record<'country' | 'countryInfo' | 'capital' | 'capitalInfo' | 'capitalHint' | 'flagSimilar', string>>> = {}

/** Images to use instead of the deck's, by file name: our copies live in scripts/deck-media. */
export const MEDIA: Record<string, string> = {
  // Honduras went back to navy blue on 27 January 2026, after four years of turquoise; the deck switched to turquoise
  // a fortnight later. Wikimedia Commons, public domain: https://en.wikipedia.org/wiki/Flag_of_Honduras
  'ug-flag-honduras.svg': 'scripts/deck-media/ug-flag-honduras.svg',
  // North Korea's flag became 20:33 (from 1:2) on 23 March 2026. Wikimedia Commons, public domain:
  // https://commons.wikimedia.org/wiki/File:Flag_of_North_Korea_(20-33).svg
  'ug-flag-north_korea.svg': 'scripts/deck-media/ug-flag-north_korea.svg',
}
