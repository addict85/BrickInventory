import { tRaw } from '../i18n.js';
import { loggedInAccount } from './state.js';
import { G, ico, setzeHtml } from './dom.js';

// Toasts: short messages at the bottom of the screen. Identical messages count instead of stacking, so that a repeated
// disruption does not cover the list.

/** Display duration per kind in ms. */
const TOAST_DURATION = { success: 3500, info: 5000, error: 9000 };

/** @type {WeakMap<Element, {schluessel: string, anzahl: number, frist: ReturnType<typeof setTimeout> | null, duration: number}>} */
const _toastStand = new WeakMap();

/** (Re)start the deadline; without a duration the message stays until someone closes it. @param {HTMLElement} el */
function startDeadline(el) {
  const stand = _toastStand.get(el);
  if (!stand) return;
  if (stand.frist) clearTimeout(stand.frist);
  stand.frist = stand.duration ? setTimeout(() => el.remove(), stand.duration) : null;
}

/** Error texts of the 401 responses: requests still running fail after the
 * end of the session with exactly this text. As a toast it would contradict the one
 * hint in the login card; toast() therefore leaves it out. */
const _messagesTheExpiredSession = new Set();

/**
 * Read a message aloud through one of two fixed live regions: status politely, errors at once. The
 * toasts themselves are not live: a region that appears together with its text is often not announced,
 * and an alert nested in a polite region is announced twice or not at all.
 * @param {string} text @param {boolean} fehler
 */
function announce(text, fehler) {
  const region = G(fehler ? 'ansage-fehler' : 'ansage-status');
  if (!region) return;
  // Emptied first: the same text again (a second identical error) is otherwise not read.
  region.textContent = '';
  setTimeout(() => {
    region.textContent = text;
  }, 50);
}

/** @param {{text: string, fn: () => unknown, bleibt?: boolean}} [aktion] button in the message, e.g. "undo";
 *  `bleibt` keeps it across a view switch (discardToasts).
 * @param {string} [details] expandable cause below the message
 * @param {unknown} msg
 * @param {'info' | 'success' | 'error'} [type]
 */
export function toast(msg, type = 'info', aktion, details) {
  const c = G('toasts');
  if (
    type === 'error' &&
    !loggedInAccount &&
    [..._messagesTheExpiredSession].some(m => String(msg ?? '').startsWith(m))
  )
    return null;
  // The same message once more: count instead of stacking, and the deadline starts anew.
  const schluessel = `${type}|${String(msg ?? '')}`;
  const gleich = aktion ? null : [...c.children].find(x => _toastStand.get(x)?.schluessel === schluessel);
  if (gleich) {
    const stand =
      /** @type {{schluessel: string, anzahl: number, frist: ReturnType<typeof setTimeout> | null, duration: number}} */ (
        _toastStand.get(gleich)
      );
    stand.anzahl++;
    const zahl = /** @type {HTMLElement} */ (gleich.querySelector('.toast-anzahl'));
    zahl.textContent = `×${stand.anzahl}`;
    zahl.hidden = false;
    startDeadline(/** @type {HTMLElement} */ (gleich));
    announce(String(msg ?? ''), type === 'error');
    return /** @type {HTMLElement} */ (gleich);
  }
  // A success settles older errors: they would otherwise stay next to the confirmation.
  if (type === 'success') for (const alt of [...c.children]) if (alt.classList.contains('error')) alt.remove();
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  // textContent instead of innerHTML: msg regularly contains server error messages and set/part numbers from
  // Nutzereingaben.
  const icon = document.createElement('span');
  icon.className = 'toast-ico';
  setzeHtml(icon, ico(type === 'success' ? 'ok' : type === 'error' ? 'fehler' : 'info'));
  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = String(msg ?? '');
  const anzahl = document.createElement('span');
  anzahl.className = 'toast-anzahl';
  anzahl.hidden = true;
  el.append(icon, text, anzahl);
  // The cause expandable: seven lines of message covered the list on the phone.
  if (details) {
    const mehr = document.createElement('details');
    mehr.className = 'toast-details';
    const kopf = document.createElement('summary');
    kopf.textContent = tRaw('liste.details');
    const inhalt = document.createElement('p');
    inhalt.textContent = details;
    mehr.append(kopf, inhalt);
    text.append(mehr);
  }
  if (aktion) {
    const knopf = document.createElement('button');
    knopf.type = 'button';
    knopf.className = 'toast-aktion';
    knopf.textContent = aktion.text;
    knopf.onclick = () => {
      el.remove();
      aktion.fn();
    };
    el.append(knopf);
    if (aktion.bleibt) el.dataset.bleibt = '';
  }
  // An error wants to be read, a confirmation only seen; with a button one also has to hit it. A
  // click on the message clears it, so that it does not cover a card.
  el.addEventListener('click', e => {
    if (e.target === el || !(/** @type {Element} */ (e.target).closest('button, details'))) el.remove();
  });
  // Errors and messages with a button do not expire (WCAG 2.2.1): whoever wants to reach the button by keyboard or reads slowly
  // lost them after 9 s. They close via their ✕, a click or switching the view.
  const bleibt = type === 'error' || !!aktion;
  if (bleibt) {
    const zu = document.createElement('button');
    zu.type = 'button';
    zu.className = 'toast-zu';
    zu.setAttribute('aria-label', tRaw('common.close'));
    setzeHtml(zu, ico('schliessen'));
    zu.onclick = () => el.remove();
    el.append(zu);
  }
  c.appendChild(el);
  announce(aktion ? `${String(msg ?? '')} — ${aktion.text}` : String(msg ?? ''), type === 'error');
  _toastStand.set(el, { schluessel, anzahl: 1, frist: null, duration: bleibt ? 0 : (TOAST_DURATION[type] ?? 4500) });
  startDeadline(el);
  // As long as the mouse or focus is on it, the deadline does not run.
  const halt = () => {
    const s = _toastStand.get(el);
    if (s?.frist) {
      clearTimeout(s.frist);
      s.frist = null;
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
    if (!(/** @type {HTMLElement} */ (el).hasAttribute('data-bleibt'))) el.remove();
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
 * @param {Element | null | undefined} feld the field or the button; an ancestor with data-rueckmeldung
 *   determines the place, otherwise the message stands directly behind it
 * @param {string} [text]
 */
export function meldeAmFeld(feld, text = tRaw('feld.gespeichert')) {
  if (!feld) return;
  const halter = feld.closest('[data-rueckmeldung]');
  let ort = halter ? halter.querySelector('.feld-status') : feld.nextElementSibling;
  if (!ort?.classList.contains('feld-status')) {
    const neu = document.createElement('span');
    neu.className = 'feld-status';
    neu.setAttribute('role', 'status');
    (halter || feld).insertAdjacentElement(halter ? 'beforeend' : 'afterend', neu);
    ort = neu;
  }
  const place = ort;
  place.textContent = text;
  clearTimeout(_fieldDeadlines.get(place));
  _fieldDeadlines.set(
    place,
    setTimeout(() => {
      place.textContent = '';
    }, 5000),
  );
}
