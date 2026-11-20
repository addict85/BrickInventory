// Keyboard handling for all dialogs in one place: Escape, focus moving in, Tab stays inside, focus moving back.
// Closing happens via the data-dialog-zu button, so the same cleanup runs as a click on ✕.

// `summary` belongs in the list: without it, the trap would jump back to the start right before "More
// actions", and everything after it would be unreachable by keyboard.
const FOCUSABLE =
  'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';

/**
 * Open means: class `open`, or an inline `display` other than none (confirm, PDF).
 * @param {HTMLElement} el
 */
export function isOpen(el) {
  return el.style.display ? el.style.display !== 'none' : el.classList.contains('open');
}

function dialogs() {
  return /** @type {HTMLElement[]} */ ([...document.querySelectorAll('.ovl[role="dialog"]')]);
}

/** The topmost open dialog: highest z-index, and on a tie the later one in the markup. */
export function topDialog() {
  /** @type {HTMLElement | null} */
  let best = null;
  let bestZ = -Infinity;
  for (const el of dialogs()) {
    if (!isOpen(el)) continue;
    const z = parseInt(el.style.zIndex || getComputedStyle(el).zIndex, 10) || 0;
    if (z >= bestZ) {
      best = el;
      bestZ = z;
    }
  }
  return best;
}

/** @param {HTMLElement & { disabled?: boolean }} el */
function visible(el) {
  if (el.disabled || el.closest('[hidden]')) return false;
  return typeof el.checkVisibility === 'function' ? el.checkVisibility() : true;
}

/** @param {HTMLElement} dialog */
function focusTargets(dialog) {
  return /** @type {HTMLElement[]} */ ([...dialog.querySelectorAll(FOCUSABLE)]).filter(visible);
}

/**
 * Initial focus: `[data-erstfokus]`, else the dialog itself — a text field would open the keyboard on the
 * phone.
 * @param {HTMLElement} dialog
 */
function focusInto(dialog) {
  if (dialog.contains(document.activeElement)) return;
  const target = /** @type {HTMLElement | null} */ (dialog.querySelector('[data-erstfokus]'));
  if (target && visible(target)) {
    target.focus();
    return;
  }
  focusPanel(dialog);
}

/** @param {HTMLElement} dialog */
function focusPanel(dialog) {
  const panel = /** @type {HTMLElement} */ (dialog.firstElementChild || dialog);
  if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
  panel.focus({ preventScroll: true });
}

const _before = new WeakMap();
const _wasOpen = new WeakMap();
/** @type {((dialog: HTMLElement, open: boolean) => void)[]} */
const _listeners = [];

/**
 * Callback for every open and close (the router uses it to drive history).
 * @param {(dialog: HTMLElement, open: boolean) => void} fn
 */
export function onDialogChange(fn) {
  _listeners.push(fn);
}

/** @param {HTMLElement} dialog */
function stateChanged(dialog) {
  const open = isOpen(dialog);
  if (open === _wasOpen.get(dialog)) return;
  _wasOpen.set(dialog, open);
  for (const h of _listeners) h(dialog, open);
  if (open) {
    const active = document.activeElement;
    if (active && active !== document.body && !dialog.contains(active)) _before.set(dialog, active);
    focusInto(dialog);
  } else {
    const back = _before.get(dialog);
    _before.delete(dialog);
    // Only when focus is still inside the now-closed dialog (or nowhere) — whoever clicked elsewhere in
    // the meantime is not yanked back.
    const active = document.activeElement;
    const orphaned = !active || active === document.body || dialog.contains(active);
    if (!orphaned) return;
    const target = returnTarget(back);
    if (target) {
      target.focus({ preventScroll: true });
      return;
    }
    const under = topDialog();
    if (under) {
      focusPanel(under);
      return;
    }
    // Opened via an address, there is no trigger: then the view's heading instead of <body>.
    focusHeading();
  }
}

function focusHeading() {
  const heading = /** @type {HTMLElement|null} */ (document.querySelector('#app .tab.active h1'));
  if (heading && visible(heading)) {
    if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}

// If the focused element disappears (card deleted, list redrawn, toast closed), focus would fall back to
// <body> (WCAG 2.4.3). Then the same element redrawn, else its neighbor, else the heading.
const ENTRY = '.sc, tr[data-arg], .part-card, .man-tile, .mk-zeile';
/** @type {{ el: Element, locations: string[] } | null} */
let _focus = null;
/** @param {Element | null} e */
function location(e) {
  if (!e) return '';
  const args = ['data-arg', 'data-arg2', 'data-arg3'].filter(a => e.hasAttribute(a));
  if (!args.length) return '';
  const kind = e.classList[0] ? `.${CSS.escape(e.classList[0])}` : e.tagName.toLowerCase();
  return kind + args.map(a => `[${a}="${CSS.escape(e.getAttribute(a) || '')}"]`).join('');
}
/** @param {FocusEvent} ev */
function focusRemembered(ev) {
  const el = /** @type {Element} */ (ev.target);
  const entry = el.closest?.(ENTRY);
  const neighbor = (/** @type {'next' | 'previous'} */ r) => {
    let x = entry?.[`${r}ElementSibling`];
    while (x && !x.matches(ENTRY)) x = x[`${r}ElementSibling`];
    return location(x || null);
  };
  _focus = {
    el,
    locations: [location(el), location(entry || null), neighbor('next'), neighbor('previous')].filter(Boolean),
  };
}
function focusLost() {
  if (!_focus || _focus.el.isConnected || topDialog()) return;
  const active = document.activeElement;
  if (active && active !== document.body) return;
  const { locations } = _focus;
  _focus = null;
  for (const o of locations) {
    const target = /** @type {HTMLElement | null} */ (document.querySelector(`#app .tab.active ${o}`));
    if (target && visible(target)) {
      target.focus({ preventScroll: true });
      if (document.activeElement === target) return;
    }
  }
  focusHeading();
}

/**
 * Where focus goes back to after closing. If the trigger sat inside a <details> that has since collapsed
 * ("More actions"), it is invisible and would not take focus — then its <summary> instead.
 * @param {HTMLElement} el
 */
function returnTarget(el) {
  if (!el?.isConnected) return null;
  if (visible(el)) return el;
  const summary = /** @type {HTMLElement | null | undefined} */ (
    el.closest('details:not([open])')?.querySelector(':scope > summary')
  );
  return summary && visible(summary) ? summary : null;
}

/** @param {KeyboardEvent} ev */
function keyPressed(ev) {
  const dialog = topDialog();
  if (!dialog) return;
  if (ev.key === 'Escape') {
    // Escape closes on the first press, even from a field. The exception is fields in a table
    // (corrections in the wanted-list preview): there it only leaves the cell, so that not every
    // correction vanishes along with the dialog.
    const active = /** @type {HTMLElement | null} */ (document.activeElement);
    if (
      active &&
      dialog.contains(active) &&
      /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) &&
      active.closest('table')
    ) {
      ev.preventDefault();
      active.blur();
      // To the panel, not to the initial focus target: if that's a text field, you'd be back inside it,
      // and Escape would never get you out of the dialog.
      focusPanel(dialog);
      return;
    }
    // An open disclosure menu inside the dialog ("More actions") closes first, like any menu per APG;
    // only the next Escape closes the dialog.
    const menu = /** @type {HTMLDetailsElement | null | undefined} */ (active?.closest('details[open]'));
    if (menu && dialog.contains(menu)) {
      ev.preventDefault();
      ev.stopPropagation();
      menu.open = false;
      /** @type {HTMLElement | null} */ (menu.querySelector(':scope > summary'))?.focus();
      return;
    }
    const closeBtn = /** @type {HTMLElement | null} */ (dialog.querySelector('[data-dialog-zu]'));
    if (!closeBtn) return;
    ev.preventDefault();
    ev.stopPropagation();
    closeBtn.click();
    return;
  }
  if (ev.key !== 'Tab') return;
  const targets = focusTargets(dialog);
  if (!targets.length) {
    ev.preventDefault();
    return;
  }
  const first = targets[0],
    last = targets[targets.length - 1];
  const active = document.activeElement;
  if (!dialog.contains(active)) {
    ev.preventDefault();
    first.focus();
  } else if (ev.shiftKey && (active === first || !targets.includes(/** @type {HTMLElement} */ (active)))) {
    ev.preventDefault();
    last.focus();
  } else if (!ev.shiftKey && active === last) {
    ev.preventDefault();
    first.focus();
  }
}

export function initDialogs() {
  const observer = new MutationObserver(entries => {
    for (const e of entries) stateChanged(/** @type {HTMLElement} */ (e.target));
  });
  for (const el of dialogs()) {
    _wasOpen.set(el, isOpen(el));
    observer.observe(el, { attributes: true, attributeFilter: ['class', 'style'] });
  }
  // Capture: ahead of individual modules' own Escape handlers (user menu etc.).
  document.addEventListener('keydown', keyPressed, true);
  document.addEventListener('focusin', focusRemembered, true);
  new MutationObserver(focusLost).observe(document.body, { childList: true, subtree: true });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initDialogs);
  else initDialogs();
}
