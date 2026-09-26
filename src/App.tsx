import { AnimatePresence, MotionConfig } from 'motion/react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Grade } from 'ts-fsrs'
import { Card, mapsUrl, type ExitTarget, type Typed } from './components/Card'
import { Welcome } from './components/Welcome'
import { Done, Empty } from './components/Done'
import { Filters } from './components/Filters'
import { GradeBar } from './components/GradeBar'
import { Piles } from './components/Piles'
import { TopBar } from './components/TopBar'
import { check } from './lib/answer'
import { answerOf, DECK_VERSION } from './lib/deck'
import { countMatching, previewIntervals, Rating, State } from './lib/scheduler'
import { useSession } from './lib/session'
import { setSettings, useSettings } from './lib/settings'
import { preload, speak, stopSpeaking } from './lib/tts'
import { useAuth } from './lib/auth'
import { syncNow } from './lib/sync'

const PILE_ROTATE = [-10, -3, 3, 10]
/** The grade a typed answer points to. */
const SUGGEST = { right: Rating.Good, close: Rating.Hard, wrong: Rating.Again } as const
const Progress = lazy(() => import('./components/Progress'))

export default function App() {
  const settings = useSettings()
  const { ready, queue, day, currentRow, learned, grade, undo, canUndo, learnMore, reload, saveError, drilling, startDrill, exitDrill } = useSession()
  const auth = useAuth()
  const card = queue?.current ?? null

  const [flipped, setFlipped] = useState(false)
  const [showMap, setShowMap] = useState(false)
  const [seq, setSeq] = useState(0)
  const [exitTarget, setExitTarget] = useState<ExitTarget | null>(null)
  const [busy, setBusy] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [progressOpen, setProgressOpen] = useState(false)
  const [pileCounts, setPileCounts] = useState<[number, number, number, number]>([0, 0, 0, 0])
  const [answer, setAnswer] = useState('')
  const [typed, setTyped] = useState<Typed | null>(null)

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
    if (shown.seq === seq) {
      setFlipped(false)
      setShowMap(false)
      setExitTarget(null)
    }
  }

  // Pull the latest progress when the app opens signed in, and whenever it comes back into view.
  useEffect(() => {
    if (!ready || !auth) return
    const run = () =>
      syncNow()
        .then((changed) => {
          if (changed) void reload()
        })
        .catch(() => {})
    run()
    const onVisible = () => document.visibilityState === 'visible' && run()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, auth?.user.id])

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
    const text = settings.typeAnswers ? answer.trim() : ''
    if (text) setTyped({ kind: check(text, card), text })
    setFlipped(true)
    if (settings.autoplay) speak(answerOf(card))
  }, [card, flipped, busy, settings.autoplay, settings.typeAnswers, answer])
  const suggested = typed ? SUGGEST[typed.kind] : null

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
      if (e.key === 'Escape') return setFiltersOpen(false)
      if (filtersOpen || progressOpen || e.repeat) return
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
        case '4':
          if (flipped) doGrade(Number(e.key) as Grade)
          break
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
        case 'p':
        case 'P':
          setFiltersOpen(false)
          setProgressOpen(true)
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
  }, [flip, doGrade, doUndo, know, say, card, flipped, filtersOpen, progressOpen, suggested])

  const filtersActive = settings.regions.length > 0 || settings.kinds.length > 0 || settings.types.length > 0
  const empty = useMemo(() => countMatching(settings) === 0, [settings])
  const progress = queue && queue.total > 0 ? queue.done / queue.total : 0

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative flex h-full touch-manipulation flex-col bg-page">
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
          drilling={drilling}
          onExitDrill={exitDrill}
        />
        <div className="mx-4 h-px bg-line sm:mx-6">
          <div className="h-full bg-ink transition-[width] duration-500 ease-out" style={{ width: `${progress * 100}%` }} />
        </div>

        {saveError && (
          <div role="alert" className="mx-4 mt-3 rounded-xl bg-again/10 px-3 py-2 text-center text-[12.5px] text-again sm:mx-6">
            This browser couldn't save your progress. Grades from now on may be lost when you close the page.
          </div>
        )}

        <AnimatePresence>{filtersOpen && <Filters key="filters" onClose={() => setFiltersOpen(false)} />}</AnimatePresence>
        <AnimatePresence>
          {progressOpen && (
            <Suspense key="progress" fallback={null}>
              <Progress onClose={() => setProgressOpen(false)} onDrill={startDrill} />
            </Suspense>
          )}
        </AnimatePresence>

        <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-4 short:gap-3">
          <div ref={stageRef} className="relative h-[min(420px,50dvh)] w-[min(560px,100%)] short:h-[min(420px,60dvh)]">
            <AnimatePresence custom={exitTarget} initial={false}>
              {ready && card && currentRow && (
                <Card key={`${card.id}:${seq}`} card={card} row={currentRow} flipped={flipped}
                  showMap={showMap}
                  onFlip={flip}
                  onGrade={doGrade}
                  onSpeak={say}
                  onToggleMap={() => setShowMap((v) => !v)}
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
                  onLearnMore={() => learnMore(20)}
                  onOpenProgress={() => setProgressOpen(true)}
                />
              )}
            </AnimatePresence>
          </div>
          <div className="w-[min(560px,100%)]">
            {card ? (
              <GradeBar flipped={flipped} intervals={intervals} isNew={isNew} onFlip={flip} onGrade={doGrade} disabled={busy} suggested={suggested} />
            ) : (
              <div className="h-16" />
            )}
          </div>
        </main>

        <div className="mx-auto w-[min(592px,100%)] px-4 pb-4">
          <Piles counts={pileCounts} refs={pileRefs} />
        </div>

        <footer className="flex h-11 shrink-0 items-center justify-between gap-6 whitespace-nowrap px-4 text-[11px] text-ink-3 sm:px-6">
          <div className="flex shrink-0 items-center gap-2">
            <Welcome />
            <span className="mx-1 hidden lg:inline">·</span>
            <span className="hidden items-center gap-2 lg:flex">
            <kbd>space</kbd> flip <span className="mx-1">·</span> <kbd>1</kbd>–<kbd>4</kbd> grade <span className="mx-1">·</span>{' '}
            <kbd>z</kbd> undo <span className="mx-1">·</span> <kbd>k</kbd> know <span className="mx-1">·</span> <kbd>s</kbd> say <span className="mx-1">·</span> <kbd>m</kbd> map <span className="mx-1">·</span> <kbd>p</kbd> progress
            </span>
          </div>
          <div className="truncate">
            <a href="https://github.com/anki-geo/ultimate-geography" className="hover:text-ink" target="_blank" rel="noreferrer">
              Ultimate Geography {DECK_VERSION}
            </a>
            <span className="hidden md:inline"> · deck public domain · images CC BY-SA / CC0,</span>{' '}
            <a
              href="https://github.com/anki-geo/ultimate-geography/blob/master/src/media/sources.csv"
              className="hover:text-ink"
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
