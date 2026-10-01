// Pulls Ultimate Geography straight from its source on GitHub (not a release, which can lag a year behind), applies
// our own corrections on top, and writes the compact JSON the app ships plus the flag and map images.
// Usage: pnpm sync:deck [ref]   (ref: a branch, tag or commit; default master)
// Prints what changed against the deck already in the app, so a pull can be reviewed before it ships.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FIELDS, MEDIA } from './deck-overrides'

const REPO = 'anki-geo/ultimate-geography'
const ref = process.argv[2] ?? 'master'
const DECK = 'src/data/deck.json'
const MEDIA_DIR = 'public/media'

type Note = {
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

const api = async (path: string) => {
  const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    headers: { Accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN && { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }) },
  })
  if (!res.ok) throw new Error(`GitHub ${path}: ${res.status}`)
  return res.json()
}

/** RFC 4180: quoted fields may hold commas, doubled quotes and line breaks. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += c
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      rows.push([...row, field])
      row = []
      field = ''
    } else field += c
  }
  if (field || row.length) rows.push([...row, field])
  return rows.filter((r) => r.some((f) => f !== ''))
}

/** One English column of a source sheet, by place name. */
function column(dir: string, sheet: string, name: string) {
  const [head, ...rows] = parseCsv(readFileSync(join(dir, 'src/data', `${sheet}.csv`), 'utf8'))
  const col = head.indexOf(name)
  if (col < 0) throw new Error(`${sheet}.csv has no "${name}" column`)
  return new Map(rows.map((r) => [r[0], r[col] ?? '']))
}

const imgs = (html: string) => [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1])
const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
const hash = (file: string) => (existsSync(file) ? createHash('sha1').update(readFileSync(file)).digest('hex') : null)

const commit = await api(`commits/${encodeURIComponent(ref)}`)
const sha: string = commit.sha
const date: string = commit.commit.committer.date.slice(0, 10)
const release = await api('releases/latest')
const tag = await api(`commits/${encodeURIComponent(release.tag_name)}`)
const version = release.tag_name.replace(/^v/, '') + (tag.sha === sha ? '' : '+')

const work = mkdtempSync(join(tmpdir(), 'ug-'))
try {
  const tarball = join(work, 'ug.tar.gz')
  const res = await fetch(`https://codeload.github.com/${REPO}/tar.gz/${sha}`)
  if (!res.ok) throw new Error(`download: ${res.status}`)
  writeFileSync(tarball, Buffer.from(await res.arrayBuffer()))
  execFileSync('tar', ['-xzf', tarball, '-C', work])
  const src = join(work, readdirSync(work).find((d) => d.startsWith('ultimate-geography-'))!)

  const main = parseCsv(readFileSync(join(src, 'src/data/main.csv'), 'utf8'))
  const [mh, ...places] = main
  const at = (name: string) => mh.indexOf(name)
  const guid = column(src, 'guid', 'guid')
  const countryInfo = column(src, 'country_info', 'country info')
  const capital = column(src, 'capital', 'capital')
  const capitalInfo = column(src, 'capital_info', 'capital info')
  const capitalHint = column(src, 'capital_hint', 'capital hint')
  const flagSimilar = column(src, 'flag_similarity', 'flag similarity')

  const notes: Note[] = places.map((r) => {
    const name = r[0]
    const flags = imgs(r[at('flag')] ?? '')
    const note: Note = {
      id: guid.get(name)!,
      country: text(name),
      countryInfo: text(countryInfo.get(name) ?? ''),
      capital: text(capital.get(name) ?? ''),
      capitalInfo: text(capitalInfo.get(name) ?? ''),
      capitalHint: text(capitalHint.get(name) ?? ''),
      // Some flags ship a blurred copy (e.g. Guam, whose flag spells its name). Front shows the blur, back the real one.
      flag: flags[0] ?? null,
      flagBack: flags.find((s) => !s.includes('-blur')) ?? null,
      flagSimilar: text(flagSimilar.get(name) ?? ''),
      map: imgs(r[at('map')] ?? '')[0] ?? null,
      tags: (r[at('tags')] ?? '').split(/[\s,]+/).filter(Boolean).map((t) => t.replace(/^UG::/, '')),
    }
    if (!note.id) throw new Error(`${name} has no guid`)
    return { ...note, ...FIELDS[name] }
  })

  // Images: every one a note uses, from the source or from our own corrections, which win.
  const used = new Set(notes.flatMap((n) => [n.flag, n.flagBack, n.map]).filter((f): f is string => !!f))
  const changedMedia: string[] = []
  for (const file of used) {
    const from = MEDIA[file] ?? join(src, 'src/media', file.startsWith('ug-map-') ? 'maps' : 'flags', file)
    if (!existsSync(from)) throw new Error(`missing image ${file}`)
    const to = join(MEDIA_DIR, file)
    if (hash(from) === hash(to)) continue
    changedMedia.push(file)
    copyFileSync(from, to)
  }
  const stale = readdirSync(MEDIA_DIR).filter((f) => /^ug-(flag|map)-/.test(f) && !used.has(f))
  for (const f of stale) unlinkSync(join(MEDIA_DIR, f))

  // What changed against the deck the app has now.
  const prev = existsSync(DECK) ? (JSON.parse(readFileSync(DECK, 'utf8')) as { version: string; notes: Note[] }) : null
  const before = prev?.notes ?? []
  const old = new Map(before.map((n) => [n.id, n]))
  const now = new Set(notes.map((n) => n.id))
  const report: string[] = prev && prev.version !== version ? [`version ${prev.version} → ${version}`] : []
  for (const n of notes) {
    const o = old.get(n.id)
    if (!o) report.push(`added ${n.country}`)
    else
      for (const k of Object.keys(n) as (keyof Note)[])
        if (JSON.stringify(n[k]) !== JSON.stringify(o[k])) report.push(`${n.country}: ${k} ${JSON.stringify(o[k])} → ${JSON.stringify(n[k])}`)
  }
  for (const o of before) if (!now.has(o.id)) report.push(`removed ${o.country}`)
  for (const f of changedMedia) report.push(`image ${old.size ? 'updated' : 'added'} ${f}`)
  for (const f of stale) report.push(`image removed ${f}`)

  // Left alone when nothing we ship changed, so a source commit that only touches other languages isn't a diff here.
  // The recorded commit is then the last one whose content we have.
  const regions = [...new Set(notes.flatMap((n) => n.tags))].sort()
  if (report.length || !prev) writeFileSync(DECK, JSON.stringify({ version, source: { commit: sha, date }, regions, notes }))
  console.log(`Ultimate Geography ${version} at ${sha.slice(0, 7)} (${date}): ${notes.length} notes, ${used.size} images`)
  console.log(report.length ? report.join('\n') : 'no changes')
} finally {
  rmSync(work, { recursive: true, force: true })
}
