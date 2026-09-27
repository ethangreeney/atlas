// Ranks the deck's places from famous to obscure, so a new learner meets France before Nauru.
// Fame is the English Wikipedia article's views over the last ten years: rough, but it tracks what people have heard of.
// Usage: pnpm build:fame   (reads src/data/deck.json, writes src/data/fame.json: note ids, most famous first)
import { readFileSync, writeFileSync } from 'node:fs'

type Note = { id: string; country: string; tags: string[] }
const deck = JSON.parse(readFileSync('src/data/deck.json', 'utf8')) as { notes: Note[] }

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
/** Wikimedia rate-limits bursts: back off and retry on 429. */
async function get(url: string | URL) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { headers: UA })
    if (res.status !== 429 || i === 5) return res
    await sleep(2000 * 2 ** i)
  }
}

type Page = { title: string; missing?: string; pageprops?: { disambiguation?: string } }
type Reply = {
  query: { pages: Record<string, Page>; redirects?: { from: string; to: string }[]; normalized?: { from: string; to: string }[] }
}

/** The article each name lands on after redirects, and whether that's a disambiguation page. */
async function resolve(titles: string[]) {
  const url = new URL('https://en.wikipedia.org/w/api.php')
  url.search = new URLSearchParams({ action: 'query', format: 'json', redirects: '1', prop: 'pageprops', ppprop: 'disambiguation', titles: titles.join('|') }).toString()
  const { query } = (await (await get(url)).json()) as Reply
  const to = new Map(titles.map((t) => [t, t]))
  for (const r of [...(query.normalized ?? []), ...(query.redirects ?? [])]) for (const [k, v] of to) if (v === r.from) to.set(k, r.to)
  const pages = new Map(Object.values(query.pages).map((p) => [p.title, p]))
  return titles.map((t) => {
    const p = pages.get(to.get(t)!)
    return { name: t, article: to.get(t)!, ok: !!p && !p.missing && !(p.pageprops && 'disambiguation' in p.pageprops) }
  })
}

/** Views over ten full years, so one news spike (a World Cup run, a crisis) doesn't decide it. */
async function decadeViews(article: string) {
  const d = (x: Date) => x.toISOString().slice(0, 10).replace(/-/g, '')
  const end = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1))
  const start = new Date(Date.UTC(end.getUTCFullYear() - 10, 0, 1))
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(article.replace(/ /g, '_'))}/monthly/${d(start)}/${d(end)}`
  const res = await get(url)
  if (!res.ok) return 0
  const { items } = (await res.json()) as { items: { views: number }[] }
  return items.reduce((a, b) => a + b.views, 0)
}

const titleOf = (n: Note) => TITLES[n.country] ?? n.country
const titles = [...new Set(deck.notes.map(titleOf))]
const found = new Map<string, { views: number; ok: boolean }>()
for (let i = 0; i < titles.length; i += 50) {
  const batch = await resolve(titles.slice(i, i + 50))
  const counts: number[] = []
  for (const r of batch) counts.push(await decadeViews(r.article))
  batch.forEach((r, j) => found.set(r.name, { views: counts[j], ok: r.ok }))
}

const ranked = deck.notes
  .map((n) => ({ n, v: found.get(titleOf(n))! }))
  .sort((a, b) => b.v.views - a.v.views)
for (const { n, v } of ranked) if (!v.ok || !v.views) console.warn('check:', n.country, v)
writeFileSync('src/data/fame.json', JSON.stringify(ranked.map((x) => x.n.id)))
console.log(ranked.slice(0, 25).map((x) => x.n.country).join(', '))
console.log('…', ranked.slice(-15).map((x) => x.n.country).join(', '))
