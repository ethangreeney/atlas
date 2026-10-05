// Keeps the order new places come in (src/data/fame.json) in step with the deck. The order is ranked by hand, best
// known first: how well a typical English speaker knows a place, by name and roughly where it is. Reading counts and
// link counts both undersell places everyone already knows (the Pacific, the Red Sea), so neither ranks it alone.
// A place the deck adds goes in where Wikipedia's links put it (how many other articles link to its article, against
// the places already ranked) and is marked `review` until someone checks its spot: move its line, then delete the field.
// Places the deck drops come out; renamed ones keep their spot.
// Usage: pnpm build:fame   (reads src/data/deck.json, rewrites src/data/fame.json, prints what changed)
import { readFileSync, writeFileSync } from 'node:fs'

type Note = { id: string; country: string }
type Place = { id: string; name: string; links: number | null; review?: string }
const FAME = 'src/data/fame.json'
const deck = JSON.parse(readFileSync('src/data/deck.json', 'utf8')) as { notes: Note[] }
let order = JSON.parse(readFileSync(FAME, 'utf8')) as Place[]

/** Deck names whose plain Wikipedia title is a disambiguation page or a different subject. */
const TITLES: Record<string, string> = {
  Georgia: 'Georgia (country)',
  Congo: 'Republic of the Congo',
  'Saint Martin': 'Collectivity of Saint Martin',
  Bougainville: 'Autonomous Region of Bougainville',
  Jeju: 'Jeju Island',
}

const UA = { 'User-Agent': 'atlas-build-fame (https://github.com/ethangreeney/atlas)' }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Wikimedia rate-limits bursts: back off and retry on 429 and passing errors. */
async function get(url: string | URL) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { headers: UA })
    if (res.ok || i === 5 || (res.status !== 429 && res.status < 500)) return res
    await sleep(2000 * 2 ** i)
  }
}

type Page = { title: string; missing?: boolean; pageprops?: { disambiguation?: string } }
/** The article a name lands on after redirects, or null if there's none or it's a disambiguation page. */
async function article(name: string) {
  const url = new URL('https://en.wikipedia.org/w/api.php')
  url.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', redirects: '1', prop: 'pageprops', ppprop: 'disambiguation', titles: name }).toString()
  const res = await get(url)
  if (!res.ok) return null
  const page = ((await res.json()) as { query: { pages: Page[] } }).query.pages[0]
  return page && !page.missing && !(page.pageprops && 'disambiguation' in page.pageprops) ? page.title : null
}

/** How many English Wikipedia articles link to this one, directly or through a redirect. */
async function linksTo(title: string) {
  const res = await get(`https://linkcount.toolforge.org/api/?project=en.wikipedia.org&namespaces=0&page=${encodeURIComponent(title.replace(/ /g, '_'))}`)
  if (!res.ok) return null
  return ((await res.json()) as { wikilinks?: { all: number } }).wikilinks?.all ?? null
}

const notes = new Map(deck.notes.map((n) => [n.id, n]))
const changes: string[] = []
order = order.filter((p) => notes.has(p.id) || (changes.push(`removed ${p.name}`), false))
for (const p of order) {
  const name = notes.get(p.id)!.country
  if (p.name !== name) {
    changes.push(`renamed ${p.name} → ${name}`)
    p.name = name
  }
}
const ranked = new Set(order.map((p) => p.id))
for (const n of deck.notes.filter((n) => !ranked.has(n.id))) {
  const title = await article(TITLES[n.country] ?? n.country)
  const links = title ? await linksTo(title) : null
  // As far down the order as it is down the list of link counts; with no count, last.
  const at = links === null ? order.length : order.filter((p) => (p.links ?? 0) > links).length
  const review = links === null ? 'no Wikipedia link count found, so placed last' : `placed by links (${links.toLocaleString('en')})`
  order.splice(at, 0, { id: n.id, name: n.country, links, review })
  changes.push(`placed ${n.country} at ${at + 1} of ${order.length}, by links`)
}

writeFileSync(FAME, `[\n${order.map((p) => `  ${JSON.stringify(p)}`).join(',\n')}\n]\n`)
const waiting = order.filter((p) => p.review)
console.log(changes.length ? changes.join('\n') : 'no changes to the order')
if (waiting.length) console.log(`waiting for review: ${waiting.map((p) => `${p.name} (${order.indexOf(p) + 1})`).join(', ')}`)
