import { db } from './db'
import { dayKey } from './scheduler'

const pad = (n: number) => String(n).padStart(2, '0')
/** The day before a day key. Noon keeps it clear of the 4am rollover and daylight-saving shifts. */
const dayBefore = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  const t = new Date(y, m - 1, d - 1, 12)
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`
}

/**
 * Consecutive days (4am rollover) with at least one answer. Today counts once studied, and an unstudied today
 * doesn't break the run yet.
 */
export async function loadStreak(now = new Date()) {
  const days = new Set<string>()
  const reviews = await db.revlog.orderBy('review').keys()
  for (const r of reviews) days.add(dayKey(new Date(r as Date)))
  // Day rows too, in case the review log from another device hasn't arrived.
  for (const d of await db.days.toArray()) if (d.newCount + d.reviewCount > 0) days.add(d.day)
  let key = dayKey(now)
  if (!days.has(key)) key = dayBefore(key)
  let n = 0
  while (days.has(key)) {
    n++
    key = dayBefore(key)
  }
  return n
}
