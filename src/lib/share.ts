import { mediaUrl, type DeckCard } from './deck'
import type { TestDef } from './tests'

export type ShareInput = {
  test: TestDef
  right: number
  total: number
  ms: number
  /** Card ids got wrong. */
  missed: Set<string>
  /** A new personal best. */
  best: boolean
  /** The first attempt at this test. */
  first: boolean
  date: Date
}

type View = [number, number, number, number]
/** The parts of the progress map's data drawn here. */
type World = {
  shapes: Record<string, string>
  rest: string
  /** Region index, label point x/y and size (side of a square of the same area), in map units. */
  places: Record<string, [number, number, number, number]>
  /** Oceania's places east of 180°, redrawn past the right edge: path and label point. */
  wrap: Record<string, [string, number, number]>
}
type Box = { x: number; y: number; w: number; h: number }

/** The usual link-preview size, drawn at 2× so it stays crisp on a phone. */
const W = 1200
const H = 630
const SCALE = 2
const PAD = 72
/** The text down the left; the flags, or a close-up map, fill the box to its right, top to bottom. */
const TEXT_W = 400
const FLAGS: Box = { x: 540, y: PAD, w: W - PAD - 540, h: H - 2 * PAD }
const CLOSE = FLAGS
/** The world is wide and short, so it gets a little more width, running nearer the right edge: the sea round it makes its own margin. */
const MAP: Box = { x: 516, y: PAD, w: W - 44 - 516, h: H - 2 * PAD }

// The app's light theme, whatever the app is showing: a shared image is seen out of context.
const INK = '#0f0f10'
const INK_2 = '#6b6b70'
const INK_3 = '#a4a4aa'
const LINE = 'rgba(15, 15, 16, 0.08)'
const GOOD = '#30a46c'
const AGAIN = '#e5484d'
const LAND = '#e5e5e5'
const FAMILY = "'Inter Variable', ui-sans-serif, system-ui, -apple-system, sans-serif"
/** Inter's capitals stand this much of the font size above the baseline, for lining tops up with the padding. */
const CAP = 0.727
const SITE = 'atlasgeo.pages.dev'

/** How much of a missed flag shows: enough to see a flag was there. */
const MISSED_ALPHA = 0.15
/** Places drawn smaller than this many px across also get a dot (missed ones sooner), and the least gap between dots, in px. */
const DOT_BELOW = 3
const MISSED_DOT_BELOW = 6
const DOT_GAP = 6.5

const pad2 = (n: number) => String(n).padStart(2, '0')
/** "9:42", or "1:04:09" past an hour. */
const clock = (ms: number) => {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  return h ? `${h}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}` : `${Math.floor(s / 60)}:${pad2(s % 60)}`
}
/** Rounded, but a score with anything missed never reads as 100%. */
const percent = (right: number, total: number) => {
  const p = Math.round((right / total) * 100)
  return right < total ? Math.min(p, 99) : p
}
const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short' })
/** "8 Oct 2026", in one form wherever it's shared from (en-GB alone would give "Sept"). */
const day = (d: Date) => `${d.getDate()} ${MONTH.format(d)} ${d.getFullYear()}`
const isoDay = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const shareText = (i: ShareInput) => `${i.test.name}: ${i.right}/${i.total} in ${clock(i.ms)} · ${SITE}`
const fileName = (i: ShareInput) => `atlas-${slug(i.test.name)}-${isoDay(i.date)}.png`

const font = (weight: number, size: number) => `${weight} ${size}px ${FAMILY}`

/** Sets the font and tracking (in em) together, so measuring and drawing agree. */
function setFont(ctx: CanvasRenderingContext2D, weight: number, size: number, tracking = 0) {
  ctx.font = font(weight, size)
  // Not every browser tracks canvas text yet; those draw it at the normal spacing, which still fits.
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${tracking * size}px`
}

/** Words broken into lines no wider than `max`, at the current font. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number) {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (line && ctx.measureText(next).width > max) {
      lines.push(line)
      line = word
    } else line = next
  }
  return [...lines, line]
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    // One missing flag leaves a blank tile rather than spoiling the picture.
    img.onerror = () => resolve(null)
    img.src = src
  })

/** Inter's weights, loaded before drawing: canvas text doesn't wait for a font, it falls back. */
async function loadFonts(text: string) {
  try {
    await Promise.all([400, 500, 600].map((w) => document.fonts.load(font(w, 32), text)))
  } catch {
    // Drawn in the fallback font, then.
  }
}

/**
 * The most columns and rows of uniform cells, `aspect` wide to 1 high with gaps a fraction of a cell's width, that fit
 * `n` cells as big as possible in the box. When the cells hit their cap, the shape that best matches the box wins.
 */
function grid(n: number, box: Box, aspect: number, gap: number, max: number) {
  let best = { cols: 1, rows: n, w: 0, fit: Infinity }
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const w = Math.min(box.w / (cols + (cols - 1) * gap), box.h / (rows / aspect + (rows - 1) * gap), max)
    const fit = Math.abs(Math.log((cols + (cols - 1) * gap) / (rows / aspect + (rows - 1) * gap) / (box.w / box.h)))
    if (w > best.w + 0.5 || (w > best.w - 0.5 && fit < best.fit)) best = { cols, rows, w, fit }
  }
  const { cols, rows, w } = best
  const h = w / aspect
  // The side with room to spare spreads its gaps a little, so the grid reaches the box's edges both ways.
  const spread = (room: number, n: number, size: number) => (n > 1 ? Math.min((room - n * size) / (n - 1), w * gap * 1.6) : 0)
  const gx = spread(box.w, cols, w)
  const gy = spread(box.h, rows, h)
  const x0 = box.x + (box.w - cols * w - (cols - 1) * gx) / 2
  const y0 = box.y + (box.h - rows * h - (rows - 1) * gy) / 2
  return { w, h, at: (i: number) => ({ x: x0 + (i % cols) * (w + gx), y: y0 + Math.floor(i / cols) * (h + gy) }) }
}

/** Every flag in the test, in a mosaic; the missed ones faded right back, so the gaps read at a glance. */
async function drawFlags(ctx: CanvasRenderingContext2D, cards: DeckCard[], missed: Set<string>, box: Box) {
  const sorted = [...cards].sort((a, b) => a.note.country.localeCompare(b.note.country))
  const images = await Promise.all(sorted.map((c) => (c.note.flag ? loadImage(mediaUrl(c.note.flag)) : null)))
  const cell = grid(sorted.length, box, 3 / 2, 0.2, 96)
  const r = Math.max(1.5, cell.w * 0.05)
  sorted.forEach((c, i) => {
    const img = images[i]
    const { x, y } = cell.at(i)
    // Each flag keeps its own shape, as big as fits the cell, centred in it.
    const aspect = img?.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 3 / 2
    const w = Math.min(cell.w, cell.h * aspect)
    const h = w / aspect
    const fx = x + (cell.w - w) / 2
    const fy = y + (cell.h - h) / 2
    const boxed = !c.note.flag?.includes('-nobox')
    ctx.save()
    ctx.globalAlpha = missed.has(c.id) ? MISSED_ALPHA : 1
    if (img) {
      if (boxed) {
        ctx.beginPath()
        ctx.roundRect(fx, fy, w, h, r)
        ctx.clip()
      }
      ctx.drawImage(img, fx, fy, w, h)
    } else {
      ctx.fillStyle = LAND
      ctx.beginPath()
      ctx.roundRect(fx, fy, w, h, r)
      ctx.fill()
    }
    ctx.restore()
    // A hairline round the edge, as the app gives its flags, so white ones still have one.
    if (boxed) {
      ctx.strokeStyle = LINE
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.roundRect(fx - 0.5, fy - 0.5, w + 1, h + 1, r + 0.5)
      ctx.stroke()
    }
  })
}

/**
 * Where a place is drawn: its label point and size. The Pacific islands east of 180° are always drawn past the right
 * edge, beside Fiji and New Zealand, rather than alone off the far side of the map.
 */
const pointOf = (world: World, id: string): [number, number, number] => {
  const [, x, y, size] = world.places[id]
  const w = world.wrap[id]
  return w ? [w[1], w[2], size] : [x, y, size]
}

/** Places too small to see at this scale, as dots nudged apart until each one shows on its own (as on the progress map). */
function dotsFor(ids: string[], world: World, px: number, missed: (id: string) => boolean) {
  const dots = ids.flatMap((id) => {
    const [x, y, size] = pointOf(world, id)
    // A miss has to read, so it gets a dot sooner.
    return size * px < (missed(id) ? MISSED_DOT_BELOW : DOT_BELOW) ? [{ id, x, y }] : []
  })
  const min = DOT_GAP / px
  for (let k = 0; k < 60; k++) {
    let moved = false
    for (let i = 0; i < dots.length; i++)
      for (let j = i + 1; j < dots.length; j++) {
        const a = dots[i]
        const b = dots[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.hypot(dx, dy)
        if (d >= min) continue
        const [ux, uy] = d ? [dx / d, dy / d] : [Math.cos(i + j), Math.sin(i + j)]
        const push = (min - d) / 2
        a.x -= ux * push
        a.y -= uy * push
        b.x += ux * push
        b.y += uy * push
        moved = true
      }
    if (!moved) break
  }
  return dots
}

/** All the land, with the far Pacific wrapped round beside Fiji: from Hawaii to French Polynesia. */
const WORLD_VIEW: View = [50, 0, 1040, 447]

/**
 * The whole world for an official test or a set spread across it; otherwise a close-up round the set's places, shaped
 * like the box, with some of their neighbours for context. Label points and sizes, not outlines, set the bounds, so
 * Russia's far east (drawn by Alaska, past 180°) doesn't stretch Europe's view across the world.
 */
function viewFor(ids: string[], world: World, box: Box, official: boolean): View | null {
  if (official || !ids.length) return null
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const id of ids) {
    const [x, y, size] = pointOf(world, id)
    const e = Math.min(size, 40) * 0.6
    ;[x0, y0, x1, y1] = [Math.min(x0, x - e), Math.min(y0, y - e), Math.max(x1, x + e), Math.max(y1, y + e)]
  }
  const pad = Math.max(x1 - x0, y1 - y0) * 0.12 + 8
  let w = x1 - x0 + 2 * pad
  let h = y1 - y0 + 2 * pad
  // A tall set widens to fill the box, with sea or coast either side. A wide one stays wide, up to the world's own
  // shape, rather than taking in a continent's worth of other land above and below.
  const aspect = Math.min(Math.max(w / h, box.w / box.h), WORLD_VIEW[2] / WORLD_VIEW[3])
  if (w / h < aspect) w = h * aspect
  else h = w / aspect
  // A handful of islands still shows a bit of the sea and coast round them.
  const k = Math.max(1, 110 / w)
  w *= k
  h *= k
  if (w >= WORLD_VIEW[2] * 0.6) return null
  // The Arctic runs right to the map's top edge, so a view never starts above it: the fade hides that cut, empty sea doesn't.
  return [(x0 + x1 - w) / 2, Math.max(0, (y0 + y1 - h) / 2), w, h]
}

/** The map with each place in the test green or red, the rest plain land. */
function drawMap(ctx: CanvasRenderingContext2D, test: TestDef, missed: Set<string>, world: World) {
  const card = new Map(test.cards.map((c) => [c.note.id, c]))
  const ids = [...card.keys()].filter((id) => world.places[id])
  const isMissed = (id: string) => missed.has(card.get(id)?.id ?? '')
  const colour = (id: string) => (card.has(id) ? (isMissed(id) ? AGAIN : GOOD) : LAND)
  const close = viewFor(ids, world, CLOSE, test.official)
  const box = close ? CLOSE : MAP
  const view = close ?? WORLD_VIEW
  // Pixels per map unit: the drawing fits inside the box, so whichever side runs out first sets the scale.
  const px = Math.min(box.w / view[2], box.h / view[3])
  const w = view[2] * px
  const h = view[3] * px
  const x = box.x + (box.w - w) / 2
  const y = box.y + (box.h - h) / 2

  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.translate(x, y)
  ctx.scale(px, px)
  ctx.translate(-view[0], -view[1])
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 0.6 / px
  ctx.lineJoin = 'round'
  const draw = (d: string, fill: string) => {
    const p = new Path2D(d)
    ctx.fillStyle = fill
    ctx.fill(p)
    ctx.stroke(p)
  }
  draw(world.rest, LAND)
  // Plain land first, so the test's places sit on top of their neighbours' borders.
  const shapes = Object.keys(world.shapes).sort((a, b) => Number(card.has(a)) - Number(card.has(b)))
  for (const id of shapes) draw(world.wrap[id]?.[0] ?? world.shapes[id], colour(id))
  // Dots grow a little closer in, where the land around them is drawn bigger too.
  const r = Math.min(3.5, 2.5 + px * 0.2) / px
  ctx.lineWidth = 0.75 / px
  // Missed ones last, so a neighbour's dot never hides one.
  const dots = dotsFor(ids, world, px, isMissed).sort((a, b) => Number(isMissed(a.id)) - Number(isMissed(b.id)))
  for (const { id, x, y } of dots) {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = colour(id)
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()

  // A close-up is cut from the world; fade its edges into the page rather than end on a hard line.
  if (close) {
    const f = 36
    const fade = (x0: number, y0: number, x1: number, y1: number) => {
      const g = ctx.createLinearGradient(x0, y0, x1, y1)
      g.addColorStop(0, 'rgba(255, 255, 255, 1)')
      g.addColorStop(1, 'rgba(255, 255, 255, 0)')
      ctx.fillStyle = g
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) || w, Math.abs(y1 - y0) || h)
    }
    fade(x, y, x + f, y)
    fade(x + w, y, x + w - f, y)
    fade(x, y, x, y + f)
    fade(x, y + h, x, y + h - f)
  }
}

/** One dot per card for a test with nothing to show on the map (seas, continents): green or red. */
function drawDots(ctx: CanvasRenderingContext2D, cards: DeckCard[], missed: Set<string>, box: Box) {
  const cell = grid(cards.length, box, 1, 0.4, 28)
  // Right ones first, so the share of each reads at a glance.
  const sorted = [...cards].sort((a, b) => Number(missed.has(a.id)) - Number(missed.has(b.id)))
  sorted.forEach((c, i) => {
    const { x, y } = cell.at(i)
    ctx.beginPath()
    ctx.arc(x + cell.w / 2, y + cell.h / 2, cell.w / 2, 0, Math.PI * 2)
    ctx.fillStyle = missed.has(c.id) ? AGAIN : GOOD
    ctx.fill()
  })
}

async function drawVisual(ctx: CanvasRenderingContext2D, i: ShareInput) {
  const { cards, type } = i.test
  if (type === 'flag') return drawFlags(ctx, cards, i.missed, FLAGS)
  const world = (await import('../data/world.json')).default as unknown as World
  // Seas and continents aren't on the map; a set mostly of them gets dots instead.
  if (cards.filter((c) => world.places[c.note.id]).length >= cards.length / 2) drawMap(ctx, i.test, i.missed, world)
  else drawDots(ctx, cards, i.missed, FLAGS)
}

/** The name, score, time and date down the left. */
function drawText(ctx: CanvasRenderingContext2D, i: ShareInput) {
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  const x = PAD

  setFont(ctx, 600, 22, -0.02)
  ctx.fillStyle = INK
  ctx.fillText('Atlas', x, PAD + 22 * CAP)

  setFont(ctx, 400, 18)
  ctx.fillStyle = INK_3
  ctx.fillText(`${day(i.date)} · ${SITE}`, x, H - PAD)

  // The name on up to two lines, smaller if it needs to be.
  let nameSize = 30
  let name: string[] = []
  for (; nameSize >= 22; nameSize -= 2) {
    setFont(ctx, 500, nameSize, -0.01)
    name = wrap(ctx, i.test.name, TEXT_W)
    if (name.length <= 2) break
  }
  const nameLead = nameSize * 1.25

  // The score as big as the column allows, the total quieter than what you got.
  const got = String(i.right)
  const of = `/${i.total}`
  setFont(ctx, 600, 100, -0.045)
  const scoreSize = Math.min(112, Math.floor((100 * TEXT_W) / ctx.measureText(got + of).width))

  const stat = `${percent(i.right, i.total)}% · ${clock(i.ms)}`
  const tag = i.best ? 'Personal best' : i.first ? 'First attempt' : null
  const PILL_H = 36

  // Stack the block and centre it in the card.
  const gaps = { score: 30, stat: 26, tag: 30 }
  const height =
    nameSize * CAP + (name.length - 1) * nameLead + gaps.score + scoreSize * CAP + gaps.stat + 26 * CAP + (tag ? gaps.tag + PILL_H : 0)
  let y = Math.round((H - height) / 2)

  setFont(ctx, 500, nameSize, -0.01)
  ctx.fillStyle = INK
  y += nameSize * CAP
  name.forEach((line, n) => ctx.fillText(line, x, y + n * nameLead))
  y += (name.length - 1) * nameLead

  y += gaps.score + scoreSize * CAP
  setFont(ctx, 600, scoreSize, -0.045)
  ctx.fillStyle = INK
  ctx.fillText(got, x, y)
  const gw = ctx.measureText(got).width
  ctx.fillStyle = INK_3
  ctx.fillText(of, x + gw, y)

  y += gaps.stat + 26 * CAP
  setFont(ctx, 500, 26, -0.01)
  ctx.fillStyle = INK_2
  ctx.fillText(stat, x, y)

  if (tag) {
    y += gaps.tag
    setFont(ctx, 500, 17)
    const tw = ctx.measureText(tag).width
    ctx.beginPath()
    ctx.roundRect(x, y, tw + 32, PILL_H, PILL_H / 2)
    ctx.fillStyle = i.best ? 'rgba(48, 164, 108, 0.12)' : 'rgba(15, 15, 16, 0.05)'
    ctx.fill()
    ctx.fillStyle = i.best ? GOOD : INK_2
    ctx.fillText(tag, x + 16, y + (PILL_H + 17 * CAP) / 2)
  }
}

async function render(i: ShareInput) {
  const canvas = document.createElement('canvas')
  canvas.width = W * SCALE
  canvas.height = H * SCALE
  const ctx = canvas.getContext('2d')!
  ctx.scale(SCALE, SCALE)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, W, H)
  // The visual draws while the fonts load; the text waits for them.
  await Promise.all([drawVisual(ctx, i), loadFonts(`Atlas ${i.test.name} 0123456789/%:· ${day(i.date)} ${SITE} Personal best First attempt`)])
  drawText(ctx, i)
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not draw the image'))), 'image/png'))
}

/** The last image drawn, so sharing then copying the same result draws it once. */
let last: { key: string; blob: Promise<Blob> } | null = null

/** The result as a PNG. */
export function shareImage(input: ShareInput): Promise<Blob> {
  const key = JSON.stringify([input.test.key, input.right, input.total, input.ms, [...input.missed].sort(), input.best, input.first, +input.date])
  if (last?.key !== key) {
    const blob = render(input)
    last = { key, blob }
    // A drawing that failed isn't kept, so the next try draws afresh.
    blob.catch(() => {
      if (last?.blob === blob) last = null
    })
  }
  return last.blob
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  // Some browsers start the download after the click returns; give it a moment before letting go of the file.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Opens the share sheet with the image and a line of text where the browser can share files; otherwise downloads the PNG. */
export async function shareResult(input: ShareInput): Promise<'shared' | 'cancelled' | 'downloaded'> {
  const blob = await shareImage(input)
  const name = fileName(input)
  const file = new File([blob], name, { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: shareText(input) })
      return 'shared'
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled'
      // Anything else (the tap's permission ran out while drawing, say) still gets the image saved.
    }
  }
  download(blob, name)
  return 'downloaded'
}

/** Copies the image to the clipboard (desktop). Returns false if the browser can't. */
export async function copyResult(input: ShareInput): Promise<boolean> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false
  try {
    // Handing over the promise, not the blob, keeps Safari's hold on the click while the image draws.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': shareImage(input) })])
    return true
  } catch {
    return false
  }
}
