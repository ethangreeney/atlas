// The find-on-map card's map: one flat world on a canvas that pans, zooms and pinches like any online map, and knows
// which place is under a click. Loaded on its own, only once the set is on: the shapes run to a few megabytes.
//
// The base map is Natural Earth's 1:50m countries (via world-atlas). Each place's own shape, the one a click is checked
// against, is in find-targets.json: Natural Earth 1:10m countries, provinces (England, Java, Hawaii…), marine areas and
// regions, quantised to about 130 m. find-places.json has each place's size and the box its main landmass sits in.
import { geoArea, geoBounds, geoCentroid, geoContains, geoDistance, geoPath, geoProjection, type GeoStream } from 'd3-geo'
import { feature } from 'topojson-client'
import world from 'world-atlas/countries-50m.json'
import targets from '../../data/find-targets.json'
import meta from '../../data/find-places.json'
import { NOTES } from '../deck'

type LonLat = [number, number]
type Geo = { type: string; coordinates: unknown; geometries?: Geo[] }
type Feature = { type: 'Feature'; properties: Record<string, string>; geometry: Geo }
type Collection = { type: 'FeatureCollection'; features: Feature[] }
type Box = [[number, number], [number, number]]
type Place = { id: string; name: string; water: boolean; region: boolean; area: number; view: Box }

/** Where the map is looking: zoom (1 is the whole world across the box) and the middle, in map units. */
export type View = { k: number; cx: number; cy: number }
export type FindResult = { kind: 'right' } | { kind: 'wrong'; name: string } | { kind: 'shown' }
/** Which of the map's buttons would do anything. */
export type Controls = { zoomIn: boolean; zoomOut: boolean; home: boolean }
export type FindOptions = {
  onResult: (r: FindResult) => void
  /** A click on the map once it's been found: on to the next card. */
  onNext?: () => void
  /** A wrong place with tries left. */
  onMiss?: (m: { name: string; left: number }) => void
  onControls?: (c: Controls) => void
  tries?: number
  /** Open where the last map was left, rather than at the start. */
  from?: View | null
  /** Turned to face this, rather than the middle of the world. */
  home?: { cx: number } | null
}
export type FindHandle = { reveal(): void; fit(): void; zoom(f: number): void; view(): View; destroy(): void }

const KM = 6371
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
type Deadline = { timeRemaining(): number } | null
const idle = 'requestIdleCallback' in window
  ? (f: (d: Deadline) => void) => requestIdleCallback(f, { timeout: 500 })
  : (f: (d: Deadline) => void) => setTimeout(() => f(null), 40)

// ---------- Places ----------
const NAME = new Map(NOTES.map((n) => [n.id, n.country]))
const PLACES: Place[] = Object.entries(meta as unknown as Record<string, Omit<Place, 'id' | 'name'>>).map(([id, m]) => ({ id, name: NAME.get(id) ?? '', ...m }))
const byId = new Map(PLACES.map((p) => [p.id, p]))
const T = targets as unknown as { objects: Record<string, unknown> }
const targetFeats = new Map<string, Feature[]>()
for (const key of Object.keys(T.objects)) {
  for (const f of (feature(T as never, T.objects[key] as never) as unknown as Collection).features) {
    const id = f.properties.id
    if (!targetFeats.has(id)) targetFeats.set(id, [])
    targetFeats.get(id)!.push(f)
  }
}
const targetOf = (id: string): Collection => ({ type: 'FeatureCollection', features: targetFeats.get(id) ?? [] })
const bboxCache = new Map<string, Box>()
const bboxOf = (id: string) => {
  if (!bboxCache.has(id)) bboxCache.set(id, geoBounds(targetOf(id) as never) as Box)
  return bboxCache.get(id)!
}
const inBox = ([x, y]: LonLat, [[w, s], [e, n]]: Box, pad = 0.3) =>
  y >= s - pad && y <= n + pad && (w <= e ? x >= w - pad && x <= e + pad : x >= w - pad || x <= e + pad)
// What's at a point, by the deck's own names: the smallest country, territory or sea that holds it.
const nameable = PLACES.filter((p) => !p.region).sort((a, b) => a.area - b.area)
const polysOf = (id: string) =>
  (targetFeats.get(id) ?? []).flatMap((f) =>
    f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? (f.geometry.coordinates as unknown[]) : [],
  )
// A point well inside a place: the middle of its biggest piece of land or water.
const repCache = new Map<string, LonLat | null>()
function repPt(q: Place) {
  if (repCache.has(q.id)) return repCache.get(q.id)!
  const big = polysOf(q.id)
    .map((c) => ({ type: 'Polygon', coordinates: c }) as never)
    .sort((a, b) => geoArea(b) - geoArea(a))[0]
  let pt: LonLat | null = big ? (geoCentroid(big) as LonLat) : null
  if (!pt || !geoContains(big, pt)) pt = null
  repCache.set(q.id, pt)
  return pt
}
// Places that sit inside another deck place: England in the United Kingdom, Java in Indonesia, Alaska in the United States.
// A card for a whole country picks whole countries; only a card for one of these parts picks at that finer level.
const SUBS = new Set<string>()
for (const q of nameable) {
  if (q.water) continue
  const pt = repPt(q)
  if (!pt) continue
  for (const o of nameable)
    if (o !== q && !o.water && o.area > q.area * 1.2 && inBox(pt, bboxOf(o.id)) && geoContains(targetOf(o.id) as never, pt)) {
      SUBS.add(q.id)
      break
    }
}
const landPlaces = nameable.filter((q) => !q.water)
const waterPlaces = nameable.filter((q) => q.water)
function landAt(ll: LonLat, subs: boolean) {
  for (const q of landPlaces) if ((subs || !SUBS.has(q.id)) && inBox(ll, bboxOf(q.id)) && geoContains(targetOf(q.id) as never, ll)) return q
  return null
}
function waterAt(ll: LonLat) {
  for (const q of waterPlaces) if (inBox(ll, bboxOf(q.id)) && geoContains(targetOf(q.id) as never, ll)) return q
  return null
}
const verticesOf = (fc: Collection) => {
  const out: LonLat[] = []
  const walk = (c: unknown): void => {
    if (typeof (c as number[])[0] === 'number') out.push(c as LonLat)
    else (c as unknown[]).forEach(walk)
  }
  for (const f of fc.features) walk(f.geometry.coordinates)
  return out
}
function nearest(fc: Collection, ll: LonLat) {
  let best = Infinity
  let at: LonLat | null = null
  for (const v of verticesOf(fc)) {
    const d = geoDistance(v, ll)
    if (d < best) {
      best = d
      at = v
    }
  }
  return { km: best * KM, at }
}

// ---------- One flat map, projected once ----------
// Miller: a familiar classroom-map look, north up everywhere. Centred on 12°E so the map's edge runs through the Bering
// Strait and open Pacific. Everything is projected once into fixed map units and kept as ready-made shapes; panning and
// zooming only change the transform they're drawn with, so a gesture never waits on geometry.
const millerRaw = Object.assign((l: number, p: number): [number, number] => [l, 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * p))], {
  invert: (x: number, y: number): [number, number] => [x, 2.5 * Math.atan(Math.exp(0.8 * y)) - 0.625 * Math.PI],
})
const U = 100
const RAD = Math.PI / 180
const WU = 2 * Math.PI * U
const TOP = -millerRaw(0, 84 * RAD)[1] * U
const BOT = -millerRaw(0, -72 * RAD)[1] * U
const LANDMID = (TOP - millerRaw(0, -56 * RAD)[1] * U) / 2 // the middle of the land, Greenland to Cape Horn
const mkProj = (precision: number) =>
  geoProjection(millerRaw)
    .rotate([-12, 0])
    .scale(U)
    .translate([0, 0])
    .precision(precision)
    .clipExtent([
      [-WU / 2 - 1, TOP],
      [WU / 2 + 1, BOT],
    ])
const proj = mkProj(0)
const projT = mkProj(0.08)
const project = (ll: LonLat) => proj(ll) as [number, number]
const wrapX = (x: number) => x - WU * Math.floor((x + WU / 2) / WU)
const nearX = (x: number, to: number) => x + WU * Math.round((to - x) / WU)
// Drop points closer than eps to the last one kept: the zoomed-out world needs a fraction of the detail.
const thin =
  (eps: number) =>
  (s: GeoStream): GeoStream => {
    let n = 0
    let lx = 0
    let ly = 0
    let px = 0
    let py = 0
    let held = false
    return {
      point(x, y) {
        if (n++ === 0 || Math.abs(x - lx) + Math.abs(y - ly) > eps) {
          s.point(x, y)
          lx = x
          ly = y
          held = false
        } else {
          px = x
          py = y
          held = true
        }
      },
      lineStart() {
        n = 0
        held = false
        s.lineStart()
      },
      lineEnd() {
        if (held) s.point(px, py)
        s.lineEnd()
      },
      polygonStart() {
        s.polygonStart()
      },
      polygonEnd() {
        s.polygonEnd()
      },
      sphere() {
        s.sphere?.()
      },
    }
  }
type Rect = [number, number, number, number]
// Draw straight into Path2D objects, keeping the bounds as we go.
function sinkTo(a: Path2D, b?: Path2D, box: Rect = [Infinity, Infinity, -Infinity, -Infinity]) {
  const ext = (x: number, y: number) => {
    if (x < box[0]) box[0] = x
    if (y < box[1]) box[1] = y
    if (x > box[2]) box[2] = x
    if (y > box[3]) box[3] = y
  }
  return {
    moveTo(x: number, y: number) {
      a.moveTo(x, y)
      b?.moveTo(x, y)
      ext(x, y)
    },
    lineTo(x: number, y: number) {
      a.lineTo(x, y)
      b?.lineTo(x, y)
      ext(x, y)
    },
    closePath() {
      a.closePath()
      b?.closePath()
    },
    arc() {},
  }
}
const W50 = world as unknown as { objects: { countries: unknown } }
// Antarctica is left off: cut at 72°S it would only be a flat strip along the bottom edge.
const WORLDF = (feature(W50 as never, W50.objects.countries as never) as unknown as Collection).features.filter((f) => f.properties.name !== 'Antarctica')
// Work is done a polygon at a time so no single step holds up a frame.
const pieces = (f: Feature): Feature[] =>
  f.geometry?.type === 'MultiPolygon'
    ? (f.geometry.coordinates as unknown[]).map((c) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: c } }))
    : f.geometry
      ? [f]
      : []
const WPIECES = WORLDF.flatMap((f, i) => pieces(f).map((p) => [i, p] as const))
// Levels of detail, by how far (in map units) a point may be dropped. Each holds one shape for the whole world (for the
// zoomed-out view) and one per country with its bounds (so a close-up only draws what's on screen).
const LEVELS = [0.7, 0.22, 0.07, 0]
type Level = { all: Path2D; each: Path2D[]; box: Rect[]; n: number; ready: boolean; geo: { stream: (s: GeoStream) => GeoStream } }
const lv: (Level | null)[] = LEVELS.map(() => null)
const redraws = new Set<() => void>() // maps on screen, redrawn when finer detail arrives
type More = () => boolean
function stepLevel(i: number, more: More) {
  let L = lv[i]
  if (!L) {
    const eps = LEVELS[i]
    L = lv[i] = {
      all: new Path2D(),
      each: WORLDF.map(() => new Path2D()),
      box: WORLDF.map(() => [Infinity, Infinity, -Infinity, -Infinity] as Rect),
      n: 0,
      ready: false,
      geo: eps ? { stream: (s) => proj.stream(thin(eps)(s)) } : proj,
    }
  }
  while (L.n < WPIECES.length) {
    const [ci, f] = WPIECES[L.n++]
    geoPath(L.geo as never, sinkTo(L.all, L.each[ci], L.box[ci]) as never)(f as never)
    if (!more()) break
  }
  if (!L.ready && L.n >= WPIECES.length) {
    L.ready = true
    redraws.forEach((f) => f())
  }
  return L.ready
}
function levelFor(S: number) {
  let want = LEVELS.findIndex((e) => e * S <= 0.7)
  if (want < 0) want = LEVELS.length - 1
  for (let i = want; i >= 0; i--) if (lv[i]?.ready) return lv[i]!
  stepLevel(0, () => true)
  return lv[0]!
}
// Each place's own shape, coarse and full, made on first use or while the page is idle.
type Shapes = { coarse: Path2D; full: Path2D; parts: Feature[]; n: number; done: boolean }
const tcache = new Map<string, Shapes>()
const coarseT = { stream: (s: GeoStream) => projT.stream(thin(0.3)(s)) }
const always = () => true
function tstep(id: string, more: More) {
  let t = tcache.get(id)
  if (!t) tcache.set(id, (t = { coarse: new Path2D(), full: new Path2D(), parts: (targetFeats.get(id) ?? []).flatMap(pieces), n: 0, done: false }))
  while (t.n < t.parts.length) {
    const f = t.parts[t.n++]
    geoPath(coarseT as never, sinkTo(t.coarse) as never)(f as never)
    geoPath(projT as never, sinkTo(t.full) as never)(f as never)
    if (!more()) break
  }
  t.done = t.n >= t.parts.length
  return t.done
}
function tpaths(id: string) {
  const t = tcache.get(id)
  if (t?.done) return t
  tstep(id, always)
  return tcache.get(id)!
}
// A place's main landmass box in map units (from the build's view box), its middle, and its size.
type Info = { x0: number; y0: number; x1: number; y1: number; cx: number; cy: number; span: number }
const pcache = new Map<string, Info>()
function pinfo(q: Place) {
  let r = pcache.get(q.id)
  if (r) return r
  const [[w, s], [e0, n]] = q.view
  const e = e0 < w ? e0 + 360 : e0
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i <= 4; i++)
    for (let j = 0; j <= 4; j++) {
      let lon = w + ((e - w) * i) / 4
      if (lon > 180) lon -= 360
      const [x, y] = project([lon, s + ((n - s) * j) / 4])
      xs.push(x)
      ys.push(y)
    }
  if (Math.max(...xs) - Math.min(...xs) > WU / 2) for (let i = 0; i < xs.length; i++) if (xs[i] < 0) xs[i] += WU
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  r = { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, span: Math.max(x1 - x0, y1 - y0) }
  pcache.set(q.id, r)
  return r
}
// How big a place really is, in map units: its extent, or for islands strung across the sea (the Marshall Islands,
// Kiribati) its land, which is all there is to click; sized by extent alone, their dots faded out while the land was
// still specks.
const solid = (q: Place) => Math.min(pinfo(q).span, (1.5 * Math.sqrt(q.area || 0)) / (KM / U))
// Background work: finer levels first, then every place's shape, a little at a time between frames.
const jobs: ((more: More) => boolean)[] = []
let pumping = false
let queued = false
function pump() {
  if (pumping || !jobs.length) return
  pumping = true
  idle((dl) => {
    pumping = false
    const t0 = performance.now()
    const more = () => performance.now() - t0 < 6 && (!dl || dl.timeRemaining() > 2)
    while (jobs.length && more()) if (jobs[0](more)) jobs.shift()
    pump()
  })
}
function queueWork() {
  if (queued) return
  queued = true
  for (let i = 1; i < LEVELS.length; i++) jobs.push((more) => stepLevel(i, more))
  let j = 0
  jobs.push((more) => {
    while (j < PLACES.length) {
      if (tstep(PLACES[j].id, more)) j++
      if (!more()) break
    }
    return j >= PLACES.length
  })
  pump()
}
// Canvas wants plain colours; read the theme's tokens through a one-pixel canvas so any CSS colour works.
const probe = (() => {
  const c = document.createElement('canvas')
  c.width = c.height = 1
  return c.getContext('2d', { willReadFrequently: true })!
})()
function toRGB(s: string) {
  probe.clearRect(0, 0, 1, 1)
  probe.fillStyle = '#000'
  probe.fillStyle = s || '#000'
  probe.fillRect(0, 0, 1, 1)
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data
  return `rgb(${r},${g},${b})`
}
function colours(el: Element) {
  const cs = getComputedStyle(el)
  const c = (n: string) => toRGB(cs.getPropertyValue(`--color-${n}`).trim())
  return {
    sea: c('sea'),
    seaHover: c('sea-hover'),
    seaPress: c('sea-press'),
    land: c('land'),
    landHover: c('land-hover'),
    landPress: c('land-press'),
    edge: c('surface'),
    dot: c('map-dot'),
    dotHover: c('map-dot-hover'),
    good: c('good'),
    again: c('again'),
  }
}

// d3's smooth zoom (van Wijk and Nuij), for the flight to an answer: out, across, and in again along one curve.
const RHO = Math.SQRT2
function smoothZoom([ux0, uy0, w0]: [number, number, number], [ux1, uy1, w1]: [number, number, number]) {
  const cosh = (x: number) => ((x = Math.exp(x)) + 1 / x) / 2
  const sinh = (x: number) => ((x = Math.exp(x)) - 1 / x) / 2
  const tanh = (x: number) => ((x = Math.exp(2 * x)) - 1) / (x + 1)
  const dx = ux1 - ux0
  const dy = uy1 - uy0
  const d2 = dx * dx + dy * dy
  if (d2 < 1e-12) {
    const S = Math.log(w1 / w0) / RHO
    return (t: number): [number, number, number] => [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(RHO * t * S)]
  }
  const d1 = Math.sqrt(d2)
  const b0 = (w1 * w1 - w0 * w0 + RHO ** 4 * d2) / (2 * w0 * RHO ** 2 * d1)
  const b1 = (w1 * w1 - w0 * w0 - RHO ** 4 * d2) / (2 * w1 * RHO ** 2 * d1)
  const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0)
  const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1)
  const S = (r1 - r0) / RHO
  return (t: number): [number, number, number] => {
    const s = t * S
    const u = (w0 / (RHO ** 2 * d1)) * (cosh(r0) * tanh(RHO * s + r0) - sinh(r0))
    return [ux0 + u * dx, uy0 + u * dy, (w0 * cosh(r0)) / cosh(RHO * s + r0)]
  }
}

const KMAX = 40 // deepest zoom, times the whole world
const KCTX = 10 // when the card shows you a place, it stays at least this zoomed out so you can see where it is
const DOT_R = 3 // drawn size; the area that catches a click or tap is much bigger
const DOT_AREA = 12000 // km²: places smaller than this become dots when too small to click

/** Whether there's a map to find this place on. */
export const findable = (noteId: string) => byId.has(noteId)

/** A view turned to face a set of places (a continent's, for its test), as far out as the map goes. */
export function facing(noteIds: string[]): View | null {
  let sx = 0
  let sy = 0
  for (const id of noteIds) {
    const q = byId.get(id)
    if (!q) continue
    const a = (pinfo(q).cx / WU) * 2 * Math.PI
    sx += Math.cos(a)
    sy += Math.sin(a)
  }
  return sx || sy ? { k: 0, cx: (Math.atan2(sy, sx) / (2 * Math.PI)) * WU, cy: LANDMID } : null
}

/**
 * Put a map for finding `noteId` into `wrap`, drawn on `cv`. `ring` is moved over the answer when it's too small to see.
 * Returns what the card needs to drive it; `destroy` once it's gone.
 */
export function mountFind(wrap: HTMLElement, cv: HTMLCanvasElement, ring: HTMLElement, noteId: string, opts: FindOptions): FindHandle {
  const { onResult, onNext, onMiss, onControls, tries = 1, from = null, home = null } = opts
  const p = byId.get(noteId)!
  const ctx = cv.getContext('2d')!
  const water = p.water
  const subs = SUBS.has(p.id)
  const target = targetOf(p.id)
  const at = water ? waterAt : (ll: LonLat) => landAt(ll, subs)
  // Places that get a dot when too small to hit: microstates and small islands (or small seas, for a sea card),
  // smallest first, since the smallest are the ones that can't be clicked any other way.
  const pool = (water ? waterPlaces : landPlaces).filter((q) => (subs || !SUBS.has(q.id)) && q.area < DOT_AREA).sort((a, b) => a.area - b.area)
  const coarse = matchMedia('(pointer: coarse)').matches
  let col = colours(wrap)
  // Every listener goes when the map does, so a card that mounts it again (or another place on the same canvas) starts clean.
  const life = new AbortController()
  const on = <K extends keyof HTMLElementEventMap>(type: K, f: (e: HTMLElementEventMap[K]) => void, o: AddEventListenerOptions = {}) =>
    cv.addEventListener(type, f, { ...o, signal: life.signal })
  let W = 1
  let H = 1
  let dpr = 1
  let base = 1
  const START: View = { k: 1, cx: home?.cx ?? 0, cy: LANDMID } // the whole world, or as much as fits, turned to face home
  let v: View = { ...START }
  let answered = false
  let result: FindResult | null = null
  type Pick = { q: Place; dot: boolean; ll: LonLat | null }
  type Pending = Pick & { x: number; y: number; type: string; timer: ReturnType<typeof setTimeout> }
  let pending: Pending | null = null
  let doneAt = 0
  let alive = true
  let misses = 0
  const marks: { hover: string | null; press: string | null; pick: string | null; ans: string | null; miss: string | null; missAt: number; fade: number } = {
    hover: null,
    press: null,
    pick: null,
    ans: null,
    miss: null,
    missAt: 0,
    fade: 0,
  }
  tpaths(p.id)

  function size() {
    W = Math.max(200, wrap.clientWidth)
    H = Math.max(140, wrap.clientHeight)
    dpr = Math.min(3, window.devicePixelRatio || 1)
    cv.width = Math.round(W * dpr)
    cv.height = Math.round(H * dpr)
    base = W / WU
  }
  const fillK = () => H / ((BOT - TOP) * base) // the zoom at which the world exactly fills the box's height
  // The furthest out: the whole world across the box, or as far as still fills it top to bottom. A world shorter than
  // the box had to switch, mid-zoom, from floating in the spare room to following the cursor, and however that was
  // smoothed the first zoom felt it; so like any online map it never gets shorter than the box, and every zoom works
  // the same.
  const kmin = () => Math.max(1, fillK())
  const clampK = (k: number) => Math.min(KMAX, Math.max(kmin(), k))
  // East-west wraps round like a globe; north-south the map's edges never come inside the box.
  function clamp(t: View): View {
    const k = clampK(t.k)
    const hh = H / 2 / (base * k)
    const lo = TOP + hh
    const hi = BOT - hh
    const cy = lo <= hi ? Math.min(hi, Math.max(lo, t.cy)) : Math.min(lo, Math.max(hi, t.cy))
    return { k, cx: wrapX(t.cx), cy }
  }
  // Zoom from view v0 to k about the screen point (x, y): what's under it stays under it.
  function zoomed(v0: View, k: number, x: number, y: number) {
    const S0 = base * v0.k
    const S = base * k
    return clamp({ k, cx: v0.cx + (x - W / 2) / S0 - (x - W / 2) / S, cy: v0.cy + (y - H / 2) / S0 - (y - H / 2) / S })
  }
  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = cv.getBoundingClientRect()
    return [((e.clientX - r.left) * W) / r.width, ((e.clientY - r.top) * H) / r.height]
  }
  function llAt(x: number, y: number): LonLat | null {
    const S = base * v.k
    const uy = v.cy + (y - H / 2) / S
    if (uy < TOP || uy > BOT) return null
    return proj.invert!([wrapX(v.cx + (x - W / 2) / S), uy]) as LonLat
  }
  const toScreen = (ux: number, uy: number): [number, number] => {
    const S = base * v.k
    return [(nearX(ux, v.cx) - v.cx) * S + W / 2, (uy - v.cy) * S + H / 2]
  }

  // ----- Drawing: one canvas, redrawn from the cached shapes whenever anything changes -----
  let raf = 0
  let lastT = 0
  type Anim = (now: number, dt: number) => boolean
  let anim: Anim | null = null
  let hoverDirty = false
  let mouse: { x: number; y: number } | null = null
  let drag = false
  type Dot = { q: Place; sx: number; sy: number; a: number; want: number }
  let shown: Dot[] = []
  const dotA = new Map<string, number>()
  const kick = () => {
    if (!raf && alive) raf = requestAnimationFrame(tick)
  }
  redraws.add(kick)
  function tick(now: number) {
    raf = 0
    const dt = lastT ? Math.min(64, now - lastT) : 16
    lastT = now
    if (anim && !anim(now, dt)) {
      anim = null
      hoverDirty = true
    }
    if (hoverDirty && mouse && !drag && !anim && !g) {
      hoverDirty = false
      hoverAt(mouse.x, mouse.y)
    }
    const more = draw(dt)
    if (anim || more) kick()
    else lastT = 0
  }
  let ctlState = ''
  function draw(dt = 0) {
    const S = base * v.k
    let more = false
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.fillStyle = col.sea
    ctx.fillRect(0, 0, cv.width, cv.height)
    const L = levelFor(S)
    const fine = 0.3 * S > 0.7
    if (marks.ans && marks.fade < 1) {
      marks.fade = reduced || !dt ? 1 : Math.min(1, marks.fade + dt / 240)
      more = marks.fade < 1
    }
    const e = 1 - Math.pow(1 - marks.fade, 3)
    const fills: [string, string, number][] = []
    if (!answered) {
      const h = marks.press || marks.hover
      if (h) fills.push([h, marks.press ? (water ? col.seaPress : col.landPress) : water ? col.seaHover : col.landHover, 1])
    }
    if (marks.pick) fills.push([marks.pick, col.again, 0.7 * e])
    if (marks.miss) {
      const t = (performance.now() - marks.missAt) / 900
      if (t >= 1 || answered) marks.miss = null
      else {
        fills.push([marks.miss, col.again, 0.7 * (1 - t * t)])
        more = true
      }
    }
    if (marks.ans) fills.push([marks.ans, col.good, 0.85 * e])
    const paint = () => {
      for (const [id, c, a] of fills) {
        if (a <= 0) continue
        ctx.globalAlpha = a
        ctx.fillStyle = c
        const t = tpaths(id)
        ctx.fill(fine ? t.full : t.coarse)
      }
      ctx.globalAlpha = 1
    }
    const ox = W / 2 - v.cx * S
    const oy = H / 2 - v.cy * S
    for (let n = -1; n <= 1; n++) {
      const off = ox + n * WU * S
      if (off + (WU / 2) * S <= 0 || off - (WU / 2) * S >= W) continue
      ctx.setTransform(dpr * S, 0, 0, dpr * S, dpr * off, dpr * oy)
      const x0 = -off / S
      const x1 = (W - off) / S
      const y0 = -oy / S
      const y1 = (H - oy) / S
      if (water) paint()
      const vis: number[] = []
      for (let i = 0; i < L.box.length; i++) {
        const b = L.box[i]
        if (b[2] >= x0 && b[0] <= x1 && b[3] >= y0 && b[1] <= y1) vis.push(i)
      }
      const all = vis.length > 60
      ctx.fillStyle = col.land
      if (all) ctx.fill(L.all)
      else for (const i of vis) ctx.fill(L.each[i])
      if (!water) paint()
      // Borders: a hairline in the card's own colour, the same width at every zoom.
      ctx.strokeStyle = col.edge
      ctx.lineWidth = 0.75 / S
      ctx.lineJoin = 'round'
      if (all) ctx.stroke(L.all)
      else for (const i of vis) ctx.stroke(L.each[i])
    }
    // Dots for places too small to hit as shapes. Each fades out as its own shape grows big enough to click; where dots
    // would crowd, the smaller place keeps its dot until you zoom in. Once answered, only your pick and the answer stay.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const SEP = coarse ? 17 : 11
    const placed: [number, number][] = []
    const special = answered ? [marks.ans, marks.pick].flatMap((id) => (id && byId.get(id) ? [byId.get(id)!] : [])) : []
    const order = special.length ? [...special, ...pool.filter((q) => !special.includes(q))] : pool
    shown = []
    for (const q of order) {
      const pi = pinfo(q)
      const px = solid(q) * S
      const sp = special.includes(q)
      let want = px <= 9 ? 1 : px >= 13 ? 0 : (13 - px) / 4
      if (answered && !sp) want = 0
      const [sx, sy] = toScreen(pi.cx, pi.cy)
      if (want > 0) {
        if (!sp && placed.some(([a, b]) => (a - sx) ** 2 + (b - sy) ** 2 < SEP * SEP)) want = 0
        else placed.push([sx, sy])
      }
      let a = dotA.get(q.id) ?? 0
      if (a !== want) {
        const st = reduced || !dt ? 1 : dt / 160
        a = a < want ? Math.min(want, a + st) : Math.max(want, a - st)
        dotA.set(q.id, a)
        if (a !== want) more = true
      }
      if (a > 0.01 && sx > -12 && sx < W + 12 && sy > -12 && sy < H + 12) shown.push({ q, sx, sy, a, want })
    }
    const hot = !answered && (marks.press || marks.hover)
    for (let i = shown.length - 1; i >= 0; i--) {
      const d = shown[i]
      const id = d.q.id
      ctx.globalAlpha = d.a
      ctx.beginPath()
      ctx.arc(d.sx, d.sy, DOT_R + 1.25, 0, 2 * Math.PI)
      ctx.fillStyle = col.edge
      ctx.fill()
      ctx.beginPath()
      ctx.arc(d.sx, d.sy, DOT_R, 0, 2 * Math.PI)
      ctx.fillStyle = id === marks.ans && answered ? col.good : id === marks.pick || id === marks.miss ? col.again : id === hot ? col.dotHover : col.dot
      ctx.fill()
    }
    ctx.globalAlpha = 1
    // A pulsing ring finds the answer for you when it's too small to see.
    const pa = pinfo(p)
    const ringOn = answered && !!result && result.kind !== 'right' && solid(p) * S < 14
    if (ringOn) {
      const [rx, ry] = toScreen(pa.cx, pa.cy)
      ring.style.transform = `translate(${rx.toFixed(1)}px, ${ry.toFixed(1)}px)`
    }
    if (ring.dataset.on !== String(ringOn)) ring.dataset.on = String(ringOn)
    const homeV = clamp(START)
    const atHome = v.k <= homeV.k + 1e-4 && Math.abs(wrapX(v.cx - homeV.cx)) < 0.5 && Math.abs(v.cy - homeV.cy) < 0.5
    const ctl: Controls = { zoomIn: v.k < KMAX - 1e-6, zoomOut: v.k > kmin() + 1e-6, home: !atHome }
    const st = JSON.stringify(ctl)
    if (st !== ctlState) {
      ctlState = st
      onControls?.(ctl)
    }
    return more
  }

  // ----- What a click or tap would answer -----
  function pickAt(x: number, y: number, type: string): Pick | null {
    const touch = type !== 'mouse'
    const S = base * v.k
    const ll = llAt(x, y)
    const q = ll ? at(ll) : null
    // A dot wins anywhere near it over open water or tiny shapes, but only right on it over a shape you can see.
    const big = q && pinfo(q).span * S >= 12
    const reach = big ? (touch ? 8 : 5) : touch ? 12 : 7.5
    let best: Dot | null = null
    let bd = reach
    for (const d of shown)
      if (d.want > 0 && d.a >= 0.25) {
        const dd = Math.hypot(d.sx - x, d.sy - y)
        if (dd <= bd) {
          bd = dd
          best = d
        }
      }
    if (best) return { q: best.q, dot: true, ll }
    return q ? { q, dot: false, ll } : null
  }
  function hoverAt(x: number, y: number) {
    const h = !answered && !pending ? pickAt(x, y, 'mouse') : null
    const id = h ? h.q.id : null
    if (id !== marks.hover) {
      marks.hover = id
      kick()
    }
    cv.style.cursor = drag ? 'grabbing' : h ? 'pointer' : 'grab'
  }

  // ----- Answering -----
  function distPx(x: number, y: number) {
    let best = Infinity
    const d = shown.find((d) => d.q.id === p.id && d.a > 0.4)
    if (d) best = Math.hypot(d.sx - x, d.sy - y)
    const ll = llAt(x, y)
    if (!ll) return best
    const { at: vtx } = nearest(target, ll)
    if (vtx) {
      const [sx, sy] = toScreen(...project(vtx))
      best = Math.min(best, Math.hypot(sx - x, sy - y))
    }
    return best
  }
  function isRight(pk: Pick & { x: number; y: number; type: string }) {
    const q = pk.q
    if (q.id === p.id) return true
    if (!pk.dot && pk.ll && geoContains(target as never, pk.ll)) return true
    if (p.region) {
      const pt = repPt(q)
      if (pt && geoContains(target as never, pt)) return true
    }
    // A finger's (or a hair's) width off the answer still counts.
    return distPx(pk.x, pk.y) <= (pk.type === 'mouse' ? 3 : 8)
  }
  function commit(pk: Pick & { x: number; y: number; type: string; timer?: ReturnType<typeof setTimeout> }) {
    clearTimeout(pk.timer)
    pending = null
    marks.press = null
    marks.hover = null
    const q = pk.q
    const right = isRight(pk)
    // Not it, with tries left (in a test): the place flashes red and the map stays put for another go.
    if (!right && ++misses < tries) {
      marks.miss = q.id
      marks.missAt = performance.now()
      burst(pk.x, pk.y, false)
      onMiss?.({ name: q.name, left: tries - misses })
      kick()
      return
    }
    answered = true
    doneAt = performance.now()
    burst(pk.x, pk.y, right)
    result = right ? { kind: 'right' } : { kind: 'wrong', name: q.name }
    marks.ans = p.id
    marks.fade = 0
    if (!right) marks.pick = q.id
    cv.style.cursor = 'grab'
    if (!right) showPlaces(q)
    onResult(result)
    kick()
  }
  // A soft ring where you clicked: green when it's right, red when it isn't.
  function burst(x: number, y: number, ok: boolean) {
    if (reduced) return
    const b = document.createElement('div')
    b.className = `find-burst ${ok ? 'find-burst-ok' : 'find-burst-no'}`
    b.style.left = `${x}px`
    b.style.top = `${y}px`
    wrap.appendChild(b)
    b.addEventListener('animationend', () => b.remove())
  }
  function reveal() {
    if (answered) return
    if (pending) {
      clearTimeout(pending.timer)
      pending = null
    }
    answered = true
    doneAt = performance.now()
    marks.press = marks.hover = null
    result = { kind: 'shown' }
    marks.ans = p.id
    marks.fade = 0
    cv.style.cursor = 'grab'
    showPlaces(null)
    onResult(result)
    kick()
  }
  // Fly to show the answer, with your pick too when they're near enough to share a view; otherwise the answer alone,
  // zoomed out enough to see where in the world it is.
  type Bounds = { x0: number; x1: number; y0: number; y1: number }
  function showPlaces(q: Place | null) {
    const box = (r: Bounds, to: number): Bounds => {
      const s = nearX((r.x0 + r.x1) / 2, to) - (r.x0 + r.x1) / 2
      return { x0: r.x0 + s, x1: r.x1 + s, y0: r.y0, y1: r.y1 }
    }
    const fitK = (b: Bounds) => clampK(Math.min(KCTX, (W * 0.6) / (Math.max(b.x1 - b.x0, 0.01) * base), (H * 0.6) / (Math.max(b.y1 - b.y0, 0.01) * base)))
    const a = box(pinfo(p), v.cx)
    let b = a
    if (q) {
      const c = box(pinfo(q), (a.x0 + a.x1) / 2)
      const u = { x0: Math.min(a.x0, c.x0), x1: Math.max(a.x1, c.x1), y0: Math.min(a.y0, c.y0), y1: Math.max(a.y1, c.y1) }
      const ku = fitK(u)
      if (ku > 1.15 && ku * 4 >= fitK(a)) b = u
    }
    const k = fitK(b)
    const to = clamp({ k, cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2 })
    // Already in view and big enough to see? Stay put.
    const S = base * v.k
    const [sx0, sy0] = toScreen(b.x0, b.y0)
    const sx1 = sx0 + (b.x1 - b.x0) * S
    const sy1 = sy0 + (b.y1 - b.y0) * S
    if (sx0 > 16 && sy0 > 16 && sx1 < W - 16 && sy1 < H - 16 && v.k >= k * 0.6) return
    flyTo(to, 620)
  }

  // ----- Camera moves -----
  let zoomGoal: number | null = null
  let wheel: { lk: number; x: number; y: number; v0: View } | null = null
  function stop() {
    anim = null
    zoomGoal = null
    wheel = null
  }
  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
  function flyTo(dest: View, ms: number) {
    stop()
    const to = { ...dest, cx: nearX(dest.cx, v.cx) }
    if (reduced) {
      v = clamp(to)
      kick()
      return
    }
    const zi = smoothZoom([v.cx, v.cy, W / (base * v.k)], [to.cx, to.cy, W / (base * to.k)])
    const t0 = performance.now()
    anim = (now) => {
      const t = Math.min(1, (now - t0) / ms)
      const [cx, cy, w] = zi(ease(t))
      v = t < 1 ? clamp({ k: W / (w * base), cx, cy }) : clamp(to)
      return t < 1
    }
    kick()
  }
  function zoomAt(f: number, x = W / 2, y = H / 2) {
    const k0 = v.k
    const k1 = clampK((zoomGoal || v.k) * f)
    if (Math.abs(k1 - k0) < 1e-4) return
    wheel = null
    zoomGoal = k1
    const v0 = v
    const t0 = performance.now()
    const l0 = Math.log(k0)
    const l1 = Math.log(k1)
    const ms = reduced ? 0 : 300
    anim = (now) => {
      const t = ms ? Math.min(1, (now - t0) / ms) : 1
      const e = 1 - Math.pow(1 - t, 3)
      v = zoomed(v0, t < 1 ? Math.exp(l0 + (l1 - l0) * e) : k1, x, y)
      if (t >= 1) zoomGoal = null
      return t < 1
    }
    kick()
  }
  const wheelAnim: Anim = (_now, dt) => {
    if (!wheel) return false
    const cur = Math.log(v.k)
    const d = wheel.lk - cur
    const nk = Math.abs(d) < 0.002 || reduced ? wheel.lk : cur + d * (1 - Math.exp(-dt / 65))
    v = zoomed(wheel.v0, Math.exp(nk), wheel.x, wheel.y)
    if (nk === wheel.lk) {
      wheel = null
      return false
    }
    return true
  }
  // Scroll or pinch on a trackpad zooms about the cursor. Small steps (trackpads) apply at once; wheel notches glide.
  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const [x, y] = local(e)
    mouse = { x, y }
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? H : 1)
    if (!dy) return
    if ((e.ctrlKey || Math.abs(dy) < 40) && !wheel) {
      stop()
      v = zoomed(v, clampK(v.k * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.003))), x, y)
      hoverDirty = true
      kick()
      return
    }
    const goal = clampK((wheel ? Math.exp(wheel.lk) : v.k) * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0035)))
    if (anim !== wheelAnim) stop()
    wheel = { lk: Math.log(goal), x, y, v0: v }
    anim = wheelAnim
    kick()
  }
  on('wheel', onWheel, { passive: false })

  // ----- Pointer: drag to pan (with a little glide), pinch to zoom, click or tap to answer, double to zoom in -----
  const ptrs = new Map<number, { x: number; y: number }>()
  type Gesture = {
    x0: number
    y0: number
    lx: number
    ly: number
    t0: number
    type: string
    moved: boolean
    multi: boolean
    dbl: boolean
    pinch: { d0: number; k0: number; ux: number; uy: number } | null
    samples: [number, number, number][]
  }
  let g: Gesture | null = null
  let lastTap: { x: number; y: number; t: number } | null = null
  on('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    try {
      cv.setPointerCapture(e.pointerId)
    } catch {
      // A pointer that's already gone.
    }
    const [x, y] = local(e)
    ptrs.set(e.pointerId, { x, y })
    stop()
    const now = performance.now()
    if (ptrs.size === 1) {
      const dbl = !!lastTap && now - lastTap.t < (e.pointerType === 'mouse' ? 260 : 300) && Math.hypot(x - lastTap.x, y - lastTap.y) < 28
      if (dbl && pending) {
        clearTimeout(pending.timer)
        pending = null
        marks.press = null
        kick()
      }
      g = { x0: x, y0: y, lx: x, ly: y, t0: now, type: e.pointerType, moved: false, multi: false, dbl, pinch: null, samples: [[now, x, y]] }
    } else if (ptrs.size === 2 && g) {
      g.multi = true
      const [a, b] = [...ptrs.values()]
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      const S = base * v.k
      g.pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, k0: v.k, ux: v.cx + (mx - W / 2) / S, uy: v.cy + (my - H / 2) / S }
      marks.hover = null
    }
  })
  on('pointermove', (e) => {
    const [x, y] = local(e)
    if (!ptrs.has(e.pointerId)) {
      if (e.pointerType === 'mouse') {
        mouse = { x, y }
        hoverDirty = true
        kick()
      }
      return
    }
    ptrs.set(e.pointerId, { x, y })
    if (!g) return
    if (g.pinch && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()]
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      const k = clampK((g.pinch.k0 * Math.hypot(a.x - b.x, a.y - b.y)) / g.pinch.d0)
      const S0 = base * g.pinch.k0
      // Pan with the fingers, then zoom about them as a wheel does.
      v = zoomed(clamp({ k: g.pinch.k0, cx: g.pinch.ux - (mx - W / 2) / S0, cy: g.pinch.uy - (my - H / 2) / S0 }), k, mx, my)
      kick()
      return
    }
    if (!g.moved) {
      if (Math.hypot(x - g.x0, y - g.y0) < (g.type === 'mouse' ? 5 : 8)) return
      g.moved = true
      drag = true
      marks.hover = null
      cv.style.cursor = 'grabbing'
    }
    const S = base * v.k
    v = clamp({ k: v.k, cx: v.cx - (x - g.lx) / S, cy: v.cy - (y - g.ly) / S })
    g.lx = x
    g.ly = y
    const now = performance.now()
    g.samples.push([now, x, y])
    while (g.samples.length > 2 && now - g.samples[0][0] > 100) g.samples.shift()
    kick()
  })
  const up = (e: PointerEvent, cancelled: boolean) => {
    if (!ptrs.has(e.pointerId)) return
    ptrs.delete(e.pointerId)
    if (!g) return
    if (ptrs.size === 1) {
      const [r] = [...ptrs.values()]
      g.pinch = null
      g.lx = r.x
      g.ly = r.y
      g.moved = true
      g.samples = []
      return
    }
    if (ptrs.size) return
    const [x, y] = local(e)
    const gg = g
    g = null
    drag = false
    cv.style.cursor = 'grab'
    if (!cancelled) {
      if (!gg.moved && !gg.multi) {
        if (performance.now() - gg.t0 < 700) tap(x, y, gg.type, gg.dbl)
      } else if (gg.moved && !gg.multi) fling(gg)
    }
    if (e.pointerType === 'mouse') {
      mouse = { x, y }
      hoverDirty = true
      kick()
    }
  }
  on('pointerup', (e) => up(e, false))
  on('pointercancel', (e) => up(e, true))
  on('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !ptrs.size) {
      mouse = null
      if (marks.hover) {
        marks.hover = null
        kick()
      }
    }
  })
  on('click', (e) => e.stopPropagation())
  on('contextmenu', (e) => {
    if (coarse) e.preventDefault()
  })
  function fling(gg: Gesture) {
    if (reduced) return
    const now = performance.now()
    const s = gg.samples
    if (s.length < 2) return
    const [t0, x0, y0] = s[0]
    const [t1, x1, y1] = s[s.length - 1]
    if (now - t1 > 60) return
    const span = Math.max(16, t1 - t0)
    let vx = (x1 - x0) / span
    let vy = (y1 - y0) / span
    if (Math.hypot(vx, vy) < 0.25) return
    anim = (_t, d) => {
      const S = base * v.k
      v = clamp({ k: v.k, cx: v.cx - (vx * d) / S, cy: v.cy - (vy * d) / S })
      const f = Math.exp(-d / 190)
      vx *= f
      vy *= f
      return Math.hypot(vx, vy) > 0.02
    }
    kick()
  }
  function tap(x: number, y: number, type: string, dbl: boolean) {
    const now = performance.now()
    lastTap = { x, y, t: now }
    if (dbl) {
      lastTap = null
      zoomAt(2, x, y)
      return
    }
    if (answered) {
      if (result?.kind === 'right' && now - doneAt > 350) onNext?.()
      return
    }
    if (pending) commit(pending)
    if (answered) return
    // Open sea within a finger's (or a hair's) width of the answer counts as the answer, as it does over land: island
    // nations are specks until you zoom in, and a tap just off one would otherwise do nothing at all.
    const hit = pickAt(x, y, type) ?? (distPx(x, y) <= (type === 'mouse' ? 3 : 8) ? { q: p, dot: false, ll: llAt(x, y) } : null)
    if (!hit) return
    // A right answer counts at once. Anything else waits a beat in case it's the first half of a double-click to zoom;
    // the place darkens at once so it still feels instant.
    if (isRight({ ...hit, x, y, type })) return commit({ ...hit, x, y, type })
    marks.press = hit.q.id
    kick()
    pending = {
      ...hit,
      x,
      y,
      type,
      timer: setTimeout(() => {
        if (pending && alive) commit(pending)
      }, type === 'mouse' ? 200 : 250),
    }
  }

  // ----- Size, theme, lifetime -----
  size()
  v = clamp(from ? { k: from.k, cx: from.cx, cy: from.cy } : START)
  draw(0) // the first frame is drawn now, before the card is ever shown
  queueWork()
  const ro = new ResizeObserver(() => {
    if (Math.max(200, wrap.clientWidth) === W && Math.max(140, wrap.clientHeight) === H) return
    size()
    v = clamp(v)
    draw(0)
  })
  ro.observe(wrap)
  const mq = matchMedia('(prefers-color-scheme: dark)')
  const recolor = () => {
    col = colours(wrap)
    kick()
  }
  mq.addEventListener('change', recolor)

  // For the app's end-to-end checks: where places are on screen, and what a click there would pick.
  Object.assign(wrap, {
    _find: {
      place: p,
      state: () => ({ answered, pending: !!pending, misses }),
      view: () => ({ ...v, W, H, base }),
      screenOf: (name: string) => {
        const q = PLACES.find((x) => x.name === name)
        const pt = q && repPt(q)
        return pt ? toScreen(...project(pt)) : null
      },
      dotOf: (name: string) => {
        const d = shown.find((d) => d.q.name === name)
        return d ? [d.sx, d.sy, d.a] : null
      },
      hit: (x: number, y: number, type = 'mouse') => pickAt(x, y, type)?.q.name ?? null,
      hover: () => (marks.hover ? byId.get(marks.hover)?.name : null) ?? null,
    },
  })

  return {
    reveal,
    fit: () => flyTo(clamp(START), 560),
    zoom: (f) => zoomAt(f),
    view: () => ({ ...v }),
    destroy() {
      alive = false
      redraws.delete(kick)
      cancelAnimationFrame(raf)
      if (pending) clearTimeout(pending.timer)
      life.abort()
      ro.disconnect()
      mq.removeEventListener('change', recolor)
    },
  }
}
