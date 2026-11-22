import { tRaw, locale } from '../i18n.js';
import { G } from './dom.js';
import { toast } from './messages.js';
import { readAmount } from './format.js';
import { todayIso } from './components.js';

// Forms: messages at the field, password rules, amounts from inputs. One version for all dialogs, so that
// screen readers and highlighting react the same everywhere.

/**
 * Minimum length of a password. The server enforces it, the browser says it beforehand;
 * test/password-length.test.js keeps server, web and app the same.
 */
export const PASSWORD_MIN_CHARS = 12;

/**
 * The web app checked the length at none of the five places that set a password, and ran into the
 * server error where the app does not even enable the button. Here it is asked beforehand.
 * @param {unknown} p
 */
export function passwordToShort(p) {
  return String(p ?? '').length < PASSWORD_MIN_CHARS;
}

/** The matching message — the same in five places. */
export function passwordToShortText() {
  return tRaw('settings.password.too_short', { n: PASSWORD_MIN_CHARS });
}

/** The same limit as PASSWORD_MAX_CHARS in the server (src/infra/passwordRule.ts). */
export const PASSWORD_MAX_CHARS = 1024;

/**
 * What the browser can check before submitting, as a message, otherwise null. Only the server knows the list of
 * common passwords; its message comes back.
 * @param {string} p
 */
export function passwordRuleText(p) {
  if (passwordToShort(p)) return passwordToShortText();
  if (String(p).length > PASSWORD_MAX_CHARS) return tRaw('settings.password.too_long', { n: PASSWORD_MAX_CHARS });
  return null;
}

/**
 * Does the input look like a set number? Digits, before them at most a letter prefix of real numbers
 * (llca30, comcon001), after them a version suffix (-1). The server checks itself; here the point is that
 * "abc" is not even created as set "abc-1".
 * @param {string} input
 */
export function isSetNumber(input) {
  return /^[A-Za-z]{0,12}\d{1,8}[A-Za-z0-9]{0,8}(-\d{1,3})?$/.test(String(input ?? '').trim());
}

/** Does an element lay out its children side by side (flex row or grid)? @param {Element} el */
function sideBySide(el) {
  const s = getComputedStyle(el);
  return /grid$/.test(s.display) || (/flex$/.test(s.display) && !s.flexDirection.startsWith('column'));
}

/**
 * The siblings that stand with `kind` on the same line of its flex row (without messages). On the phone
 * the same rows wrap below each other; then the field stands alone.
 * @param {Element} kind
 */
function linesNeighbors(kind) {
  const a = kind.getBoundingClientRect();
  return [...(kind.parentElement?.children ?? [])].filter(x => {
    if (x === kind || x.classList.contains('field-error')) return false;
    const b = x.getBoundingClientRect();
    return b.height > 0 && b.top < a.bottom - 1 && a.top < b.bottom - 1;
  });
}

/** A cell in a grid of field groups that all stand top-aligned on their line? @param {Element} cell */
function fieldCell(cell) {
  const grid = cell.parentElement;
  if (!grid || !/grid$/.test(getComputedStyle(grid).display)) return false;
  const top = (/** @type {Element} */ x) => {
    const s = getComputedStyle(x);
    const situation =
      s.alignSelf === 'auto' || s.alignSelf === 'normal' ? getComputedStyle(grid).alignItems : s.alignSelf;
    return ['normal', 'stretch', 'start', 'flex-start', 'self-start'].includes(situation);
  };
  return [cell, ...linesNeighbors(cell)].every(x => x.classList.contains('fg') && top(x));
}

/**
 * Puts the message below the form row, not into it: in a flex row it would otherwise push the button
 * next to it aside or lift the neighbors out of alignment. If the field stands alone on its line, it stays
 * directly below it.
 * @param {HTMLElement} field @param {HTMLElement} message
 */
function errorPlace(field, message) {
  /** @type {Element} */
  let anchor = field.closest('.price-with-currency, .secret-field') ?? field;
  let group = anchor.parentElement?.closest('.fg') ?? null;
  if (group && !group.contains(anchor)) group = null;
  // In the grid the field group itself is the cell: the message stays in its column below the field. Behind the
  // row it otherwise stood at the left below both columns, even for the right field. Only next to other fields, top
  // aligned; a bottom-aligned button next to it would be pushed down by the growing cell.
  if (group && fieldCell(group)) {
    if (anchor.nextElementSibling !== message) anchor.insertAdjacentElement('afterend', message);
    return;
  }
  /** @type {Element} */
  let kind = group ?? anchor;
  while (kind.parentElement && sideBySide(kind.parentElement)) {
    const neighbors = linesNeighbors(kind);
    if (!neighbors.length) break;
    // Wrapping row or grid: as a line of its own behind the last neighbors (.field-error spans all
    // columns), the lines below only move down.
    const s = getComputedStyle(kind.parentElement);
    if (/grid$/.test(s.display) || s.flexWrap !== 'nowrap') {
      anchor = [kind, ...neighbors].reduce((x, y) => (x.compareDocumentPosition(y) & 4 ? y : x));
      break;
    }
    kind = kind.parentElement;
    anchor = kind;
  }
  if (anchor.nextElementSibling !== message) anchor.insertAdjacentElement('afterend', message);
}

/**
 * An error message directly at the field (empty text clears it). Screen readers hear it via role="alert" and
 * find it via aria-describedby.
 * @param {string} id
 * @param {string} text
 */
export function fieldError(id, text) {
  const field = G(id);
  if (!field) return;
  /** @type {HTMLElement | null} */
  let el = G(id + '-error');
  if (!el) {
    el = document.createElement('div');
    el.id = id + '-error';
    el.className = 'field-error';
    el.setAttribute('role', 'alert');
    // In the table a row of its own (in the cell it pushed columns out of view).
    const row = field.closest('td')?.parentElement;
    if (row instanceof HTMLTableRowElement) {
      const tr = document.createElement('tr');
      tr.className = 'field-error-row';
      const td = document.createElement('td');
      td.colSpan = row.cells.length;
      td.append(el);
      tr.append(td);
      row.insertAdjacentElement('afterend', tr);
    }
    field.addEventListener('input', () => fieldError(id, ''));
  }
  // An empty message goes into the document too: otherwise every call would create a new one, including a listener.
  if ((text || !el.isConnected) && !el.closest('tr.field-error-row')) errorPlace(field, el);
  el.textContent = text || '';
  el.hidden = !text;
  const errorRow = el.closest('tr.field-error-row');
  if (errorRow instanceof HTMLElement) errorRow.hidden = !text;
  // Add and remove the own identifier: an existing hint (password rule) stays linked.
  const ids = new Set((field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
  if (text) {
    ids.add(el.id);
    field.setAttribute('aria-invalid', 'true');
  } else {
    ids.delete(el.id);
    field.removeAttribute('aria-invalid');
  }
  if (ids.size) field.setAttribute('aria-describedby', [...ids].join(' '));
  else field.removeAttribute('aria-describedby');
  if (text) field.focus();
}

/**
 * A refusal from the server: if its code belongs to a field of the form, the message stands there (like
 * fieldError), otherwise as a toast.
 * @param {object | null | undefined} d response of api()
 * @param {Record<string, string>} fields error code → field ID
 * @param {string} fallback text if the response has none
 */
export function responseError(d, fields, fallback) {
  const a = /** @type {{ code?: string, error?: string | null }} */ (d ?? {});
  const id = a.code ? fields[a.code] : null;
  if (id && G(id)) fieldError(id, a.error || fallback);
  else toast(a.error || fallback, 'error');
}

/**
 * Checks the set number field before submitting; reports at the field and says whether to continue.
 * @param {string} id
 * @param {string} value
 */
export function setNumberFieldValid(id, value) {
  const v = value ?? (G(id)?.value || '').trim();
  if (!v) {
    fieldError(id, tRaw('common.enter_set_number'));
    return false;
  }
  if (!isSetNumber(v)) {
    fieldError(id, tRaw('gallery.add.number_invalid', { num: v }));
    return false;
  }
  fieldError(id, '');
  return true;
}

/** Upper bound of the piece count per acquisition; the same as `input.piece-number()` in the server (src/infra/validate.ts). */
export const QUANTITY_MAX = 10_000;

/**
 * Reads a quantity field: only a whole number from 1 to QUANTITY_MAX goes out. Everything else (empty, 0, 1.5,
 * negative, too large) is reported at the field instead of silently becoming 1 or only coming back as a toast.
 * @param {string} id
 * @returns {{ ok: boolean, value: number }}
 */
export function quantityFromField(id) {
  const raw = (G(id)?.value ?? '').trim();
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(value >= 1 && value <= QUANTITY_MAX)) {
    fieldError(id, tRaw('common.qty_invalid', { max: QUANTITY_MAX.toLocaleString(locale()) }));
    return { ok: false, value: 1 };
  }
  if (G(id + '-error')) fieldError(id, '');
  return { ok: true, value };
}

/**
 * Checks a purchase date: empty is allowed, a day after today is not. The field gets the same as `max`,
 * so that the browser's picker does not offer any future at all; typed in it still works.
 * @param {string} id
 * @returns {boolean}
 */
export function purchaseDateValid(id) {
  const field = /** @type {HTMLInputElement | null} */ (G(id));
  if (!field) return true;
  const today = todayIso();
  field.max = today;
  if (field.value && field.value > today) {
    fieldError(id, tRaw('common.date_future'));
    return false;
  }
  if (G(id + '-error')) fieldError(id, '');
  return true;
}

/**
 * Reads a money field; if the content is not a number (or negative), the message stands at the field and `ok` is false
 * — then nothing is sent.
 * @param {string|HTMLInputElement} field  ID or element
 * @param {string} [negative] key of the message for a negative amount (default: purchase price)
 * @returns {{ ok: boolean, value: number|null }}
 */
export function amountFromField(field, negative = 'common.amount_negative') {
  const el = typeof field === 'string' ? G(field) : field;
  if (!el) return { ok: true, value: null };
  const raw = el.value.trim();
  const value = readAmount(raw);
  if (value !== null && !(value >= 0)) {
    // "-5" is readable, just not allowed: "is not an amount" was misleading there.
    const minus = /^[-−]/.test(raw) && Number.isFinite(readAmount(raw.slice(1)));
    const message = minus ? tRaw(negative) : tRaw('common.amount_invalid', { value: raw });
    if (el.id) fieldError(el.id, message);
    else toast(message, 'error');
    return { ok: false, value: null };
  }
  if (el.id && G(el.id + '-error')) fieldError(el.id, '');
  return { ok: true, value };
}

// ── FORMS ─────────────────────────────────────────────────────────────────
/**
 * Bind a form's errors to the affected fields: aria-invalid marks the field, aria-describedby
 * lets screen readers announce the message at the field, and the focus jumps into the first one so that one corrects
 * right away. Without text, message and markings disappear.
 * @param {HTMLElement} box  the message field (role=alert)
 * @param {string} text
 * @param {string[]} [fields] IDs of the affected fields
 */
export function formError(box, text, fields = []) {
  box.textContent = text;
  box.style.display = text ? 'block' : 'none';
  box.parentElement?.querySelectorAll('[aria-invalid="true"]').forEach(f => {
    fieldValid(f, box.id);
  });
  const targets = /** @type {HTMLElement[]} */ (fields.map(id => G(id)).filter(Boolean));
  for (const f of targets) {
    f.setAttribute('aria-invalid', 'true');
    const ids = new Set((f.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
    ids.add(box.id);
    f.setAttribute('aria-describedby', [...ids].join(' '));
  }
  if (text && targets[0]) targets[0].focus();
}

/** @param {Element} f @param {string} boxId */
function fieldValid(f, boxId) {
  f.removeAttribute('aria-invalid');
  const rest = (f.getAttribute('aria-describedby') || '').split(/\s+/).filter(x => x && x !== boxId);
  if (rest.length) f.setAttribute('aria-describedby', rest.join(' '));
  else f.removeAttribute('aria-describedby');
}

// Whoever types in the marked field is correcting: the marking goes, the message stays.
if (typeof document !== 'undefined')
  document.addEventListener('input', ev => {
    const f = ev.target instanceof Element ? ev.target : null;
    if (f?.getAttribute('aria-invalid') === 'true') f.removeAttribute('aria-invalid');
  });

// A field with maxlength silently cut off while typing ("…Weihnachtss"). With data-counter, from ten characters
// before the limit it says below how many there are, and at the limit that no more fit.
if (typeof document !== 'undefined')
  document.addEventListener('input', ev => {
    const f = ev.target instanceof HTMLInputElement && ev.target.hasAttribute('data-counter') ? ev.target : null;
    const max = f ? Number(f.getAttribute('maxlength')) : 0;
    if (!f || !max) return;
    let hint =
      f.nextElementSibling instanceof HTMLElement && f.nextElementSibling.classList.contains('char-counter')
        ? f.nextElementSibling
        : null;
    if (!hint) {
      hint = document.createElement('span');
      hint.className = 'char-counter';
      hint.setAttribute('aria-live', 'polite');
      f.insertAdjacentElement('afterend', hint);
    }
    const n = f.value.length;
    hint.hidden = n < max - 10;
    hint.textContent = n >= max ? tRaw('form.char_limit', { n, max }) : tRaw('form.char', { n, max });
  });
