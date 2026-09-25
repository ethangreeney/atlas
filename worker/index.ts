/// <reference types="@cloudflare/workers-types" />
// Atlas API: Google sign-in and sync. Cards are last-write-wins, the review log is append-only (undo deletes and
// leaves a tombstone), and day rows only carry `extraNew`, merged by max. Every row records `synced` (server receipt
// time) so a pull with `since` catches rows that were written offline and pushed late.
import deck from '../src/data/deck.json'

export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  GOOGLE_CLIENT_ID?: string
  SESSION_SECRET: string
}

type Row = { id: string; data: unknown; updated: number }
type DayRowIn = { day: string; data: unknown; updated: number }
type RevlogIn = { cardId: string; review: number; data: unknown }
type RevlogKey = { cardId: string; review: number }

/** Every card id in the deck (mirrors src/lib/deck.ts). */
const CARD_IDS = new Set(
  deck.notes.flatMap((n) => [
    ...(n.capital ? [`${n.id}:capital`, `${n.id}:country`] : []),
    ...(n.flag ? [`${n.id}:flag`] : []),
    ...(n.map ? [`${n.id}:map`] : []),
  ]),
)
const MAX_BODY = 1_000_000
const MAX_ROWS = 1000 // per push, all kinds together; the client sends 500
const MAX_DATA = 2000 // serialized length of one row's `data`
const MAX_AHEAD = 5 * 60_000 // client clocks may run this far ahead of ours

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })

const enc = new TextEncoder()
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

const hmacKey = (secret: string) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])

/** Session token: base64url(payload).base64url(hmac). 90-day expiry. */
async function issueSession(env: Env, sub: string) {
  const payload = enc.encode(JSON.stringify({ sub, exp: Date.now() + 90 * 86_400_000 }))
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env.SESSION_SECRET), payload)
  return `${b64url(payload)}.${b64url(sig)}`
}

async function readSession(env: Env, req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const [p, s] = token.split('.')
  if (!p || !s) return null
  try {
    const payload = fromB64url(p)
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env.SESSION_SECRET), fromB64url(s), payload)
    if (!ok) return null
    const { sub, exp } = JSON.parse(new TextDecoder().decode(payload)) as { sub: string; exp: number }
    return exp > Date.now() ? sub : null
  } catch {
    return null
  }
}

async function googleSignIn(env: Env, req: Request) {
  if (!env.GOOGLE_CLIENT_ID) return json({ error: 'Sign-in not configured' }, 503)
  const { access_token } = (await req.json()) as { access_token?: string }
  if (!access_token) return json({ error: 'Missing token' }, 400)
  const info = (await (await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(access_token)}`)).json()) as {
    aud?: string
    sub?: string
    email?: string
  }
  if (info.aud !== env.GOOGLE_CLIENT_ID || !info.sub) return json({ error: 'Invalid token' }, 401)
  const profile = (await (
    await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { authorization: `Bearer ${access_token}` } })
  ).json()) as { name?: string; picture?: string; email?: string }
  const user = { id: info.sub, email: profile.email ?? info.email ?? '', name: profile.name ?? '', picture: profile.picture ?? '' }
  await env.DB.prepare(
    'INSERT INTO users (id, email, name, picture, created) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(id) DO UPDATE SET email = ?2, name = ?3, picture = ?4',
  )
    .bind(user.id, user.email, user.name, user.picture, Date.now())
    .run()
  return json({ token: await issueSession(env, user.id), user })
}

async function pull(env: Env, uid: string, since: number) {
  const now = Date.now()
  const q = (sql: string) => env.DB.prepare(sql).bind(uid, since)
  const [cards, days, revlog, deleted] = await Promise.all([
    q('SELECT id, data, updated FROM cards WHERE user_id = ?1 AND synced > ?2').all<{ id: string; data: string; updated: number }>(),
    q('SELECT day, data, updated FROM days WHERE user_id = ?1 AND synced > ?2').all<{ day: string; data: string; updated: number }>(),
    q('SELECT card_id, review, data FROM revlog WHERE user_id = ?1 AND synced > ?2').all<{ card_id: string; review: number; data: string }>(),
    q('SELECT card_id, review FROM revlog_deleted WHERE user_id = ?1 AND synced > ?2').all<{ card_id: string; review: number }>(),
  ])
  return json({
    now,
    cards: cards.results.map((r) => ({ id: r.id, data: JSON.parse(r.data), updated: r.updated })),
    days: days.results.map((r) => ({ day: r.day, data: JSON.parse(r.data), updated: r.updated })),
    revlog: revlog.results.map((r) => ({ cardId: r.card_id, review: r.review, data: JSON.parse(r.data) })),
    deleted: deleted.results.map((r) => ({ cardId: r.card_id, review: r.review })),
  })
}

const list = <T>(v: unknown) => (Array.isArray(v) ? (v as T[]) : [])
const isTime = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0
/** Serialized `data` if it's a small plain object, else null (the row is skipped). */
const dataOf = (v: unknown) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const s = JSON.stringify(v)
  return s.length <= MAX_DATA ? s : null
}

async function push(env: Env, uid: string, req: Request) {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return json({ error: 'Too large' }, 413)
  const text = await req.text()
  if (text.length > MAX_BODY) return json({ error: 'Too large' }, 413)
  let body: { cards?: unknown; days?: unknown; revlog?: unknown; deleted?: unknown }
  try {
    body = JSON.parse(text) ?? {}
  } catch {
    return json({ error: 'Bad JSON' }, 400)
  }
  const cards = list<Row>(body.cards)
  const days = list<DayRowIn>(body.days)
  const revlog = list<RevlogIn>(body.revlog)
  const deleted = list<RevlogKey>(body.deleted)
  if (cards.length + days.length + revlog.length + deleted.length > MAX_ROWS) return json({ error: 'Too many rows' }, 413)

  const now = Date.now()
  // A clock that runs ahead would otherwise win every last-write-wins merge until real time catches up.
  const clamp = (t: number) => Math.min(t, now + MAX_AHEAD)
  const isKey = (k: RevlogKey) => !!k && CARD_IDS.has(k.cardId) && isTime(k.review)
  const stmts: D1PreparedStatement[] = []
  const upCard = env.DB.prepare(
    'INSERT INTO cards (user_id, id, data, updated, synced) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(user_id, id) DO UPDATE SET data = excluded.data, updated = excluded.updated, synced = excluded.synced WHERE excluded.updated > cards.updated',
  )
  // Day rows: keep the larger `extraNew` from either side; the other counters are derived from the log on each device.
  const upDay = env.DB.prepare(
    "INSERT INTO days (user_id, day, data, updated, synced) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(user_id, day) DO UPDATE SET data = json_set(excluded.data, '$.extraNew', max(coalesce(json_extract(excluded.data, '$.extraNew'), 0), coalesce(json_extract(days.data, '$.extraNew'), 0))), updated = max(excluded.updated, days.updated), synced = excluded.synced",
  )
  // An undone review stays undone even if a device that still has it pushes it again.
  const upLog = env.DB.prepare(
    'INSERT OR IGNORE INTO revlog (user_id, card_id, review, data, synced) SELECT ?1, ?2, ?3, ?4, ?5 WHERE NOT EXISTS (SELECT 1 FROM revlog_deleted WHERE user_id = ?1 AND card_id = ?2 AND review = ?3)',
  )
  const delLog = env.DB.prepare('DELETE FROM revlog WHERE user_id = ?1 AND card_id = ?2 AND review = ?3')
  const tomb = env.DB.prepare('INSERT OR REPLACE INTO revlog_deleted (user_id, card_id, review, synced) VALUES (?1, ?2, ?3, ?4)')
  let skipped = 0
  for (const c of cards) {
    const data = c && CARD_IDS.has(c.id) && isTime(c.updated) ? dataOf(c.data) : null
    if (data) stmts.push(upCard.bind(uid, c.id, data, clamp(c.updated), now))
    else skipped++
  }
  for (const d of days) {
    const data = d && /^\d{4}-\d{2}-\d{2}$/.test(d.day) && isTime(d.updated) ? dataOf(d.data) : null
    if (data) stmts.push(upDay.bind(uid, d.day, data, clamp(d.updated), now))
    else skipped++
  }
  for (const r of revlog) {
    const data = isKey(r) ? dataOf(r.data) : null
    if (data) stmts.push(upLog.bind(uid, r.cardId, r.review, data, now))
    else skipped++
  }
  for (const k of deleted) {
    if (isKey(k)) stmts.push(delLog.bind(uid, k.cardId, k.review), tomb.bind(uid, k.cardId, k.review, now))
    else skipped++
  }
  // D1 batches are limited in size; chunk them.
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100))
  return json({ ok: true, count: stmts.length, skipped })
}

export async function handleApi(req: Request, env: Env): Promise<Response> {
  {
    const url = new URL(req.url)

    if (url.pathname === '/api/config') return json({ googleClientId: env.GOOGLE_CLIENT_ID ?? null })
    if (url.pathname === '/api/auth/google' && req.method === 'POST') return googleSignIn(env, req)

    const uid = await readSession(env, req)
    if (!uid) return json({ error: 'Unauthorized' }, 401)

    if (url.pathname === '/api/me') {
      const u = await env.DB.prepare('SELECT id, email, name, picture FROM users WHERE id = ?1').bind(uid).first()
      return json({ user: u })
    }
    if (url.pathname === '/api/sync' && req.method === 'GET') return pull(env, uid, Math.max(0, Number(url.searchParams.get('since')) || 0))
    if (url.pathname === '/api/sync' && req.method === 'POST') return push(env, uid, req)
    return json({ error: 'Not found' }, 404)
  }
}

/** Worker entry (kept for `wrangler dev`); production runs the same handler as a Pages Function. */
export default {
  async fetch(req, env) {
    return new URL(req.url).pathname.startsWith('/api/') ? handleApi(req, env) : env.ASSETS.fetch(req)
  },
} satisfies ExportedHandler<Env>
