import { tRaw } from '../i18n.js';
import { loggedInAccount } from './state.js';
import { G, ico, setHtml } from './dom.js';

// Toasts: short messages at the bottom of the screen. Identical messages count instead of stacking, so that a repeated
// disruption does not cover the list.

/** Display duration per kind in ms. */
const TOAST_DURATION = { success: 3500, info: 5000, error: 9000 };

/** @type {WeakMap<Element, {key: string, count: number, timer: ReturnType<typeof setTimeout> | null, duration: number}>} */
const _toastStatus = new WeakMap();

/** (Re)start the deadline; without a duration the message stays until someone closes it. @param {HTMLElement} el */
function startDeadline(el) {
  const status = _toastStatus.get(el);
  if (!status) return;
  if (status.timer) clearTimeout(status.timer);
  status.timer = status.duration ? setTimeout(() => el.remove(), status.duration) : null;
}

/** Error texts of the 401 responses: requests still running fail after the
 * end of the session with exactly this text. As a toast it would contradict the one
 * hint in the login card; toast() therefore leaves it out. */
const _messagesTheExpiredSession = new Set();

/**
 * Read a message aloud through one of two fixed live regions: status politely, errors at once. The
 * toasts themselves are not live: a region that appears together with its text is often not announced,
 * and an alert nested in a polite region is announced twice or not at all.
 * @param {string} text @param {boolean} error
 */
function announce(text, error) {
  const region = G(error ? 'announcement-error' : 'announcement-status');
  if (!region) return;
  // Emptied first: the same text again (a second identical error) is otherwise not read.
  region.textContent = '';
  setTimeout(() => {
    region.textContent = text;
  }, 50);
}

/** A message without the counting and the deadline. textContent instead of innerHTML: msg regularly contains
 * server error messages and set/part numbers from user input. @param {unknown} msg @param {string} type
 * @param {{ text: string, fn: () => unknown, stays?: boolean } | undefined} action @param {string | undefined} details */
function toastElement(msg, type, action, details) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = document.createElement('span');
  icon.className = 'toast-ico';
  setHtml(icon, ico(type === 'success' ? 'ok' : type === 'error' ? 'error' : 'info'));
  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = String(msg ?? '');
  const count = document.createElement('span');
  count.className = 'toast-count';
  count.hidden = true;
  el.append(icon, text, count);
  // The cause expandable: seven lines of message covered the list on the phone.
  if (details) text.append(toastDetails(details));
  if (action) appendAction(el, action);
  // An error wants to be read, a confirmation only seen; with a button one also has to hit it. A
  // click on the message clears it, so that it does not cover a card.
  el.addEventListener('click', e => {
    if (e.target === el || !(/** @type {Element} */ (e.target).closest('button, details'))) el.remove();
  });
  // Errors and messages with a button do not expire (WCAG 2.2.1): whoever wants to reach the button by
  // keyboard or reads slowly lost them after 9 s. They close via their ✕, a click or switching the view.
  if (type === 'error' || action) el.append(closeButton(el));
  return el;
}

/** @param {string} details */
function toastDetails(details) {
  const more = document.createElement('details');
  more.className = 'toast-details';
  const header = document.createElement('summary');
  header.textContent = tRaw('list.details');
  const content = document.createElement('p');
  content.textContent = details;
  more.append(header, content);
  return more;
}

/** @param {HTMLElement} el @param {{ text: string, fn: () => unknown, stays?: boolean }} action */
function appendAction(el, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'toast-action';
  button.textContent = action.text;
  button.onclick = () => {
    el.remove();
    action.fn();
  };
  el.append(button);
  if (action.stays) el.dataset.stays = '';
}

/** @param {HTMLElement} el */
function closeButton(el) {
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', tRaw('common.close'));
  setHtml(close, ico('close'));
  close.onclick = () => el.remove();
  return close;
}

/** @param {{text: string, fn: () => unknown, stays?: boolean}} [action] button in the message, e.g. "undo";
 *  `stays` keeps it across a view switch (discardToasts).
 * @param {string} [details] expandable cause below the message
 * @param {unknown} msg
 * @param {'info' | 'success' | 'error'} [type]
 */
export function toast(msg, type = 'info', action, details) {
  const c = G('toasts');
  if (
    type === 'error' &&
    !loggedInAccount &&
    [..._messagesTheExpiredSession].some(m => String(msg ?? '').startsWith(m))
  )
    return null;
  // The same message once more: count instead of stacking, and the deadline starts anew.
  const key = `${type}|${String(msg ?? '')}`;
  const same = action ? null : [...c.children].find(x => _toastStatus.get(x)?.key === key);
  if (same) {
    const status =
      /** @type {{key: string, count: number, timer: ReturnType<typeof setTimeout> | null, duration: number}} */ (
        _toastStatus.get(same)
      );
    status.count++;
    const number = /** @type {HTMLElement} */ (same.querySelector('.toast-count'));
    number.textContent = `×${status.count}`;
    number.hidden = false;
    startDeadline(/** @type {HTMLElement} */ (same));
    announce(String(msg ?? ''), type === 'error');
    return /** @type {HTMLElement} */ (same);
  }
  // A success settles older errors: they would otherwise stay next to the confirmation.
  if (type === 'success') for (const alt of [...c.children]) if (alt.classList.contains('error')) alt.remove();
  const el = toastElement(msg, type, action, details);
  const stays = type === 'error' || !!action;
  c.appendChild(el);
  announce(action ? `${String(msg ?? '')} — ${action.text}` : String(msg ?? ''), type === 'error');
  _toastStatus.set(el, { key, count: 1, timer: null, duration: stays ? 0 : (TOAST_DURATION[type] ?? 4500) });
  startDeadline(el);
  // As long as the mouse or focus is on it, the deadline does not run.
  const halt = () => {
    const s = _toastStatus.get(el);
    if (s?.timer) {
      clearTimeout(s.timer);
      s.timer = null;
    }
  };
  el.addEventListener('mouseenter', halt);
  el.addEventListener('focusin', halt);
  el.addEventListener('mouseleave', () => startDeadline(el));
  el.addEventListener('focusout', e => {
    if (!el.contains(/** @type {Node | null} */ (e.relatedTarget))) startDeadline(el);
  });
  return el;
}

/**
 * On switching the view: messages belong to the view in which they arose; only those with a button
 * (undo, change) stay until the deadline.
 */
export function discardToasts() {
  for (const el of [...(G('toasts')?.children || [])])
    if (!(/** @type {HTMLElement} */ (el).hasAttribute('data-stays'))) el.remove();
}

/** Remembers the text of a 401 response; toast() leaves it out after the end of the session. @param {string} text */
export function rememberSessionEnd(text) {
  _messagesTheExpiredSession.add(text);
}

/** @type {WeakMap<Element, ReturnType<typeof setTimeout>>} */
const _fieldDeadlines = new WeakMap();

/**
 * THE one rule for saving: single values save immediately, forms with "save" — and both
 * confirm at the place where something was changed ("saved ✓", read aloud). A toast at the screen edge
 * was far away from the field, and with autosave often none came at all.
 * @param {Element | null | undefined} field the field or the button; an ancestor with data-feedback
 *   determines the place, otherwise the message stands directly behind it
 * @param {string} [text]
 */
export function reportAtField(field, text = tRaw('field.saved')) {
  if (!field) return;
  const holder = field.closest('[data-feedback]');
  let statusEl = holder ? holder.querySelector('.field-status') : field.nextElementSibling;
  if (!statusEl?.classList.contains('field-status')) {
    const newValue = document.createElement('span');
    newValue.className = 'field-status';
    newValue.setAttribute('role', 'status');
    (holder || field).insertAdjacentElement(holder ? 'beforeend' : 'afterend', newValue);
    statusEl = newValue;
  }
  const place = statusEl;
  place.textContent = text;
  clearTimeout(_fieldDeadlines.get(place));
  _fieldDeadlines.set(
    place,
    setTimeout(() => {
      place.textContent = '';
    }, 5000),
  );
}
