let voices: SpeechSynthesisVoice[] = []
const load = () => {
  if (typeof speechSynthesis === 'undefined') return
  voices = speechSynthesis.getVoices()
}
if (typeof speechSynthesis !== 'undefined') {
  load()
  speechSynthesis.addEventListener('voiceschanged', load)
}

const norm = (l: string) => l.replace('_', '-').toLowerCase()

/**
 * Names are read in English, in the user's own dialect: the browser's language list first
 * (en-NZ in New Zealand, en-US in America), then the common English locales as fallbacks.
 */
const preferred = () => {
  const own = (typeof navigator !== 'undefined' ? navigator.languages : []).map(norm).filter((l) => l.startsWith('en'))
  return [...new Set([...own, 'en-us', 'en-gb', 'en-au', 'en-nz', 'en-ie', 'en-za', 'en-in'])]
}

// macOS novelty and legacy voices that should never be picked.
const JUNK =
  /albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|eddy|flo|fred|good news|grandma|grandpa|hysterical|jester|junior|kathy|organ|ralph|reed|rocko|sandy|shelley|superstar|trinoids|whisper|wobble|zarvox|compact|eloquence/

const quality = (v: SpeechSynthesisVoice) => {
  const n = v.name.toLowerCase()
  if (JUNK.test(n)) return 0
  if (/natural|neural|premium|enhanced|siri/.test(n)) return 4
  if (n.startsWith('google') || n.startsWith('microsoft')) return 3
  if (!v.localService) return 2
  return 1
}

export function pickVoice() {
  const order = preferred()
  const rank = (v: SpeechSynthesisVoice) => {
    const i = order.indexOf(norm(v.lang))
    return i === -1 ? order.length : i
  }
  const en = voices.filter((v) => norm(v.lang).startsWith('en') && quality(v) > 0)
  return en.sort((a, b) => rank(a) - rank(b) || quality(b) - quality(a))[0] ?? null
}

export function speak(text: string) {
  if (typeof speechSynthesis === 'undefined' || !text) return
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  const v = pickVoice()
  if (v) u.voice = v
  u.lang = v?.lang ?? (typeof navigator !== 'undefined' ? navigator.language : 'en')
  u.rate = 0.95
  speechSynthesis.speak(u)
}

export const stopSpeaking = () => typeof speechSynthesis !== 'undefined' && speechSynthesis.cancel()
