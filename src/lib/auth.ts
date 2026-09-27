import { useSyncExternalStore } from 'react'

export type User = { id: string; email: string; name: string; picture: string }
type Auth = { token: string; user: User } | null

const KEY = 'atlas.auth'
/** What's stored now, which another tab may have changed; undefined if storage can't be read. */
const stored = (): Auth | undefined => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null')
  } catch {
    return undefined
  }
}
let current: Auth = stored() ?? null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export const getAuth = () => current

/** Another tab has signed in or out since this one loaded, and this tab may not have heard yet. Sync waits on it. */
export const authChanged = () => {
  const s = stored()
  return s !== undefined && s?.user.id !== current?.user.id
}

// Another tab signed in or out. Progress on this device follows the account, so what this tab holds in memory is now
// someone else's or being cleared: start over from what's stored rather than write it back. The same account (a
// fresh token) just carries on.
window.addEventListener('storage', (e) => {
  if (e.key !== KEY && e.key !== null) return
  if (authChanged()) return location.reload()
  current = stored() ?? current
  emit()
})

export const useAuth = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    getAuth,
  )

const setAuth = (a: Auth) => {
  current = a
  try {
    if (a) localStorage.setItem(KEY, JSON.stringify(a))
    else localStorage.removeItem(KEY)
  } catch {
    /* private mode */
  }
  emit()
}

export const signOut = () => setAuth(null)

/** Asked before a sign-in takes effect; false keeps things as they are. Sync sets it (it knows what would be lost). */
let beforeSignIn: (uid: string) => Promise<boolean> = async () => true
export const setBeforeSignIn = (f: typeof beforeSignIn) => {
  beforeSignIn = f
}

/** Sign-in is only offered when the server has a Google client id configured. */
let clientId: Promise<string | null> | null = null
export const getGoogleClientId = () => {
  clientId ??= fetch('/api/config')
    .then((r) => (r.ok ? r.json() : { googleClientId: null }))
    .then((c: { googleClientId: string | null }) => c.googleClientId)
    .catch(() => null)
  return clientId
}

type TokenClient = { requestAccessToken: () => void }
declare global {
  interface Window {
    google?: { accounts: { oauth2: { initTokenClient: (o: object) => TokenClient } } }
  }
}

let gis: Promise<void> | null = null
const loadGis = () => {
  gis ??= new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve()
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Could not load Google sign-in'))
    document.head.appendChild(s)
  })
  return gis
}

/** Opens Google's popup, then trades the access token for an Atlas session. */
export async function signInWithGoogle(): Promise<User> {
  const id = await getGoogleClientId()
  if (!id) throw new Error('Sign-in not configured')
  await loadGis()
  const access_token = await new Promise<string>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: id,
      scope: 'openid email profile',
      callback: (r: { access_token?: string; error?: string }) => (r.access_token ? resolve(r.access_token) : reject(new Error(r.error ?? 'Cancelled'))),
      error_callback: (e: { type?: string }) => reject(new Error(e.type ?? 'Cancelled')),
    })
    client.requestAccessToken()
  })
  const res = await fetch('/api/auth/google', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ access_token }) })
  if (!res.ok) throw new Error('Sign-in failed')
  const { token, user } = (await res.json()) as { token: string; user: User }
  if (!(await beforeSignIn(user.id))) throw new Error('Cancelled')
  setAuth({ token, user })
  return user
}

export async function api(path: string, init: RequestInit = {}) {
  const a = getAuth()
  if (!a) throw new Error('Not signed in')
  const res = await fetch(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${a.token}`, 'content-type': 'application/json' } })
  if (res.status === 401) {
    // Not if another tab has signed in again since: its token is fine.
    if ((stored() ?? current)?.token === a.token) setAuth(null)
    throw new Error('Session expired')
  }
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}
