/** Bausteine des API-Vertrags. Antworten sind offene Objekte (looseObject):
 * Ein zusätzliches Feld bricht keinen Client (die App liest mit
 * ignoreUnknownKeys). Eingaben und Abfragen sind geschlossen (strictObject):
 * Ein vertippter Feldname ist 400 statt still ignoriert. */
import { z } from 'zod';
import { FEHLER, type ErrorCode } from '../infra/fehlerTexte';

export interface Route {
  /** Der Rumpf einer 2xx-Antwort. Fehlt er, ist die Antwort kein JSON (`art`). */
  antwort?: z.ZodType;
  /** Der Rumpf (bei `formular` die Textfelder); die Route liest `req.eingabe`. */
  eingabe?: z.ZodType;
  /** Die Abfrage (?…); die Route liest `req.abfrage`. */
  abfrage?: z.ZodType;
  /** Antworten, die kein JSON sind: Datei, Ereignisstrom oder CSV. */
  art?: 'pdf' | 'datei' | 'strom' | 'csv' | 'zip';
  /** Bei `strom`: ein Ereignis (data: JSON); die Oberfläche liest es über strom() in js/api.js. */
  ereignis?: z.ZodType;
  /** Die Anfrage ist ein Formular mit Datei (multipart). */
  formular?: true;
  /** Felder von Passwort und Code der erneuten Bestätigung (confirmWithFactor). */
  bestaetigung?: { passwort: string; code: string };
  /** Die Antwort trägt einen Zugang, Code oder Klartext: Sie wird nie gespeichert. */
  geheim?: true;
  /** Ein App-Token braucht vorher die Freigabe des Geräteschlüssels für diesen Schritt
   * (src/konto/http/schrittschutz.ts); am Vertrag, damit sie an der Route hängt und nicht an einem Pfadmuster. */
  schritt?: 'gutschein' | 'zweiter_faktor';
  /** Die Liste ist von Natur aus kurz (ein Set, eine Zeitspanne); sonst SEITE. */
  klein?: true;
}

/** Bestätigte und geheime Antworten wiederholt die Idempotenz nie: Eine
 * Wiederholung mit falschem Passwort bekäme sonst die gespeicherte Antwort. */
export function notRetryable(route: Route | undefined): boolean {
  return !!(route?.geheim || route?.bestaetigung);
}

export const ganz = z.number().int();

/** Ein Doppelfeld aus der Zeit vor einheitlichem Geld: bleibt für ältere Apps, entfällt mit API-Version 3. */
export const veraltet = <T extends z.ZodType>(s: T, statt: string) =>
  s.meta({ deprecated: true, description: `veraltet, entfällt mit API-Version 3; stattdessen ${statt}` });
/** Prozent als Text („12.3“); die Zahl steht in pnl_prozent. */
export const PERCENT_TEXT = veraltet(z.string().nullable().optional(), 'pnl_prozent');

const inPath = (muster: RegExp) => z.string().regex(muster);
/** Eine Zeilenkennung im Pfad; aus Ziffern wird eine Zahl. Die Obergrenze (int4
 * oder bigint der Aufträge) setzt vertragsRouter je Router. */
const idInPath = inPath(/^\d{1,15}$/)
  .transform(Number)
  .pipe(z.number().int().min(1));
const numberInPath = inPath(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
/** Jeder Pfadparameter, nach Namen: checkInput prüft ihn, die Route liest `req.pfad`. */
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
  // Genau die Kennung aus GET /settings/tokens: Ein Präfix träfe mehrere Zugänge.
  tokenId: inPath(/^[0-9a-f]{16}$/),
  barcode: inPath(/^[A-Za-z0-9-]{1,64}$/),
} as const;
type Namen<P extends string> = P extends `${string}/:${infer N}/${infer R}`
  ? N | Namen<`/${R}`>
  : P extends `${string}/:${infer N}`
    ? N
    : never;
export type PathOf<K extends string> = { [N in Namen<K> & keyof typeof PATH]: z.output<(typeof PATH)[N]> };
/** Ein Zeitpunkt als ISO-Text. Die Marke trägt nur der TS-Typ: In der Route
 * darf dort noch ein Date stehen, res.json schreibt es als Text (Draht). */
export const zeit = z.string().brand<'Zeit'>();
type Zeit = z.output<typeof zeit>;
/** Ohne die Indexsignatur der offenen Objekte: Sonst passte kein Interface
 * (ihm fehlt sie), und ein vertippter Feldname fiele nicht auf. */
export type Wire<T> = T extends Zeit
  ? string | Date
  : T extends readonly (infer E)[]
    ? Wire<E>[]
    : T extends object
      ? { [K in keyof T as string extends K ? never : K]: Wire<T[K]> }
      : T;

/** Jede Fehlerantwort (src/infra/fehlerTexte.ts): Die Apps entscheiden am
 * Code, der Satz ist nur für Menschen. */
export const Fehler = z.looseObject({
  success: z.literal(false),
  error: z.string().min(1),
  code: z.string().regex(/^[a-z][a-z0-9_]*$/),
});

/** Die Codes aus fehlerTexte.ts als eigene Komponente: Die App verzweigt nach ihnen
 * (Fehlercode.kt), und Android-App/tools/vertrag/vertrag-kotlin.test.js hält beide Listen zusammen. Die
 * Laufzeitprüfung oben bleibt beim Muster, weil auch Codes ausserhalb der Tabelle
 * gesendet werden (vertrag_verletzt). */
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
/** Marke und Eingabe aus einer Hand: Der Wächtertest schickt genau diese Felder. */
export function bestaetigt<
  F extends z.ZodRawShape = Record<never, z.ZodType>,
  const P extends string = 'password',
  const C extends string = 'code',
>(felder: F = {} as F, passwort: P = 'password' as P, code: C = 'code' as C) {
  // null wie fehlend: Die App schickt jedes Feld ihrer Anfrage, auch ein leeres.
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
/** Für jede schreibende Route ohne eigenes Schema: nur einfache Werte und Listen
 * davon. Ein Objekt statt eines Textes ({"$ne":1}) landete sonst als
 * "[object Object]" in der Tabelle oder an einer Prüfung vorbei. */
export const FLAT_INPUT = z.record(z.string(), z.union([SIMPLE, z.array(SIMPLE)]));

/** Eine Route ohne Rumpf: Ein mitgeschicktes Feld wäre ein Missverständnis. */
export const WITHOUT_BODY = z.strictObject({});

/** Eine Abfrage: Jeder Wert ist ein einzelner Text und darf fehlen. */
export function abfrage<T extends Record<string, z.ZodType<unknown, string>>>(felder: T) {
  return z.strictObject(
    Object.fromEntries(Object.entries(felder).map(([k, s]) => [k, s.optional()])) as {
      [K in keyof T]: z.ZodOptional<T[K]>;
    },
  );
}
/** Bausteine der Abfragen; eine Zahl kommt als Ziffern an und geht als Zahl weiter. */
export const Q = {
  zahl: (max = 1_000_000_000) =>
    z
      .string()
      .regex(/^\d{1,10}$/)
      .transform(Number)
      .pipe(z.number().int().max(max)),
  /** Ein leerer Wert ist keine Angabe (null), wie ihn ein leeres Auswahlfeld schickt. */
  numberOrEmpty: z
    .string()
    .regex(/^\d{0,10}$/)
    .transform(v => (v === '' ? null : Number(v))),
  text: (max = 200) => z.string().max(max),
  /** '1' oder 'true' ist ja — so schicken es Oberfläche und App. */
  schalter: z.enum(['0', '1', 'true', 'false']).transform(v => v === '1' || v === 'true'),
  /** Welche Konten des Haushalts eine Liste zeigt (src/haushalt: scopeKind). */
  konten: z.union([z.enum(['all', 'own', 'subs', '']), z.string().regex(/^\d{1,10}$/)]),
  /** Ein Konto als Besitzer oder Ziel; leer heisst „das eigene“. */
  konto: z.string().regex(/^\d{0,10}$/),
};
/** Seiten einer langen Liste; ohne page_size alles (ältere App-Stände). */
export const SEITE = { page: Q.zahl(), page_size: Q.zahl() };
/** Was eine Seite über die ganze Liste sagt (src/infra/seite.ts). */
export const PAGES_DETAIL = { total: ganz, page: ganz, page_size: ganz };
/** Eine Kennung im Rumpf; App und Oberfläche schicken Zahl oder Ziffern, die Route liest eine Zahl. */
export const KENNUNG = z.union([ganz, z.string().regex(/^-?\d{1,12}$/)]).transform(Number);
export const TEXT = (max = 200) => z.string().max(max);
/** Klein geschrieben gilt wie gross; die Route liest nur 'N', 'U' oder ''. */
export const ZUSTAND = z
  .union([z.enum(['N', 'U', 'n', 'u']), z.literal('')])
  .transform(v => v.toUpperCase() as 'N' | 'U' | '');
/** Ein Text, der fehlen darf; die Route liest dann ''. */
export const TEXT_OR_EMPTY = (max = 200) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform(v => v ?? '');
export const JA_NO = z.union([z.boolean(), z.literal(0), z.literal(1), z.enum(['0', '1', 'true', 'false'])]);
/** Einstellungen als Schlüssel und einfacher Wert; welche gelten, prüft die Route. */
export const EINSTELLUNGEN = z.record(
  z.string().max(64),
  SIMPLE.transform(v => String(v)),
);

/** Ein Konto in Besitzerlisten. */
export const KontoName = z.looseObject({ id: ganz, username: z.string() });
