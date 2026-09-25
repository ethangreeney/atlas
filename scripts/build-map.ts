// Pre-renders the Progress page's world map: Natural Earth 1:50m countries (public domain, via world-atlas),
// simplified and projected once into SVG path strings keyed by deck note id.
// Also groups places into regions and frames each one, so the map can zoom in far enough to tap the smallest states.
// Usage: pnpm build:map   (reads world-atlas + src/data/deck.json, writes src/data/world.json)
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { geoEqualEarth, geoEqualEarthRaw, geoPath } from 'd3-geo'
import { feature } from 'topojson-client'
import { presimplify, quantile, simplify } from 'topojson-simplify'
import type { Topology, GeometryCollection } from 'topojson-specification'
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Position } from 'geojson'

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

/** Overseas parts Natural Earth draws inside their parent, split out so they're their own place in their own region. */
const SPLIT: { name: string; from: string; box: [number, number, number, number] }[] = [
  { name: 'French Guiana', from: 'France', box: [-55, 1, -51, 6] },
  { name: 'Guadeloupe', from: 'France', box: [-62, 15.8, -60.9, 16.6] },
  { name: 'Martinique', from: 'France', box: [-61.3, 14.3, -60.7, 15] },
  { name: 'Réunion', from: 'France', box: [55, -21.5, 56, -20.8] },
  { name: 'Mayotte', from: 'France', box: [44.9, -13.1, 45.4, -12.5] },
  { name: 'Canary Islands', from: 'Spain', box: [-18.5, 27, -13, 29.5] },
  { name: 'Azores', from: 'Portugal', box: [-32, 36.5, -24.5, 40] },
  { name: 'Madeira', from: 'Portugal', box: [-17.5, 32.3, -16, 33.2] },
  { name: 'Kaliningrad Oblast', from: 'Russia', box: [19, 54, 23, 55.5] },
]
/** Places Natural Earth 1:50m lacks or draws inside another, shown as a dot at [longitude, latitude]. */
const POINTS: Record<string, [number, number]> = {
  Tuvalu: [179.2, -8.5],
  Gibraltar: [-5.35, 36.14],
  Abkhazia: [41.2, 43.1],
  'South Ossetia': [44, 42.3],
  Transnistria: [29.4, 47.2],
}

/** Regions the map zooms into, framed by a longitude/latitude box. Oceania runs past 180° so the Pacific stays in one piece. */
const REGIONS: { name: string; tag: string; box: [number, number, number, number]; align?: 'end' }[] = [
  { name: 'Europe', tag: 'Europe', box: [-31, 32.3, 50, 71.5] },
  { name: 'Africa', tag: 'Africa', box: [-26, -35, 58.5, 38] },
  { name: 'Asia', tag: 'Asia', box: [25, -11, 146, 56] },
  { name: 'North America', tag: 'North_America', box: [-170, 7, -12, 84] },
  { name: 'Caribbean', tag: 'Caribbean', box: [-85, 9.8, -59.3, 27.5] },
  { name: 'South America', tag: 'South_America', box: [-82, -56, -34, 13] },
  // Anchored at its eastern edge: past it the map has no Americas to show.
  { name: 'Oceania', tag: 'Oceania', box: [112, -48, 232, 21], align: 'end' },
]
/** Where the deck's tags disagree with the map. Caribbean wins over North America otherwise. */
const REGION_OF: Record<string, string> = { Bermuda: 'North America' }
const OCEANIA = REGIONS.findIndex((r) => r.name === 'Oceania')

const byName = new Map(deck.notes.map((n) => [n.country, n.id]))
const noteOf = new Map(deck.notes.map((n) => [n.id, n]))

const pre = presimplify(topo)
const simplified = simplify(pre, quantile(pre, SIMPLIFY)) as typeof topo
const countries = feature(simplified, simplified.objects.countries) as FeatureCollection<Geometry, Props>
const inBox = (poly: Position[][], [x0, y0, x1, y1]: number[]) => {
  const r = poly[0]
  const x = r.reduce((a, p) => a + p[0], 0) / r.length
  const y = r.reduce((a, p) => a + p[1], 0) / r.length
  return x >= x0 && x <= x1 && y >= y0 && y <= y1
}
for (const s of SPLIT) {
  const parent = countries.features.find((f) => f.properties.name === s.from)!
  const g = parent.geometry as MultiPolygon
  const polys = g.coordinates.filter((p) => inBox(p, s.box))
  if (!polys.length) throw new Error(`No part of ${s.from} in ${s.name}'s box`)
  g.coordinates = g.coordinates.filter((p) => !polys.includes(p))
  countries.features.push({ type: 'Feature', properties: { name: s.name }, geometry: { type: 'MultiPolygon', coordinates: polys } })
}
const kept = countries.features.filter((f) => !DROP.has(f.properties.name))

const projection = geoEqualEarth().fitWidth(WIDTH, { type: 'FeatureCollection', features: kept })
const height = Math.ceil(geoPath(projection).bounds({ type: 'FeatureCollection', features: kept })[1][1])

/** The same projection without clipping at the antimeridian, so longitudes past 180° carry on east. */
const k = projection.scale()
const [tx, ty] = projection.translate()
const RAD = Math.PI / 180
const project = (lon: number, lat: number): [number, number] => {
  const [x, y] = geoEqualEarthRaw(lon * RAD, lat * RAD)
  return [tx + k * x, ty - k * y]
}

type Ring = { pts: [number, number][]; area: number; cx: number; cy: number }
const ring = (pts: [number, number][]): Ring => {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const c = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]
    a += c
    cx += (pts[j][0] + pts[i][0]) * c
    cy += (pts[j][1] + pts[i][1]) * c
  }
  return a ? { pts, area: Math.abs(a / 2), cx: cx / (3 * a), cy: cy / (3 * a) } : { pts, area: 0, cx: pts[0][0], cy: pts[0][1] }
}

/** A feature's projected rings, via d3 so the antimeridian is clipped like the rest of the map. */
function ringsOf(f: Feature<Geometry, Props>) {
  const rings: Ring[] = []
  let cur: [number, number][] = []
  const ctx = {
    moveTo: (x: number, y: number) => {
      cur = [[x, y]]
    },
    lineTo: (x: number, y: number) => {
      cur.push([x, y])
    },
    closePath: () => {
      rings.push(ring(cur))
      cur = []
    },
    arc: () => {},
    rect: () => {},
  }
  geoPath(projection, ctx as unknown as CanvasRenderingContext2D)(f)
  return rings
}

/** A Pacific feature's rings with western longitudes carried past 180°. */
function wrappedRingsOf(f: Feature<Geometry, Props>) {
  const g = f.geometry
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
  return polys.flat().map((r) => ring(r.slice(0, -1).map(([lon, lat]) => project(lon < 0 ? lon + 360 : lon, lat))))
}

const r1 = (v: number) => Math.round(v * 10) / 10
/** Label point (centre of the largest ring), and the side of a square with the same area as everything drawn. */
const stats = (rings: Ring[]) => {
  const big = rings.reduce((a, b) => (b.area > a.area ? b : a))
  return [r1(big.cx), r1(big.cy), r1(Math.sqrt(rings.reduce((a, r) => a + r.area, 0)))]
}

/** Compact SVG path: coordinates rounded to 0.1px and written relative to the previous point. */
function render(all: Ring[]) {
  if (!all.length) return { d: '', rings: [] }
  const biggest = Math.max(...all.map((r) => r.area))
  const rings = all.filter((r) => r.area >= MIN_RING || r.area === biggest)
  const r10 = (v: number) => Math.round(v * 10)
  const fmt = (v: number) => {
    const s = (v / 10).toString()
    return s.startsWith('0.') ? s.slice(1) : s.startsWith('-0.') ? '-' + s.slice(2) : s
  }
  let d = ''
  let px = 0
  let py = 0
  for (const r of rings) {
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
  return { d, rings }
}

const regionOf = (id: string) => {
  const n = noteOf.get(id)!
  const name = REGION_OF[n.country] ?? REGIONS.find((r) => r.tag === 'Caribbean' && n.tags.includes(r.tag))?.name ?? REGIONS.find((r) => n.tags.includes(r.tag))?.name
  return REGIONS.findIndex((r) => r.name === name)
}

const shapes: Record<string, string> = {}
const drawn: Record<string, Ring[]> = {}
const byId: Record<string, Feature<Geometry, Props>[]> = {}
const rest: string[] = []
const unmatchedShapes: string[] = []
for (const f of kept) {
  const name = f.properties.name
  const id = byName.get(RENAME[name] ?? name)
  const { d, rings } = render(ringsOf(f))
  if (!d) continue
  if (!id) {
    unmatchedShapes.push(name)
    rest.push(d)
    continue
  }
  // A few deck places span two Natural Earth shapes; draw both.
  shapes[id] = (shapes[id] ?? '') + d
  drawn[id] = [...(drawn[id] ?? []), ...rings]
  byId[id] = [...(byId[id] ?? []), f]
}

/** Per place: region index, label point x/y and size, all in map units. Dots carry no shape. */
const places: Record<string, number[]> = {}
const leftovers: string[] = []
for (const id of Object.keys(shapes)) {
  const r = regionOf(id)
  if (r < 0) leftovers.push(noteOf.get(id)!.country)
  places[id] = [r, ...stats(drawn[id])]
}
for (const [name, [lon, lat]] of Object.entries(POINTS)) {
  const id = byName.get(name)!
  const [x, y] = project(lon, lat)
  places[id] = [regionOf(id), r1(x), r1(y), 0]
}

/** Oceania's places east of 180°, drawn again past the map's right edge for when Oceania is zoomed in. */
const wrap: Record<string, [string, number, number]> = {}
for (const [id, fs] of Object.entries(byId)) {
  if (places[id][0] !== OCEANIA || !fs.some((f) => JSON.stringify(f.geometry).includes('[-'))) continue
  const { d, rings } = render(fs.flatMap(wrappedRingsOf))
  const [cx, cy] = stats(rings)
  wrap[id] = [d, cx, cy]
}

/** Each region's view box: its box padded, widened to the map's aspect ratio. */
const PAD = 0.04
const regions = REGIONS.map(({ name, box: [w, s, e, n], align }) => {
  const pts: [number, number][] = []
  for (let i = 0; i <= 24; i++) {
    const t = i / 24
    pts.push(project(w + (e - w) * t, s), project(w + (e - w) * t, n), project(w, s + (n - s) * t), project(e, s + (n - s) * t))
  }
  const x0 = Math.min(...pts.map((p) => p[0]))
  const x1 = Math.max(...pts.map((p) => p[0]))
  const y0 = Math.min(...pts.map((p) => p[1]))
  const y1 = Math.max(...pts.map((p) => p[1]))
  let bw = (x1 - x0) * (1 + 2 * PAD)
  let bh = (y1 - y0) * (1 + 2 * PAD)
  if (bw / bh > WIDTH / height) bh = (bw * height) / WIDTH
  else bw = (bh * WIDTH) / height
  const cx = align === 'end' ? x1 + (x1 - x0) * PAD - bw / 2 : (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  return { name, view: [r1(cx - bw / 2), r1(cy - bh / 2), r1(bw), r1(bh)] }
})

const out = { width: WIDTH, height, shapes, rest: rest.join(''), places, wrap, regions }
const json = JSON.stringify(out)
writeFileSync('src/data/world.json', json + '\n')

// Small places whose label point falls outside their region's view couldn't be tapped there.
const outside = Object.entries(places).filter(([id, [r, x, y, size]]) => {
  const [vx, vy, vw, vh] = regions[r]?.view ?? [0, 0, 0, 0]
  const [px, py] = wrap[id] ? [wrap[id][1], wrap[id][2]] : [x, y]
  return size < 20 && (px < vx || px > vx + vw || py < vy || py > vy + vh)
})

const noShape = deck.notes
  .filter((n) => !places[n.id] && !n.tags.includes('Oceans+Seas') && !n.tags.includes('Continents'))
  .map((n) => n.country)
console.log(`world.json: ${(json.length / 1024).toFixed(0)} KB, ${Object.keys(shapes).length} places, ${WIDTH}×${height}`)
console.log(`Deck places without a shape (${noShape.length}): ${noShape.join(', ')}`)
console.log(`Shapes without a deck note, drawn as plain land (${unmatchedShapes.length}): ${unmatchedShapes.join(', ')}`)
console.log(`Places in no region (${leftovers.length}): ${leftovers.join(', ')}`)
console.log(`Small places outside their region's view (${outside.length}): ${outside.map(([id]) => noteOf.get(id)!.country).join(', ')}`)
console.log(`Wrapped past 180°: ${Object.keys(wrap).map((id) => noteOf.get(id)!.country).join(', ')}`)
for (const r of REGIONS.keys()) {
  const ids = Object.keys(places).filter((id) => places[id][0] === r)
  console.log(`${REGIONS[r].name}: ${ids.length} places, ${ids.filter((id) => noteOf.get(id)!.tags.includes('Sovereign_State')).length} countries`)
}
