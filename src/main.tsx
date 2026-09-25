import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App'
import { refreshReminder } from './lib/push'

// New versions install in the background and the page reloads once they take over,
// so nobody keeps running a stale build. Also re-check when the tab comes back into view.
// The reload waits until the tab is hidden, so it never lands mid-card.
const reloadWhenHidden = () => document.visibilityState === 'hidden' && location.reload()
const update = registerSW({
  immediate: true,
  onNeedReload() {
    reloadWhenHidden()
    document.addEventListener('visibilitychange', reloadWhenHidden)
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
