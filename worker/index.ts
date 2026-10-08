/// <reference types="@cloudflare/workers-types" />
// Atlas API: Google sign-in and sync. Cards are last-write-wins, the review log is append-only (undo deletes and
// leaves a tombstone), and day rows only carry `extraNew`, merged by max. Every row records `synced` (server receipt
// time) so a pull with `since` catches rows that were written offline and pushed late. The fitted FSRS weights are one
// row per account, kept from whichever fit saw the most reviews, so every device schedules the same way. Finished tests
// never change, so they're only ever added. /api/push stores daily reminder subscriptions; the separate worker in
// reminders/ sends them.
import deck from '../src/data/deck.json'
import outlined from '../src/data/outline-ids.json'

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
type ParamsIn = { data: { w?: unknown; at?: unknown; reviews?: unknown }; updated: number }
type TestIn = { id: unknown; data: { test?: unknown; finished?: unknown; ms?: unknown; total?: unknown; right?: unknown; missed?: unknown } | null }

/** Every card id in the deck, the outline set included (mirrors src/lib/deck.ts). */
const OUTLINED = new Set<string>(outlined)
const CARD_IDS = new Set(
  deck.notes.flatMap((n) => [
    ...(n.capital ? [`${n.id}:capital`, `${n.id}:country`] : []),
    ...(n.flag ? [`${n.id}:flag`] : []),
    ...(n.map ? [`${n.id}:map`] : []),
    ...(OUTLINED.has(n.id) ? [`${n.id}:outline`] : []),
  ]),
)
const MAX_BODY = 1_000_000
const MAX_ROWS = 1000 // per push, all kinds together; the client sends 500
const MAX_DATA = 2000 // serialized length of one row's `data`
const MAX_TEST_DATA = 60_000 // the same for a test, which lists every card missed (a few hundred at most)
const MAX_TEST_MS = 86_400_000 // a test longer than a day is a broken clock
const MAX_AHEAD = 5 * 60_000 // client clocks may run this far ahead of ours
const MIN_TIME = Date.UTC(2000, 0, 1) // anything earlier is a broken clock or a bad value

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
  const body = await readSmallJson(req)
  if (body instanceof Response) return body
  const { access_token } = body
  if (typeof access_token !== 'string' || !access_token) return json({ error: 'Missing token' }, 400)
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
  const [cards, days, revlog, deleted, params, tests] = await Promise.all([
    q('SELECT id, data, updated FROM cards WHERE user_id = ?1 AND synced > ?2').all<{ id: string; data: string; updated: number }>(),
    q('SELECT day, data, updated FROM days WHERE user_id = ?1 AND synced > ?2').all<{ day: string; data: string; updated: number }>(),
    q('SELECT card_id, review, data FROM revlog WHERE user_id = ?1 AND synced > ?2').all<{ card_id: string; review: number; data: string }>(),
    q('SELECT card_id, review FROM revlog_deleted WHERE user_id = ?1 AND synced > ?2').all<{ card_id: string; review: number }>(),
    q('SELECT data FROM params WHERE user_id = ?1 AND synced > ?2').first<{ data: string }>(),
    q('SELECT id, data FROM tests WHERE user_id = ?1 AND synced > ?2').all<{ id: string; data: string }>(),
  ])
  return json({
    now,
    cards: cards.results.map((r) => ({ id: r.id, data: JSON.parse(r.data), updated: r.updated })),
    days: days.results.map((r) => ({ day: r.day, data: JSON.parse(r.data), updated: r.updated })),
    revlog: revlog.results.map((r) => ({ cardId: r.card_id, review: r.review, data: JSON.parse(r.data) })),
    deleted: deleted.results.map((r) => ({ cardId: r.card_id, review: r.review })),
    params: params ? JSON.parse(params.data) : null,
    tests: tests.results.map((r) => ({ id: r.id, data: JSON.parse(r.data) })),
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
/** A local day key (YYYY-MM-DD) for a real date, not far from now. */
const isDay = (v: unknown, now: number) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const t = Date.parse(`${v}T00:00:00Z`) // rolls 02-30 over to March, caught below
  return t >= MIN_TIME && t <= now + 2 * 86_400_000 && new Date(t).toISOString().startsWith(v)
}
/** A safe integer from `lo` to `hi`. */
const inRange = (v: unknown, lo: number, hi: number): v is number => Number.isSafeInteger(v) && (v as number) >= lo && (v as number) <= hi
/**
 * A finished test rebuilt from just the fields it should have, each checked, or null if any is off. Its score is kept
 * in columns too, to compare with everyone's, so it has to add up: every card missed is listed, and only those.
 */
const testOf = (t: TestIn, now: number) => {
  const { id, data } = t ?? {}
  if (typeof id !== 'string' || id.length > 64 || !/^[A-Za-z0-9-]+$/.test(id) || !data || typeof data !== 'object') return null
  const { test, finished, ms, total, right, missed } = data
  if (typeof test !== 'string' || test.length > 64 || !/^[A-Za-z_+]+:(flag|map|capital|country)$/.test(test)) return null
  if (!inRange(finished, MIN_TIME, now + MAX_AHEAD) || !inRange(ms, 0, MAX_TEST_MS) || !inRange(total, 1, 1000) || !inRange(right, 0, total)) return null
  const isMiss = (m: { id?: unknown; typed?: unknown } | null) => !!m && typeof m.id === 'string' && CARD_IDS.has(m.id) && typeof m.typed === 'string' && m.typed.length <= 80
  if (!Array.isArray(missed) || missed.length !== total - right || !missed.every(isMiss)) return null
  const row = { id, test, finished, ms, total, right, missed: missed.map((m) => ({ id: m.id as string, typed: m.typed as string })) }
  const s = JSON.stringify(row)
  return s.length <= MAX_TEST_DATA ? { ...row, data: s } : null
}

async function push(env: Env, uid: string, req: Request) {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return json({ error: 'Too large' }, 413)
  const text = await req.text()
  if (text.length > MAX_BODY) return json({ error: 'Too large' }, 413)
  let body: { cards?: unknown; days?: unknown; revlog?: unknown; deleted?: unknown; params?: unknown; tests?: unknown }
  try {
    body = JSON.parse(text) ?? {}
  } catch {
    return json({ error: 'Bad JSON' }, 400)
  }
  const cards = list<Row>(body.cards)
  const days = list<DayRowIn>(body.days)
  const revlog = list<RevlogIn>(body.revlog)
  const deleted = list<RevlogKey>(body.deleted)
  const params = body.params as ParamsIn | undefined
  const tests = list<TestIn>(body.tests)
  if (cards.length + days.length + revlog.length + deleted.length + tests.length + (params ? 1 : 0) > MAX_ROWS) return json({ error: 'Too many rows' }, 413)

  const now = Date.now()
  // A clock that runs ahead would otherwise win every last-write-wins merge until real time catches up.
  const clamp = (t: number) => Math.min(t, now + MAX_AHEAD)
  // A review time is part of the row's key, so it can't be clamped: one out of range is refused, and the client keeps
  // it to try again. Past 8.64e15 it isn't even a valid Date, and would fail every pull after it.
  const isKey = (k: RevlogKey) => !!k && CARD_IDS.has(k.cardId) && isTime(k.review) && k.review >= MIN_TIME && k.review <= now + MAX_AHEAD
  const stmts: D1PreparedStatement[] = []
  const upCard = env.DB.prepare(
    'INSERT INTO cards (user_id, id, data, updated, synced) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(user_id, id) DO UPDATE SET data = excluded.data, updated = excluded.updated, synced = excluded.synced WHERE excluded.updated > cards.updated',
  )
  // Day rows: keep the larger `extraNew` and every card `pulled` from either side; the other counters are derived from
  // the log on each device.
  const upDay = env.DB.prepare(
    "INSERT INTO days (user_id, day, data, updated, synced) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(user_id, day) DO UPDATE SET data = json_set(excluded.data, '$.extraNew', max(coalesce(json_extract(excluded.data, '$.extraNew'), 0), coalesce(json_extract(days.data, '$.extraNew'), 0)), '$.pulled', json((SELECT json_group_array(value) FROM (SELECT value FROM json_each(coalesce(json_extract(excluded.data, '$.pulled'), '[]')) UNION SELECT value FROM json_each(coalesce(json_extract(days.data, '$.pulled'), '[]')))))), updated = max(excluded.updated, days.updated), synced = excluded.synced",
  )
  // An undone review stays undone even if a device that still has it pushes it again.
  const upLog = env.DB.prepare(
    'INSERT OR IGNORE INTO revlog (user_id, card_id, review, data, synced) SELECT ?1, ?2, ?3, ?4, ?5 WHERE NOT EXISTS (SELECT 1 FROM revlog_deleted WHERE user_id = ?1 AND card_id = ?2 AND review = ?3)',
  )
  // A fit replaces the stored one only if it learned from more reviews, or as many and later.
  const upParams = env.DB.prepare(
    'INSERT INTO params (user_id, data, reviews, updated, synced) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, reviews = excluded.reviews, updated = excluded.updated, synced = excluded.synced WHERE excluded.reviews > params.reviews OR (excluded.reviews = params.reviews AND excluded.updated > params.updated)',
  )
  const delLog = env.DB.prepare('DELETE FROM revlog WHERE user_id = ?1 AND card_id = ?2 AND review = ?3')
  const tomb = env.DB.prepare('INSERT OR REPLACE INTO revlog_deleted (user_id, card_id, review, synced) VALUES (?1, ?2, ?3, ?4)')
  // A test never changes, so one already stored (sent again after a lost reply, say) is left as it is.
  const addTest = env.DB.prepare(
    'INSERT OR IGNORE INTO tests (user_id, id, test, finished, ms, total, right, data, synced) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)',
  )
  // Positions of the rows not stored, per kind, so the client keeps those to send again instead of marking them done.
  const rejected = { cards: [] as number[], days: [] as number[], revlog: [] as number[], deleted: [] as number[], params: [] as number[], tests: [] as number[] }
  for (const [i, c] of cards.entries()) {
    const data = c && CARD_IDS.has(c.id) && isTime(c.updated) ? dataOf(c.data) : null
    if (data) stmts.push(upCard.bind(uid, c.id, data, clamp(c.updated), now))
    else rejected.cards.push(i)
  }
  for (const [i, d] of days.entries()) {
    // Only `extraNew` and `pulled` are kept (and the key, which older clients read from `data`). Whole rows grew past
    // MAX_DATA once a day's list of places seen got long.
    const data = d?.data as { extraNew?: unknown; pulled?: unknown } | null
    const extraNew = data?.extraNew ?? 0
    const pulled = data?.pulled ?? []
    // A card the deck no longer has (one dropped in an update) is left out, rather than refusing the day and every
    // change after it.
    const okPulled = Array.isArray(pulled) && pulled.length <= CARD_IDS.size
    if (d && isDay(d.day, now) && isTime(d.updated) && Number.isSafeInteger(extraNew) && (extraNew as number) >= 0 && okPulled) {
      const known = [...new Set((pulled as unknown[]).filter((id): id is string => typeof id === 'string' && CARD_IDS.has(id)))]
      stmts.push(upDay.bind(uid, d.day, JSON.stringify({ day: d.day, extraNew, pulled: known }), clamp(d.updated), now))
    } else rejected.days.push(i)
  }
  for (const [i, r] of revlog.entries()) {
    const data = isKey(r) ? dataOf(r.data) : null
    if (data) stmts.push(upLog.bind(uid, r.cardId, r.review, data, now))
    else rejected.revlog.push(i)
  }
  for (const [i, k] of deleted.entries()) {
    if (isKey(k)) stmts.push(delLog.bind(uid, k.cardId, k.review), tomb.bind(uid, k.cardId, k.review, now))
    else rejected.deleted.push(i)
  }
  if (params) {
    const { w, at, reviews } = params.data ?? {}
    const ok =
      Array.isArray(w) && w.length === 21 && w.every((x) => Number.isFinite(x) && Math.abs(x) < 1000) && isTime(at) && Number.isSafeInteger(reviews) && (reviews as number) >= 0
    if (ok) stmts.push(upParams.bind(uid, JSON.stringify({ w, at, reviews }), reviews, clamp(at as number), now))
    else rejected.params.push(0)
  }
  for (const [i, t] of tests.entries()) {
    const r = testOf(t, now)
    if (r) stmts.push(addTest.bind(uid, r.id, r.test, r.finished, r.ms, r.total, r.right, r.data, now))
    else rejected.tests.push(i)
  }
  // D1 batches are limited in size; chunk them.
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100))
  const skipped = Object.values(rejected).reduce((n, a) => n + a.length, 0)
  // The fit kept, when one was sent: if it wasn't this one, the device switches to it rather than keep a worse one.
  const kept = params ? await env.DB.prepare('SELECT data FROM params WHERE user_id = ?1').bind(uid).first<{ data: string }>() : null
  // `cap`: card times above it were stored as it, so the client can hold the same value and compare like for like.
  return json({ ok: true, count: stmts.length, skipped, rejected, cap: now + MAX_AHEAD, ...(kept && { params: JSON.parse(kept.data) }) })
}

const MAX_PUSH_BODY = 4000
const MAX_SUBS = 5 // per user; the oldest browser drops off beyond this
/** Web Push services the browsers we support use. Anything else could make the sender call arbitrary URLs. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/]
const isB64url = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max && /^[A-Za-z0-9_-]+=*$/.test(v)
const isTimeZone = (v: unknown): v is string => {
  if (typeof v !== 'string' || v.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v })
    return true
  } catch {
    return false
  }
}

async function readSmallJson(req: Request): Promise<Record<string, unknown> | Response> {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_PUSH_BODY) return json({ error: 'Too large' }, 413)
  const text = await req.text()
  if (text.length > MAX_PUSH_BODY) return json({ error: 'Too large' }, 413)
  try {
    const body = JSON.parse(text)
    return body && typeof body === 'object' && !Array.isArray(body) ? body : json({ error: 'Bad JSON' }, 400)
  } catch {
    return json({ error: 'Bad JSON' }, 400)
  }
}

/** The endpoint if it's an https URL on a known push service, else null. */
const pushEndpoint = (v: unknown) => {
  if (typeof v !== 'string' || v.length > 1000) return null
  try {
    const u = new URL(v)
    return u.protocol === 'https:' && !u.port && !u.username && PUSH_HOSTS.some((h) => h.test(u.hostname)) ? v : null
  } catch {
    return null
  }
}

/** Turn on or update the daily reminder for this browser. */
async function subscribe(env: Env, uid: string, req: Request) {
  const body = await readSmallJson(req)
  if (body instanceof Response) return body
  const endpoint = pushEndpoint(body.endpoint)
  const keys = (body.keys ?? {}) as { p256dh?: unknown; auth?: unknown }
  const { tz, hour } = body
  if (!endpoint || !isB64url(keys.p256dh, 200) || !isB64url(keys.auth, 100) || !isTimeZone(tz) || !Number.isInteger(hour) || (hour as number) < 0 || (hour as number) > 23)
    return json({ error: 'Invalid subscription' }, 400)
  await env.DB.batch([
    // A browser belongs to whoever signed in on it last.
    env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?1 AND user_id != ?2').bind(endpoint, uid),
    env.DB.prepare(
      'INSERT INTO push_subs (user_id, endpoint, p256dh, auth, tz, hour, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(user_id, endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, tz = excluded.tz, hour = excluded.hour',
    ).bind(uid, endpoint, keys.p256dh, keys.auth, tz, hour, Date.now()),
    env.DB.prepare(
      'DELETE FROM push_subs WHERE user_id = ?1 AND endpoint NOT IN (SELECT endpoint FROM push_subs WHERE user_id = ?1 ORDER BY created DESC LIMIT ?2)',
    ).bind(uid, MAX_SUBS),
  ])
  return json({ ok: true })
}

async function unsubscribe(env: Env, uid: string, req: Request) {
  const body = await readSmallJson(req)
  if (body instanceof Response) return body
  if (typeof body.endpoint !== 'string' || body.endpoint.length > 1000) return json({ error: 'Invalid endpoint' }, 400)
  await env.DB.prepare('DELETE FROM push_subs WHERE user_id = ?1 AND endpoint = ?2').bind(uid, body.endpoint).run()
  return json({ ok: true })
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
    if (url.pathname === '/api/push' && req.method === 'POST') return subscribe(env, uid, req)
    if (url.pathname === '/api/push' && req.method === 'DELETE') return unsubscribe(env, uid, req)
    return json({ error: 'Not found' }, 404)
  }
}

/** Worker entry (kept for `wrangler dev`); production runs the same handler as a Pages Function. */
export default {
  async fetch(req, env) {
    return new URL(req.url).pathname.startsWith('/api/') ? handleApi(req, env) : env.ASSETS.fetch(req)
  },
} satisfies ExportedHandler<Env>
