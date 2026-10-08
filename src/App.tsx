import { AnimatePresence, MotionConfig } from 'motion/react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Grade } from 'ts-fsrs'
import { Card, mapsUrl, type ExitTarget, type Typed } from './components/Card'
import { FindCard } from './components/FindCard'
import { loadFindMap } from './components/FindMap'
import { Welcome } from './components/Welcome'
import { Celebrate } from './components/Celebrate'
import { Done, Empty } from './components/Done'
import { Filters } from './components/Filters'
import { GradeBar } from './components/GradeBar'
import { Piles } from './components/Piles'
import { TopBar } from './components/TopBar'
import { Zoom } from './components/Zoom'
import { check } from './lib/answer'
import { answerOf, DECK_VERSION } from './lib/deck'
import { countMatching, previewIntervals, Rating, State } from './lib/scheduler'
import { useSession } from './lib/session'
import { loadOutlines } from './lib/outlines'
import { setSettings, useSettings } from './lib/settings'
import { preload, speak, stopSpeaking } from './lib/tts'
import { useAuth } from './lib/auth'
import { pushNow, syncNow } from './lib/sync'
import { maybeOptimize } from './lib/optimize'
import { zoom } from './lib/zoom'
import type { FindHandle, FindResult } from './lib/find/engine'

const PILE_ROTATE = [-10, -3, 3, 10]
/** The grade a typed answer points to. */
const SUGGEST = { right: Rating.Good, close: Rating.Hard, wrong: Rating.Again } as const
/** A typed answer that's right goes to Good by itself after this long (longer while its name is read out). */
const AUTO_MS = 1400
const AUTO_SPOKEN_MS = 2400
/** A place found on the map moves on as Good after this long: time to see the tick, not to wait on it. */
const FOUND_MS = 420
const Progress = lazy(() => import('./components/Progress'))
const Test = lazy(() => import('./components/Test'))

export default function App() {
  const settings = useSettings()
  const { ready, queue, day, currentRow, learned, grade, undo, canUndo, learnMore, learnNow, learnAll, reload, saveError, drilling, startDrill, exitDrill, celebrate, endCelebrate, answerTest } = useSession()
  const auth = useAuth()
  const card = queue?.current ?? null
  // The outline set's shapes come in their own file: fetched as soon as the set is on, so its first card isn't blank.
  const outlinesOn = settings.decks.includes('outlines')
  useEffect(() => {
    if (outlinesOn) void loadOutlines()
  }, [outlinesOn])
  // The same for the map the find-on-map set needs.
  const findOn = settings.decks.includes('find')
  useEffect(() => {
    if (findOn) void loadFindMap().catch(() => {})
  }, [findOn])

  const [flipped, setFlipped] = useState(false)
  const [showMap, setShowMap] = useState(false)
  const [seq, setSeq] = useState(0)
  const [exitTarget, setExitTarget] = useState<ExitTarget | null>(null)
  const [busy, setBusy] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [progressOpen, setProgressOpen] = useState(false)
  /** Tests open: at the list, or at one test's start. */
  const [test, setTest] = useState<{ key?: string } | null>(null)
  const [pileCounts, setPileCounts] = useState<[number, number, number, number]>([0, 0, 0, 0])
  const [answer, setAnswer] = useState('')
  const [typed, setTyped] = useState<Typed | null>(null)
  /** Right answer typed: Good goes by itself after this many ms, unless anything else happens first. */
  const [auto, setAuto] = useState<number | null>(null)
  /** The grade a swipe in progress would give, lit up on its button. */
  const [lean, setLean] = useState<Grade | null>(null)
  /** How a find-on-map card was answered: found, the wrong place picked, or shown. */
  const [found, setFound] = useState<FindResult | null>(null)
  const findControl = useRef<FindHandle | null>(null)
  const isFind = card?.type === 'find'

  const stageRef = useRef<HTMLDivElement>(null)
  const pileRefs = useRef<(HTMLDivElement | null)[]>([])
  const busyRef = useRef(false)
  /** Focus last moved with Tab, so Space/Enter belong to the focused control rather than the card. */
  const tabbing = useRef(false)

  // A card swapped in by anything but grading or undo (filters, a sync) starts face down, and the old one just fades.
  const [shown, setShown] = useState({ id: card?.id, seq })
  if (shown.id !== card?.id || shown.seq !== seq) {
    setShown({ id: card?.id, seq })
    setAnswer('')
    setTyped(null)
    setAuto(null)
    setLean(null)
    setFound(null)
    if (shown.seq === seq) {
      setFlipped(false)
      setShowMap(false)
      setExitTarget(null)
    }
  }

  // Pull the latest progress when the app opens signed in, and whenever it comes back into view or back online.
  useEffect(() => {
    if (!ready || !auth) return
    const run = () =>
      syncNow()
        .then((changed) => {
          if (changed) void reload()
        })
        .catch(() => {})
    run()
    // Going out of view (or closing) sends answers still waiting on the push delay, while requests can still go out.
    const onVisible = () => (document.visibilityState === 'visible' ? run() : pushNow())
    // Mobile Safari can restore a page from its back/forward cache without a visibility change.
    const onShow = (e: PageTransitionEvent) => e.persisted && run()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onShow)
    window.addEventListener('pagehide', pushNow)
    window.addEventListener('online', run)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onShow)
      window.removeEventListener('pagehide', pushNow)
      window.removeEventListener('online', run)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, auth?.user.id])

  // Now and then, refit the scheduler to this learner's own answers, once the app has settled.
  useEffect(() => {
    if (!ready) return
    const t = setTimeout(() => void maybeOptimize().catch(() => {}), 5000)
    return () => clearTimeout(t)
  }, [ready])

  // Pile counters tick when the card lands, not when the key is pressed.
  useEffect(() => {
    if (!day) return
    const t = setTimeout(() => setPileCounts(day.grades), 400)
    return () => clearTimeout(t)
  }, [day])

  // Have the pronunciation ready before the answer is shown.
  useEffect(() => {
    if (!card) return
    preload(answerOf(card))
    if (card.type === 'capital' || card.type === 'country') preload(card.type === 'capital' ? card.note.country : card.note.capital!)
  }, [card])

  const intervals = useMemo(() => (currentRow ? previewIntervals(currentRow, new Date()) : []), [currentRow])

  /** Turns the card over, marking what was typed if anything. */
  const flip = useCallback(() => {
    if (!card || flipped || busy) return
    // A find card shows the place on its map, which says so (see onFound).
    if (card.type === 'find') return findControl.current?.reveal()
    const text = settings.typeAnswers ? answer.trim() : ''
    const kind = text ? check(text, card) : null
    if (kind) setTyped({ kind, text })
    if (kind === 'right') setAuto(settings.autoplay ? AUTO_SPOKEN_MS : AUTO_MS)
    setFlipped(true)
    if (settings.autoplay) speak(answerOf(card))
  }, [card, flipped, busy, settings.autoplay, settings.typeAnswers, answer])
  const suggested = typed ? SUGGEST[typed.kind] : found ? (found.kind === 'right' ? Rating.Good : Rating.Again) : null
  const onFound = useCallback((r: FindResult) => {
    setFound(r)
    setFlipped(true)
  }, [])

  const say = useCallback((text?: string) => {
    if (!card || !flipped) return
    speak(text ?? answerOf(card))
  }, [card, flipped])

  /** Sends the card to a pile. `known`: a new card the learner already knew. */
  const send = useCallback(
    (g: Grade, known = false) => {
      if (!card || busy || busyRef.current) return
      busyRef.current = true
      const stage = stageRef.current?.getBoundingClientRect()
      const pile = pileRefs.current[g - 1]?.getBoundingClientRect()
      if (stage && pile) {
        setExitTarget({
          x: pile.left + pile.width / 2 - (stage.left + stage.width / 2),
          y: pile.top + pile.height / 2 - (stage.top + stage.height / 2),
          rotate: PILE_ROTATE[g - 1],
        })
      }
      stopSpeaking()
      setBusy(true)
      setFlipped(false)
      setShowMap(false)
      setSeq((s) => s + 1)
      void grade(card, g, known)
      // Long enough that a quick double tap on a grade doesn't land on "Show answer" for the next card.
      setTimeout(() => {
        busyRef.current = false
        setBusy(false)
      }, 400)
    },
    [card, busy, grade],
  )
  const isNew = currentRow?.state === State.New
  // Easy on a card seen for the first time can only mean it was already known.
  const doGrade = useCallback((g: Grade) => flipped && send(g, isNew && g === Rating.Easy), [flipped, isNew, send])
  const know = useCallback(() => isNew && send(Rating.Easy, true), [isNew, send])
  /** Graded from the question, without looking at the answer: for a new card, that it was already known. */
  const sure = useCallback(() => !flipped && (isNew ? know() : send(Rating.Good)), [flipped, isNew, know, send])

  // A right typed answer moves on as Good by itself. Any tap or key first (another grade, a look at the map) stops that;
  // Space and Enter still grade Good straight away.
  useEffect(() => {
    if (!auto || !flipped) return
    const t = setTimeout(() => doGrade(Rating.Good), auto)
    const stop = () => setAuto(null)
    window.addEventListener('pointerdown', stop, true)
    window.addEventListener('keydown', stop, true)
    return () => {
      clearTimeout(t)
      window.removeEventListener('pointerdown', stop, true)
      window.removeEventListener('keydown', stop, true)
    }
  }, [auto, flipped, doGrade])

  // Found on the map: Good, by itself, once the tick's had a moment. Space or a click on the map gets there sooner.
  useEffect(() => {
    if (found?.kind !== 'right' || !flipped) return
    const t = setTimeout(() => doGrade(Rating.Good), FOUND_MS)
    return () => clearTimeout(t)
  }, [found, flipped, doGrade])

  const doUndo = useCallback(() => {
    if (!canUndo || busy) return
    setExitTarget(null)
    setFlipped(false)
    setShowMap(false)
    setSeq((s) => s + 1)
    void undo()
  }, [canUndo, busy, undo])

  useEffect(() => {
    const onPointer = () => {
      tabbing.current = false
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') tabbing.current = true
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return
      if (e.key === 'Escape') {
        if (filtersOpen) return setFiltersOpen(false)
        // Back out to the whole world, on a find card's map.
        if (isFind && !progressOpen && !test && !celebrate) findControl.current?.fit()
        return
      }
      if (filtersOpen || progressOpen || test || celebrate || e.repeat) return
      switch (e.code === 'Space' ? ' ' : e.key) {
        case ' ':
        case 'Spacebar':
        case 'Enter':
          // A button, link or name reached with Tab keeps its own Space/Enter; one that was just clicked hands them back.
          if (t !== document.body) {
            if (tabbing.current) return
            t.blur()
          }
          e.preventDefault()
          if (flipped) doGrade(suggested ?? Rating.Good)
          else flip()
          break
        case '1':
        case '2':
        case '3':
        case '4': {
          // On the question, Again just shows the answer, and the others grade it unseen.
          const g = Number(e.key) as Grade
          if (flipped) doGrade(g)
          else if (g === Rating.Again) flip()
          else send(g, isNew && g === Rating.Easy)
          break
        }
        case 'z':
        case 'Z':
          doUndo()
          break
        case 'k':
        case 'K':
          know()
          break
        case 's':
        case 'S':
          say()
          break
        case 'm':
        case 'M':
          if (flipped) setShowMap((v) => !v)
          break
        case 'g':
        case 'G':
          if (card && flipped) window.open(mapsUrl(card), '_blank', 'noopener')
          break
        case 'f':
        case 'F':
          // The card's picture up close, whichever side is showing: its flag or map, or the map shown with the answer.
          if (card) {
            const n = card.note
            if (flipped && n.map && (card.type === 'map' || showMap)) zoom({ file: n.map, alt: `Map of ${n.country}` })
            else if (!flipped && card.type === 'map') zoom({ file: n.map!, alt: 'Map' })
            else if (card.type === 'flag') zoom({ file: (flipped && n.flagBack) || n.flag!, alt: flipped ? `Flag of ${n.country}` : 'Flag' })
          }
          break
        case 'p':
        case 'P':
          setFiltersOpen(false)
          setProgressOpen(true)
          break
        case 't':
        case 'T':
          setFiltersOpen(false)
          setTest({})
          break
        case '+':
        case '=':
        case '-':
        case '_':
          if (!isFind) return
          findControl.current?.zoom(e.key === '+' || e.key === '=' ? 2 : 0.5)
          break
        default:
          return
      }
      // The next card's answer box may take focus before this key would be typed; keep it out.
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer, true)
    }
  }, [flip, doGrade, send, isNew, doUndo, know, say, card, flipped, showMap, filtersOpen, progressOpen, test, celebrate, suggested, isFind])

  const filtersActive = settings.regions.length > 0 || settings.kinds.length > 0 || settings.types.length > 0
  const empty = useMemo(() => countMatching(settings) === 0, [settings])
  const progress = queue && queue.total > 0 ? queue.done / queue.total : 0

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative flex h-full touch-manipulation flex-col bg-page">
        <Zoom />
        <TopBar
          queue={queue}
          learned={learned}
          canUndo={canUndo}
          filtersOpen={filtersOpen}
          filtersActive={filtersActive}
          onUndo={doUndo}
          onToggleFilters={() => setFiltersOpen((o) => !o)}
          onSynced={reload}
          onOpenProgress={() => setProgressOpen(true)}
          onOpenTests={() => {
            setFiltersOpen(false)
            setTest({})
          }}
          drilling={drilling}
          onExitDrill={exitDrill}
        />
        <div className="mx-4 h-px bg-line sm:mx-6">
          <div className="h-full bg-ink transition-[width] duration-500 ease-out" style={{ width: `${progress * 100}%` }} />
        </div>

        {saveError && (
          <div role="alert" className="mx-4 mt-3 rounded-xl bg-again/10 px-3 py-2 text-center text-[12.5px] text-again sm:mx-6 short:mt-2 short:py-1.5">
            This browser couldn't save your progress. Grades from now on may be lost when you close the page.
          </div>
        )}

        <AnimatePresence>{filtersOpen && <Filters key="filters" onClose={() => setFiltersOpen(false)} />}</AnimatePresence>
        <AnimatePresence>
          {progressOpen && (
            <Suspense key="progress" fallback={null}>
              <Progress
                onClose={() => setProgressOpen(false)}
                onDrill={startDrill}
                onLearn={learnNow}
                onTest={(key) => {
                  setProgressOpen(false)
                  setTest({ key })
                }}
              />
            </Suspense>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {test && (
            <Suspense key="test" fallback={null}>
              <Test initial={test.key} onClose={() => setTest(null)} onAnswer={(c, v) => void answerTest(c, v)} />
            </Suspense>
          )}
        </AnimatePresence>
        <AnimatePresence>{celebrate && <Celebrate key="celebrate" onClose={endCelebrate} />}</AnimatePresence>

        <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-4 short:gap-2 short:pt-2.5">
          {/* On a short screen the card takes whatever height the bars leave it. */}
          {/* A find card is a map, so it takes more room: nearly the whole world fits across it on a laptop. */}
          <div
            ref={stageRef}
            className={`relative transition-[width,height] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none short:h-auto short:min-h-0 short:flex-1 ${isFind ? 'h-[clamp(380px,calc(100dvh_-_290px),540px)] w-[min(720px,100%)] short:max-h-none' : 'h-[min(420px,50dvh)] w-[min(560px,100%)] short:max-h-[420px]'}`}
          >
            <AnimatePresence custom={exitTarget} initial={false}>
              {ready && card && currentRow && card.type === 'find' && (
                <FindCard key={`${card.id}:${seq}`} card={card} row={currentRow} result={found} control={findControl} onResult={onFound} onNext={() => doGrade(Rating.Good)} />
              )}
              {ready && card && currentRow && card.type !== 'find' && (
                <Card key={`${card.id}:${seq}`} card={card} row={currentRow} flipped={flipped}
                  showMap={showMap}
                  onFlip={flip}
                  onGrade={doGrade}
                  onSpeak={say}
                  onToggleMap={() => setShowMap((v) => !v)}
                  onSure={sure}
                  onLean={setLean}
                  input={settings.typeAnswers ? { value: answer, onChange: setAnswer, onSubmit: flip } : undefined}
                  typed={typed}
                />
              )}
              {ready && queue && !card && empty && <Empty key="empty" onReset={() => setSettings({ types: [], kinds: [], regions: [] })} />}
              {ready && queue && !card && !empty && (
                <Done
                  key="done"
                  queue={queue}
                  learned={learned}
                  grades={day?.grades ?? [0, 0, 0, 0]}
                  onLearnMore={learnMore}
                  onLearnAll={learnAll}
                  onOpenProgress={() => setProgressOpen(true)}
                  onOpenTests={() => setTest({})}
                />
              )}
            </AnimatePresence>
          </div>
          <div className="w-[min(560px,100%)]">
            {card ? (
              <GradeBar flipped={flipped} intervals={intervals} isNew={isNew} onFlip={flip} onGrade={doGrade} disabled={busy} suggested={suggested} auto={auto} leaning={lean} find={isFind} />
            ) : (
              <div className="h-16 short:hidden" />
            )}
          </div>
        </main>

        <div className="mx-auto w-[min(592px,100%)] px-4 pb-4 short:pb-1.5 short:pt-2">
          <Piles counts={pileCounts} refs={pileRefs} onDrill={startDrill} />
        </div>

        <footer className="flex h-11 shrink-0 items-center justify-between gap-6 whitespace-nowrap px-4 text-[11px] text-ink-3 sm:px-6 short:h-8">
          <div className="flex shrink-0 items-center gap-2">
            <Welcome />
            <span className="mx-1 hidden lg:inline">·</span>
            {isFind ? (
              <span className="hidden items-center gap-2 lg:flex">
                scroll zoom <span className="mx-1">·</span> drag pan <span className="mx-1">·</span> click to answer <span className="mx-1">·</span> <kbd>space</kbd> show or next{' '}
                <span className="mx-1">·</span> <kbd>esc</kbd> whole world <span className="mx-1">·</span> <kbd>z</kbd> undo <span className="mx-1">·</span> <kbd>p</kbd> progress{' '}
                <span className="mx-1">·</span> <kbd>t</kbd> tests
              </span>
            ) : (
              <span className="hidden items-center gap-2 lg:flex">
                <kbd>space</kbd> show <span className="mx-1">·</span> <kbd>1</kbd>–<kbd>4</kbd> grade <span className="mx-1">·</span> <kbd>z</kbd> undo <span className="mx-1">·</span> <kbd>k</kbd> know{' '}
                <span className="mx-1">·</span> <kbd>s</kbd> say <span className="mx-1">·</span> <kbd>m</kbd> map <span className="mx-1">·</span> <kbd>f</kbd> zoom <span className="mx-1">·</span> <kbd>p</kbd> progress{' '}
                <span className="mx-1">·</span> <kbd>t</kbd> tests
              </span>
            )}
          </div>
          {/* Padded to the footer's height (and pulled back) so the links' full-height tap targets aren't clipped. */}
          <div className="-my-3.5 truncate py-3.5">
            <a href="https://github.com/anki-geo/ultimate-geography" className="relative hover:text-ink after:absolute after:inset-x-0 after:-inset-y-3.5" target="_blank" rel="noreferrer">
              Ultimate Geography {DECK_VERSION}
            </a>
            <span className="hidden md:inline"> · deck public domain · images CC BY-SA / CC0,</span>{' '}
            <a
              href="https://github.com/anki-geo/ultimate-geography/blob/master/src/media/sources.csv"
              className="relative hover:text-ink after:absolute after:inset-x-0 after:-inset-y-3.5"
              target="_blank"
              rel="noreferrer"
            >
              sources
            </a>
          </div>
        </footer>
      </div>
    </MotionConfig>
  )
}
