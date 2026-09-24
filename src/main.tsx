import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App'

// New versions install in the background and the page reloads once they take over,
// so nobody keeps running a stale build. Also re-check when the tab comes back into view.
const update = registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return
    const check = () => reg.update().catch(() => {})
    setInterval(check, 60 * 60_000)
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check())
  },
})
void update

// Clips used to live in an 'audio' cache before pronunciations were redone; drop it so nobody hears the old ones.
if ('caches' in window) void caches.delete('audio').catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
