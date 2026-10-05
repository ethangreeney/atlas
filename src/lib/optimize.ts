import { db, type RevlogRow } from './db'
import type { FitRequest } from './optimize.worker'
import { applyWeights, dayNumber, loadFitted, State, validWeights } from './scheduler'
import { schedulePush } from './sync'

/** Below this the optimizer mostly hands back the defaults it started from. */
const MIN_REVIEWS = 400
/** Refit once the log has grown by a quarter, or a month has passed with anything new. */
const GROWTH = 1.25
const REFIT_MS = 30 * 86_400_000

/**
 * Every card's history as FSRS training items: each prefix of two or more reviews, starting from the first answer
 * and spanning at least one day.
 * Cards whose log doesn't start at a new-card answer (history from before the log was kept) are left out.
 */
export function trainingItems(logs: RevlogRow[]): FitRequest {
  const byCard = new Map<string, RevlogRow[]>()
  for (const l of logs) if (l.rating >= 1 && l.rating <= 4) byCard.set(l.cardId, [...(byCard.get(l.cardId) ?? []), l])
  const ratings: number[] = []
  const deltas: number[] = []
  const lengths: number[] = []
  for (const list of byCard.values()) {
    list.sort((a, b) => +a.review - +b.review)
    if (list[0].state !== State.New || list.length < 2) continue
    const days = list.map((l) => dayNumber(new Date(l.review)))
    for (let k = 2; k <= list.length; k++) {
      // The optimizer needs at least one gap of a day or more; a card only ever seen on its first day teaches it nothing yet.
      if (days[k - 1] === days[0]) continue
      lengths.push(k)
      for (let j = 0; j < k; j++) {
        ratings.push(list[j].rating)
        deltas.push(j === 0 ? 0 : days[j] - days[j - 1])
      }
    }
  }
  return { ratings: new Uint32Array(ratings), deltas: new Uint32Array(deltas), lengths: new Uint32Array(lengths) }
}

let running = false
/**
 * Fit FSRS to this learner's own answers when there's enough history and it's due a refit. Quiet: runs in a worker,
 * and on any failure (an old browser, no WebAssembly) scheduling just keeps the weights it has.
 */
export async function maybeOptimize() {
  if (running || typeof Worker === 'undefined') return
  const reviews = await db.revlog.count()
  const last = loadFitted()
  if (reviews < MIN_REVIEWS) return
  if (last && reviews < last.reviews * GROWTH && !(Date.now() - last.at > REFIT_MS && reviews > last.reviews)) return
  running = true
  try {
    const items = trainingItems(await db.revlog.toArray())
    if (!items.lengths.length) return
    const worker = new Worker(new URL('./optimize.worker.ts', import.meta.url), { type: 'module' })
    const w = await new Promise<number[] | null>((resolve) => {
      worker.onmessage = (e: MessageEvent<{ w?: number[] }>) => resolve(e.data.w ?? null)
      worker.onerror = () => resolve(null)
      worker.postMessage(items, [items.ratings.buffer, items.deltas.buffer, items.lengths.buffer])
    })
    worker.terminate()
    // Only if nothing better arrived from another device while this one was fitting.
    const now = loadFitted()
    if (validWeights(w) && (!now || reviews > now.reviews)) {
      applyWeights({ w, at: Date.now(), reviews })
      schedulePush() // so the account's other devices use it too
    }
  } finally {
    running = false
  }
}
