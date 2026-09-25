import Dexie, { type EntityTable } from 'dexie'
import type { Card, ReviewLog } from 'ts-fsrs'

/** `updated` is a ms timestamp used for last-write-wins sync. `dirty` marks rows written here and not yet pushed. */
export type CardRow = Card & { id: string; noteId: string; leech?: boolean; updated: number; dirty?: 1 }
/** `known`: marked "I know this" when new, so it doesn't count against the day's new cards. */
export type RevlogRow = ReviewLog & { id?: number; cardId: string; known?: 1; dirty?: 1 }
/** Per-day counters (day = local date string with Anki's 4am rollover). */
export type DayRow = {
  day: string
  newCount: number
  reviewCount: number
  extraNew: number
  seenNotes: string[]
  /** Answers given today per grade: [again, hard, good, easy]. */
  grades: [number, number, number, number]
  updated: number
  dirty?: 1
}

export const db = new Dexie('atlas') as Dexie & {
  cards: EntityTable<CardRow, 'id'>
  revlog: EntityTable<RevlogRow, 'id'>
  days: EntityTable<DayRow, 'day'>
}

db.version(1).stores({
  cards: 'id, noteId, state, due',
  revlog: '++id, cardId, review',
  days: 'day',
})

db.version(2)
  .stores({
    cards: 'id, noteId, state, due, updated',
    revlog: '++id, cardId, review',
    days: 'day, updated',
  })
  .upgrade((tx) => {
    const now = Date.now()
    return Promise.all([
      tx.table('cards').toCollection().modify((c: CardRow) => {
        c.updated ??= c.last_review ? +new Date(c.last_review) : now
      }),
      tx.table('days').toCollection().modify((d: DayRow) => {
        d.updated ??= now
      }),
    ])
  })

// Dirty flags replace the old push timestamp. Everything starts dirty: pushes are idempotent, and it re-sends
// anything the timestamp may have skipped.
db.version(3)
  .stores({
    cards: 'id, noteId, state, due, updated, dirty',
    revlog: '++id, cardId, review, dirty',
    days: 'day, updated, dirty',
  })
  .upgrade((tx) =>
    Promise.all(
      ['cards', 'revlog', 'days'].map((t) =>
        tx
          .table(t)
          .toCollection()
          .modify((r: { dirty?: 1 }) => {
            r.dirty = 1
          }),
      ),
    ),
  )
