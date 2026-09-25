/// <reference types="@cloudflare/workers-types" />
// Atlas daily reminders. Runs hourly (Pages Functions can't run cron) against the same D1 database as the site.
// Each browser that turned reminders on gets one payload-less Web Push a day, at its chosen local hour, unless its
// account has already studied that day. The service worker (public/push-sw.js) shows the notification text.

export interface Env {
  DB: D1Database
  /** base64url uncompressed P-256 point; the same key the client subscribes with (VITE_VAPID_PUBLIC_KEY). */
  VAPID_PUBLIC_KEY: string
  /** base64url private scalar `d`. Secret. */
  VAPID_PRIVATE_KEY: string
  VAPID_SUBJECT: string
}

type Sub = { user_id: string; endpoint: string; tz: string; hour: number; last_sent_day: string | null }

const ROLLOVER_HOURS = 4 // the app's day starts at 4am local (src/lib/scheduler.ts dayKey)
const WINDOW_HOURS = 3 // a reminder missed at its hour (a failed run, a busy push service) can still go out this late
const MAX_SENDS = 45 // stay under the subrequest limit per run; anyone left over is caught up next hour
const CONCURRENCY = 6
const TTL = 4 * 3600 // a reminder that can't be delivered within 4h isn't worth delivering

const enc = new TextEncoder()
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
const pad = (n: number) => String(n).padStart(2, '0')

/** Wall-clock time in `tz` at `ms`. */
function local(ms: number, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(ms)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), min: get('minute') }
}

/** Offset of `tz` from UTC at `ms`, in ms. */
const offset = (ms: number, tz: string) => {
  const l = local(ms, tz)
  return Date.UTC(l.y, l.m - 1, l.d, l.h, l.min) - Math.floor(ms / 60_000) * 60_000
}

/** The app's day key (4am rollover) in `tz`, and the UTC ms at which that day started. */
export function localDay(ms: number, tz: string) {
  const l = local(ms, tz)
  const day = new Date(Date.UTC(l.y, l.m - 1, l.d - (l.h < ROLLOVER_HOURS ? 1 : 0)))
  const key = `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`
  const wall = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), ROLLOVER_HOURS)
  let start = wall - offset(ms, tz)
  start = wall - offset(start, tz) // the offset at 4am, if daylight saving changed since
  return { key, start, hour: l.h }
}

/** Due if the local hour is within the window after the chosen hour, without crossing into the next app day. */
export function isDue(localHour: number, hour: number) {
  const since = (localHour - hour + 24) % 24
  if (since >= WINDOW_HOURS) return false
  const rel = (h: number) => (h - ROLLOVER_HOURS + 24) % 24 // hours since the day started
  return rel(localHour) >= rel(hour)
}

let signingKey: Promise<CryptoKey> | null = null
const importKey = (env: Env) => {
  const pub = fromB64url(env.VAPID_PUBLIC_KEY)
  signingKey ??= crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE_KEY, x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  return signingKey
}

/** VAPID (RFC 8292) JWT for one push service origin. WebCrypto's ECDSA signature is already JWS's r||s form. */
export async function vapidJwt(env: Env, aud: string, now: number) {
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64url(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT })))
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await importKey(env), enc.encode(`${header}.${claims}`))
  return `${header}.${claims}.${b64url(sig)}`
}

/** Has this account graded anything in the app day that started at `start`? Either sign counts. */
const studied = async (env: Env, uid: string, key: string, start: number) =>
  !!(await env.DB.prepare(
    `SELECT 1 FROM revlog WHERE user_id = ?1 AND review >= ?3
     UNION ALL SELECT 1 FROM days WHERE user_id = ?1 AND day = ?2
       AND coalesce(json_extract(data, '$.newCount'), 0) + coalesce(json_extract(data, '$.reviewCount'), 0) > 0
     LIMIT 1`,
  )
    .bind(uid, key, start)
    .first())

export async function run(env: Env, now: number) {
  const { results } = await env.DB.prepare('SELECT user_id, endpoint, tz, hour, last_sent_day FROM push_subs').all<Sub>()
  const due: (Sub & { day: string })[] = []
  const checked = new Map<string, boolean>()
  for (const s of results) {
    let day
    try {
      day = localDay(now, s.tz)
    } catch {
      continue // a time zone this runtime doesn't know
    }
    if (!isDue(day.hour, s.hour) || s.last_sent_day === day.key) continue
    const k = `${s.user_id}|${day.key}`
    if (!checked.has(k)) checked.set(k, await studied(env, s.user_id, day.key, day.start))
    if (!checked.get(k)) due.push({ ...s, day: day.key })
  }

  const jwts = new Map<string, Promise<string>>()
  const tally = { sent: 0, gone: 0, failed: 0, skipped: Math.max(0, due.length - MAX_SENDS) }
  const queue = due.slice(0, MAX_SENDS)
  const send = async (s: Sub & { day: string }) => {
    const aud = new URL(s.endpoint).origin
    if (!jwts.has(aud)) jwts.set(aud, vapidJwt(env, aud, now))
    try {
      const res = await fetch(s.endpoint, {
        method: 'POST',
        headers: { authorization: `vapid t=${await jwts.get(aud)}, k=${env.VAPID_PUBLIC_KEY}`, ttl: String(TTL), urgency: 'normal', 'content-length': '0' },
      })
      if (res.ok) {
        tally.sent++
        await env.DB.prepare('UPDATE push_subs SET last_sent_day = ?3 WHERE user_id = ?1 AND endpoint = ?2').bind(s.user_id, s.endpoint, s.day).run()
      } else if (res.status === 404 || res.status === 410) {
        // Unsubscribed or expired: this browser won't get pushes again.
        tally.gone++
        await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?1').bind(s.endpoint).run()
      } else {
        tally.failed++
        console.warn('push failed', res.status, aud, (await res.text()).slice(0, 200))
      }
    } catch (e) {
      tally.failed++
      console.warn('push error', aud, String(e))
    }
  }
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let s = queue.shift(); s; s = queue.shift()) await send(s)
    }),
  )
  console.log('reminders', { subs: results.length, due: due.length, ...tally })
  return tally
}

export default {
  scheduled(controller, env, ctx) {
    ctx.waitUntil(run(env, controller.scheduledTime))
  },
} satisfies ExportedHandler<Env>
