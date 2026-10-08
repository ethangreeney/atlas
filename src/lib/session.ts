import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Rating, State, type Grade } from 'ts-fsrs'
import { db, type CardRow, type DayRow } from './db'
import type { Verdict } from './answer'
import { ALL_CARDS, CARD_BY_ID, STUDY_CARDS, type DeckCard } from './deck'
import { becomesLeech, buildQueue, dayEnd, dayKey, emptyDay, freshRow, LEARN_AHEAD_MS, matchesFilters, next as nextState, type Queue } from './scheduler'
import { useSettings } from './settings'
import { recordUndo, restartOutlines, schedulePush } from './sync'
import { reloadIfUpdated } from './update'

/** A new card marked "Knew it" comes back in 30 to 60 days. */
const KNOWN_DAYS = 30
/** Set once the whole deck has been celebrated on this device, so it only happens once. */
const CELEBRATED = 'atlas.celebrated'
const celebrated = () => {
  try {
    return !!localStorage.getItem(CELEBRATED)
  } catch {
    return false
  }
}

type Drill = { ids: string[]; left: string[] }
/** `drill`: the drill under way when the card was answered, so undoing puts it back as it was. */
type Undo = { row: CardRow | undefined; day: DayRow; logId: number; cardId: string; review: Date; drill: Drill | null }

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
   * The card that was on screen when an undo took it away, to come back once the undone card is answered again.
   * Answering differently the second time ("Knew it" instead of Good, say) changes the day's counts, and without this
   * the queue could pick another card, so the one just seen would vanish.
   */
  const resume = useRef<{ id: string; rev: number } | null>(null)
  /**
   * The card on screen stays there until it's answered. Without this, coming back to the tab could swap it
   * for a learning card that fell due in the meantime, mid-view and already flipped. `rev` is the card's
   * `updated` when it went on screen: any change after that, here or synced from another device, lets it go.
   */
  const shown = useRef<{ id: string; rev: number } | null>(null)
  /**
   * A short run over chosen cards (the hardest ones), whether due or not. Each is answered once through the normal
   * grade path, so FSRS sees an ordinary early review; the run ends when none are left, or on exit.
   */
  const [drill, setDrill] = useState<Drill | null>(null)
  /** Cards never answered right yet (Hard or better), so the moment the last one is can be celebrated. */
  const unpassed = useRef<Set<string> | null>(null)
  const [celebrate, setCelebrate] = useState(false)
  const loadUnpassed = useCallback(async () => {
    const passed = new Set<string>()
    await db.revlog.each((l) => {
      if (l.rating >= Rating.Hard) passed.add(l.cardId)
    })
    unpassed.current = new Set(ALL_CARDS.filter((c) => !passed.has(c.id)).map((c) => c.id))
  }, [])

  /**
   * Today's counters come from the review log, not the stored day row, so progress made on two devices
   * (or before signing in) adds up instead of one copy replacing the other. The row only keeps `extraNew` and `pulled`.
   */
  const loadDay = useCallback(async (now: Date) => {
    const key = dayKey(now)
    const stored = await db.days.get(key)
    const d = emptyDay(key)
    d.extraNew = stored?.extraNew ?? 0
    d.pulled = stored?.pulled ?? []
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
        // Before the first read, so the queue never shows the outline set as it was (see restartOutlines).
        await restartOutlines().catch(() => {})
        const all = await db.cards.toArray()
        if (cancelled) return
        rows.current = new Map(all.map((r) => [r.id, r]))
        await loadDay(new Date())
        await loadUnpassed()
      } catch {
        if (cancelled) return
        setSaveError(true)
        setDay(emptyDay(dayKey(new Date())))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadDay, loadUnpassed])

  // Roll the day over if the tab was left open past 4am.
  useEffect(() => {
    const check = () => {
      if (day && dayKey(new Date()) !== day.day) void loadDay(new Date())
      setTick((t) => t + 1)
    }
    document.addEventListener('visibilitychange', check)
    return () => document.removeEventListener('visibilitychange', check)
  }, [day, loadDay])

  /** In today's study: within the filters, or added to the day by hand. */
  const inToday = (c: DeckCard, d = day) => matchesFilters(c, settings) || !!d?.pulled?.includes(c.id)

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
      if (c && inToday(c)) {
        shown.current = { id: c.id, rev: rows.current.get(c.id)?.updated ?? 0 }
        return { ...q, current: c }
      }
    }
    const keep = shown.current
    if (keep && q.current?.id !== keep.id) {
      const c = CARD_BY_ID.get(keep.id)
      const untouched = (rows.current.get(keep.id)?.updated ?? 0) === keep.rev
      if (c && untouched && inToday(c)) return { ...q, current: c }
    }
    shown.current = q.current
      ? { id: q.current.id, rev: keep?.id === q.current.id ? keep.rev : (rows.current.get(q.current.id)?.updated ?? 0) }
      : null
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

  /** Cards answered at least once, ever, among those still in the deck (as Progress counts them). */
  const learned = useMemo(() => {
    let n = 0
    for (const r of rows.current.values()) if (r.state !== State.New && CARD_BY_ID.has(r.id)) n++
    return n
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue])

  const grade = useCallback(
    /**
     * `known`: a new card the learner already knew. Scheduled well out and free of the day's new-card limit.
     * `quiet`: answered in a test, so it isn't the answer to undo, and a new build waits for the test to end.
     */
    async (card: DeckCard, g: Grade, known = false, quiet = false) => {
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
      let { card: next, log } = nextState(prev, now, g)
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
      // Re-answering the card an undo brought back returns to the one that was showing before the undo.
      const back = pinned.current === card.id ? resume.current : null
      pinned.current = null
      resume.current = null
      // Whatever comes next (this card again, even) is a fresh showing, unless it's the card the undo interrupted.
      shown.current = back && back.id !== card.id && stillDue(back.id, row, nd, now) ? back : null
      if (!quiet)
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
      // A test's answers aren't undone one by one; the last thing to undo stays whatever it was before.
      if (!quiet) setUndo({ row: before, day: d, logId, cardId: card.id, review: log.review, drill })
      // The last card of the deck answered right for the first time.
      const left = unpassed.current
      if (g >= Rating.Hard && left?.delete(card.id) && left.size === 0 && !celebrated()) {
        try {
          localStorage.setItem(CELEBRATED, new Date().toISOString())
        } catch {
          // Shown anyway; it may just show again on another visit.
        }
        setCelebrate(true)
      }
      schedulePush()
      if (!quiet) reloadIfUpdated()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [day, loadDay, drill, settings],
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
    // Undo takes back the answer, not a 'learn more' asked for since.
    const extraNew = Math.max(undo.day.extraNew, day?.day === undo.day.day ? day.extraNew : 0)
    const pulled = [...new Set([...(undo.day.pulled ?? []), ...(day?.day === undo.day.day ? (day.pulled ?? []) : [])])]
    const nd: DayRow = { ...undo.day, extraNew, pulled, updated: now, dirty: 1 }
    rows.current.set(undo.cardId, row)
    // Don't carry a card over from one undo to the next: only the one on screen now is interrupted.
    resume.current = shown.current && shown.current.id !== undo.cardId ? shown.current : null
    pinned.current = undo.cardId
    setDrill(undo.drill)
    setDay(nd)
    setUndo(null)
    try {
      await db.transaction('rw', db.cards, db.revlog, db.days, async () => {
        await db.cards.put(row)
        await db.days.put(nd)
        await db.revlog.delete(undo.logId)
      })
      // An undone right answer may have been the card's only one.
      if (!(await db.revlog.where('cardId').equals(undo.cardId).filter((l) => l.rating >= Rating.Hard).count())) unpassed.current?.add(undo.cardId)
    } catch {
      setSaveError(true)
      return
    }
    recordUndo(undo.cardId, undo.review)
    schedulePush()
  }, [undo, day])

  /**
   * Whether a card would still be on today's list after `graded` was answered: a learning card due within the
   * learn-ahead limit, a review due today, or a new card with room left and its place not seen today.
   */
  function stillDue(id: string, graded: CardRow, d: DayRow, now: Date) {
    const c = CARD_BY_ID.get(id)
    if (!c || !inToday(c, d)) return false
    const r = rows.current.get(id) ?? freshRow(c, now)
    if (r.state === State.Learning || r.state === State.Relearning) return +r.due - +now <= LEARN_AHEAD_MS
    if (r.state === State.Review) return r.due < dayEnd(now)
    if (d.pulled?.includes(id)) return true
    return c.note.id !== graded.noteId && !d.seenNotes.includes(c.note.id) && buildQueue(now, rows.current, settings, d).counts.new > 0
  }

  const learnMore = useCallback(
    async (n: number) => {
      if (!day) return
      // Past a limit already (one lowered since, say)? Make that up too, so it brings as many as it offered.
      const nd: DayRow = { ...day, extraNew: day.extraNew + n + (queue?.newOver ?? 0), updated: Date.now(), dirty: 1 }
      setDay(nd)
      try {
        await db.days.put(nd)
      } catch {
        setSaveError(true)
        return
      }
      schedulePush()
    },
    [day, queue],
  )

  /** Adds cards to today ('learn now'): past the daily limit and not held to one per place. Only unstarted ones count. */
  const learnNow = useCallback(
    async (ids: string[]) => {
      if (!day) return
      const have = new Set(day.pulled ?? [])
      const add = ids.filter((id) => CARD_BY_ID.has(id) && !have.has(id) && (rows.current.get(id)?.state ?? State.New) === State.New)
      if (!add.length) return
      const nd: DayRow = { ...day, pulled: [...have, ...add], updated: Date.now(), dirty: 1 }
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
  /** Every unstarted card in the filters, today. */
  const learnAll = useCallback(() => learnNow(STUDY_CARDS.filter((c) => matchesFilters(c, settings)).map((c) => c.id)), [learnNow, settings])

  /**
   * A test's answer, counted as a review: right is Good, a spelling slip Hard, wrong Again. A card not started yet
   * that's answered right counts as known; one got wrong is left to learn in the usual way.
   */
  const answerTest = useCallback(
    (card: DeckCard, verdict: Verdict) => {
      const started = (rows.current.get(card.id)?.state ?? State.New) !== State.New
      if (!started) return verdict === 'wrong' ? Promise.resolve() : grade(card, Rating.Easy, true, true)
      return grade(card, verdict === 'right' ? Rating.Good : verdict === 'close' ? Rating.Hard : Rating.Again, false, true)
    },
    [grade],
  )

  const refresh = useCallback(() => setTick((t) => t + 1), [])
  const endCelebrate = useCallback(() => setCelebrate(false), [])

  const startDrill = useCallback((ids: string[]) => {
    const valid = ids.filter((id) => CARD_BY_ID.has(id))
    if (!valid.length) return
    pinned.current = null
    shown.current = null
    setDrill({ ids: valid, left: valid })
  }, [])

  const exitDrill = useCallback(() => {
    // A drill card brought back by undo isn't due: don't carry it into normal study.
    pinned.current = null
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
      await loadUnpassed()
    } catch {
      setSaveError(true)
    }
    setTick((t) => t + 1)
  }, [loadDay, loadUnpassed])

  return { ready: !!day, queue, day, currentRow, learned, grade, undo: undoLast, canUndo: !!undo, learnMore, learnNow, learnAll, refresh, reload, saveError, drilling: drill?.ids.length ?? 0, startDrill, exitDrill, celebrate, endCelebrate, answerTest }
}
