import { db, type TestRow } from './db'
import { ALL_CARDS, type CoreType, type DeckCard } from './deck'
import { setName, WHOLE } from './insights'
import { schedulePush } from './sync'

/** The official tests cover the 205 sovereign states: no territories, seas or continents. */
const SOVEREIGN = 'Sovereign_State'

export type TestDef = {
  key: string
  name: string
  type: CoreType
  cards: DeckCard[]
  /** One of the four tests over every country in the world: the same for everyone, so scores compare. */
  official: boolean
}

export const TEST_TYPES: CoreType[] = ['flag', 'map', 'capital', 'country']
const OFFICIAL_NAME: Record<CoreType, string> = {
  flag: 'Flags of the world',
  map: 'Countries on the map',
  capital: 'Capitals of the world',
  country: 'Countries from their capitals',
}

/** A test by key: `world:flag` for an official one, or a set's key (`Africa:flag`, `All:map`) for practice. */
export function testDef(key: string): TestDef | null {
  const [region, type] = key.split(':') as [string, CoreType]
  if (!TEST_TYPES.includes(type)) return null
  if (region === 'world')
    return { key, name: OFFICIAL_NAME[type], type, official: true, cards: ALL_CARDS.filter((c) => c.type === type && c.note.tags.includes(SOVEREIGN)) }
  const cards = ALL_CARDS.filter((c) => c.type === type && (region === WHOLE || c.note.tags.includes(region)))
  return cards.length ? { key, name: setName(region, type), type, official: false, cards } : null
}

export const OFFICIAL = TEST_TYPES.map((t) => testDef(`world:${t}`)!)

/** Keeps a finished test, to sync to the account like an answer. */
export async function saveTest(row: Omit<TestRow, 'dirty'>) {
  await db.tests.put({ ...row, dirty: 1 })
  schedulePush()
}

/** Every attempt at a test, oldest first. */
export const attempts = (key: string) => db.tests.where('test').equals(key).sortBy('finished')

/** Whether `a` beats `b`: more of it right, or as much in less time. */
export const beats = (a: TestRow, b: TestRow | undefined) => {
  if (!b) return true
  const [x, y] = [a.right / a.total, b.right / b.total]
  return x > y || (x === y && a.ms < b.ms)
}
export const bestOf = (rows: TestRow[]) => rows.reduce<TestRow | undefined>((b, r) => (beats(r, b) ? r : b), undefined)
