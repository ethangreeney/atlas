import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App'
import { refreshReminder } from './lib/push'
import { updateWaiting } from './lib/update'

// New versions install in the background and the page reloads once they take over, so nobody keeps running a stale
// build (an app opened before an update once graded a morning's cards with an already-fixed bug). Also re-check when
// the tab comes back into view. The reload never lands mid-card: it goes at once if nothing's been touched since the
// app came into view, otherwise once the next answer is saved, after a minute without input, or when it's hidden.
let lastInput = 0
for (const type of ['pointerdown', 'keydown']) addEventListener(type, () => (lastInput = Date.now()), { capture: true, passive: true })
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && (lastInput = 0))
const IDLE_MS = 60_000
const reloadWhenIdle = () => (document.visibilityState === 'hidden' || Date.now() - lastInput > IDLE_MS) && location.reload()
const update = registerSW({
  immediate: true,
  onNeedReload() {
    updateWaiting()
    reloadWhenIdle()
    document.addEventListener('visibilitychange', reloadWhenIdle)
    setInterval(reloadWhenIdle, 10_000)
  },
  onRegisteredSW(_url, reg) {
    if (!reg) return
    const check = () => reg.update().catch(() => {})
    setInterval(check, 60 * 60_000)
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check())
  },
})
void update
void refreshReminder().catch(() => {})

// Clip caches from older builds: bump the name in vite.config.ts whenever the clips are re-rendered.
if ('caches' in window) for (const old of ['audio', 'voice']) void caches.delete(old).catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
