// Frei erfassbare Katalogfelder vor der Datenbank prüfen: Dort begann Stored XSS.

/** Das, was Rebrickable und BrickLink tatsächlich vergeben. */
export const ITEM_NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;

import { z } from 'zod';
import { fachfehler, type FehlerCode } from './fehlerTexte';
import { geldEingabe } from './geld';

/** Die Spalten sind integer (int4): Ein grösserer Wert endete als 500 in PostgreSQL. */
export const GROESSTE_ID = 2 ** 31 - 1;

/** Eine ID aus Pfad, Rumpf oder Abfrage: Ziffern bis `hoechstens`, sonst null. */
export function idWert(wert: unknown, hoechstens = GROESSTE_ID): number | null {
  const roh = typeof wert === 'number' || typeof wert === 'string' ? String(wert).trim() : '';
  if (!/^\d{1,16}$/.test(roh)) return null;
  const n = Number(roh);
  return Number.isSafeInteger(n) && n <= hoechstens ? n : null;
}

const ID_FELD = /^(id|ids)$|_ids?$|[a-z]Ids?$/;

/** Der erste Feldname, der nach ID heisst und eine zu grosse oder krumme Zahl
 * trägt. Andere Werte (Setnummern, leere Angaben) prüft die Route selbst. */
export function zuGrosseId(wert: unknown, tiefe = 0): string | null {
  if (tiefe > 6 || wert === null || typeof wert !== 'object') return null;
  for (const [k, v] of Object.entries(wert)) {
    const liste = Array.isArray(v) ? v : [v];
    if (
      ID_FELD.test(k) &&
      liste.some(
        x =>
          (typeof x === 'number' || (typeof x === 'string' && /^-?\d+$/.test(x.trim()))) &&
          !(Number.isSafeInteger(Number(x)) && Math.abs(Number(x)) <= GROESSTE_ID),
      )
    )
      return k;
    const tiefer = zuGrosseId(v, tiefe + 1);
    if (tiefer) return tiefer;
  }
  return null;
}

/** null, wenn es keines ist (die Route antwortet dann 400). */
export function jsonOderNull(text: string): { wert: unknown } | null {
  try {
    return { wert: JSON.parse(text) };
  } catch {
    return null;
  }
}

export function urlOderNull(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

/** Nur eine reine Adresse: nodemailer liest `x<a@b.de>` oder `a@b.de,c` als Liste mit
 * Anzeigenamen, Vergabeprüfung und Zieldrossel zählten dann eine andere Zeichenkette. */
export const EMAIL_RE = /^[^\s@<>",;:()[\]\\]+@[^\s@<>",;:()[\]\\]+\.[^\s@<>",;:()[\]\\]+$/;
export function emailGueltig(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v) && !/\p{Cc}/u.test(v);
}

export function einmalDekodiert(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

export function requireItemNumber(value: unknown, field = 'part_number'): string {
  const v = String(value ?? '').trim();
  if (!v) fachfehler('ungueltig', 'feld_erforderlich', { feld: field });
  if (!ITEM_NUMBER_RE.test(v)) fachfehler('ungueltig', 'feld_nummer_ungueltig', { feld: field });
  return v;
}

/** Gekappt statt abgelehnt: Katalognamen sind lang. */
export function optionalText(value: unknown, maxLen = 200): string | null {
  if (value === undefined || value === null) return null;
  const v = String(value)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen herauszufiltern ist der Zweck dieser Stelle.
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim();
  return v ? v.slice(0, maxLen) : null;
}

/** Nur https und ein wohlgeformter Host: "javascript:…", "data:…" und
 * Attribut-Ausbrüche fallen damit raus. */
export function optionalImageUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const v = String(value).trim();
  if (v.length > 2048) fachfehler('ungueltig', 'bild_url_zu_lang');
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    fachfehler('ungueltig', 'bild_url_ungueltig');
  }
  if (u.protocol !== 'https:') fachfehler('ungueltig', 'bild_url_nicht_https');
  return u.toString();
}

export function positiveInt(value: unknown, fallback = 1, max = 1_000_000): number {
  const n = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, n));
}

/** Kein Ersatzwert: `parseInt({a:1}) || 0` machte aus einer kaputten Anfrage
 * „Menge 0" und löschte den Bestand. */
export function bestandsMenge(value: unknown, min = 0, max = 100_000): number {
  const roh = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : '';
  if (!/^\d{1,6}$/.test(roh) || +roh < min || +roh > max) fachfehler('ungueltig', 'wert_ungueltig');
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
export function optionalHex(value: unknown): string | null {
  const v = String(value ?? '')
    .trim()
    .replace(/^#/, '');
  return /^[0-9A-Fa-f]{6}$/.test(v) ? v.toUpperCase() : null;
}

/** Zustand eines Bestands, einer Erfassung oder eines Preises: neu oder gebraucht. */
export type Zustand = 'N' | 'U';

/** Die eine Regel für Zustände aus Datenbank, CSV und Eingabe: 'U' (auch klein)
 * ist gebraucht, 'N' neu, alles andere die Vorgabe. */
export function zustand(roh: unknown, vorgabe: Zustand = 'N'): Zustand {
  const v = String(roh ?? '')
    .trim()
    .toUpperCase();
  return v === 'U' || v === 'N' ? v : vorgabe;
}

/** null = keine Angabe. */
export function optionalCondition(value: unknown): 'N' | 'U' | null {
  return value === 'N' || value === 'U' ? value : null;
}

// Eine Milliarde Stück ist Unsinn.
export function acquisitionQuantity(value: unknown, fallback = 1): number {
  return positiveInt(value, fallback, 10_000);
}

/** Relativ geänderte Menge (quantity_delta): ganzzahlig, |Δ| ≤ 9999; fehlt sie, null. */
export function mengenDelta(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const roh = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : '';
  if (!/^-?\d{1,4}$/.test(roh)) fachfehler('ungueltig', 'wert_ungueltig');
  return Number(roh);
}

/** Streng: Die Zeichenkette "false" ist in JavaScript wahr. */
export function strictBool(value: unknown, feld = 'Wert'): boolean {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  fachfehler('ungueltig', 'feld_kein_wahrheitswert', { feld });
}

/** Aggregate kommen als Zeichenkette, und "0" ist in JavaScript wahr. */
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

/** Express liefert bei doppeltem Parameter ein Array. */
export function einzelwert(value: unknown, fallback = ''): string {
  if (Array.isArray(value)) return value.length ? String(value[0]) : fallback;
  if (value === undefined || value === null) return fallback;
  return String(value);
}

/** Nur EIGENE Schlüssel zählen: Ein Wert von aussen wie 'constructor' fände
 * sonst ein geerbtes Mitglied. */
export function ausTabelle<T>(tabelle: Record<string, T>, schluessel: unknown, vorgabe: T): T;
export function ausTabelle<T>(tabelle: Record<string, T>, schluessel: unknown): T | undefined;
export function ausTabelle<T>(tabelle: Record<string, T>, schluessel: unknown, vorgabe?: T): T | undefined {
  const k = einzelwert(schluessel);
  return Object.hasOwn(tabelle, k) ? tabelle[k] : vorgabe;
}

/** Dieselben Prüfungen als Eingabeschema für den API-Vertrag: Die Regel gibt es
 * einmal, das JSON-Schema beschreibt sie nur, und die Route bekommt ihr Ergebnis. */
function alsSchema<T>(pruefe: (v: unknown) => T, json: Record<string, unknown>, pflicht: true): z.ZodType<T, unknown>;
function alsSchema<T>(
  pruefe: (v: unknown) => T,
  json: Record<string, unknown>,
  pflicht?: false,
): z.ZodType<T | undefined, unknown>;
function alsSchema<T>(pruefe: (v: unknown) => T, json: Record<string, unknown>, pflicht = false) {
  const geprueft = z
    .unknown()
    .meta(json)
    .transform((v, ctx): T => {
      // Ein Objekt hiesse für die Prüfer oft „fehlt" und damit Vorgabewert.
      if (v !== null && typeof v === 'object') {
        ctx.addIssue({ code: 'custom', message: 'kein einfacher Wert' });
        return z.NEVER;
      }
      try {
        return pruefe(v);
      } catch (e) {
        ctx.addIssue({ code: 'custom', message: e instanceof Error ? e.message : String(e), params: { fehler: e } });
        return z.NEVER;
      }
    });
  return pflicht ? geprueft : geprueft.optional();
}

export const eingabe = {
  /** Eine eigene Regel mit eigenem Fehlercode; Pflicht. */
  regel: <T>(pruefe: (v: unknown) => T, json: Record<string, unknown>) => alsSchema(pruefe, json, true),
  artikelnummer: (feld: string) =>
    alsSchema(v => requireItemNumber(v, feld), { type: 'string', pattern: ITEM_NUMBER_RE.source }, true),
  text: (max = 200) => alsSchema(v => optionalText(v, max), { type: ['string', 'null'], maxLength: max }),
  bildUrl: () => alsSchema(optionalImageUrl, { type: ['string', 'null'], format: 'uri', pattern: '^https:' }),
  /** Ohne `pflicht` darf die Menge fehlen oder null sein; dann bleibt sie, wie sie ist. */
  menge: (min = 0, max = 100_000) =>
    alsSchema(v => bestandsMenge(v, min, max), { type: ['integer', 'string'], minimum: min, maximum: max }, true),
  /** Fehlt sie oder ist sie null, bleibt die Menge, wie sie ist. */
  mengeOderNichts: (min = 0, max = 100_000) =>
    alsSchema(v => (v == null ? null : bestandsMenge(v, min, max)), {
      type: ['integer', 'string', 'null'],
      minimum: min,
      maximum: max,
    }),
  stueckzahl: () =>
    alsSchema(v => acquisitionQuantity(v), { type: ['integer', 'string'], minimum: 1, maximum: 10_000 }),
  farbe: () =>
    alsSchema(colorId, { type: ['integer', 'string'], description: `fehlt sie, gilt ${KEINE_FARBE} (keine Farbe)` }),
  farbcode: () => alsSchema(optionalHex, { type: ['string', 'null'], pattern: '^#?[0-9A-Fa-f]{6}$' }),
  /** Geld (src/infra/geld.ts). Beschrieben als Zahl; Text mit Punkt oder Komma nimmt der
   * Server noch an (Formulare), er ist nicht Teil des Vertrags. */
  geld: (feld: string, o: { nullbar?: boolean; max?: number; einCode?: FehlerCode } = {}) =>
    alsSchema(v => geldEingabe(v, feld, o.max, o.einCode), {
      ...(o.nullbar === false ? { type: 'number' } : { anyOf: [{ type: 'number' }, { type: 'null' }] }),
      minimum: 0,
      maximum: o.max ?? 1_000_000,
      description: 'Betrag als Zahl, höchstens vier Nachkommastellen; null oder leer: kein Betrag',
    }),
  mengenDelta: () =>
    alsSchema(mengenDelta, { anyOf: [{ type: 'integer', minimum: -9999, maximum: 9999 }, { type: 'null' }] }),
  zustand: () => alsSchema(optionalCondition, { enum: ['N', 'U', null] }),
  schalter: (feld: string) =>
    alsSchema(
      v => strictBool(v, feld),
      { type: ['boolean', 'integer', 'string'], enum: [true, false, 1, 0, 'true', 'false', '1', '0'] },
      true,
    ),
  /** Darf fehlen; dann ist er nein. */
  schalterOderNein: (feld: string) =>
    alsSchema(v => strictBool(v, feld), {
      type: ['boolean', 'integer', 'string'],
      enum: [true, false, 1, 0, 'true', 'false', '1', '0'],
    }),
};
