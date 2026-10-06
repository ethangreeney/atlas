/** Set once a new build has taken over in the background: until it reloads, this page is still running the old one. */
let waiting = false
export const updateWaiting = () => {
  waiting = true
}

/** Load the new build at a safe moment: between cards, once the answer just given is saved. */
export const reloadIfUpdated = () => {
  if (waiting) location.reload()
}
