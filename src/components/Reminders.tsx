import { useEffect, useId, useState } from 'react'
import { getGoogleClientId, useAuth } from '../lib/auth'
import { currentSubscription, disableReminders, enableReminders, iosBrowserTab, pushRegistration, reminderHour, setReminderHour } from '../lib/push'

const BLOCKED = 'Blocked in browser settings'
const HOURS = Array.from({ length: 24 }, (_, h) => h)
const hourLabel = (h: number) => new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2000, 0, 1, h))

const Track = ({ on }: { on: boolean }) => (
  <span className={`relative h-5 w-8 shrink-0 rounded-full transition-colors ${on ? 'bg-ink' : 'bg-muted-2'}`}>
    <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full shadow-sm transition-transform ${on ? 'translate-x-3 bg-on-ink' : 'bg-knob'}`} />
  </span>
)

type Status = 'loading' | 'hidden' | 'homescreen' | 'ready'
/** What the last mount found, so reopening the panel doesn't pop the row in while the checks rerun. */
let last: { status: Status; on: boolean } = { status: 'loading', on: false }

/**
 * "Daily reminder" switch with the hour to send it at. Signed-in accounts only, since the server needs to know
 * whether today's cards are done. Hidden where push can't work, except on iOS where a Home Screen install enables it.
 */
export function Reminders() {
  const auth = useAuth()
  const id = useId()
  const [status, setStatus] = useState(last.status)
  const [on, setOn] = useState(last.on)
  const [hour, setHour] = useState(reminderHour)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      const [signIn, reg] = await Promise.all([getGoogleClientId(), pushRegistration()])
      const sub = reg && (await currentSubscription())
      if (!live) return
      setOn(!!sub)
      if (!sub && reg && Notification.permission === 'denied') setNote(BLOCKED)
      setStatus(!signIn ? 'hidden' : reg ? 'ready' : iosBrowserTab() ? 'homescreen' : 'hidden')
    })()
    return () => {
      live = false
    }
  }, [])
  useEffect(() => {
    last = { status, on }
  }, [status, on])

  if (status === 'loading' || status === 'hidden') return null
  if (status === 'homescreen') return <div className="flex min-h-9 items-center">Add Atlas to your Home Screen to get reminders</div>

  const toggle = async () => {
    if (busy) return
    setBusy(true)
    setNote(null)
    setOn(!on)
    try {
      if (on) await disableReminders()
      else {
        const permission = await enableReminders(hour)
        if (permission !== 'granted') {
          setOn(false)
          if (permission === 'denied') setNote(BLOCKED)
        }
      }
    } catch {
      setOn(on)
      setNote(on ? "Couldn't turn off" : "Couldn't turn on")
    } finally {
      setBusy(false)
    }
  }

  const pick = (h: number) => {
    setHour(h)
    setNote(null)
    setReminderHour(h).catch(() => setNote("Couldn't save"))
  }

  const disabled = !auth || note === BLOCKED
  return (
    <div className="flex min-h-9 items-center justify-between gap-3">
      <label htmlFor={id} className={`flex-1 ${disabled ? '' : 'cursor-pointer'}`}>
        Daily reminder
      </label>
      {!auth ? (
        <span>Sign in to get reminders</span>
      ) : note ? (
        <span className={note.startsWith('Couldn') ? 'text-again' : ''}>{note}</span>
      ) : (
        <select
          aria-label="Reminder time"
          value={hour}
          onChange={(e) => pick(Number(e.target.value))}
          className={`cursor-pointer appearance-none bg-transparent text-right tabular-nums outline-none transition-colors hover:text-ink focus-visible:text-ink ${on ? 'text-ink-2' : ''}`}
        >
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {hourLabel(h)}
            </option>
          ))}
        </select>
      )}
      <button id={id} role="switch" aria-checked={on} onClick={toggle} disabled={disabled} className="flex min-h-9 items-center disabled:opacity-40">
        <Track on={on} />
      </button>
    </div>
  )
}
