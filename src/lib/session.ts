import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { State, type Grade } from 'ts-fsrs'
import { db, type CardRow, type DayRow } from './db'
import { CARD_BY_ID, type DeckCard } from './deck'
import { becomesLeech, buildQueue, dayEnd, dayKey, emptyDay, freshRow, matchesFilters, scheduler, type Queue } from './scheduler'
import { useSettings } from './settings'
import { recordUndo, schedulePush } from './sync'

/** A card marked "I know this" comes back in 30 to 60 days. */
const KNOWN_DAYS = 30

type Undo = { row: CardRow | undefined; day: DayRow; logId: number; cardId: string; review: Date }

export function useSession() {
  const settings = useSettings()
  const rows = useRef(new Map<string, CardRow>())
  const [day, setDay] = useState<DayRow | null>(null)
  const [tick, setTick] = useState(0)
  const [undo, setUndo] = useState<Undo | null>(null)
  /** An IndexedDB read or write failed: progress shown may not be saved. */
  const [saveError, setSaveError] = useState(false)
  /** Card pinned to the front of the queue after an undo. */
  const pinned = useRef<string | null>(null)
  /**
   * The card on screen stays there until it's answered. Without this, coming back to the tab could swap it
   * for a learning card that fell due in the meantime, mid-view and already flipped.
   */
  const shown = useRef<{ id: string; at: number } | null>(null)
  /**
   * A short run over chosen cards (the hardest ones), whether due or not. Each is answered once through the normal
   * grade path, so FSRS sees an ordinary early review; the run ends when none are left, or on exit.
   */
  const [drill, setDrill] = useState<{ ids: string[]; left: string[] } | null>(null)

  /**
   * Today's counters come from the review log, not the stored day row, so progress made on two devices
   * (or before signing in) adds up instead of one copy replacing the other. The row only keeps `extraNew`.
   */
  const loadDay = useCallback(async (now: Date) => {
    const key = dayKey(now)
    const stored = await db.days.get(key)
    const d = emptyDay(key)
    d.extraNew = stored?.extraNew ?? 0
    d.updated = stored?.updated ?? 0
    const start = dayEnd(now)
    start.setDate(start.getDate() - 1)
    const logs = await db.revlog.where('review').aboveOrEqual(start).toArray()
    const seen = new Set<string>()
    for (const l of logs) {
      if (dayKey(new Date(l.review)) !== key) continue
      if (l.state === State.New && !l.known) d.newCount++
      else if (l.state === State.Review) d.reviewCount++
      if (l.rating >= 1 && l.rating <= 4) d.grades[l.rating - 1]++
      const note = CARD_BY_ID.get(l.cardId)?.note.id
      if (note) seen.add(note)
    }
    d.seenNotes = [...seen]
    setDay(d)
    return d
  }, [])

  useEffect(() => {
    let cancelled = false
    // Ask to keep storage from being evicted (Safari clears idle sites after 7 days). Firefox would show a prompt, so skip it there.
    if (!navigator.userAgent.includes('Firefox')) void navigator.storage?.persisted?.().then((p) => p || navigator.storage.persist()).catch(() => {})
    ;(async () => {
      try {
        const all = await db.cards.toArray()
        if (cancelled) return
        rows.current = new Map(all.map((r) => [r.id, r]))
        await loadDay(new Date())
      } catch {
        if (cancelled) return
        setSaveError(true)
        setDay(emptyDay(dayKey(new Date())))
      }
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
    if (drill) {
      const c = CARD_BY_ID.get(pinned.current ?? drill.left[0])
      shown.current = null
      if (c) return { ...q, current: c, nextLearningAt: null, total: drill.ids.length, done: drill.ids.length - drill.left.length }
    }
    if (pinned.current) {
      const c = CARD_BY_ID.get(pinned.current)
      if (c) {
        shown.current = { id: c.id, at: Date.now() }
        return { ...q, current: c }
      }
    }
    const keep = shown.current
    if (keep && q.current?.id !== keep.id) {
      const c = CARD_BY_ID.get(keep.id)
      const untouched = (rows.current.get(keep.id)?.updated ?? 0) <= keep.at
      if (c && untouched && matchesFilters(c, settings)) return { ...q, current: c }
    }
    shown.current = q.current ? { id: q.current.id, at: keep?.id === q.current.id ? keep.at : Date.now() } : null
    return q
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, settings, tick, drill])

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

  /** Cards answered at least once, ever. */
  const learned = useMemo(() => {
    let n = 0
    for (const r of rows.current.values()) if (r.state !== State.New) n++
    return n
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue])

  const grade = useCallback(
    /** `known`: skipped with "I know this". Scheduled well out and free of the day's new-card limit. */
    async (card: DeckCard, g: Grade, known = false) => {
      if (!day) return
      const now = new Date()
      let d = day
      try {
        if (dayKey(now) !== day.day) d = await loadDay(now)
      } catch {
        setSaveError(true)
        d = emptyDay(dayKey(now))
      }
      const before = rows.current.get(card.id)
      const prev = before ?? freshRow(card, now)
      let { card: next, log } = scheduler.next(prev, now, g)
      if (known) {
        const days = KNOWN_DAYS + Math.round(Math.random() * KNOWN_DAYS)
        next = { ...next, stability: Math.max(next.stability, days), scheduled_days: days, due: new Date(+now + days * 86_400_000) }
        log = { ...log, scheduled_days: days }
      }
      const row: CardRow = {
        ...next,
        id: card.id,
        noteId: card.note.id,
        leech: before?.leech || becomesLeech(g, next.lapses),
        updated: +now,
        dirty: 1,
      }

      const nd: DayRow = {
        ...d,
        newCount: d.newCount + (prev.state === State.New && !known ? 1 : 0),
        reviewCount: d.reviewCount + (prev.state === State.Review ? 1 : 0),
        seenNotes: d.seenNotes.includes(card.note.id) ? d.seenNotes : [...d.seenNotes, card.note.id],
        grades: d.grades.map((n, i) => n + (i === g - 1 ? 1 : 0)) as DayRow['grades'],
        updated: +now,
        dirty: 1,
      }

      rows.current.set(card.id, row)
      pinned.current = null
      setDrill((dr) => {
        if (!dr) return dr
        const left = dr.left.filter((id) => id !== card.id)
        return left.length ? { ...dr, left } : null
      })
      setDay(nd)
      let logId: number
      try {
        logId = await db.transaction('rw', db.cards, db.revlog, db.days, async () => {
          await db.cards.put(row)
          await db.days.put(nd)
          return (await db.revlog.add({ ...log, cardId: card.id, ...(known && { known: 1 as const }), dirty: 1 })) as number
        })
      } catch {
        setSaveError(true)
        return
      }
      setUndo({ row: before, day: d, logId, cardId: card.id, review: log.review })
      schedulePush()
    },
    [day, loadDay],
  )

  const undoLast = useCallback(async () => {
    if (!undo) return
    const now = Date.now()
    // Restore the previous state (a fresh card if this was its first grade) but stamp it as new, so a synced copy
    // elsewhere is overwritten too.
    const deckCard = CARD_BY_ID.get(undo.cardId)
    const prev = undo.row ?? (deckCard && freshRow(deckCard, new Date(now)))
    if (!prev) return
    const row: CardRow = { ...prev, updated: now, dirty: 1 }
    const day: DayRow = { ...undo.day, updated: now, dirty: 1 }
    rows.current.set(undo.cardId, row)
    pinned.current = undo.cardId
    setDrill((dr) => (dr && dr.ids.includes(undo.cardId) && !dr.left.includes(undo.cardId) ? { ...dr, left: [undo.cardId, ...dr.left] } : dr))
    setDay(day)
    setUndo(null)
    try {
      await db.transaction('rw', db.cards, db.revlog, db.days, async () => {
        await db.cards.put(row)
        await db.days.put(day)
        await db.revlog.delete(undo.logId)
      })
    } catch {
      setSaveError(true)
      return
    }
    recordUndo(undo.cardId, undo.review)
    schedulePush()
  }, [undo])

  const learnMore = useCallback(
    async (n = 20) => {
      if (!day) return
      const nd: DayRow = { ...day, extraNew: day.extraNew + n, updated: Date.now(), dirty: 1 }
      setDay(nd)
      try {
        await db.days.put(nd)
      } catch {
        setSaveError(true)
        return
      }
      schedulePush()
    },
    [day],
  )

  const refresh = useCallback(() => setTick((t) => t + 1), [])

  const startDrill = useCallback((ids: string[]) => {
    const valid = ids.filter((id) => CARD_BY_ID.has(id))
    if (!valid.length) return
    pinned.current = null
    shown.current = null
    setDrill({ ids: valid, left: valid })
  }, [])

  const exitDrill = useCallback(() => {
    shown.current = null
    setDrill(null)
  }, [])

  /** Re-read everything from IndexedDB (after a sync pull). */
  const reload = useCallback(async () => {
    try {
      const all = await db.cards.toArray()
      rows.current = new Map(all.map((r) => [r.id, r]))
      pinned.current = null
      setUndo(null)
      await loadDay(new Date())
    } catch {
      setSaveError(true)
    }
    setTick((t) => t + 1)
  }, [loadDay])

  return { ready: !!day, queue, day, currentRow, learned, grade, undo: undoLast, canUndo: !!undo, learnMore, refresh, reload, saveError, drilling: drill?.ids.length ?? 0, startDrill, exitDrill }
}
