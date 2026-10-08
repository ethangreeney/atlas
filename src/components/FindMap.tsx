import { Globe, Minus, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Controls, FindHandle, FindResult, View } from '../lib/find/engine'

type Engine = typeof import('../lib/find/engine')
let engine: Engine | null = null
let loading: Promise<Engine> | null = null
/** The map's code and shapes, a few megabytes: fetched once, as soon as the set is on, so its first card isn't waiting. */
export const loadFindMap = () =>
  (loading ??= import('../lib/find/engine').then((m) => (engine = m)).catch((e) => {
    loading = null
    throw e
  }))

type Props = {
  noteId: string
  onResult: (r: FindResult) => void
  /** A wrong place, with tries left. */
  onMiss?: (m: { name: string; left: number }) => void
  /** A click on the map once it's been found. */
  onNext?: () => void
  /** Filled in with the map's controls while it's up: show the answer, zoom, back to the start. */
  control?: React.RefObject<FindHandle | null>
  tries?: number
  /** Open where the last map was left. */
  from?: View | null
  /** Turned to face these places (a continent's, in its test) rather than the middle of the world. */
  face?: string[]
  label: string
  className?: string
  /** Whether Esc goes back to the whole world (in a test, it quits). */
  escFits?: boolean
}

const pill = 'flex w-[34px] flex-col overflow-hidden rounded-full bg-surface shadow-[0_0_0_1px_var(--color-edge),0_1px_3px_var(--color-drop)]'
const btn =
  'relative flex h-[34px] w-[34px] items-center justify-center text-ink-2 transition-colors hover:enabled:bg-subtle hover:enabled:text-ink active:enabled:bg-muted disabled:cursor-default disabled:text-ink-3 disabled:opacity-50'

/**
 * A blank world map to find a place on: drag to pan, scroll or pinch to zoom, click to answer. The same map every time,
 * so it gives nothing away. Zoom buttons in the corner, like any online map (not on a touch screen, which pinches).
 */
export function FindMap({ noteId, onResult, onMiss, onNext, control, tries, from, face, label, className = '', escFits = true }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const ring = useRef<HTMLDivElement>(null)
  const handle = useRef<FindHandle | null>(null)
  const [ready, setReady] = useState(!!engine)
  const [failed, setFailed] = useState(false)
  const [ctl, setCtl] = useState<Controls>({ zoomIn: true, zoomOut: false, home: false })
  // The latest callbacks, so a new one doesn't mean a new map.
  const on = useRef({ onResult, onMiss, onNext })
  useEffect(() => {
    on.current = { onResult, onMiss, onNext }
  })

  useEffect(() => {
    if (ready) return
    let live = true
    loadFindMap()
      .then(() => live && setReady(true))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [ready])

  useEffect(() => {
    if (!ready || !engine || !wrap.current || !canvas.current || !ring.current) return
    const h = engine.mountFind(wrap.current, canvas.current, ring.current, noteId, {
      tries,
      from,
      home: face ? engine.facing(face) : null,
      onResult: (r) => on.current.onResult(r),
      onMiss: (m) => on.current.onMiss?.(m),
      onNext: () => on.current.onNext?.(),
      onControls: setCtl,
    })
    handle.current = h
    if (control) control.current = h
    return () => {
      h.destroy()
      handle.current = null
      if (control?.current === h) control.current = null
    }
    // Where it opens matters only when it's put up for a place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, noteId])

  return (
    <div ref={wrap} className={`relative overflow-hidden bg-[var(--color-sea)] ${className}`}>
      <canvas ref={canvas} aria-label={label} className="absolute inset-0 block h-full w-full cursor-grab touch-none select-none [-webkit-touch-callout:none]" />
      <div ref={ring} aria-hidden className="find-ring" />
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-[13px] text-ink-3">The map couldn't load. Check the connection and try again.</div>
      )}
      <div className="absolute bottom-3 right-3 z-[2] flex flex-col items-center gap-2">
        <div className={pill}>
          <button className={btn} disabled={!ctl.home} onClick={() => handle.current?.fit()} aria-label={escFits ? 'Show the whole world (Esc)' : 'Show the whole world'} title={escFits ? 'Whole world (Esc)' : 'Whole world'}>
            <Globe size={17} strokeWidth={1.75} />
          </button>
        </div>
        <div className={`${pill} pointer-coarse:hidden`}>
          <button className={btn} disabled={!ctl.zoomIn} onClick={() => handle.current?.zoom(2)} aria-label="Zoom in (+)" title="Zoom in (+)">
            <Plus size={17} strokeWidth={1.75} />
          </button>
          <span aria-hidden className="mx-2 h-px bg-line" />
          <button className={btn} disabled={!ctl.zoomOut} onClick={() => handle.current?.zoom(0.5)} aria-label="Zoom out (−)" title="Zoom out (−)">
            <Minus size={17} strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  )
}
