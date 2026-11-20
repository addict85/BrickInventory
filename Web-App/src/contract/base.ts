/** Building blocks of the API contract. Responses are open objects (looseObject):
 * an additional field breaks no client (the app reads with
 * ignoreUnknownKeys). Inputs and queries are closed (strictObject):
 * a mistyped field name is a 400 instead of silently ignored. */
import { z } from 'zod';
import { FEHLER, type ErrorCode } from '../infra/errorTexts';

export interface Route {
  /** The body of a 2xx response. If missing, the response is not JSON (`art`). */
  antwort?: z.ZodType;
  /** The body (for `formular` the text fields); the route reads `req.eingabe`. */
  eingabe?: z.ZodType;
  /** The query (?…); the route reads `req.abfrage`. */
  abfrage?: z.ZodType;
  /** Responses that are not JSON: file, event stream or CSV. */
  art?: 'pdf' | 'datei' | 'strom' | 'csv' | 'zip';
  /** For `strom`: one event (data: JSON); the UI reads it via strom() in js/api.js. */
  ereignis?: z.ZodType;
  /** The request is a form with a file (multipart). */
  formular?: true;
  /** Fields for password and code of the re-confirmation (confirmWithFactor). */
  bestaetigung?: { passwort: string; code: string };
  /** The response carries an access, code or plaintext: it is never stored. */
  geheim?: true;
  /** An app token first needs the device key's approval for this step
   * (src/account/http/stepGuard.ts); on the contract so that it is attached to the route and not to a path pattern. */
  schritt?: 'gutschein' | 'zweiter_faktor';
  /** The list is short by nature (one set, one time span); otherwise SEITE. */
  klein?: true;
}

/** Idempotency never repeats confirmed and secret responses: a
 * repetition with a wrong password would otherwise get the stored response. */
export function notRetryable(route: Route | undefined): boolean {
  return !!(route?.geheim || route?.bestaetigung);
}

export const ganz = z.number().int();

/** A duplicate field from the time before unified money: stays for older apps, dropped with API version 3. */
export const veraltet = <T extends z.ZodType>(s: T, statt: string) =>
  s.meta({ deprecated: true, description: `veraltet, entfällt mit API-Version 3; stattdessen ${statt}` });
/** Percent as text ("12.3"); the number is in pnl_prozent. */
export const PERCENT_TEXT = veraltet(z.string().nullable().optional(), 'pnl_prozent');

const inPath = (muster: RegExp) => z.string().regex(muster);
/** A row identifier in the path; digits become a number. The upper bound (int4
 * or the jobs' bigint) is set per router by vertragsRouter. */
const idInPath = inPath(/^\d{1,15}$/)
  .transform(Number)
  .pipe(z.number().int().min(1));
const numberInPath = inPath(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
/** Every path parameter, by name: checkInput checks it, the route reads `req.pfad`. */
export const PATH = {
  setNumber: numberInPath,
  sn: numberInPath,
  partNumber: numberInPath,
  figNumber: numberInPath,
  colorId: inPath(/^\d{1,6}$/).transform(Number),
  id: idInPath,
  acqId: idInPath,
  instrId: idInPath,
  jobId: inPath(/^\d{10,16}-[a-z0-9]{4,12}$/),
  condition: inPath(/^[NUnu]$/).transform(v => v.toUpperCase() as 'N' | 'U'),
  art: inPath(/^[a-z_]{1,40}$/),
  // Exactly the identifier from GET /settings/tokens: a prefix would match several accesses.
  tokenId: inPath(/^[0-9a-f]{16}$/),
  barcode: inPath(/^[A-Za-z0-9-]{1,64}$/),
} as const;
type Namen<P extends string> = P extends `${string}/:${infer N}/${infer R}`
  ? N | Namen<`/${R}`>
  : P extends `${string}/:${infer N}`
    ? N
    : never;
export type PathOf<K extends string> = { [N in Namen<K> & keyof typeof PATH]: z.output<(typeof PATH)[N]> };
/** A point in time as ISO text. Only the TS type carries the brand: in the route
 * a Date may still stand there, res.json writes it as text (wire). */
export const zeit = z.string().brand<'Zeit'>();
type Zeit = z.output<typeof zeit>;
/** Without the index signature of the open objects: otherwise no interface would fit
 * (it lacks one), and a mistyped field name would go unnoticed. */
export type Wire<T> = T extends Zeit
  ? string | Date
  : T extends readonly (infer E)[]
    ? Wire<E>[]
    : T extends object
      ? { [K in keyof T as string extends K ? never : K]: Wire<T[K]> }
      : T;

/** Every error response (src/infra/errorTexts.ts): the apps decide by the
 * code, the sentence is only for humans. */
export const Fehler = z.looseObject({
  success: z.literal(false),
  error: z.string().min(1),
  code: z.string().regex(/^[a-z][a-z0-9_]*$/),
});

/** The codes from fehlerTexte.ts as a component of their own: the app branches on them
 * (Fehlercode.kt), and Android-App/tools/vertrag/vertrag-kotlin.test.js keeps both lists together. The
 * runtime check above stays with the pattern because codes outside the table are
 * sent as well (vertrag_verletzt). */
export const Fehlercode = z.enum(Object.keys(FEHLER) as [ErrorCode, ...ErrorCode[]]);

export const Erfolg = z.looseObject({ success: z.literal(true) });

const factorFields = {
  code: z
    .union([z.string().max(64), z.number()])
    .nullable()
    .optional(),
  passkey: z.record(z.string(), z.unknown()).nullable().optional(),
};
type Confirmation<P extends string, C extends string> = { [K in P]: z.ZodOptional<z.ZodNullable<z.ZodString>> } & {
  [K in C]: typeof factorFields.code;
} & { passkey: typeof factorFields.passkey };
/** Brand and input from one hand: the guard test sends exactly these fields. */
export function bestaetigt<
  F extends z.ZodRawShape = Record<never, z.ZodType>,
  const P extends string = 'password',
  const C extends string = 'code',
>(felder: F = {} as F, passwort: P = 'password' as P, code: C = 'code' as C) {
  // null as missing: the app sends every field of its request, even an empty one.
  const zusatz = {
    [passwort]: z.string().max(1024).nullable().optional(),
    [code]: factorFields.code,
    passkey: factorFields.passkey,
  };
  return {
    bestaetigung: { passwort: passwort as NoInfer<P>, code: code as NoInfer<C> },
    eingabe: z.strictObject({ ...felder, ...(zusatz as Confirmation<P, C>) }),
  };
}

export const SIMPLE = z.union([z.string(), z.number(), z.boolean(), z.null()]);
/** For every writing route without its own schema: only simple values and lists
 * of them. An object instead of a text ({"$ne":1}) would otherwise end up as
 * "[object Object]" in the table or slip past a check. */
export const FLAT_INPUT = z.record(z.string(), z.union([SIMPLE, z.array(SIMPLE)]));

/** A route without a body: a field sent along would be a misunderstanding. */
export const WITHOUT_BODY = z.strictObject({});

/** A query: every value is a single text and may be missing. */
export function abfrage<T extends Record<string, z.ZodType<unknown, string>>>(felder: T) {
  return z.strictObject(
    Object.fromEntries(Object.entries(felder).map(([k, s]) => [k, s.optional()])) as {
      [K in keyof T]: z.ZodOptional<T[K]>;
    },
  );
}
/** Building blocks of the queries; a number arrives as digits and is passed on as a number. */
export const Q = {
  zahl: (max = 1_000_000_000) =>
    z
      .string()
      .regex(/^\d{1,10}$/)
      .transform(Number)
      .pipe(z.number().int().max(max)),
  /** An empty value is no value (null), as sent by an empty select field. */
  numberOrEmpty: z
    .string()
    .regex(/^\d{0,10}$/)
    .transform(v => (v === '' ? null : Number(v))),
  text: (max = 200) => z.string().max(max),
  /** '1' or 'true' is yes — that is how the UI and the app send it. */
  schalter: z.enum(['0', '1', 'true', 'false']).transform(v => v === '1' || v === 'true'),
  /** Which household accounts a list shows (src/household: scopeKind). */
  konten: z.union([z.enum(['all', 'own', 'subs', '']), z.string().regex(/^\d{1,10}$/)]),
  /** An account as owner or target; empty means "the own one". */
  konto: z.string().regex(/^\d{0,10}$/),
};
/** Pages of a long list; without page_size everything (older app versions). */
export const SEITE = { page: Q.zahl(), page_size: Q.zahl() };
/** What a page says about the whole list (src/infra/page.ts). */
export const PAGES_DETAIL = { total: ganz, page: ganz, page_size: ganz };
/** An identifier in the body; app and UI send a number or digits, the route reads a number. */
export const KENNUNG = z.union([ganz, z.string().regex(/^-?\d{1,12}$/)]).transform(Number);
export const TEXT = (max = 200) => z.string().max(max);
/** Lower case counts as upper case; the route reads only 'N', 'U' or ''. */
export const ZUSTAND = z
  .union([z.enum(['N', 'U', 'n', 'u']), z.literal('')])
  .transform(v => v.toUpperCase() as 'N' | 'U' | '');
/** A text that may be missing; the route then reads ''. */
export const TEXT_OR_EMPTY = (max = 200) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform(v => v ?? '');
export const JA_NO = z.union([z.boolean(), z.literal(0), z.literal(1), z.enum(['0', '1', 'true', 'false'])]);
/** Settings as key and simple value; which ones apply is checked by the route. */
export const EINSTELLUNGEN = z.record(
  z.string().max(64),
  SIMPLE.transform(v => String(v)),
);

/** An account in owner lists. */
export const KontoName = z.looseObject({ id: ganz, username: z.string() });
