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
 * @param {string} eingabe
 */
export function isSetnummer(eingabe) {
  return /^[A-Za-z]{0,12}\d{1,8}[A-Za-z0-9]{0,8}(-\d{1,3})?$/.test(String(eingabe ?? '').trim());
}

/** Does an element lay out its children side by side (flex row or grid)? @param {Element} el */
function nebeneinander(el) {
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
    if (x === kind || x.classList.contains('feld-fehler')) return false;
    const b = x.getBoundingClientRect();
    return b.height > 0 && b.top < a.bottom - 1 && a.top < b.bottom - 1;
  });
}

/** A cell in a grid of field groups that all stand top-aligned on their line? @param {Element} zelle */
function feldzelle(zelle) {
  const raster = zelle.parentElement;
  if (!raster || !/grid$/.test(getComputedStyle(raster).display)) return false;
  const oben = (/** @type {Element} */ x) => {
    const s = getComputedStyle(x);
    const situation =
      s.alignSelf === 'auto' || s.alignSelf === 'normal' ? getComputedStyle(raster).alignItems : s.alignSelf;
    return ['normal', 'stretch', 'start', 'flex-start', 'self-start'].includes(situation);
  };
  return [zelle, ...linesNeighbors(zelle)].every(x => x.classList.contains('fg') && oben(x));
}

/**
 * Puts the message below the form row, not into it: in a flex row it would otherwise push the button
 * next to it aside or lift the neighbors out of alignment. If the field stands alone on its line, it stays
 * directly below it.
 * @param {HTMLElement} feld @param {HTMLElement} meldung
 */
function errorPlace(feld, meldung) {
  /** @type {Element} */
  let anker = feld.closest('.preis-mit-waehrung, .geheim-feld') ?? feld;
  let gruppe = anker.parentElement?.closest('.fg') ?? null;
  if (gruppe && !gruppe.contains(anker)) gruppe = null;
  // In the grid the field group itself is the cell: the message stays in its column below the field. Behind the
  // row it otherwise stood at the left below both columns, even for the right field. Only next to other fields, top
  // aligned; a bottom-aligned button next to it would be pushed down by the growing cell.
  if (gruppe && feldzelle(gruppe)) {
    if (anker.nextElementSibling !== meldung) anker.insertAdjacentElement('afterend', meldung);
    return;
  }
  /** @type {Element} */
  let kind = gruppe ?? anker;
  while (kind.parentElement && nebeneinander(kind.parentElement)) {
    const neighbors = linesNeighbors(kind);
    if (!neighbors.length) break;
    // Wrapping row or grid: as a line of its own behind the last neighbors (.feld-fehler spans all
    // columns), the lines below only move down.
    const s = getComputedStyle(kind.parentElement);
    if (/grid$/.test(s.display) || s.flexWrap !== 'nowrap') {
      anker = [kind, ...neighbors].reduce((x, y) => (x.compareDocumentPosition(y) & 4 ? y : x));
      break;
    }
    kind = kind.parentElement;
    anker = kind;
  }
  if (anker.nextElementSibling !== meldung) anker.insertAdjacentElement('afterend', meldung);
}

/**
 * An error message directly at the field (empty text clears it). Screen readers hear it via role="alert" and
 * find it via aria-describedby.
 * @param {string} id
 * @param {string} text
 */
export function feldFehler(id, text) {
  const feld = G(id);
  if (!feld) return;
  /** @type {HTMLElement | null} */
  let el = G(id + '-fehler');
  if (!el) {
    el = document.createElement('div');
    el.id = id + '-fehler';
    el.className = 'feld-fehler';
    el.setAttribute('role', 'alert');
    // In the table a row of its own (in the cell it pushed columns out of view).
    const zeile = feld.closest('td')?.parentElement;
    if (zeile instanceof HTMLTableRowElement) {
      const tr = document.createElement('tr');
      tr.className = 'feld-fehler-zeile';
      const td = document.createElement('td');
      td.colSpan = zeile.cells.length;
      td.append(el);
      tr.append(td);
      zeile.insertAdjacentElement('afterend', tr);
    }
    feld.addEventListener('input', () => feldFehler(id, ''));
  }
  // An empty message goes into the document too: otherwise every call would create a new one, including a listener.
  if ((text || !el.isConnected) && !el.closest('tr.feld-fehler-zeile')) errorPlace(feld, el);
  el.textContent = text || '';
  el.hidden = !text;
  const errorRow = el.closest('tr.feld-fehler-zeile');
  if (errorRow instanceof HTMLElement) errorRow.hidden = !text;
  // Add and remove the own identifier: an existing hint (password rule) stays linked.
  const ids = new Set((feld.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
  if (text) {
    ids.add(el.id);
    feld.setAttribute('aria-invalid', 'true');
  } else {
    ids.delete(el.id);
    feld.removeAttribute('aria-invalid');
  }
  if (ids.size) feld.setAttribute('aria-describedby', [...ids].join(' '));
  else feld.removeAttribute('aria-describedby');
  if (text) feld.focus();
}

/**
 * A refusal from the server: if its code belongs to a field of the form, the message stands there (like
 * feldFehler), otherwise as a toast.
 * @param {object | null | undefined} d response of api()
 * @param {Record<string, string>} felder error code → field ID
 * @param {string} ersatz text if the response has none
 */
export function responseError(d, felder, ersatz) {
  const a = /** @type {{ code?: string, error?: string | null }} */ (d ?? {});
  const id = a.code ? felder[a.code] : null;
  if (id && G(id)) feldFehler(id, a.error || ersatz);
  else toast(a.error || ersatz, 'error');
}

/**
 * Checks the set number field before submitting; reports at the field and says whether to continue.
 * @param {string} id
 * @param {string} wert
 */
export function setnummerFieldValid(id, wert) {
  const v = wert ?? (G(id)?.value || '').trim();
  if (!v) {
    feldFehler(id, tRaw('common.enter_set_number'));
    return false;
  }
  if (!isSetnummer(v)) {
    feldFehler(id, tRaw('gallery.add.number_invalid', { num: v }));
    return false;
  }
  feldFehler(id, '');
  return true;
}

/** Upper bound of the piece count per acquisition; the same as `eingabe.stueckzahl()` in the server (src/infra/validate.ts). */
export const QUANTITY_MAX = 10_000;

/**
 * Reads a quantity field: only a whole number from 1 to QUANTITY_MAX goes out. Everything else (empty, 0, 1.5,
 * negative, too large) is reported at the field instead of silently becoming 1 or only coming back as a toast.
 * @param {string} id
 * @returns {{ ok: boolean, wert: number }}
 */
export function quantityFromField(id) {
  const roh = (G(id)?.value ?? '').trim();
  const wert = /^\d+$/.test(roh) ? Number(roh) : NaN;
  if (!(wert >= 1 && wert <= QUANTITY_MAX)) {
    feldFehler(id, tRaw('common.qty_invalid', { max: QUANTITY_MAX.toLocaleString(locale()) }));
    return { ok: false, wert: 1 };
  }
  if (G(id + '-fehler')) feldFehler(id, '');
  return { ok: true, wert };
}

/**
 * Checks a purchase date: empty is allowed, a day after today is not. The field gets the same as `max`,
 * so that the browser's picker does not offer any future at all; typed in it still works.
 * @param {string} id
 * @returns {boolean}
 */
export function purchaseDateValid(id) {
  const feld = /** @type {HTMLInputElement | null} */ (G(id));
  if (!feld) return true;
  const heute = todayIso();
  feld.max = heute;
  if (feld.value && feld.value > heute) {
    feldFehler(id, tRaw('common.date_future'));
    return false;
  }
  if (G(id + '-fehler')) feldFehler(id, '');
  return true;
}

/**
 * Reads a money field; if the content is not a number (or negative), the message stands at the field and `ok` is false
 * — then nothing is sent.
 * @param {string|HTMLInputElement} feld  ID or element
 * @param {string} [negativ] key of the message for a negative amount (default: purchase price)
 * @returns {{ ok: boolean, wert: number|null }}
 */
export function amountFromField(feld, negativ = 'common.amount_negative') {
  const el = typeof feld === 'string' ? G(feld) : feld;
  if (!el) return { ok: true, wert: null };
  const roh = el.value.trim();
  const wert = readAmount(roh);
  if (wert !== null && !(wert >= 0)) {
    // "-5" is readable, just not allowed: "is not an amount" was misleading there.
    const minus = /^[-−]/.test(roh) && Number.isFinite(readAmount(roh.slice(1)));
    const meldung = minus ? tRaw(negativ) : tRaw('common.amount_invalid', { wert: roh });
    if (el.id) feldFehler(el.id, meldung);
    else toast(meldung, 'error');
    return { ok: false, wert: null };
  }
  if (el.id && G(el.id + '-fehler')) feldFehler(el.id, '');
  return { ok: true, wert };
}

// ── FORMS ─────────────────────────────────────────────────────────────────
/**
 * Bind a form's errors to the affected fields: aria-invalid marks the field, aria-describedby
 * lets screen readers announce the message at the field, and the focus jumps into the first one so that one corrects
 * right away. Without text, message and markings disappear.
 * @param {HTMLElement} box  the message field (role=alert)
 * @param {string} text
 * @param {string[]} [felder] IDs of the affected fields
 */
export function formError(box, text, felder = []) {
  box.textContent = text;
  box.style.display = text ? 'block' : 'none';
  box.parentElement?.querySelectorAll('[aria-invalid="true"]').forEach(f => {
    fieldValid(f, box.id);
  });
  const ziele = /** @type {HTMLElement[]} */ (felder.map(id => G(id)).filter(Boolean));
  for (const f of ziele) {
    f.setAttribute('aria-invalid', 'true');
    const ids = new Set((f.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
    ids.add(box.id);
    f.setAttribute('aria-describedby', [...ids].join(' '));
  }
  if (text && ziele[0]) ziele[0].focus();
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

// A field with maxlength silently cut off while typing ("…Weihnachtss"). With data-zaehler, from ten characters
// before the limit it says below how many there are, and at the limit that no more fit.
if (typeof document !== 'undefined')
  document.addEventListener('input', ev => {
    const f = ev.target instanceof HTMLInputElement && ev.target.hasAttribute('data-zaehler') ? ev.target : null;
    const max = f ? Number(f.getAttribute('maxlength')) : 0;
    if (!f || !max) return;
    let hinweis =
      f.nextElementSibling instanceof HTMLElement && f.nextElementSibling.classList.contains('zeichen-zaehler')
        ? f.nextElementSibling
        : null;
    if (!hinweis) {
      hinweis = document.createElement('span');
      hinweis.className = 'zeichen-zaehler';
      hinweis.setAttribute('aria-live', 'polite');
      f.insertAdjacentElement('afterend', hinweis);
    }
    const n = f.value.length;
    hinweis.hidden = n < max - 10;
    hinweis.textContent = n >= max ? tRaw('form.zeichen_grenze', { n, max }) : tRaw('form.zeichen', { n, max });
  });
