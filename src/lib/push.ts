import { api, getAuth } from './auth'

/** Daily reminders: a Web Push subscription stored on the server, sent by the worker in reminders/. */
const VAPID_KEY: string | undefined = import.meta.env.VITE_VAPID_PUBLIC_KEY
const HOUR_KEY = 'atlas.reminder.hour'
const DEFAULT_HOUR = 19

/** iPhone or iPad Safari in a normal tab. Web push only works there once Atlas is added to the Home Screen. */
export const iosBrowserTab = () => {
  const ua = navigator.userAgent
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) // iPadOS reports as a Mac
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches
  return ios && !standalone
}

/** The service worker, if this browser can do push at all and one is registered (not in `vite dev`). */
export const pushRegistration = async () => {
  if (!VAPID_KEY || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return null
  return (await navigator.serviceWorker.getRegistration().catch(() => undefined)) ?? null
}

export const currentSubscription = async () => (await (await pushRegistration())?.pushManager.getSubscription()) ?? null

export const reminderHour = () => {
  try {
    const h = Number(localStorage.getItem(HOUR_KEY) ?? DEFAULT_HOUR)
    return Number.isInteger(h) && h >= 0 && h <= 23 ? h : DEFAULT_HOUR
  } catch {
    return DEFAULT_HOUR
  }
}

const key = () => Uint8Array.from(atob(VAPID_KEY!.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
const sameKey = (a: ArrayBuffer | null, b: Uint8Array) => !!a && a.byteLength === b.length && new Uint8Array(a).every((x, i) => x === b[i])

/** Tell the server where and when to remind: this browser's subscription, its time zone and the chosen hour. */
async function save(sub: PushSubscription, hour: number) {
  const { endpoint, keys } = sub.toJSON()
  await api('/api/push', { method: 'POST', body: JSON.stringify({ endpoint, keys, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, hour }) })
}

/** Ask for permission (call from a tap), subscribe, and register with the server. Returns the permission. */
export async function enableReminders(hour: number) {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission
  const reg = await pushRegistration()
  if (!reg) throw new Error('No service worker')
  const k = key()
  let sub = await reg.pushManager.getSubscription()
  // Subscribed with a key that has since been replaced: the push service would reject our pushes.
  if (sub && !sameKey(sub.options.applicationServerKey, k)) {
    await sub.unsubscribe()
    sub = null
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: k })
  await save(sub, hour)
  return permission
}

export async function setReminderHour(hour: number) {
  try {
    localStorage.setItem(HOUR_KEY, String(hour))
  } catch {
    /* private mode */
  }
  const sub = await currentSubscription()
  if (sub && getAuth()) await save(sub, hour)
}

/** Stop reminders on this browser. The server forgets it too, or finds out on the next send if this request fails. */
export async function disableReminders() {
  const sub = await currentSubscription()
  if (!sub) return
  if (getAuth()) await api('/api/push', { method: 'DELETE', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {})
  await sub.unsubscribe()
}

/** On load, re-send the subscription so it follows the time zone the device is in now. */
export async function refreshReminder() {
  if (!getAuth()) return
  const sub = await currentSubscription()
  if (sub) await save(sub, reminderHour())
}
