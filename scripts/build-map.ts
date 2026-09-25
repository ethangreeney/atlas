// Pre-renders the Progress page's world map: Natural Earth 1:50m countries (public domain, via world-atlas),
// simplified and projected once into SVG path strings keyed by deck note id.
// Usage: pnpm build:map   (reads world-atlas + src/data/deck.json, writes src/data/world.json)
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { geoEqualEarth, geoPath } from 'd3-geo'
import { feature } from 'topojson-client'
import { presimplify, quantile, simplify } from 'topojson-simplify'
import type { Topology, GeometryCollection } from 'topojson-specification'
import type { Feature, FeatureCollection, Geometry } from 'geojson'

const require = createRequire(import.meta.url)
const WIDTH = 1000
/** Share of Natural Earth's points kept by Visvalingam simplification: plenty for a map a few hundred pixels wide. */
const SIMPLIFY = 0.2
/** Rings smaller than this (px²) are dropped, except a country's largest one, so tiny states keep a speck. */
const MIN_RING = 1.5

type Props = { name: string }
const topo = JSON.parse(readFileSync(require.resolve('world-atlas/countries-50m.json'), 'utf8')) as Topology<{
  countries: GeometryCollection<Props>
}>
const deck = JSON.parse(readFileSync('src/data/deck.json', 'utf8')) as { notes: { id: string; country: string; tags: string[] }[] }

/** Natural Earth's short names → the deck's names. Anything not listed must match exactly. */
const RENAME: Record<string, string> = {
  'Bosnia and Herz.': 'Bosnia and Herzegovina',
  Czechia: 'Czech Republic',
  Macedonia: 'North Macedonia',
  Vatican: 'Vatican City',
  'Cabo Verde': 'Cape Verde',
  'São Tomé and Principe': 'São Tomé and Príncipe',
  'Central African Rep.': 'Central African Republic',
  'Eq. Guinea': 'Equatorial Guinea',
  "Côte d'Ivoire": 'Ivory Coast',
  'Dem. Rep. Congo': 'Democratic Republic of the Congo',
  Congo: 'Republic of the Congo',
  Gambia: 'The Gambia',
  eSwatini: 'Eswatini',
  'W. Sahara': 'Sahrawi Arab Democratic Republic',
  'S. Sudan': 'South Sudan',
  'N. Cyprus': 'Northern Cyprus',
  'Solomon Is.': 'Solomon Islands',
  'Cook Is.': 'Cook Islands',
  'Marshall Is.': 'Marshall Islands',
  // The deck also has "Micronesia" the region; the shape is the country.
  Micronesia: 'Federated States of Micronesia',
  'Dominican Rep.': 'Dominican Republic',
  Bahamas: 'The Bahamas',
  'Antigua and Barb.': 'Antigua and Barbuda',
  'St. Vin. and Gren.': 'Saint Vincent and the Grenadines',
  'St. Kitts and Nevis': 'Saint Kitts and Nevis',
  'N. Mariana Is.': 'Northern Mariana Islands',
  'U.S. Virgin Is.': 'United States Virgin Islands',
  'British Virgin Is.': 'British Virgin Islands',
  'Turks and Caicos Is.': 'Turks and Caicos Islands',
  'Cayman Is.': 'Cayman Islands',
  'Falkland Is.': 'Falkland Islands',
  'Wallis and Futuna Is.': 'Wallis and Futuna',
  'St-Martin': 'Saint Martin',
  'Fr. Polynesia': 'French Polynesia',
  Åland: 'Åland Islands',
  'Faeroe Is.': 'Faroe Islands',
  Macao: 'Macau',
}
/** Shapes left off entirely rather than drawn as unmatched land. */
const DROP = new Set(['Antarctica', 'Fr. S. Antarctic Lands', 'Heard I. and McDonald Is.'])

const byName = new Map(deck.notes.map((n) => [n.country, n.id]))

const pre = presimplify(topo)
const simplified = simplify(pre, quantile(pre, SIMPLIFY)) as typeof topo
const countries = feature(simplified, simplified.objects.countries) as FeatureCollection<Geometry, Props>
const kept = countries.features.filter((f) => !DROP.has(f.properties.name))

const projection = geoEqualEarth().fitWidth(WIDTH, { type: 'FeatureCollection', features: kept })
const height = Math.ceil(geoPath(projection).bounds({ type: 'FeatureCollection', features: kept })[1][1])

/** Compact SVG path: coordinates rounded to 0.1px and written relative to the previous point. */
function render(f: Feature<Geometry, Props>) {
  const rings: { pts: [number, number][]; area: number }[] = []
  let cur: [number, number][] = []
  const ctx = {
    moveTo: (x: number, y: number) => {
      cur = [[x, y]]
    },
    lineTo: (x: number, y: number) => {
      cur.push([x, y])
    },
    closePath: () => {
      let a = 0
      for (let i = 0, j = cur.length - 1; i < cur.length; j = i++) a += cur[j][0] * cur[i][1] - cur[i][0] * cur[j][1]
      rings.push({ pts: cur, area: Math.abs(a / 2) })
      cur = []
    },
    arc: () => {},
    rect: () => {},
  }
  geoPath(projection, ctx as unknown as CanvasRenderingContext2D)(f)
  if (!rings.length) return ''
  const biggest = Math.max(...rings.map((r) => r.area))
  const r10 = (v: number) => Math.round(v * 10)
  const fmt = (v: number) => {
    const s = (v / 10).toString()
    return s.startsWith('0.') ? s.slice(1) : s.startsWith('-0.') ? '-' + s.slice(2) : s
  }
  let d = ''
  let px = 0
  let py = 0
  for (const r of rings) {
    if (r.area < MIN_RING && r.area !== biggest) continue
    const pts = r.pts.map(([x, y]) => [r10(x), r10(y)] as const)
    d += `M${fmt(pts[0][0])} ${fmt(pts[0][1])}`
    ;[px, py] = pts[0]
    let seg = ''
    for (const [x, y] of pts.slice(1)) {
      const dx = x - px
      const dy = y - py
      if (!dx && !dy) continue
      seg += `${seg ? (dx < 0 ? '' : ' ') : 'l'}${fmt(dx)}${dy < 0 ? '' : ' '}${fmt(dy)}`
      px = x
      py = y
    }
    d += seg + 'z'
  }
  return d
}

const shapes: Record<string, string> = {}
const rest: string[] = []
const unmatchedShapes: string[] = []
for (const f of kept) {
  const name = f.properties.name
  const id = byName.get(RENAME[name] ?? name)
  const d = render(f)
  if (!d) continue
  if (!id) {
    unmatchedShapes.push(name)
    rest.push(d)
    continue
  }
  // A few deck places span two Natural Earth shapes; draw both.
  shapes[id] = (shapes[id] ?? '') + d
}

const out = { width: WIDTH, height, shapes, rest: rest.join('') }
const json = JSON.stringify(out)
writeFileSync('src/data/world.json', json + '\n')

const noShape = deck.notes
  .filter((n) => !shapes[n.id] && !n.tags.includes('Oceans+Seas') && !n.tags.includes('Continents'))
  .map((n) => n.country)
console.log(`world.json: ${(json.length / 1024).toFixed(0)} KB, ${Object.keys(shapes).length} places, ${WIDTH}×${height}`)
console.log(`Deck places without a shape (${noShape.length}): ${noShape.join(', ')}`)
console.log(`Shapes without a deck note, drawn as plain land (${unmatchedShapes.length}): ${unmatchedShapes.join(', ')}`)
