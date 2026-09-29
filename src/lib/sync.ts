import { api, authChanged, getAuth, setBeforeSignIn } from './auth'
import { applyWeights, emptyDay, loadFitted, resetWeights, validWeights, type Fitted } from './scheduler'
import { db, type CardRow, type DayRow, type RevlogRow } from './db'

const PULL_KEY = 'atlas.sync.pulled2' // server clock of the last pull (v2: also pulls the review log)
const DELETED_KEY = 'atlas.sync.deleted' // undone reviews not yet deleted on the server
const OWNER_KEY = 'atlas.owner' // account whose progress is stored on this device; none = guest
const FIT_SENT_KEY = 'atlas.fsrs.sent' // when the fit in use here was made, once the server has it
const OVERLAP = 60_000 // re-pull this much before the last pull, for pushes that were still committing
const BATCH = 500 // rows per push request (the server takes up to 1000)
const KEEPALIVE_MAX = 60_000 // browsers cap a request that outlives its page at 64KB
const num = (k: string) => Number(localStorage.getItem(k) ?? 0)
const set = (k: string, v: number) => localStorage.setItem(k, String(v))

type LogKey = { cardId: string; review: number }
const pendingDeletes = (): LogKey[] => {
  try {
    return JSON.parse(localStorage.getItem(DELETED_KEY) ?? '[]')
  } catch {
    return []
  }
}
const setPendingDeletes = (v: LogKey[]) => localStorage.setItem(DELETED_KEY, JSON.stringify(v))
const sameKey = (a: LogKey, b: LogKey) => a.cardId === b.cardId && a.review === b.review
const isDate = (d: Date) => !Number.isNaN(+d)

/** An undo removed this review locally; remove it from the server on the next push too. */
export const recordUndo = (cardId: string, review: Date) => setPendingDeletes([...pendingDeletes(), { cardId, review: +review }])

const reviveCard = (c: CardRow): CardRow => ({
  ...c,
  due: new Date(c.due),
  last_review: c.last_review ? new Date(c.last_review) : undefined,
})

/** Forget all progress on this device (sign-out, or another account signing in). */
export async function clearLocal() {
  await db.transaction('rw', db.cards, db.days, db.revlog, () => Promise.all([db.cards.clear(), db.days.clear(), db.revlog.clear()]))
  for (const k of [PULL_KEY, DELETED_KEY, OWNER_KEY, FIT_SENT_KEY, 'atlas.sync.pushed']) localStorage.removeItem(k)
  resetWeights()
}

// Another tab cleared this device's progress or handed it to another account, so this tab's copy in memory is gone
// too. (Its sign-in or sign-out has usually reloaded this tab already; see auth.)
window.addEventListener('storage', (e) => {
  if (e.key === OWNER_KEY && e.oldValue && e.oldValue !== e.newValue) location.reload()
})

// Signing in as a different account drops what the last one left here (see own). If some of it never reached that
// account (its session ran out, say, and answers carried on as a guest), ask rather than lose it quietly.
setBeforeSignIn(async (uid) => {
  const owner = localStorage.getItem(OWNER_KEY)
  if (!owner || owner === uid) return true
  const unsynced = (await db.cards.where('dirty').equals(1).count()) + (await db.revlog.where('dirty').equals(1).count()) + pendingDeletes().length
  return !unsynced || confirm("Some answers on this device haven't synced to the account signed in here before, and signing in with a different one will remove them. Sign in anyway?")
})

/**
 * Tie local progress to the signed-in account. Guest progress merges into the first account; progress left by a
 * different account is dropped rather than merged. Returns true if local data was cleared.
 */
async function own() {
  const uid = getAuth()!.user.id
  const owner = localStorage.getItem(OWNER_KEY)
  if (owner === uid) return false
  if (owner) await clearLocal()
  localStorage.setItem(OWNER_KEY, uid)
  return !!owner
}

/** Whether fit `a` should replace fit `b`: the one that learned from more reviews, or as many and made later (as the server decides). */
const betterFit = (a: Fitted, b: Fitted | null) => !b || a.reviews > b.reviews || (a.reviews === b.reviews && a.at > b.at)
/** The fit in use here, if the server doesn't have it yet. */
const unsentFit = () => {
  const f = loadFitted()
  return f && num(FIT_SENT_KEY) !== f.at ? f : null
}

/** Switch to the account's stored fit if it beats the one in use here. */
function adoptFit(f: Fitted | null | undefined) {
  if (f && validWeights(f.w) && Number.isSafeInteger(f.reviews) && Number.isSafeInteger(f.at) && betterFit(f, loadFitted())) {
    applyWeights({ w: f.w, at: f.at, reviews: f.reviews })
    set(FIT_SENT_KEY, f.at)
  }
}

/** Bring down anything newer on the server. Returns true if local data changed. */
export async function pull(): Promise<boolean> {
  const uid = getAuth()!.user.id
  const r = (await api(`/api/sync?since=${Math.max(0, num(PULL_KEY) - OVERLAP)}`)) as {
    now: number
    cards: { id: string; data: CardRow; updated: number }[]
    days: { day: string; data: DayRow; updated: number }[]
    revlog?: { cardId: string; review: number; data: RevlogRow }[]
    deleted?: LogKey[]
    params?: Fitted | null
  }
  const undone = pendingDeletes()
  let changed = false
  await db.transaction('rw', db.cards, db.days, db.revlog, async () => {
    // Another tab switched accounts while this was in flight: these rows aren't this device's to keep any more.
    if (authChanged() || localStorage.getItem(OWNER_KEY) !== uid) throw new Error('Account changed')
    // One bad row (an impossible date, say) is skipped, rather than failing this pull and every one after it.
    const each = async <T>(rows: T[] | undefined, f: (x: T) => Promise<void>) => {
      for (const x of rows ?? []) await f(x).catch(() => {})
    }
    await each(r.cards, async (c) => {
      const local = await db.cards.get(c.id)
      const row = reviveCard({ ...c.data, id: c.id, updated: c.updated })
      if ((!local || local.updated < c.updated) && isDate(row.due)) {
        await db.cards.put(row)
        changed = true
      }
    })
    await each(r.days, async (d) => {
      const local = await db.days.get(d.day)
      // Only `extraNew` matters here (counters are derived from the log); keep the larger of the two.
      const extraNew = Math.max(local?.extraNew ?? 0, d.data.extraNew ?? 0)
      if (!local || local.extraNew !== extraNew) {
        // The server keeps just `extraNew` now, so a day new to this device starts from an empty row.
        await db.days.put({ ...emptyDay(d.day), ...(local ?? d.data), day: d.day, extraNew, updated: Math.max(local?.updated ?? 0, d.updated) })
        changed = true
      }
    })
    await each(r.revlog, async (l) => {
      const review = new Date(l.review)
      if (!isDate(review) || undone.some((k) => sameKey(k, l))) return
      const exists = await db.revlog.where('review').equals(review).filter((x) => x.cardId === l.cardId).count()
      if (exists) return
      await db.revlog.add({ ...l.data, id: undefined, cardId: l.cardId, review, due: new Date(l.data.due) })
      changed = true
    })
    // Reviews undone on another device.
    await each(r.deleted, async (k) => {
      if (await db.revlog.where('review').equals(new Date(k.review)).filter((x) => x.cardId === k.cardId).delete()) changed = true
    })
  })
  // Weights fitted on another device: use them here too if they learned from more, so both schedule alike. Cards keep
  // their dates; the next answer uses the new weights.
  adoptFit(r.params)
  set(PULL_KEY, r.now)
  return changed
}

const unmark = (x: { dirty?: 1 }) => {
  delete x.dirty
}

type Rejected = Partial<Record<'cards' | 'days' | 'revlog' | 'deleted' | 'params', number[]>>

/**
 * Send everything written locally and not yet pushed, in requests of at most BATCH rows. Throws if something is
 * waiting that can't be sent under this account. `leaving`: the page is being hidden or closed.
 */
export async function push(leaving = false) {
  const [cards, days, revlog] = await db.transaction('r', db.cards, db.days, db.revlog, () =>
    Promise.all([db.cards.where('dirty').equals(1).toArray(), db.days.where('dirty').equals(1).toArray(), db.revlog.where('dirty').equals(1).toArray()]),
  )
  const deleted = pendingDeletes()
  let fit = unsentFit()
  if (!cards.length && !days.length && !revlog.length && !deleted.length && !fit) return
  // Another tab signed in or out, or syncNow hasn't claimed local data for this account yet. Failing, rather than
  // quietly skipping, lets a sign-out warn that it's unsent.
  const auth = getAuth()
  if (!auth || authChanged() || localStorage.getItem(OWNER_KEY) !== auth.user.id) throw new Error('Not synced')
  while (cards.length || days.length || revlog.length || deleted.length || fit) {
    let room = BATCH
    const take = <T>(a: T[]) => {
      const s = a.splice(0, room)
      room -= s.length
      return s
    }
    const [c, d, l, k] = [take(cards), take(days), take(revlog), take(deleted)]
    const body = JSON.stringify({
      cards: c.map((x) => ({ id: x.id, data: { ...x, dirty: undefined }, updated: x.updated })),
      // Only `extraNew` is kept for a day; the counters are derived from the log.
      days: d.map((x) => ({ day: x.day, data: { day: x.day, extraNew: x.extraNew }, updated: x.updated })),
      revlog: l.map((x) => ({ cardId: x.cardId, review: +new Date(x.review), data: { ...x, id: undefined, dirty: undefined } })),
      deleted: k,
      // The fit goes with the first request.
      params: fit ? { data: fit, updated: fit.at } : undefined,
    })
    const sentFit = fit
    fit = null
    // Keepalive lets the request finish after the page has gone, but only up to 64KB; past that it's best effort.
    const res = (await api('/api/sync', { method: 'POST', body, keepalive: leaving && body.length < KEEPALIVE_MAX })) as {
      rejected?: Rejected
      cap?: number
      params?: Fitted
    }
    // Rows the server refused (an out-of-range time, say) stay pending to go again, rather than count as sent.
    const no = res.rejected ?? {}
    const kept = <T>(rows: T[], skip: number[] = []) => rows.filter((_, i) => !skip.includes(i))
    const [sc, sd, sl, sk] = [kept(c, no.cards), kept(d, no.days), kept(l, no.revlog), kept(k, no.deleted)]
    // Only clear what was sent; a row written again since then stays dirty for the next push.
    const sent = new Map(sc.map((x) => [x.id, x.updated]))
    const sentDays = new Map(sd.map((x) => [x.day, x.updated]))
    const cap = res.cap ?? Infinity
    await db.transaction('rw', db.cards, db.days, db.revlog, async () => {
      // The server stores a fast clock's times as `cap`. Hold the same here, so the next pull compares like for like.
      await db.cards
        .where('id')
        .anyOf([...sent.keys()])
        .and((x) => sent.get(x.id) === x.updated)
        .modify((x) => {
          unmark(x)
          x.updated = Math.min(x.updated, cap)
        })
      await db.days.where('day').anyOf([...sentDays.keys()]).and((x) => sentDays.get(x.day) === x.updated).modify(unmark)
      await db.revlog.where('id').anyOf(sl.map((x) => x.id!)).modify(unmark)
    })
    if (sk.length) setPendingDeletes(pendingDeletes().filter((x) => !sk.some((y) => sameKey(x, y))))
    // Sent, whether or not it beat the one stored; if it didn't, use that one instead.
    if (sentFit && !no.params?.length) set(FIT_SENT_KEY, sentFit.at)
    adoptFit(res.params)
  }
}

let timer: ReturnType<typeof setTimeout> | null = null
/** Debounced push after a grade. */
export function schedulePush() {
  if (!getAuth()) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    push().catch(() => {})
  }, 1500)
}

/** The page is being hidden or closed: send what the debounce is holding now, while requests can still go out. */
export function pushNow() {
  if (!timer) return
  clearTimeout(timer)
  timer = null
  push(true).catch(() => {})
}

/** Push anything pending right now (before signing out). Returns false if it didn't get through. */
export async function flush() {
  if (timer) clearTimeout(timer)
  timer = null
  if (!getAuth()) return false
  try {
    await push()
  } catch {
    return false
  }
  // Rows the server refused are still waiting, so this didn't get everything through either.
  const waiting = await db.transaction('r', db.cards, db.days, db.revlog, () =>
    Promise.all([db.cards, db.days, db.revlog].map((t) => t.where('dirty').equals(1).count())),
  )
  return !waiting.some(Boolean) && !pendingDeletes().length
}

let syncing: Promise<boolean> | null = null
/** Full round trip: used on load and right after sign-in. Concurrent calls share one run. */
export function syncNow(): Promise<boolean> {
  // Signed out, or another tab switched accounts and this one is about to reload (see auth).
  if (!getAuth() || authChanged()) return Promise.resolve(false)
  syncing ??= (async () => {
    const cleared = await own()
    try {
      const changed = await pull()
      await push()
      return changed || cleared
    } catch (e) {
      if (cleared) return true // still reload the emptied state
      throw e
    }
  })().finally(() => {
    syncing = null
  })
  return syncing
}
