import { CAPITAL_LANG, DEFAULT_LANG } from '../data/langMap'

let voices: SpeechSynthesisVoice[] = []
const load = () => {
  if (typeof speechSynthesis === 'undefined') return
  voices = speechSynthesis.getVoices()
}
if (typeof speechSynthesis !== 'undefined') {
  load()
  speechSynthesis.addEventListener('voiceschanged', load)
}

// The deck writes capitals in Latin script, which voices for these scripts read badly. Use English there.
const NON_LATIN = new Set(['ar', 'fa', 'he', 'ur', 'hi', 'bn', 'ne', 'si', 'th', 'km', 'lo', 'my', 'zh', 'ja', 'ko', 'ka', 'hy', 'am', 'ti', 'el', 'ru', 'uk', 'be', 'bg', 'mk', 'sr', 'mn', 'kk', 'ky', 'tg', 'dz', 'bo'])

/** Rough quality ranking: neural/cloud voices first, legacy compact system voices last. */
const quality = (v: SpeechSynthesisVoice) => {
  const n = v.name.toLowerCase()
  if (/natural|neural|premium|enhanced|siri/.test(n)) return 4
  if (n.startsWith('google') || n.startsWith('microsoft')) return 3
  if (!v.localService) return 2
  if (/compact|eloquence|fred|albert|bad news|bells|boing|bubbles|cellos|deranged|good news|hysterical|junior|organ|trinoids|whisper|zarvox|ralph|kathy/.test(n)) return 0
  return 1
}

const best = (lang: string, minQuality = 0) => {
  const base = lang.split('-')[0].toLowerCase()
  const pool = voices.filter((v) => v.lang.replace('_', '-').toLowerCase().split('-')[0] === base && quality(v) >= minQuality)
  if (!pool.length) return null
  return pool.sort((a, b) => {
    const q = quality(b) - quality(a)
    if (q) return q
    const exactA = a.lang.replace('_', '-').toLowerCase() === lang.toLowerCase() ? 1 : 0
    const exactB = b.lang.replace('_', '-').toLowerCase() === lang.toLowerCase() ? 1 : 0
    return exactB - exactA
  })[0]
}

export const langForCapital = (country: string) => {
  const lang = CAPITAL_LANG[country] ?? DEFAULT_LANG
  return NON_LATIN.has(lang.split('-')[0]) ? DEFAULT_LANG : lang
}

export function speak(text: string, lang = DEFAULT_LANG) {
  if (typeof speechSynthesis === 'undefined' || !text) return
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  // Only use a foreign-language voice if it is a decent one; a bad accent is worse than plain English.
  const v = (lang !== DEFAULT_LANG ? best(lang, 2) : null) ?? best(DEFAULT_LANG) ?? best('en')
  if (v) u.voice = v
  u.lang = v?.lang ?? lang
  u.rate = 0.95
  speechSynthesis.speak(u)
}

export const stopSpeaking = () => typeof speechSynthesis !== 'undefined' && speechSynthesis.cancel()
