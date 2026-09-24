import manifest from '../data/audio.json'

const CLIPS = manifest as Record<string, string>

/**
 * Pronunciation is pre-recorded with neural voices in British and American English;
 * the browser's locale picks one (NZ, AU, UK, IE, ZA, IN → gb; everyone else → us).
 */
const dialect = (() => {
  const langs = typeof navigator !== 'undefined' ? navigator.languages.map((l) => l.toLowerCase()) : []
  for (const l of langs) {
    if (/^en-(nz|au|gb|ie|za|in|sg|ke|ng)/.test(l)) return 'gb'
    if (/^en/.test(l)) return 'us'
  }
  return 'us'
})()

const url = (text: string) => (CLIPS[text] ? `${import.meta.env.BASE_URL}voice/${dialect}/${CLIPS[text]}` : null)

const cache = new Map<string, HTMLAudioElement>()

/** Warm the clip for a card as soon as it appears so S plays instantly. */
export function preload(text: string) {
  const src = url(text)
  if (!src || cache.has(text)) return
  const a = new Audio(src)
  a.preload = 'auto'
  cache.set(text, a)
  if (cache.size > 24) cache.delete(cache.keys().next().value!)
}

let playing: HTMLAudioElement | null = null

export function speak(text: string) {
  if (!text) return
  stopSpeaking()
  preload(text)
  const a = cache.get(text)
  if (!a) return fallback(text)
  playing = a
  a.currentTime = 0
  a.play().catch(() => fallback(text))
}

export function stopSpeaking() {
  if (playing) {
    playing.pause()
    playing = null
  }
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
}

/** Browser voice, only if a clip is missing or fails to load. */
function fallback(text: string) {
  if (typeof speechSynthesis === 'undefined') return
  const u = new SpeechSynthesisUtterance(text)
  u.lang = typeof navigator !== 'undefined' ? navigator.language : 'en'
  u.rate = 0.95
  speechSynthesis.speak(u)
}
