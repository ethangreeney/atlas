// Runs the official FSRS optimizer (fsrs-rs compiled to WebAssembly) off the main thread.
// Single-threaded: the thread pool would need cross-origin isolation, which the Google sign-in popup can't live with.
import init, { Fsrs } from 'fsrs-browser'

export type FitRequest = { ratings: Uint32Array; deltas: Uint32Array; lengths: Uint32Array }

self.onmessage = async (e: MessageEvent<FitRequest>) => {
  try {
    await init()
    const { ratings, deltas, lengths } = e.data
    const w = new Fsrs().computeParameters(ratings, deltas, lengths, undefined, true)
    self.postMessage({ w: Array.from(w) })
  } catch (err) {
    self.postMessage({ error: String(err) })
  }
}
