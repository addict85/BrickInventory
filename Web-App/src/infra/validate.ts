// Check freely editable catalog fields before the database: that is where stored XSS began.

/** What Rebrickable and BrickLink actually assign. */
export const ITEM_NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;

import { z } from 'zod';
import { fachfehler, type ErrorCode } from './errorTexts';
import { moneyInput } from './geld';

/** The columns are integer (int4): a larger value ended as a 500 in PostgreSQL. */
export const LARGEST_ID = 2 ** 31 - 1;

/** An ID from path, body or query: digits up to `hoechstens`, otherwise null. */
export function idWert(wert: unknown, atMost = LARGEST_ID): number | null {
  const raw = typeof wert === 'number' || typeof wert === 'string' ? String(wert).trim() : '';
  if (!/^\d{1,16}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n <= atMost ? n : null;
}

const ID_FIELD = /^(id|ids)$|_ids?$|[a-z]Ids?$/;

/** The first field name that is named like an ID and carries a too large or crooked number.
 * Other values (set numbers, empty values) are checked by the route itself. */
export function toLargeId(wert: unknown, depth = 0): string | null {
  if (depth > 6 || wert === null || typeof wert !== 'object') return null;
  for (const [k, v] of Object.entries(wert)) {
    const list = Array.isArray(v) ? v : [v];
    if (
      ID_FIELD.test(k) &&
      list.some(
        x =>
          (typeof x === 'number' || (typeof x === 'string' && /^-?\d+$/.test(x.trim()))) &&
          !(Number.isSafeInteger(Number(x)) && Math.abs(Number(x)) <= LARGEST_ID),
      )
    )
      return k;
    const deeper = toLargeId(v, depth + 1);
    if (deeper) return deeper;
  }
  return null;
}

/** null if it is none (the route then answers 400). */
export function jsonOrNull(text: string): { wert: unknown } | null {
  try {
    return { wert: JSON.parse(text) };
  } catch {
    return null;
  }
}

export function urlOrNull(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

/** Only a plain address: nodemailer reads `x<a@b.de>` or `a@b.de,c` as a list with
 * display names; the availability check and target throttle would then count a different string. */
export const EMAIL_RE = /^[^\s@<>",;:()[\]\\]+@[^\s@<>",;:()[\]\\]+\.[^\s@<>",;:()[\]\\]+$/;
export function emailValid(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v) && !/\p{Cc}/u.test(v);
}

export function onceDecoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

export function numberRequired(value: unknown, field = 'part_number'): string {
  const v = String(value ?? '').trim();
  if (!v) fachfehler('ungueltig', 'feld_erforderlich', { feld: field });
  if (!ITEM_NUMBER_RE.test(v)) fachfehler('ungueltig', 'feld_nummer_ungueltig', { feld: field });
  return v;
}

/** Truncated instead of rejected: catalog names are long. */
export function optionalText(value: unknown, maxLen = 200): string | null {
  if (value === undefined || value === null) return null;
  const v = String(value)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: filtering out control characters is the purpose of this spot.
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim();
  return v ? v.slice(0, maxLen) : null;
}

/** Only https and a well-formed host: "javascript:…", "data:…" and
 * attribute breakouts drop out with this. */
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

/** No substitute value: `parseInt({a:1}) || 0` turned a broken request into
 * "quantity 0" and deleted the inventory. */
export function inventoryQuantity(value: unknown, min = 0, max = 100_000): number {
  const raw = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : '';
  if (!/^\d{1,6}$/.test(raw) || +raw < min || +raw > max) fachfehler('ungueltig', 'wert_ungueltig');
  return +raw;
}

/** Rebrickable's "[No Color/Any Color]". There 0 is black; a missing color
 * must therefore never become 0. */
export const NO_COLOR = 9999;

export function colorId(value: unknown): number {
  const raw = String(value ?? '').trim();
  return /^\d{1,6}$/.test(raw) ? Number(raw) : NO_COLOR;
}

/** Invalid values are discarded, not rejected. */
export function optionalHex(value: unknown): string | null {
  const v = String(value ?? '')
    .trim()
    .replace(/^#/, '');
  return /^[0-9A-Fa-f]{6}$/.test(v) ? v.toUpperCase() : null;
}

/** Condition of an inventory item, an acquisition or a price: new or used. */
export type Zustand = 'N' | 'U';

/** THE one rule for conditions from database, CSV and input: 'U' (lower case too)
 * is used, 'N' new, everything else the default. */
export function zustand(raw: unknown, defaultValue: Zustand = 'N'): Zustand {
  const v = String(raw ?? '')
    .trim()
    .toUpperCase();
  return v === 'U' || v === 'N' ? v : defaultValue;
}

/** null = not specified. */
export function optionalCondition(value: unknown): 'N' | 'U' | null {
  return value === 'N' || value === 'U' ? value : null;
}

// A billion pieces is nonsense.
export function acquisitionQuantity(value: unknown, fallback = 1): number {
  return positiveInt(value, fallback, 10_000);
}

/** Relatively changed quantity (quantity_delta): integer, |Δ| ≤ 9999; if missing, null. */
export function quantitiesDelta(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const raw = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : '';
  if (!/^-?\d{1,4}$/.test(raw)) fachfehler('ungueltig', 'wert_ungueltig');
  return Number(raw);
}

/** Strict: the string "false" is truthy in JavaScript. */
export function strictBool(value: unknown, feld = 'Wert'): boolean {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  fachfehler('ungueltig', 'feld_kein_wahrheitswert', { feld });
}

/** Aggregates come as strings, and "0" is truthy in JavaScript. */
export function isSparePart(value: unknown): boolean {
  return isJa(value);
}

/** Everything unknown is no. */
export function isJa(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value !== 'string') return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 't' || v === 'true' || v === 'y' || v === 'yes';
}

/** Express delivers an array for a duplicate parameter. */
export function singleValue(value: unknown, fallback = ''): string {
  if (Array.isArray(value)) return value.length ? String(value[0]) : fallback;
  if (value === undefined || value === null) return fallback;
  return String(value);
}

/** Only OWN keys count: a value from outside like 'constructor' would otherwise
 * find an inherited member. */
export function fromTable<T>(table: Record<string, T>, key: unknown, defaultValue: T): T;
export function fromTable<T>(table: Record<string, T>, key: unknown): T | undefined;
export function fromTable<T>(table: Record<string, T>, key: unknown, defaultValue?: T): T | undefined {
  const k = singleValue(key);
  return Object.hasOwn(table, k) ? table[k] : defaultValue;
}

/** The same checks as an input schema for the API contract: the rule exists
 * once, the JSON schema only describes it, and the route gets its result. */
function alsSchema<T>(check: (v: unknown) => T, json: Record<string, unknown>, pflicht: true): z.ZodType<T, unknown>;
function alsSchema<T>(
  check: (v: unknown) => T,
  json: Record<string, unknown>,
  pflicht?: false,
): z.ZodType<T | undefined, unknown>;
function alsSchema<T>(check: (v: unknown) => T, json: Record<string, unknown>, pflicht = false) {
  const checked = z
    .unknown()
    .meta(json)
    .transform((v, ctx): T => {
      // For the validators an object would often mean "missing" and thus the default value.
      if (v !== null && typeof v === 'object') {
        ctx.addIssue({ code: 'custom', message: 'kein einfacher Wert' });
        return z.NEVER;
      }
      try {
        return check(v);
      } catch (e) {
        ctx.addIssue({ code: 'custom', message: e instanceof Error ? e.message : String(e), params: { fehler: e } });
        return z.NEVER;
      }
    });
  return pflicht ? checked : checked.optional();
}

export const input = {
  /** An own rule with its own error code; mandatory. */
  regel: <T>(check: (v: unknown) => T, json: Record<string, unknown>) => alsSchema(check, json, true),
  itemNumber: (feld: string) =>
    alsSchema(v => numberRequired(v, feld), { type: 'string', pattern: ITEM_NUMBER_RE.source }, true),
  text: (max = 200) => alsSchema(v => optionalText(v, max), { type: ['string', 'null'], maxLength: max }),
  imageUrl: () => alsSchema(optionalImageUrl, { type: ['string', 'null'], format: 'uri', pattern: '^https:' }),
  /** Without `pflicht` the quantity may be missing or null; then it stays as it is. */
  menge: (min = 0, max = 100_000) =>
    alsSchema(v => inventoryQuantity(v, min, max), { type: ['integer', 'string'], minimum: min, maximum: max }, true),
  /** If it is missing or null, the quantity stays as it is. */
  quantityOrNothing: (min = 0, max = 100_000) =>
    alsSchema(v => (v == null ? null : inventoryQuantity(v, min, max)), {
      type: ['integer', 'string', 'null'],
      minimum: min,
      maximum: max,
    }),
  stueckzahl: () =>
    alsSchema(v => acquisitionQuantity(v), { type: ['integer', 'string'], minimum: 1, maximum: 10_000 }),
  farbe: () =>
    alsSchema(colorId, { type: ['integer', 'string'], description: `if missing, ${NO_COLOR} (no color) applies` }),
  farbcode: () => alsSchema(optionalHex, { type: ['string', 'null'], pattern: '^#?[0-9A-Fa-f]{6}$' }),
  /** Money (src/infra/geld.ts). Described as a number; text with a dot or comma is still accepted by the
   * server (forms), it is not part of the contract. */
  geld: (feld: string, o: { nullbar?: boolean; max?: number; oneCode?: ErrorCode } = {}) =>
    alsSchema(v => moneyInput(v, feld, o.max, o.oneCode), {
      ...(o.nullbar === false ? { type: 'number' } : { anyOf: [{ type: 'number' }, { type: 'null' }] }),
      minimum: 0,
      maximum: o.max ?? 1_000_000,
      description: 'Amount as a number, at most four decimal places; null or empty: no amount',
    }),
  quantitiesDelta: () =>
    alsSchema(quantitiesDelta, { anyOf: [{ type: 'integer', minimum: -9999, maximum: 9999 }, { type: 'null' }] }),
  zustand: () => alsSchema(optionalCondition, { enum: ['N', 'U', null] }),
  schalter: (feld: string) =>
    alsSchema(
      v => strictBool(v, feld),
      { type: ['boolean', 'integer', 'string'], enum: [true, false, 1, 0, 'true', 'false', '1', '0'] },
      true,
    ),
  /** May be missing; then it is no. */
  toggleOrNo: (feld: string) =>
    alsSchema(v => strictBool(v, feld), {
      type: ['boolean', 'integer', 'string'],
      enum: [true, false, 1, 0, 'true', 'false', '1', '0'],
    }),
};
