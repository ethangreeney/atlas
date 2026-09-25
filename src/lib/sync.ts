import { api, getAuth } from './auth'
import { db, type CardRow, type DayRow, type RevlogRow } from './db'

const PULL_KEY = 'atlas.sync.pulled2' // server clock of the last pull (v2: also pulls the review log)
const DELETED_KEY = 'atlas.sync.deleted' // undone reviews not yet deleted on the server
const OWNER_KEY = 'atlas.owner' // account whose progress is stored on this device; none = guest
const OVERLAP = 60_000 // re-pull this much before the last pull, for pushes that were still committing
const BATCH = 500 // rows per push request (the server takes up to 1000)
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
  for (const k of [PULL_KEY, DELETED_KEY, OWNER_KEY, 'atlas.sync.pushed']) localStorage.removeItem(k)
}

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

/** Bring down anything newer on the server. Returns true if local data changed. */
export async function pull(): Promise<boolean> {
  const r = (await api(`/api/sync?since=${Math.max(0, num(PULL_KEY) - OVERLAP)}`)) as {
    now: number
    cards: { id: string; data: CardRow; updated: number }[]
    days: { day: string; data: DayRow; updated: number }[]
    revlog?: { cardId: string; review: number; data: RevlogRow }[]
    deleted?: LogKey[]
  }
  const undone = pendingDeletes()
  let changed = false
  await db.transaction('rw', db.cards, db.days, db.revlog, async () => {
    for (const c of r.cards) {
      const local = await db.cards.get(c.id)
      if (!local || local.updated < c.updated) {
        await db.cards.put(reviveCard({ ...c.data, updated: c.updated }))
        changed = true
      }
    }
    for (const d of r.days) {
      const local = await db.days.get(d.day)
      // Only `extraNew` matters here (counters are derived from the log); keep the larger of the two.
      const extraNew = Math.max(local?.extraNew ?? 0, d.data.extraNew ?? 0)
      if (!local || local.extraNew !== extraNew) {
        await db.days.put({ ...(local ?? d.data), extraNew, updated: Math.max(local?.updated ?? 0, d.updated) })
        changed = true
      }
    }
    for (const l of r.revlog ?? []) {
      if (undone.some((k) => sameKey(k, l))) continue
      const review = new Date(l.review)
      const exists = await db.revlog.where('review').equals(review).filter((x) => x.cardId === l.cardId).count()
      if (exists) continue
      await db.revlog.add({ ...l.data, id: undefined, cardId: l.cardId, review, due: new Date(l.data.due) })
      changed = true
    }
    // Reviews undone on another device.
    for (const k of r.deleted ?? []) {
      if (await db.revlog.where('review').equals(new Date(k.review)).filter((x) => x.cardId === k.cardId).delete()) changed = true
    }
  })
  set(PULL_KEY, r.now)
  return changed
}

const unmark = (x: { dirty?: 1 }) => {
  delete x.dirty
}

/** Send everything written locally and not yet pushed, in requests of at most BATCH rows. */
export async function push() {
  if (!getAuth() || localStorage.getItem(OWNER_KEY) !== getAuth()!.user.id) return // syncNow claims local data first
  const [cards, days, revlog] = await db.transaction('r', db.cards, db.days, db.revlog, () =>
    Promise.all([db.cards.where('dirty').equals(1).toArray(), db.days.where('dirty').equals(1).toArray(), db.revlog.where('dirty').equals(1).toArray()]),
  )
  const deleted = pendingDeletes()
  while (cards.length || days.length || revlog.length || deleted.length) {
    let room = BATCH
    const take = <T>(a: T[]) => {
      const s = a.splice(0, room)
      room -= s.length
      return s
    }
    const [c, d, l, k] = [take(cards), take(days), take(revlog), take(deleted)]
    await api('/api/sync', {
      method: 'POST',
      body: JSON.stringify({
        cards: c.map((x) => ({ id: x.id, data: { ...x, dirty: undefined }, updated: x.updated })),
        days: d.map((x) => ({ day: x.day, data: { ...x, dirty: undefined }, updated: x.updated })),
        revlog: l.map((x) => ({ cardId: x.cardId, review: +new Date(x.review), data: { ...x, id: undefined, dirty: undefined } })),
        deleted: k,
      }),
    })
    // Only clear what was sent; a row written again since then stays dirty for the next push.
    const sent = new Map(c.map((x) => [x.id, x.updated]))
    const sentDays = new Map(d.map((x) => [x.day, x.updated]))
    await db.transaction('rw', db.cards, db.days, db.revlog, async () => {
      await db.cards.where('id').anyOf([...sent.keys()]).and((x) => sent.get(x.id) === x.updated).modify(unmark)
      await db.days.where('day').anyOf([...sentDays.keys()]).and((x) => sentDays.get(x.day) === x.updated).modify(unmark)
      await db.revlog.where('id').anyOf(l.map((x) => x.id!)).modify(unmark)
    })
    if (k.length) setPendingDeletes(pendingDeletes().filter((x) => !k.some((y) => sameKey(x, y))))
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

/** Push anything pending right now (before signing out). Returns false if it didn't get through. */
export async function flush() {
  if (timer) clearTimeout(timer)
  timer = null
  if (!getAuth()) return false
  return push().then(
    () => true,
    () => false,
  )
}

let syncing: Promise<boolean> | null = null
/** Full round trip: used on load and right after sign-in. Concurrent calls share one run. */
export function syncNow(): Promise<boolean> {
  if (!getAuth()) return Promise.resolve(false)
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
