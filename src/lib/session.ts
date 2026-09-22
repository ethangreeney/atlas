import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { State, type Grade } from 'ts-fsrs'
import { db, type CardRow, type DayRow } from './db'
import { ALL_CARDS, type DeckCard } from './deck'
import { becomesLeech, buildQueue, dayKey, emptyDay, freshRow, scheduler, type Queue } from './scheduler'
import { useSettings } from './settings'

type Undo = { row: CardRow | undefined; day: DayRow; logId: number; cardId: string }

export function useSession() {
  const settings = useSettings()
  const rows = useRef(new Map<string, CardRow>())
  const [day, setDay] = useState<DayRow | null>(null)
  const [tick, setTick] = useState(0)
  const [undo, setUndo] = useState<Undo | null>(null)
  /** Card pinned to the front of the queue after an undo. */
  const pinned = useRef<string | null>(null)

  const loadDay = useCallback(async (now: Date) => {
    const key = dayKey(now)
    const existing = await db.days.get(key)
    const d = existing ?? emptyDay(key)
    setDay(d)
    return d
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const all = await db.cards.toArray()
      if (cancelled) return
      rows.current = new Map(all.map((r) => [r.id, r]))
      await loadDay(new Date())
    })()
    return () => {
      cancelled = true
    }
  }, [loadDay])

  // Roll the day over if the tab was left open past 4am.
  useEffect(() => {
    const check = () => {
      if (day && dayKey(new Date()) !== day.day) void loadDay(new Date())
      setTick((t) => t + 1)
    }
    document.addEventListener('visibilitychange', check)
    return () => document.removeEventListener('visibilitychange', check)
  }, [day, loadDay])

  const queue: Queue | null = useMemo(() => {
    if (!day) return null
    const q = buildQueue(new Date(), rows.current, settings, day)
    if (pinned.current) {
      const c = ALL_CARDS.find((x) => x.id === pinned.current)
      if (c) return { ...q, current: c }
    }
    return q
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, settings, tick])

  // Wake up when the next learning card becomes due.
  useEffect(() => {
    if (!queue?.nextLearningAt) return
    const ms = Math.max(250, +queue.nextLearningAt - Date.now() + 50)
    const t = setTimeout(() => setTick((x) => x + 1), ms)
    return () => clearTimeout(t)
  }, [queue?.nextLearningAt])

  const currentRow = useMemo(
    () => (queue?.current ? (rows.current.get(queue.current.id) ?? freshRow(queue.current, new Date())) : null),
    [queue],
  )

  const grade = useCallback(
    async (card: DeckCard, g: Grade) => {
      if (!day) return
      const now = new Date()
      const d = dayKey(now) === day.day ? day : await loadDay(now)
      const before = rows.current.get(card.id)
      const prev = before ?? freshRow(card, now)
      const { card: next, log } = scheduler.next(prev, now, g)
      const row: CardRow = { ...next, id: card.id, noteId: card.note.id, leech: before?.leech || becomesLeech(g, next.lapses) }

      const nd: DayRow = {
        ...d,
        newCount: d.newCount + (prev.state === State.New ? 1 : 0),
        reviewCount: d.reviewCount + (prev.state === State.Review ? 1 : 0),
        seenNotes: d.seenNotes.includes(card.note.id) ? d.seenNotes : [...d.seenNotes, card.note.id],
        grades: d.grades.map((n, i) => n + (i === g - 1 ? 1 : 0)) as DayRow['grades'],
      }

      rows.current.set(card.id, row)
      pinned.current = null
      setDay(nd)
      const logId = await db.transaction('rw', db.cards, db.revlog, db.days, async () => {
        await db.cards.put(row)
        await db.days.put(nd)
        return (await db.revlog.add({ ...log, cardId: card.id })) as number
      })
      setUndo({ row: before, day: d, logId, cardId: card.id })
    },
    [day, loadDay],
  )

  const undoLast = useCallback(async () => {
    if (!undo) return
    if (undo.row) rows.current.set(undo.cardId, undo.row)
    else rows.current.delete(undo.cardId)
    pinned.current = undo.cardId
    setDay(undo.day)
    setUndo(null)
    await db.transaction('rw', db.cards, db.revlog, db.days, async () => {
      if (undo.row) await db.cards.put(undo.row)
      else await db.cards.delete(undo.cardId)
      await db.days.put(undo.day)
      await db.revlog.delete(undo.logId)
    })
  }, [undo])

  const learnMore = useCallback(
    async (n = 20) => {
      if (!day) return
      const nd = { ...day, extraNew: day.extraNew + n }
      setDay(nd)
      await db.days.put(nd)
    },
    [day],
  )

  const refresh = useCallback(() => setTick((t) => t + 1), [])

  return { ready: !!day, queue, day, currentRow, grade, undo: undoLast, canUndo: !!undo, learnMore, refresh }
}
