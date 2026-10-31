// Ausführlich: docs/begruendungen/src/infra/validate.ts.md#item-number-re

/** Das, was Rebrickable und BrickLink tatsächlich vergeben. */
export const ITEM_NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;

import { fehlerWerfen } from './fehlerTexte';

/** null, wenn es keines ist (die Route antwortet dann 400). */
export function jsonOderNull(text: string): { wert: unknown } | null {
  try { return { wert: JSON.parse(text) }; } catch { return null; }
}

export function urlOderNull(text: string): URL | null {
  try { return new URL(text); } catch { return null; }
}

export function einmalDekodiert(text: string): string {
  try { return decodeURIComponent(text); } catch { return text; }
}

function fail(msg: string): never {
  const e: any = new Error(msg);
  e.status = 400;
  throw e;
}

export function requireItemNumber(value: any, field = 'part_number'): string {
  const v = String(value ?? '').trim();
  if (!v) fail(`${field} erforderlich`);
  if (!ITEM_NUMBER_RE.test(v))
    fail(`${field} darf nur Buchstaben, Zahlen und . _ - / enthalten (max. 64 Zeichen)`);
  return v;
}

/** Gekappt statt abgelehnt: Katalognamen sind lang. */
export function optionalText(value: any, maxLen = 200): string | null {
  if (value === undefined || value === null) return null;
  const v = String(value).replace(/[\u0000-\u001F\u007F]/g, '').trim();
  return v ? v.slice(0, maxLen) : null;
}

/** Nur https und ein wohlgeformter Host: "javascript:…", "data:…" und
 * Attribut-Ausbrüche fallen damit raus. */
export function optionalImageUrl(value: any): string | null {
  if (value === undefined || value === null || value === '') return null;
  const v = String(value).trim();
  if (v.length > 2048) fail('image_url ist zu lang');
  let u: URL;
  try { u = new URL(v); } catch { fail('image_url ist keine gültige URL'); }
  if (u.protocol !== 'https:') fail('image_url muss https sein');
  return u.toString();
}

export function positiveInt(value: any, fallback = 1, max = 1_000_000): number {
  const n = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, n));
}

/** Kein Ersatzwert: `parseInt({a:1}) || 0` machte aus einer kaputten Anfrage
 * „Menge 0" und löschte den Bestand. */
export function bestandsMenge(value: unknown, min = 0, max = 100_000): number {
  const roh = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : '';
  if (!/^\d{1,6}$/.test(roh) || +roh < min || +roh > max) fehlerWerfen('wert_ungueltig', 400);
  return +roh;
}

/** Rebrickables „[No Color/Any Color]". Dort ist 0 Schwarz; eine fehlende Farbe
 * darf deshalb nie zu 0 werden. */
export const KEINE_FARBE = 9999;

export function colorId(value: unknown): number {
  const roh = String(value ?? '').trim();
  return /^\d{1,6}$/.test(roh) ? Number(roh) : KEINE_FARBE;
}

/** Ungültige Werte werden verworfen, nicht abgelehnt. */
export function optionalHex(value: any): string | null {
  const v = String(value ?? '').trim().replace(/^#/, '');
  return /^[0-9A-Fa-f]{6}$/.test(v) ? v.toUpperCase() : null;
}

/** null = keine Angabe. */
export function optionalCondition(value: any): 'N' | 'U' | null {
  return value === 'N' || value === 'U' ? value : null;
}

// Ausführlich: docs/begruendungen/src/infra/validate.ts.md#acquisitionquantity
export function acquisitionQuantity(value: any, fallback = 1): number {
  return positiveInt(value, fallback, 10_000);
}

/** @returns null bei leerer Angabe (= „kein Preis"), sonst der geprüfte Betrag
 * Ausführlich: docs/begruendungen/src/infra/validate.ts.md#optionalprice */
export function optionalPrice(value: any, feld = 'Preis'): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = parseFloat(String(value).replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  if (n < 0) fail(`${feld} darf nicht negativ sein`);
  if (n > 1_000_000) fail(`${feld} ist unplausibel hoch`);
  return n;
}

/** Streng: Die Zeichenkette "false" ist in JavaScript wahr.
 * Ausführlich: docs/begruendungen/src/infra/validate.ts.md#strictbool */
export function strictBool(value: any, feld = 'Wert'): boolean {
  if (value === true  || value === 'true'  || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  fail(`${feld} muss true oder false sein`);
}

/** Aggregate kommen als Zeichenkette, und "0" ist in JavaScript wahr.
 * Ausführlich: docs/begruendungen/src/infra/validate.ts.md#istersatzteil */
export function istErsatzteil(value: unknown): boolean {
  return istJa(value);
}

/** Alles Unbekannte ist nein. */
export function istJa(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value !== 'string') return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 't' || v === 'true' || v === 'y' || v === 'yes';
}

/** Express liefert bei doppeltem Parameter ein Array.
 * Ausführlich: docs/begruendungen/src/infra/validate.ts.md#einzelwert */
export function einzelwert(value: unknown, fallback = ''): string {
  if (Array.isArray(value)) return value.length ? String(value[0]) : fallback;
  if (value === undefined || value === null) return fallback;
  return String(value);
}

/** Nur EIGENE Schlüssel zählen: Ein Wert von aussen wie 'constructor' fände
 * sonst ein geerbtes Mitglied.
 * Ausführlich: docs/begruendungen/src/infra/validate.ts.md#austabelle */
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
