// Local end-to-end test for the reminders worker: `pnpm test:reminders`.
// Seeds a throwaway local D1 with subscriptions pointing at a fake push service on localhost, fires the cron at a
// fixed time with `wrangler dev --test-scheduled` (/cdn-cgi/handler/scheduled?time=), then checks who got a push,
// the VAPID headers and JWT, and the D1 bookkeeping.
// Needs reminders/.dev.vars with VAPID_PRIVATE_KEY. Touches nothing remote.
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const state = join(here, '.wrangler', 'test-state')
const config = join(here, 'wrangler.jsonc')
const PUSH_PORT = 9911
const WORKER_PORT = 8799
const PUSH = `http://127.0.0.1:${PUSH_PORT}`
const T = Date.UTC(2026, 8, 25, 19, 0) // Fri 25 Sep 2026, 19:00 UTC = Sat 26 Sep 07:00 in Auckland (UTC+12)
const H = 3_600_000

const wrangler = (...args) => execFileSync('npx', ['wrangler', ...args, '-c', config, '--persist-to', state], { cwd: here, stdio: 'pipe' }).toString()
const sql = (q) => JSON.parse(wrangler('d1', 'execute', 'atlas', '--local', '--json', '--command', q))[0].results

// A fake push service: /ok/* accepts, /gone/* says the subscription expired.
const received = []
const server = createServer((req, res) => {
  received.push({ path: req.url, method: req.method, headers: req.headers })
  res.writeHead(req.url.startsWith('/gone/') ? 410 : 201).end()
})
await new Promise((r) => server.listen(PUSH_PORT, '127.0.0.1', r))

rmSync(state, { recursive: true, force: true })
wrangler('d1', 'migrations', 'apply', 'atlas', '--local')
const sub = (user, path, tz, hour, last = null) =>
  `INSERT INTO push_subs VALUES ('${user}', '${PUSH}${path}', 'p', 'a', '${tz}', ${hour}, ${last ? `'${last}'` : 'NULL'}, 0);`
const seed = [
  sub('due', '/ok/due', 'UTC', 19), // due now; only studied yesterday (03:00 is before the 4am rollover)
  `INSERT INTO revlog VALUES ('due', 'x', ${T - 16 * H}, '{}', 0);`,
  sub('reviewed', '/ok/reviewed', 'UTC', 19), // graded an hour ago
  `INSERT INTO revlog VALUES ('reviewed', 'x', ${T - H}, '{}', 0);`,
  sub('dayrow', '/ok/dayrow', 'UTC', 19), // today's day row has counts
  `INSERT INTO days VALUES ('dayrow', '2026-09-25', '{"newCount":3,"reviewCount":0,"extraNew":0}', 0, 0);`,
  sub('learnmore', '/ok/learnmore', 'UTC', 18), // day row but only extraNew, and caught up an hour late
  `INSERT INTO days VALUES ('learnmore', '2026-09-25', '{"newCount":0,"reviewCount":0,"extraNew":20}', 0, 0);`,
  sub('sent', '/ok/sent', 'UTC', 18, '2026-09-25'), // already reminded today
  sub('expired', '/gone/expired', 'UTC', 19), // push service says 410
  sub('nz', '/ok/nz', 'Pacific/Auckland', 7), // 07:00 Saturday there; studied at 03:00, which still counts as Friday
  `INSERT INTO revlog VALUES ('nz', 'x', ${T - 4 * H}, '{}', 0);`,
  sub('ny', '/ok/ny', 'America/New_York', 19), // 15:00 there
  sub('late', '/ok/late', 'UTC', 16), // window is 3 hours
  sub('night', '/ok/night', 'UTC', 3), // would be tomorrow's reminder
].join('\n')
writeFileSync(join(state, 'seed.sql'), seed)
wrangler('d1', 'execute', 'atlas', '--local', '--file', join(state, 'seed.sql'))

const dev = spawn('npx', ['wrangler', 'dev', '-c', config, '--test-scheduled', '--port', String(WORKER_PORT), '--persist-to', state], {
  cwd: here,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
dev.stdout.on('data', (d) => (log += d))
dev.stderr.on('data', (d) => (log += d))
const stop = () => {
  dev.kill()
  server.close()
}

try {
  const fire = async () => {
    for (let i = 0; i < 60; i++) {
      const r = await fetch(`http://127.0.0.1:${WORKER_PORT}/cdn-cgi/handler/scheduled?cron=0+*+*+*+*&time=${T}`).catch(() => null)
      if (r?.ok) return
      await new Promise((r) => setTimeout(r, 500))
    }
    throw new Error(`wrangler dev did not start:\n${log}`)
  }
  await fire()
  await new Promise((r) => setTimeout(r, 1500)) // waitUntil

  const paths = received.map((r) => r.path).sort()
  assert.deepEqual(paths, ['/gone/expired', '/ok/due', '/ok/learnmore', '/ok/nz'], 'pushed to exactly the due subscriptions')

  const PUB = readFileSync(config, 'utf8').match(/"VAPID_PUBLIC_KEY": "([^"]+)"/)[1]
  const verifyKey = await crypto.subtle.importKey('raw', Buffer.from(PUB, 'base64url'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  for (const r of received) {
    assert.equal(r.method, 'POST')
    assert.equal(r.headers.ttl, '14400')
    assert.equal(r.headers.urgency, 'normal')
    assert.equal(r.headers['content-length'], '0', 'no payload')
    const m = /^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/.exec(r.headers.authorization)
    assert.ok(m, `vapid authorization header: ${r.headers.authorization}`)
    assert.equal(m[2], PUB)
    const [h, c, s] = m[1].split('.')
    const header = JSON.parse(Buffer.from(h, 'base64url'))
    const claims = JSON.parse(Buffer.from(c, 'base64url'))
    assert.deepEqual(header, { typ: 'JWT', alg: 'ES256' })
    assert.equal(claims.aud, PUSH, 'aud is the push service origin')
    assert.equal(claims.sub, 'mailto:ethan@greene.nz')
    assert.ok(claims.exp > T / 1000 && claims.exp <= T / 1000 + 24 * 3600, 'exp within 24h')
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, Buffer.from(s, 'base64url'), Buffer.from(`${h}.${c}`))
    assert.ok(ok, 'JWT signature verifies with the public key')
  }

  const rows = Object.fromEntries(sql('SELECT user_id, last_sent_day FROM push_subs').map((r) => [r.user_id, r.last_sent_day]))
  assert.equal(rows.due, '2026-09-25')
  assert.equal(rows.learnmore, '2026-09-25')
  assert.equal(rows.nz, '2026-09-26', 'local day in Auckland')
  assert.equal(rows.sent, '2026-09-25')
  assert.equal(rows.reviewed, null)
  assert.equal(rows.dayrow, null)
  assert.ok(!('expired' in rows), '410 deletes the subscription')

  // Same hour again: everyone's been reminded or skipped, nothing more goes out.
  received.length = 0
  await fire()
  await new Promise((r) => setTimeout(r, 1500))
  assert.deepEqual(received, [], 'at most one reminder a day')

  console.log('reminders: all checks passed')
} catch (e) {
  console.error(e.message ?? e)
  console.error(log.split('\n').slice(-30).join('\n'))
  process.exitCode = 1
} finally {
  stop()
}
