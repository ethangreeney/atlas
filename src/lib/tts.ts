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

const pick = (lang: string) => {
  const exact = voices.find((v) => v.lang.replace('_', '-').toLowerCase() === lang.toLowerCase())
  if (exact) return exact
  const base = lang.split('-')[0].toLowerCase()
  return voices.find((v) => v.lang.toLowerCase().startsWith(base)) ?? null
}

// The deck writes capitals in Latin script, which voices for these scripts read badly. Use English there.
const NON_LATIN = new Set(['ar', 'fa', 'he', 'ur', 'hi', 'bn', 'ne', 'si', 'th', 'km', 'lo', 'my', 'zh', 'ja', 'ko', 'ka', 'hy', 'am', 'ti', 'el', 'ru', 'uk', 'be', 'bg', 'mk', 'sr', 'mn', 'kk', 'ky', 'tg', 'dz', 'bo'])

export const langForCapital = (country: string) => {
  const lang = CAPITAL_LANG[country] ?? DEFAULT_LANG
  return NON_LATIN.has(lang.split('-')[0]) ? DEFAULT_LANG : lang
}

export function speak(text: string, lang = DEFAULT_LANG) {
  if (typeof speechSynthesis === 'undefined' || !text) return
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  const v = pick(lang) ?? pick(DEFAULT_LANG)
  if (v) u.voice = v
  u.lang = v?.lang ?? lang
  u.rate = 0.95
  speechSynthesis.speak(u)
}

export const stopSpeaking = () => typeof speechSynthesis !== 'undefined' && speechSynthesis.cancel()
