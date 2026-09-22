import type { Card } from 'ts-fsrs'
import { api, getAuth } from './auth'
import { db, type CardRow, type DayRow, type RevlogRow } from './db'

const PULL_KEY = 'atlas.sync.pulled2' // server clock of the last pull (v2: also pulls the review log)
const PUSH_KEY = 'atlas.sync.pushed' // local `updated` high-water mark of the last push
const DELETED_KEY = 'atlas.sync.deleted' // undone reviews not yet deleted on the server
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

/** Bring down anything newer on the server. Returns true if local data changed. */
export async function pull(): Promise<boolean> {
  const r = (await api(`/api/sync?since=${num(PULL_KEY)}`)) as {
    now: number
    cards: { id: string; data: CardRow; updated: number }[]
    days: { day: string; data: DayRow; updated: number }[]
    revlog?: { cardId: string; review: number; data: RevlogRow }[]
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
  })
  set(PULL_KEY, r.now)
  return changed
}

/** Send everything written locally since the last push. */
export async function push() {
  const since = num(PUSH_KEY)
  const [cards, days, revlog] = await Promise.all([
    db.cards.where('updated').above(since).toArray(),
    db.days.where('updated').above(since).toArray(),
    db.revlog.where('review').above(new Date(since)).toArray(),
  ])
  const deleted = pendingDeletes()
  if (!cards.length && !days.length && !revlog.length && !deleted.length) return
  await api('/api/sync', {
    method: 'POST',
    body: JSON.stringify({
      cards: cards.map((c) => ({ id: c.id, data: c as Card, updated: c.updated })),
      days: days.map((d) => ({ day: d.day, data: d, updated: d.updated })),
      revlog: revlog.map((r: RevlogRow) => ({ cardId: r.cardId, review: +new Date(r.review), data: { ...r, id: undefined } })),
      deleted,
    }),
  })
  setPendingDeletes(pendingDeletes().filter((k) => !deleted.some((d) => sameKey(d, k))))
  const mark = Math.max(since, ...cards.map((c) => c.updated), ...days.map((d) => d.updated), ...revlog.map((r) => +new Date(r.review)))
  set(PUSH_KEY, mark)
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

/** Full round trip: used on load and right after sign-in. */
export async function syncNow() {
  if (!getAuth()) return false
  const changed = await pull()
  await push()
  return changed
}

export const resetSyncMarks = () => {
  localStorage.removeItem(PULL_KEY)
  localStorage.removeItem(PUSH_KEY)
  localStorage.removeItem(DELETED_KEY)
}
