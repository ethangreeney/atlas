import { AnimatePresence } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Grade } from 'ts-fsrs'
import { Card, mapsUrl, type ExitTarget } from './components/Card'
import { Welcome } from './components/Welcome'
import { Done } from './components/Done'
import { Filters } from './components/Filters'
import { GradeBar } from './components/GradeBar'
import { Piles } from './components/Piles'
import { TopBar } from './components/TopBar'
import { answerOf, DECK_VERSION } from './lib/deck'
import { previewIntervals, Rating } from './lib/scheduler'
import { useSession } from './lib/session'
import { useSettings } from './lib/settings'
import { preload, speak, stopSpeaking } from './lib/tts'
import { useAuth } from './lib/auth'
import { syncNow } from './lib/sync'

const PILE_ROTATE = [-10, -3, 3, 10]

export default function App() {
  const settings = useSettings()
  const { ready, queue, day, currentRow, learned, grade, undo, canUndo, learnMore, reload } = useSession()
  const auth = useAuth()
  const card = queue?.current ?? null

  const [flipped, setFlipped] = useState(false)
  const [showMap, setShowMap] = useState(false)
  const [seq, setSeq] = useState(0)
  const [exitTarget, setExitTarget] = useState<ExitTarget | null>(null)
  const [busy, setBusy] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [pileCounts, setPileCounts] = useState<[number, number, number, number]>([0, 0, 0, 0])

  const stageRef = useRef<HTMLDivElement>(null)
  const pileRefs = useRef<(HTMLDivElement | null)[]>([])
  const busyRef = useRef(false)

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
    if (card) preload(answerOf(card))
  }, [card])

  const intervals = useMemo(() => (currentRow ? previewIntervals(currentRow, new Date()) : []), [currentRow])

  const flip = useCallback(() => {
    if (!card || flipped || busy) return
    setFlipped(true)
  }, [card, flipped, busy])

  const say = useCallback(() => {
    if (!card || !flipped) return
    speak(answerOf(card))
  }, [card, flipped])

  const doGrade = useCallback(
    (g: Grade) => {
      if (!card || !flipped || busy || busyRef.current) return
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
      void grade(card, g)
      setTimeout(() => {
        busyRef.current = false
        setBusy(false)
      }, 220)
    },
    [card, flipped, busy, grade],
  )

  const doUndo = useCallback(() => {
    if (!canUndo || busy) return
    setExitTarget(null)
    setFlipped(false)
    setShowMap(false)
    setSeq((s) => s + 1)
    void undo()
  }, [canUndo, busy, undo])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
      if (e.key === 'Escape') return setFiltersOpen(false)
      if (filtersOpen) return
      // A focused button would also fire on space/enter; we handle those ourselves.
      if (t.tagName === 'BUTTON') t.blur()
      switch (e.code === 'Space' ? ' ' : e.key) {
        case ' ':
        case 'Spacebar':
        case 'Enter':
          e.preventDefault()
          if (flipped) doGrade(Rating.Good)
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
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flip, doGrade, doUndo, say, card, flipped, filtersOpen])

  const filtersActive = settings.regions.length > 0 || settings.types.length > 0
  const progress = queue && queue.total > 0 ? queue.done / queue.total : 0

  return (
    <div className="flex h-full flex-col bg-white">
      <TopBar
        queue={queue}
        learned={learned}
        canUndo={canUndo}
        filtersOpen={filtersOpen}
        filtersActive={filtersActive}
        onUndo={doUndo}
        onToggleFilters={() => setFiltersOpen((o) => !o)}
        onSynced={reload}
      />
      <div className="mx-4 h-px bg-line sm:mx-6">
        <div className="h-full bg-ink transition-[width] duration-500 ease-out" style={{ width: `${progress * 100}%` }} />
      </div>

      <AnimatePresence>{filtersOpen && <Filters key="filters" onClose={() => setFiltersOpen(false)} />}</AnimatePresence>

      <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-4">
        <div ref={stageRef} className="relative h-[min(420px,50dvh)] w-[min(560px,100%)]">
          <AnimatePresence custom={exitTarget} initial={false}>
            {ready && card && currentRow && (
              <Card key={`${card.id}:${seq}`} card={card} row={currentRow} flipped={flipped}
                showMap={showMap}
                onFlip={flip}
                onSpeak={say}
                onToggleMap={() => setShowMap((v) => !v)}
              />
            )}
            {ready && queue && !card && <Done key="done" queue={queue} learned={learned} onLearnMore={() => learnMore(20)} />}
          </AnimatePresence>
        </div>
        <div className="w-[min(560px,100%)]">
          {card ? (
            <GradeBar flipped={flipped} intervals={intervals} onFlip={flip} onGrade={doGrade} disabled={busy} />
          ) : (
            <div className="h-16" />
          )}
        </div>
      </main>

      <div className="mx-auto w-[min(720px,100%)] px-6 pb-2">
        <Piles counts={pileCounts} refs={pileRefs} />
      </div>

      <footer className="flex h-11 shrink-0 items-center justify-between gap-6 whitespace-nowrap px-4 text-[11px] text-ink-3 sm:px-6">
        <div className="flex shrink-0 items-center gap-2">
          <Welcome />
          <span className="mx-1 hidden lg:inline">·</span>
          <span className="hidden items-center gap-2 lg:flex">
          <kbd>space</kbd> flip <span className="mx-1">·</span> <kbd>1</kbd>–<kbd>4</kbd> grade <span className="mx-1">·</span>{' '}
          <kbd>z</kbd> undo <span className="mx-1">·</span> <kbd>s</kbd> say <span className="mx-1">·</span> <kbd>m</kbd> map
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
  )
}
