import { ChevronLeft, Search, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import world from '../data/world.json'
import { db, type CardRow } from '../lib/db'
import { ALL_CARDS, CARD_BY_ID, CARD_TYPES, kindOf, mediaUrl, NOTES, type CardType, type Note } from '../lib/deck'
import { CARDS_BY_NOTE, forecast, hardest, isMature, mastery, NOTE_BY_ID, search, type Mastery } from '../lib/progress'
import { formatInterval, State } from '../lib/scheduler'
import { useSettings } from '../lib/settings'
import { loadStreak } from '../lib/streak'
import { speak } from '../lib/tts'
import { Say } from './Card'

const WORLD = world as { width: number; height: number; shapes: Record<string, string>; rest: string }
const COUNTRIES = NOTES.filter((n) => kindOf(n) === 'sovereign')
/** Fill opacity of the good colour for each mastery step; step 0 is plain land. */
const SHADE = [0, 0.3, 0.5, 0.75, 1]
/** Marks the history entry pushed on open, so Back closes the page and closing pops it again. */
const TOKEN = Math.random().toString(36).slice(2)

const TYPE_WORD: Record<CardType, string> = { capital: 'capital', country: 'from its capital', flag: 'flag', map: 'on the map' }

const Heading = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">{children}</div>
)

/** Small flag beside a place's name, or an empty slot of the same size so names line up. */
const Thumb = ({ note }: { note: Note }) => {
  const file = note.flagBack ?? note.flag
  return (
    <span className="flex h-5 w-7 shrink-0 items-center justify-center">
      {file && (
        <img
          src={mediaUrl(file)}
          alt=""
          draggable={false}
          loading="lazy"
          className={`max-h-5 max-w-7 ${file.includes('-nobox') ? '' : 'img-shadow rounded-[2px]'}`}
        />
      )}
    </span>
  )
}

const Row = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <li>
    <button onClick={onClick} className="flex min-h-10 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-neutral-50">
      {children}
    </button>
  </li>
)

function status(r: CardRow | undefined, now: Date) {
  if (!r || r.state === State.New) return { label: 'New', cls: 'text-easy' }
  if (r.state === State.Learning || r.state === State.Relearning) return { label: 'Learning', cls: 'text-again' }
  if (isMature(r)) return { label: 'Mastered', cls: 'text-good' }
  const ms = +new Date(r.due) - +now
  return { label: ms > 0 ? `Due in ${formatInterval(ms)}` : 'Due now', cls: 'text-ink-2' }
}

const span = (days: number) => (days === 1 ? '1 day' : days < 90 ? `${days} days` : `${Math.round(days / 30)} months`)

function MasteryMap({ levels, onPick }: { levels: Map<string, Mastery>; onPick: (id: string) => void }) {
  const [hover, setHover] = useState<string | null>(null)
  const paths = useMemo(
    () =>
      Object.entries(WORLD.shapes).map(([id, d]) => {
        const l = levels.get(id)?.level ?? 0
        return <path key={id} d={d} data-id={id} className={`cursor-pointer ${l ? 'fill-good' : 'fill-neutral-200'}`} fillOpacity={l ? SHADE[l] : undefined} />
      }),
    [levels],
  )
  const mastered = COUNTRIES.filter((n) => levels.get(n.id)?.level === 4).length
  const hovered = hover ? NOTE_BY_ID.get(hover) : null
  const m = hover ? levels.get(hover) : null
  const idOf = (e: React.SyntheticEvent) => (e.target as Element).getAttribute('data-id')
  return (
    <section className="mt-5">
      <svg
        viewBox={`0 0 ${WORLD.width} ${WORLD.height}`}
        className="block h-auto w-full stroke-white [stroke-width:0.6px] [&_path]:[vector-effect:non-scaling-stroke]"
        role="img"
        aria-label={`World map: ${mastered} of ${COUNTRIES.length} countries mastered`}
        onPointerOver={(e) => setHover(idOf(e))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          const id = idOf(e)
          if (!id) return
          setHover(null)
          onPick(id)
        }}
      >
        <path d={WORLD.rest} className="fill-neutral-200" />
        {paths}
        {hover && WORLD.shapes[hover] && <path d={WORLD.shapes[hover]} className="pointer-events-none fill-none stroke-ink [stroke-width:1px]" />}
      </svg>
      <div className="mt-2 flex items-center justify-between gap-3 text-[12.5px] text-ink-3">
        <span className="min-w-0 truncate">
          {hovered && m ? (
            <>
              <span className="text-ink-2">{hovered.country}</span> · {m.mature} of {m.total} cards mastered
            </>
          ) : (
            `${mastered} of ${COUNTRIES.length} countries mastered`
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1" aria-hidden>
          <span className="mr-0.5">Less</span>
          {SHADE.map((o, l) => (
            <span key={l} className={`h-2.5 w-2.5 rounded-[3px] ${l ? 'bg-good' : 'bg-neutral-200'}`} style={l ? { opacity: o } : undefined} />
          ))}
          <span className="ml-0.5">More</span>
        </span>
      </div>
    </section>
  )
}

function Detail({ note, rows, onBack }: { note: Note; rows: Map<string, CardRow>; onBack: () => void }) {
  const now = new Date()
  const flag = note.flagBack ?? note.flag
  const info = [note.countryInfo, note.capitalInfo].filter(Boolean).join(' ')
  return (
    <div>
      <button onClick={onBack} className="-ml-1.5 flex h-8 items-center gap-0.5 rounded-full pl-0.5 pr-2.5 text-[12.5px] text-ink-3 transition-colors hover:bg-neutral-100 hover:text-ink">
        <ChevronLeft size={16} strokeWidth={1.75} /> Back
      </button>
      <div className="mt-2 flex flex-col items-center gap-3 text-center">
        {flag && <img src={mediaUrl(flag)} alt={`Flag of ${note.country}`} draggable={false} className={`max-h-20 max-w-[140px] ${flag.includes('-nobox') ? '' : 'img-shadow rounded-[3px]'}`} />}
        <div>
          <div className="text-balance text-[26px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink">
            <Say text={note.country} onSay={speak} big />
          </div>
          {note.capital && (
            <div className="mt-1 text-[15px] font-medium text-ink-2">
              <Say text={note.capital} onSay={speak} />
            </div>
          )}
        </div>
        {info && <p className="max-w-[40ch] text-balance text-[13px] leading-snug text-ink-3">{info}</p>}
        {note.map && <img src={mediaUrl(note.map)} alt={`Map of ${note.country}`} draggable={false} className="img-shadow mt-1 w-[min(320px,100%)] rounded-xl" />}
      </div>
      <ul className="mt-6 divide-y divide-line border-y border-line">
        {(CARDS_BY_NOTE.get(note.id) ?? []).map((c) => {
          const r = rows.get(c.id)
          const s = status(r, now)
          return (
            <li key={c.id} className="flex min-h-10 items-center justify-between gap-3 py-2 text-[13.5px]">
              <span className="text-ink-2">{CARD_TYPES.find((t) => t.id === c.type)?.label}</span>
              <span className="flex items-baseline gap-2">
                {r?.leech && <span className="text-[12px] text-again">Leech</span>}
                <span className={`font-medium tabular-nums ${s.cls}`}>{s.label}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

type Props = { onClose: () => void; onDrill: (ids: string[]) => void }

/** Search any place, see mastery on a world map, the streak, what's ahead, and the cards that keep slipping. */
export default function Progress({ onClose, onDrill }: Props) {
  const settings = useSettings()
  const [rows, setRows] = useState<Map<string, CardRow> | null>(null)
  const [streak, setStreak] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [detail, setDetail] = useState<Note | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    let live = true
    db.cards
      .toArray()
      .then((all) => live && setRows(new Map(all.map((r) => [r.id, r]))))
      .catch(() => live && setRows(new Map()))
    loadStreak()
      .then((n) => live && setStreak(n))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  // The phone's back gesture closes the page rather than leaving the app.
  useEffect(() => {
    if (history.state?.atlasProgress !== TOKEN) history.pushState({ ...history.state, atlasProgress: TOKEN }, '')
    const onPop = () => onCloseRef.current()
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const close = useCallback(() => (history.state?.atlasProgress === TOKEN ? history.back() : onCloseRef.current()), [])

  // Typing goes straight to search with a keyboard; on a phone the keyboard would cover the map, so wait for a tap.
  useEffect(() => {
    if (matchMedia('(pointer: fine)').matches) inputRef.current?.focus()
    else dialogRef.current?.focus()
  }, [])

  // Escape steps back one level: detail, then search, then the page itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      e.preventDefault()
      if (detail) setDetail(null)
      else if (query) setQuery('')
      else close()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [detail, query, close])

  const searching = query.trim() !== ''
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 })
  }, [detail, searching])

  const results = useMemo(() => search(query), [query])
  const levels = useMemo(() => rows && mastery(rows), [rows])
  const ahead = useMemo(() => rows && forecast(rows, settings), [rows, settings])
  const hard = useMemo(() => (rows ? hardest(rows) : []), [rows])
  const learned = useMemo(() => (rows ? [...rows.values()].filter((r) => r.state !== State.New && CARD_BY_ID.has(r.id)).length : 0), [rows])
  const filtered = settings.regions.length > 0 || settings.kinds.length > 0 || settings.types.length > 0

  const open = (note: Note | undefined) => note && setDetail(note)

  let body: React.ReactNode = null
  if (detail && rows) body = <Detail note={detail} rows={rows} onBack={() => setDetail(null)} />
  else if (searching)
    body = results.length ? (
      <ul className="-mx-2">
        {results.map((n) => (
          <Row key={n.id} onClick={() => open(n)}>
            <Thumb note={n} />
            <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{n.country}</span>
            {n.capital && <span className="max-w-[45%] truncate text-[13px] text-ink-3">{n.capital}</span>}
          </Row>
        ))}
      </ul>
    ) : (
      <p className="pt-2 text-[13.5px] text-ink-3">Nothing matches “{query.trim()}”.</p>
    )
  else if (rows && levels && ahead)
    body = (
      <>
        <div className="mt-1 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[22px] font-semibold leading-[1.15] tracking-[-0.025em] text-ink sm:text-[24px]">
              {streak ? `${streak}-day streak` : 'Progress'}
            </h2>
            <p className="mt-1 text-[13.5px] text-ink-2">
              {learned.toLocaleString()} of {ALL_CARDS.length.toLocaleString()} cards learned
              {streak === 0 ? ' · study today to start a streak' : ''}
            </p>
          </div>
          {/* Reminders toggle goes here */}
        </div>

        <MasteryMap levels={levels} onPick={(id) => open(NOTE_BY_ID.get(id))} />

        <p className="mt-5 text-balance text-[13.5px] leading-snug text-ink-2">
          {ahead.remaining > 0
            ? `At ${settings.newPerDay} new a day you'll finish ${filtered ? 'these cards' : 'the deck'} in about ${span(ahead.days)}`
            : `Every card${filtered ? ' in these filters' : ''} is under way`}
          {ahead.peak > 0 && ` · about ${ahead.peak} review${ahead.peak === 1 ? '' : 's'} a day at peak`}
        </p>

        <section className="mt-7">
          <div className="mb-1.5 flex items-baseline justify-between">
            <Heading>Hardest cards</Heading>
            {hard.length > 0 && <span className="text-[11px] text-ink-3">lapses</span>}
          </div>
          {hard.length ? (
            <>
              <ul className="-mx-2">
                {hard.map((r) => {
                  const c = CARD_BY_ID.get(r.id)!
                  return (
                    <Row key={r.id} onClick={() => open(c.note)}>
                      <Thumb note={c.note} />
                      <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">
                        {c.note.country}
                        <span className="text-ink-3"> · {TYPE_WORD[c.type]}</span>
                      </span>
                      <span className={`text-[12.5px] tabular-nums ${r.leech ? 'text-again' : 'text-ink-3'}`} title={r.leech ? 'Leech' : undefined}>
                        {r.lapses}
                      </span>
                    </Row>
                  )
                })}
              </ul>
              <button
                onClick={() => {
                  onDrill(hard.map((r) => r.id))
                  close()
                }}
                className="mt-3 rounded-full border border-line bg-white px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-neutral-50 pointer-coarse:py-3"
              >
                Drill these {hard.length}
              </button>
            </>
          ) : (
            <p className="text-[13.5px] text-ink-3">No trouble cards yet.</p>
          )}
        </section>
      </>
    )

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-white/70 pad-safe backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onPointerDown={(e) => e.target === e.currentTarget && close()}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Progress"
        tabIndex={-1}
        className="card-shadow flex h-full w-[min(560px,100%)] flex-col overflow-hidden rounded-3xl bg-white outline-none sm:h-[min(780px,100%)]"
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-4 sm:px-6 sm:pt-6">
          <label className="relative flex-1">
            <Search size={15} strokeWidth={1.75} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setDetail(null)
              }}
              onKeyDown={(e) => e.key === 'Enter' && open(results[0])}
              placeholder="Search a country or capital…"
              aria-label="Search a country or capital"
              autoComplete="off"
              spellCheck={false}
              className="h-10 w-full rounded-full border border-line bg-white pl-9 pr-4 text-[14px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-ink-3 [&::-webkit-search-cancel-button]:hidden"
            />
          </label>
          <button
            onClick={close}
            aria-label="Close (Esc)"
            title="Close (Esc)"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-neutral-100 hover:text-ink"
          >
            <X size={17} strokeWidth={1.75} />
          </button>
        </div>
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-2 sm:px-7 sm:pb-8">
          {body}
        </div>
      </motion.div>
    </motion.div>
  )
}
