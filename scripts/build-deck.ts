// Converts the CrowdAnki export of Ultimate Geography into a compact JSON the app ships.
// Usage: pnpm build:deck   (reads deck-src/deck.json, writes src/data/deck.json)
import { readFileSync, writeFileSync } from 'node:fs'

type RawNote = { guid: string; fields: string[]; tags: string[] }
type Raw = { name: string; notes: RawNote[]; note_models: { flds: { name: string }[] }[] }

const raw = JSON.parse(readFileSync('deck-src/deck.json', 'utf8')) as Raw
const fieldNames = raw.note_models[0].flds.map((f) => f.name)
const idx = (name: string) => fieldNames.indexOf(name)

const imgs = (html: string) => [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1])
// Some flags ship a blurred copy (e.g. Guam, whose flag spells its name). Front shows the blur, back the real one.
const flagFront = (html: string) => imgs(html)[0] ?? null
const flagBack = (html: string) => imgs(html).find((s) => !s.includes('-blur')) ?? null
const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()

const notes = raw.notes.map((n) => ({
  id: n.guid,
  country: text(n.fields[idx('Country')]),
  countryInfo: text(n.fields[idx('Country info')]),
  capital: text(n.fields[idx('Capital')]),
  capitalInfo: text(n.fields[idx('Capital info')]),
  capitalHint: text(n.fields[idx('Capital hint')]),
  flag: flagFront(n.fields[idx('Flag')]),
  flagBack: flagBack(n.fields[idx('Flag')]),
  flagSimilar: text(n.fields[idx('Flag similarity')]),
  map: imgs(n.fields[idx('Map')])[0] ?? null,
  tags: n.tags.map((t) => t.replace(/^UG::/, '')),
}))

const suspicious = raw.notes.flatMap((n) =>
  n.fields
    .map((f, i) => ({ name: fieldNames[i], f }))
    .filter((x) => !['Flag', 'Map'].includes(x.name) && /<[a-z]/i.test(x.f))
    .map((x) => `${n.fields[0]} / ${x.name}: ${x.f.slice(0, 80)}`),
)
if (suspicious.length) console.log('HTML in text fields:\n' + suspicious.join('\n'))

const regions = [...new Set(notes.flatMap((n) => n.tags))].sort()
writeFileSync('src/data/deck.json', JSON.stringify({ version: '5.3', regions, notes }))
console.log(`wrote ${notes.length} notes, ${regions.length} tags, ${notes.filter((n) => n.capital).length} with capital, ${notes.filter((n) => n.flag).length} with flag`)
