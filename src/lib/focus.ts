const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** For a modal's keydown listener: keeps Tab and Shift+Tab inside `box`, wrapping from the last control to the first and back. */
export function trapTab(e: KeyboardEvent, box: HTMLElement | null) {
  if (e.key !== 'Tab' || !box) return
  const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0 && !el.closest('[inert]'))
  const first = items[0]
  const last = items[items.length - 1]
  const at = document.activeElement
  const inside = !!at && at !== box && box.contains(at)
  let to: HTMLElement | undefined
  if (!first) to = box
  else if (!inside) to = e.shiftKey ? last : first
  else if (e.shiftKey && at === first) to = last
  else if (!e.shiftKey && at === last) to = first
  if (!to) return
  e.preventDefault()
  to.focus()
}

/** Puts focus back on whatever had it before a dialog opened, or failing that just out of the dialog. */
export function restoreFocus(to: Element | null, box: HTMLElement | null) {
  if (to instanceof HTMLElement && to !== document.body && to.isConnected && !box?.contains(to)) to.focus({ preventScroll: true })
  else if (box && document.activeElement instanceof HTMLElement && box.contains(document.activeElement)) document.activeElement.blur()
}
