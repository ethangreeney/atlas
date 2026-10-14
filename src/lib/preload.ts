import { useEffect, useRef, useState, type ComponentType, type LazyExoticComponent } from 'react'

/**
 * A screen loaded on demand, but fetched once the app has settled and from then on used directly. Through lazy() alone
 * it would suspend the first time it opens, and React holds back what a suspense reveals by 300ms. Opened before the
 * fetch is done, lazy() it stays, so a screen that's open is never swapped out and reset.
 */
export function usePreloaded<C extends ComponentType<any>>(load: () => Promise<{ default: C }>, Lazy: LazyExoticComponent<C>, open: boolean) {
  const [loaded, setLoaded] = useState<C | null>(null)
  const opened = useRef(false)
  useEffect(() => {
    if (open) opened.current = true
  }, [open])
  useEffect(() => {
    const t = setTimeout(() => void load().then((m) => opened.current || setLoaded(() => m.default)), 2000)
    return () => clearTimeout(t)
  }, [load])
  return loaded ?? Lazy
}
