/**
 * Eingangsvalidierung für frei erfassbare Katalogfelder.
 * Ausführlich: docs/begruendungen/utils/validate.ts.md#item-number-re
 */

/** Teile-/Figuren-/Setnummern: das, was Rebrickable und BrickLink tatsächlich vergeben. */
export const ITEM_NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;

import { fehlerWerfen } from './fehlerTexte';

function fail(msg: string): never {
  const e: any = new Error(msg);
  e.status = 400;
  throw e;
}

/** Pflichtfeld: Item-Nummer (Teil, Minifigur, Set). */
export function requireItemNumber(value: any, field = 'part_number'): string {
  const v = String(value ?? '').trim();
  if (!v) fail(`${field} erforderlich`);
  if (!ITEM_NUMBER_RE.test(v))
    fail(`${field} darf nur Buchstaben, Zahlen und . _ - / enthalten (max. 64 Zeichen)`);
  return v;
}

/** Optionales Freitextfeld — auf maxLen gekappt statt abgelehnt (Katalognamen sind lang). */
export function optionalText(value: any, maxLen = 200): string | null {
  if (value === undefined || value === null) return null;
  const v = String(value).replace(/[\u0000-\u001F\u007F]/g, '').trim();
  return v ? v.slice(0, maxLen) : null;
}

/**
 * Optionale Bild-URL. Nur https und nur ein wohlgeformter Host —
 * "javascript:…", "data:…" und Attribut-Ausbrüche fallen damit raus.
 */
export function optionalImageUrl(value: any): string | null {
  if (value === undefined || value === null || value === '') return null;
  const v = String(value).trim();
  if (v.length > 2048) fail('image_url ist zu lang');
  let u: URL;
  try { u = new URL(v); } catch { fail('image_url ist keine gültige URL'); }
  if (u.protocol !== 'https:') fail('image_url muss https sein');
  return u.toString();
}

/** Menge: positive Ganzzahl in einem plausiblen Rahmen. */
export function positiveInt(value: any, fallback = 1, max = 1_000_000): number {
  const n = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, n));
}

/**
 * Gewünschte Bestandsmenge: eine Ganzzahl ab `min`, sonst 400. Hier wird
 * nicht auf einen Ersatzwert ausgewichen — `parseInt({a:1}) || 0` machte aus
 * einer kaputten Anfrage „Menge 0" und löschte den Bestand.
 */
export function bestandsMenge(value: unknown, min = 0, max = 100_000): number {
  const roh = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : '';
  if (!/^\d{1,6}$/.test(roh) || +roh < min || +roh > max) fehlerWerfen('wert_ungueltig', 400);
  return +roh;
}

/**
 * Rebrickables „[No Color/Any Color]“. Dort ist 0 Schwarz; eine fehlende Farbe
 * darf deshalb nie zu 0 werden (Migration 0071).
 */
export const KEINE_FARBE = 9999;

/** Farb-ID: nicht-negative Ganzzahl; leer, unlesbar oder negativ heisst KEINE_FARBE. */
export function colorId(value: unknown): number {
  const roh = String(value ?? '').trim();
  return /^\d{1,6}$/.test(roh) ? Number(roh) : KEINE_FARBE;
}

/** Hex-Farbcode ohne führendes '#'. Ungültige Werte werden verworfen, nicht abgelehnt. */
export function optionalHex(value: any): string | null {
  const v = String(value ?? '').trim().replace(/^#/, '');
  return /^[0-9A-Fa-f]{6}$/.test(v) ? v.toUpperCase() : null;
}

/** Zustand: 'N' oder 'U', sonst null (= keine Angabe). */
export function optionalCondition(value: any): 'N' | 'U' | null {
  return value === 'N' || value === 'U' ? value : null;
}

/**
 * Menge einer Erfassung: 1 bis 10 000.
 * Ausführlich: docs/begruendungen/utils/validate.ts.md#acquisitionquantity
 */
export function acquisitionQuantity(value: any, fallback = 1): number {
  return positiveInt(value, fallback, 10_000);
}

/**
 * Kaufpreis oder Stückpreis: nicht negativ, in plausiblem Rahmen.
 * Ausführlich: docs/begruendungen/utils/validate.ts.md#optionalprice
 * @returns null bei leerer Angabe (= „kein Preis"), sonst der geprüfte Betrag
 */
export function optionalPrice(value: any, feld = 'Preis'): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = parseFloat(String(value).replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  if (n < 0) fail(`${feld} darf nicht negativ sein`);
  if (n > 1_000_000) fail(`${feld} ist unplausibel hoch`);
  return n;
}

/**
 * Einen Wahrheitswert aus einer Anfrage lesen — streng.
 * Ausführlich: docs/begruendungen/utils/validate.ts.md#strictbool
 */
export function strictBool(value: any, feld = 'Wert'): boolean {
  if (value === true  || value === 'true'  || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  fail(`${feld} muss true oder false sein`);
}

/**
 * Ist dieser Wert ein ERSATZTEIL-Kennzeichen, das „ja" bedeutet?
 * Ausführlich: docs/begruendungen/utils/validate.ts.md#istersatzteil
 */
export function istErsatzteil(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value !== 'string') return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 't' || v === 'true' || v === 'y' || v === 'yes';
}

/**
 * Ersatzteil als SQL-Ausdruck. Seit Migration 0075 ist is_spare in jeder
 * Tabelle 0 oder 1 (CHECK); die Schreibweisen kennt nur noch istErsatzteil()
 * für Eingaben wie die Rebrickable-CSV.
 * @param spalte Spaltenname, bereits vertrauenswuerdig — es ist NIE ein Wert
 */
export function ersatzteilSql(spalte: string): string {
  return `(${spalte} = 1)`;
}

/**
 * Einen Routen- oder Abfrageparameter als EINEN Text nehmen.
 * Ausführlich: docs/begruendungen/utils/validate.ts.md#einzelwert
 */
export function einzelwert(value: unknown, fallback = ''): string {
  if (Array.isArray(value)) return value.length ? String(value[0]) : fallback;
  if (value === undefined || value === null) return fallback;
  return String(value);
}

/**
 * Einen Wert aus einer Nachschlagetabelle holen, wenn der Schlüssel von aussen
 * kommt.
 * Ausführlich: docs/begruendungen/utils/validate.ts.md#austabelle
 * @param tabelle    Die erlaubten Werte. Nur EIGENE Schlüssel zählen.
 * @param schluessel Der Schlüssel von aussen — beliebiger Typ, wird zu String.
 * @param vorgabe    Was zurückkommt, wenn der Schlüssel nicht in der Tabelle steht.
 * @returns Der Tabellenwert, sonst `vorgabe`.
 */
export function ausTabelle<T>(tabelle: Record<string, T>, schluessel: unknown, vorgabe: T): T;
export function ausTabelle<T>(tabelle: Record<string, T>, schluessel: unknown): T | undefined;
export function ausTabelle<T>(
  tabelle: Record<string, T>,
  schluessel: unknown,
  vorgabe?: T,
): T | undefined {
  const k = einzelwert(schluessel);
  return Object.prototype.hasOwnProperty.call(tabelle, k) ? tabelle[k] : vorgabe;
}
