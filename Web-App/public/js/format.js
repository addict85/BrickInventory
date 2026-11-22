import { LANG, locale, tRaw } from '../i18n.js';
import { accountCurrency } from './state.js';

// Numbers, amounts and dates in the notation of the UI language, one version for all views.

/**
 * A money amount in the user's currency. Without a value the configured currency applies, not a fixed EUR: otherwise
 * "EUR" silently stood there for francs. test/money-format.test.js ensures that no call omits it.
 * @param {number | string | null | undefined} v
 * @param {string} [cur]
 */
export function fmtN(v, cur) {
  if (!v || Number(v) === 0) return '—';
  return new Intl.NumberFormat(locale(), {
    style: 'currency',
    currency: cur || accountCurrency || 'EUR',
    minimumFractionDigits: 2,
  }).format(Number(v));
}

/**
 * Amount with ISO code instead of symbol ("260,66 USD"): for foreign currencies whose symbol is ambiguous.
 * @param {unknown} v @param {string} cur
 */
export function fmtMoneyCode(v, cur) {
  if (v === null || v === undefined || String(v).trim() === '' || !Number.isFinite(Number(v))) return '—';
  return new Intl.NumberFormat(locale(), {
    style: 'currency',
    currency: cur,
    currencyDisplay: 'code',
    minimumFractionDigits: 2,
  }).format(Number(v));
}

/**
 * A captured purchase price of 0 is a gift; if it is missing (null), it is unknown.
 * @param {unknown} purchase
 */
export function isGift(purchase) {
  return purchase !== null && purchase !== undefined && String(purchase).trim() !== '' && Number(purchase) === 0;
}

/**
 * Amount for which 0 is a value (purchase price): "0,00 €" instead of "—".
 * @param {number | string | null | undefined} v
 * @param {string} [cur]
 */
export function fmtMoney(v, cur) {
  if (v === null || v === undefined || String(v).trim() === '' || !Number.isFinite(Number(v))) return '—';
  return Number(v) === 0
    ? new Intl.NumberFormat(locale(), {
        style: 'currency',
        currency: cur || accountCurrency || 'EUR',
        minimumFractionDigits: 2,
      }).format(0)
    : fmtN(v, cur);
}

/** Which sign separates the decimals: with only one kind of sign several times, or one sign that is the
 * locale's group sign before exactly three digits, there is none. @param {string} s @param {number} last */
function decimalSign(s, last) {
  const divider = s.match(/[.,]/g) || [];
  if (!divider.length) return null;
  if (new Set(divider).size === 1 && divider.length > 1) return null;
  if (divider.length === 1) {
    const group = new Intl.NumberFormat(locale()).formatToParts(1000).find(p => p.type === 'group')?.value;
    if (divider[0] === group && /^\d{3}$/.test(s.slice(last + 1)) && !/^0[.,]/.test(s)) return null;
  }
  return s[last];
}

/**
 * An amount from an input field. Comma and dot are both decimal separators, spaces and ' are
 * thousands separators; a single separator with exactly three digits after it counts as thousands if the
 * language writes it that way ("1.234" de-DE). Empty → null; not a number → NaN, so that the caller reports at the field
 * instead of silently cutting "149,95" to 149.
 * @param {unknown} raw
 * @returns {number|null}
 */
export function readAmount(raw) {
  const s = String(raw ?? '')
    .replace(/[\s  \x27’]/g, '')
    .replace(/^[€$£]|[€$£]$/g, '');
  if (!s) return null;
  if (!/^[\d.,]*\d[\d.,]*$/.test(s)) return NaN;
  const last = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  const decimal = decimalSign(s, last);
  const whole = decimal ? s.slice(0, last) : s,
    nach = decimal ? s.slice(last + 1) : '';
  if (/[.,]/.test(nach) || (decimal && whole.includes(decimal))) return NaN;
  const groups = whole.split(/[.,]/);
  if (groups.length > 1 && (!/^\d{1,3}$/.test(groups[0]) || groups.slice(1).some(g => !/^\d{3}$/.test(g)))) return NaN;
  return Number((groups.join('') || '0') + (nach ? '.' + nach : ''));
}

/**
 * An amount for an input field in the language's notation ("129,99" de-DE), without thousands.
 * @param {number | string | null | undefined} v
 */
export function amountForField(v) {
  if (v === null || v === undefined || String(v).trim() === '' || !Number.isFinite(Number(v))) return '';
  return new Intl.NumberFormat(locale(), {
    useGrouping: false,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(Number(v));
}

/**
 * Percent in the UI's form (de-DE "+51,1 %", en-GB "+51.1%"), so that it does not state in a second notation next to the amounts from
 * fmtN().
 * @param {number|string} v  percentage value (51.1, not 0.511)
 * @param {{sign?: boolean, places?: number}} [o]
 */
export function fmtPct(v, o = {}) {
  const n = parseFloat(String(v));
  if (!Number.isFinite(n)) return '—';
  const places = o.places ?? 1;
  return new Intl.NumberFormat(locale(), {
    style: 'percent',
    minimumFractionDigits: places,
    maximumFractionDigits: places,
    signDisplay: o.sign === false ? 'auto' : 'exceptZero',
  }).format(n / 100);
}

/**
 * Count in the UI language, abbreviated only from one million ("1,2 Mio."). Below that exact in all languages:
 * en showed "10.8K" where de showed "10.828".
 * @param {number | string | null | undefined} n
 */
export function fmtBig(n) {
  const v = Number(n) || 0;
  if (v < 1e6) return v.toLocaleString(locale());
  return new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(v);
}

/**
 * An <input type="date"> shows the date in the browser's language. If that is the same as the app's,
 * no second notation is needed next to it.
 * @param {string} iso  YYYY-MM-DD
 */
export function browserWritesDateHowApp(iso) {
  if (!iso) return true;
  const d = new Date(iso + 'T00:00:00');
  /** @type {Intl.DateTimeFormatOptions} */
  const o = { day: '2-digit', month: '2-digit', year: 'numeric' };
  try {
    return d.toLocaleDateString(navigator.language, o) === d.toLocaleDateString(locale(), o);
  } catch {
    return false;
  }
}

/** A time alone read as today, even if the run was only tomorrow or three days ago. @param {Date} d */
function whenText(d) {
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  const time = fmtDate(d, 'time');
  if (days === 0) return time;
  if (days === 1) return tRaw('time.morgen', { time });
  if (days === -1) return tRaw('time.yesterday', { time });
  return fmtDate(d, 'datetime');
}

/** English with month names: "03/11/2026" reads as 11 March in the USA. German always 24 hours, even
 * with a browser defaulting to 12 h. @param {string} kind @returns {Intl.DateTimeFormatOptions} */
function dateOptions(kind) {
  /** @type {Intl.DateTimeFormatOptions} */
  const tag =
    LANG === 'en'
      ? { day: 'numeric', month: 'short', year: 'numeric' }
      : { day: '2-digit', month: '2-digit', year: 'numeric' };
  /** @type {Intl.DateTimeFormatOptions} */
  const time =
    LANG === 'en' ? { hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  if (kind === 'time') return time;
  if (kind === 'datetime') return { ...tag, ...time };
  if (kind === 'lang') return { day: 'numeric', month: 'long', year: 'numeric' };
  return tag;
}

/**
 * A date the same everywhere: "05.01.2024" (de), "5 Jan 2024" (en). Before, every place had toLocaleDateString()
 * ("5.1.2024") next to its own forms.
 * @param {string|number|Date|null|undefined} v
 * @param {'tag'|'time'|'datetime'|'lang'|'when'} [kind]  lang: "1. Juni 2026"; when: "10:03" today, otherwise
 *   "tomorrow 10:03", "yesterday 10:03" or date with time
 * @returns {string}
 */
export function fmtDate(v, kind = 'tag') {
  if (v === null || v === undefined || v === '') return '';
  const d =
    v instanceof Date ? v : new Date(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v + 'T00:00:00' : v);
  if (Number.isNaN(d.getTime())) return '';
  if (kind === 'when') return whenText(d);
  return new Intl.DateTimeFormat(locale(), dateOptions(kind)).format(d);
}
