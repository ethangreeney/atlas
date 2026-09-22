/// <reference types="@cloudflare/workers-types" />
// Atlas API: Google sign-in and sync. Cards are last-write-wins, the review log is append-only (undo deletes),
// and day rows only carry `extraNew`, merged by max. Every row records `synced` (server receipt time) so a pull
// with `since` catches rows that were written offline and pushed late.

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
  const [cards, days, revlog] = await Promise.all([
    env.DB.prepare('SELECT id, data, updated FROM cards WHERE user_id = ?1 AND synced > ?2').bind(uid, since).all<{ id: string; data: string; updated: number }>(),
    env.DB.prepare('SELECT day, data, updated FROM days WHERE user_id = ?1 AND synced > ?2').bind(uid, since).all<{ day: string; data: string; updated: number }>(),
    env.DB.prepare('SELECT card_id, review, data FROM revlog WHERE user_id = ?1 AND synced > ?2').bind(uid, since).all<{ card_id: string; review: number; data: string }>(),
  ])
  return json({
    now,
    cards: cards.results.map((r) => ({ id: r.id, data: JSON.parse(r.data), updated: r.updated })),
    days: days.results.map((r) => ({ day: r.day, data: JSON.parse(r.data), updated: r.updated })),
    revlog: revlog.results.map((r) => ({ cardId: r.card_id, review: r.review, data: JSON.parse(r.data) })),
  })
}

async function push(env: Env, uid: string, req: Request) {
  const body = (await req.json()) as { cards?: Row[]; days?: DayRowIn[]; revlog?: RevlogIn[]; deleted?: RevlogKey[] }
  const now = Date.now()
  const stmts: D1PreparedStatement[] = []
  const upCard = env.DB.prepare(
    'INSERT INTO cards (user_id, id, data, updated, synced) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(user_id, id) DO UPDATE SET data = excluded.data, updated = excluded.updated, synced = excluded.synced WHERE excluded.updated > cards.updated',
  )
  // Day rows: keep the larger `extraNew` from either side; the other counters are derived from the log on each device.
  const upDay = env.DB.prepare(
    "INSERT INTO days (user_id, day, data, updated, synced) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(user_id, day) DO UPDATE SET data = json_set(excluded.data, '$.extraNew', max(coalesce(json_extract(excluded.data, '$.extraNew'), 0), coalesce(json_extract(days.data, '$.extraNew'), 0))), updated = max(excluded.updated, days.updated), synced = excluded.synced",
  )
  const upLog = env.DB.prepare('INSERT OR IGNORE INTO revlog (user_id, card_id, review, data, synced) VALUES (?1, ?2, ?3, ?4, ?5)')
  const delLog = env.DB.prepare('DELETE FROM revlog WHERE user_id = ?1 AND card_id = ?2 AND review = ?3')
  for (const c of body.cards ?? []) stmts.push(upCard.bind(uid, c.id, JSON.stringify(c.data), c.updated, now))
  for (const d of body.days ?? []) stmts.push(upDay.bind(uid, d.day, JSON.stringify(d.data), d.updated, now))
  for (const r of body.revlog ?? []) stmts.push(upLog.bind(uid, r.cardId, r.review, JSON.stringify(r.data), now))
  for (const k of body.deleted ?? []) stmts.push(delLog.bind(uid, k.cardId, k.review))
  // D1 batches are limited in size; chunk them.
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100))
  return json({ ok: true, count: stmts.length })
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
    if (url.pathname === '/api/sync' && req.method === 'GET') return pull(env, uid, Number(url.searchParams.get('since') ?? 0))
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
