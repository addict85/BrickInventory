import { LANG, locale } from '../i18n.js';
import { CURRENCY } from './00-zustand.js';

// Zahlen, Beträge und Daten in der Schreibweise der Oberflächensprache, eine Fassung für alle Ansichten.

/**
 * Ein Geldbetrag in der Währung des Nutzers. Ohne Angabe gilt die eingestellte Währung, nicht fest EUR: Sonst
 * stand bei Franken still „EUR“ da. test/geldformat.test.js hält fest, dass kein Aufruf sie weglässt.
 * @param {number | string | null | undefined} v
 * @param {string} [cur]
 */
export function fmtN(v,cur){
  if(!v||v==0) return '—';
  return new Intl.NumberFormat(locale(),{style:'currency',currency:cur||CURRENCY||'EUR',minimumFractionDigits:2}).format(Number(v));
}

/**
 * Betrag mit ISO-Code statt Zeichen („260,66 USD“): für fremde Währungen, deren Zeichen mehrdeutig ist.
 * @param {unknown} v @param {string} cur
 */
export function fmtGeldCode(v, cur){
  if (v === null || v === undefined || String(v).trim() === '' || !Number.isFinite(Number(v))) return '—';
  return new Intl.NumberFormat(locale(), { style: 'currency', currency: cur, currencyDisplay: 'code', minimumFractionDigits: 2 }).format(Number(v));
}

/**
 * Ein erfasster Kaufpreis von 0 ist ein Geschenk; fehlt er (null), ist er unbekannt.
 * @param {unknown} kauf
 */
export function istGeschenk(kauf){
  return kauf !== null && kauf !== undefined && String(kauf).trim() !== '' && Number(kauf) === 0;
}

/**
 * Betrag, bei dem 0 ein Wert ist (Kaufpreis): „0,00 €“ statt „—“.
 * @param {number | string | null | undefined} v
 * @param {string} [cur]
 */
export function fmtGeld(v, cur){
  if (v === null || v === undefined || String(v).trim() === '' || !Number.isFinite(Number(v))) return '—';
  return Number(v) === 0 ? new Intl.NumberFormat(locale(),{style:'currency',currency:cur||CURRENCY||'EUR',minimumFractionDigits:2}).format(0) : fmtN(v, cur);
}

/**
 * Ein Betrag aus einem Eingabefeld. Komma und Punkt sind beide Dezimalzeichen, Leerzeichen und ' sind
 * Tausendertrenner; ein einzelnes Trennzeichen mit genau drei Ziffern danach gilt als Tausender, wenn die
 * Sprache es so schreibt („1.234“ de-DE). Leer → null; keine Zahl → NaN, damit der Aufrufer am Feld meldet,
 * statt „149,95“ still zu 149 zu kürzen.
 * @param {unknown} roh
 * @returns {number|null}
 */
export function leseBetrag(roh) {
  const s = String(roh ?? '').replace(/[\s  '’]/g, '').replace(/^[€$£]|[€$£]$/g, '');
  if (!s) return null;
  if (!/^[\d.,]*\d[\d.,]*$/.test(s)) return NaN;
  const trenner = s.match(/[.,]/g) || [];
  const letztes = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  let dezimal = trenner.length ? s[letztes] : null;
  if (new Set(trenner).size === 1 && trenner.length > 1) dezimal = null;
  if (trenner.length === 1) {
    const gruppe = new Intl.NumberFormat(locale()).formatToParts(1000).find(p => p.type === 'group')?.value;
    if (trenner[0] === gruppe && /^\d{3}$/.test(s.slice(letztes + 1)) && !/^0[.,]/.test(s)) dezimal = null;
  }
  const ganz = dezimal ? s.slice(0, letztes) : s, nach = dezimal ? s.slice(letztes + 1) : '';
  if (/[.,]/.test(nach) || (dezimal && ganz.includes(dezimal))) return NaN;
  const gruppen = ganz.split(/[.,]/);
  if (gruppen.length > 1 && (!/^\d{1,3}$/.test(gruppen[0]) || gruppen.slice(1).some(g => !/^\d{3}$/.test(g)))) return NaN;
  return Number((gruppen.join('') || '0') + (nach ? '.' + nach : ''));
}

/**
 * Ein Betrag für ein Eingabefeld in der Schreibweise der Sprache („129,99“ de-DE), ohne Tausender.
 * @param {number | string | null | undefined} v
 */
export function betragFuerFeld(v) {
  if (v === null || v === undefined || String(v).trim() === '' || !Number.isFinite(Number(v))) return '';
  return new Intl.NumberFormat(locale(), { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number(v));
}

/**
 * Prozent in der Form der Oberfläche (de-DE „+51,1 %“, en-GB „+51.1%“), damit sie neben den Beträgen aus
 * fmtN() nicht in einer zweiten Schreibweise steht.
 * @param {number|string} v  Prozentwert (51.1, nicht 0.511)
 * @param {{vorzeichen?: boolean, stellen?: number}} [o]
 */
export function fmtPct(v, o = {}) {
  const n = parseFloat(String(v));
  if (!Number.isFinite(n)) return '—';
  const stellen = o.stellen ?? 1;
  return new Intl.NumberFormat(locale(), { style: 'percent', minimumFractionDigits: stellen,
    maximumFractionDigits: stellen, signDisplay: o.vorzeichen === false ? 'auto' : 'exceptZero' }).format(n / 100);
}

/**
 * Anzahl in der Sprache der Oberfläche, erst ab einer Million kurz („1,2 Mio.“). Darunter in allen Sprachen
 * genau: en zeigte „10.8K“, wo de „10.828“ stand.
 * @param {number | string | null | undefined} n
 */
export function fmtBig(n){
  const v = Number(n) || 0;
  if (v < 1e6) return v.toLocaleString(locale());
  return new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(v);
}

/**
 * Ein <input type="date"> zeigt das Datum in der Sprache des Browsers. Ist die dieselbe wie die der App,
 * braucht es keine zweite Schreibweise daneben.
 * @param {string} iso  JJJJ-MM-TT
 */
export function browserSchreibtDatumWieApp(iso) {
  if (!iso) return true;
  const d = new Date(iso + 'T00:00:00');
  /** @type {Intl.DateTimeFormatOptions} */
  const o = { day: '2-digit', month: '2-digit', year: 'numeric' };
  try { return d.toLocaleDateString(navigator.language, o) === d.toLocaleDateString(locale(), o); } catch { return false; }
}

/**
 * Ein Datum überall gleich: „05.01.2024“ (de), „5 Jan 2024“ (en). Vorher stand je Stelle toLocaleDateString()
 * („5.1.2024“) neben eigenen Formen.
 * @param {string|number|Date|null|undefined} v
 * @param {'tag'|'zeit'|'tagzeit'|'lang'} [art]  lang: „1. Juni 2026“
 */
export function fmtDatum(v, art = 'tag'){
  if (v === null || v === undefined || v === '') return '';
  const d = v instanceof Date ? v : new Date(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v + 'T00:00:00' : v);
  if (isNaN(d.getTime())) return '';
  // Englisch mit Monatsnamen: „03/11/2026“ liest sich in den USA als 11. März. Deutsch immer 24 Stunden, auch
  // bei einem Browser mit 12-h-Vorgabe.
  const tag = LANG === 'en' ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: '2-digit', month: '2-digit', year: 'numeric' };
  const zeit = LANG === 'en' ? { hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  const o = art === 'zeit' ? zeit : art === 'tagzeit' ? { ...tag, ...zeit } : art === 'lang' ? { day: 'numeric', month: 'long', year: 'numeric' } : tag;
  return new Intl.DateTimeFormat(locale(), /** @type {Intl.DateTimeFormatOptions} */ (o)).format(d);
}
