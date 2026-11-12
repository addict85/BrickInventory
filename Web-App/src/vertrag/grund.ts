/** Bausteine des API-Vertrags. Antworten sind offene Objekte (looseObject):
 * Ein zusätzliches Feld bricht keinen Client (die App liest mit
 * ignoreUnknownKeys). Eingaben und Abfragen sind geschlossen (strictObject):
 * Ein vertippter Feldname ist 400 statt still ignoriert. */
import { z } from 'zod';
import { FEHLER, type FehlerCode } from '../infra/fehlerTexte';

export interface Route {
  /** Der Rumpf einer 2xx-Antwort. Fehlt er, ist die Antwort kein JSON (`art`). */
  antwort?: z.ZodType;
  /** Der Rumpf (bei `formular` die Textfelder); die Route liest `req.eingabe`. */
  eingabe?: z.ZodType;
  /** Die Abfrage (?…); die Route liest `req.abfrage`. */
  abfrage?: z.ZodType;
  /** Antworten, die kein JSON sind: Datei, Ereignisstrom oder CSV. */
  art?: 'pdf' | 'datei' | 'strom' | 'csv' | 'zip';
  /** Die Anfrage ist ein Formular mit Datei (multipart). */
  formular?: true;
  /** Felder von Passwort und Code der erneuten Bestätigung (bestaetigeMitFaktor). */
  bestaetigung?: { passwort: string; code: string };
  /** Die Antwort trägt einen Zugang, Code oder Klartext: Sie wird nie gespeichert. */
  geheim?: true;
  /** Die Liste ist von Natur aus kurz (ein Set, eine Zeitspanne); sonst SEITE. */
  klein?: true;
}

/** Bestätigte und geheime Antworten wiederholt die Idempotenz nie: Eine
 * Wiederholung mit falschem Passwort bekäme sonst die gespeicherte Antwort. */
export function nichtWiederholbar(route: Route | undefined): boolean {
  return !!(route?.geheim || route?.bestaetigung);
}

export const ganz = z.number().int();

/** Ein Doppelfeld aus der Zeit vor einheitlichem Geld: bleibt für ältere Apps, entfällt mit API-Version 3. */
export const veraltet = <T extends z.ZodType>(s: T, statt: string) =>
  s.meta({ deprecated: true, description: `veraltet, entfällt mit API-Version 3; stattdessen ${statt}` });
/** Prozent als Text („12.3“); die Zahl steht in pnl_prozent. */
export const PROZENT_TEXT = veraltet(z.string().nullable().optional(), 'pnl_prozent');

const imPfad = (muster: RegExp) => z.string().regex(muster);
/** Eine Zeilenkennung im Pfad; aus Ziffern wird eine Zahl. Die Obergrenze (int4
 * oder bigint der Aufträge) setzt vertragsRouter je Router. */
const kennungImPfad = imPfad(/^\d{1,15}$/)
  .transform(Number)
  .pipe(z.number().int().min(1));
const nummerImPfad = imPfad(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
/** Jeder Pfadparameter, nach Namen: eingabePruefen prüft ihn, die Route liest `req.pfad`. */
export const PFAD = {
  setNumber: nummerImPfad,
  sn: nummerImPfad,
  partNumber: nummerImPfad,
  figNumber: nummerImPfad,
  colorId: imPfad(/^\d{1,6}$/).transform(Number),
  id: kennungImPfad,
  acqId: kennungImPfad,
  instrId: kennungImPfad,
  jobId: imPfad(/^\d{10,16}-[a-z0-9]{4,12}$/),
  condition: imPfad(/^[NUnu]$/).transform(v => v.toUpperCase() as 'N' | 'U'),
  art: imPfad(/^[a-z_]{1,40}$/),
  // Genau die Kennung aus GET /settings/tokens: Ein Präfix träfe mehrere Zugänge.
  tokenId: imPfad(/^[0-9a-f]{16}$/),
  barcode: imPfad(/^[A-Za-z0-9-]{1,64}$/),
} as const;
type Namen<P extends string> = P extends `${string}/:${infer N}/${infer R}`
  ? N | Namen<`/${R}`>
  : P extends `${string}/:${infer N}`
    ? N
    : never;
export type PfadVon<K extends string> = { [N in Namen<K> & keyof typeof PFAD]: z.output<(typeof PFAD)[N]> };
/** Ein Zeitpunkt als ISO-Text. Die Marke trägt nur der TS-Typ: In der Route
 * darf dort noch ein Date stehen, res.json schreibt es als Text (Draht). */
export const zeit = z.string().brand<'Zeit'>();
type Zeit = z.output<typeof zeit>;
/** Ohne die Indexsignatur der offenen Objekte: Sonst passte kein Interface
 * (ihm fehlt sie), und ein vertippter Feldname fiele nicht auf. */
export type Draht<T> = T extends Zeit
  ? string | Date
  : T extends readonly (infer E)[]
    ? Draht<E>[]
    : T extends object
      ? { [K in keyof T as string extends K ? never : K]: Draht<T[K]> }
      : T;

/** Jede Fehlerantwort (src/infra/fehlerTexte.ts): Die Apps entscheiden am
 * Code, der Satz ist nur für Menschen. */
export const Fehler = z.looseObject({
  success: z.literal(false),
  error: z.string().min(1),
  code: z.string().regex(/^[a-z][a-z0-9_]*$/),
});

/** Die Codes aus fehlerTexte.ts als eigene Komponente: Die App verzweigt nach ihnen
 * (Fehlercode.kt), und vertrag-kotlin.test.js hält beide Listen zusammen. Die
 * Laufzeitprüfung oben bleibt beim Muster, weil auch Codes ausserhalb der Tabelle
 * gesendet werden (vertrag_verletzt). */
export const Fehlercode = z.enum(Object.keys(FEHLER) as [FehlerCode, ...FehlerCode[]]);

export const Erfolg = z.looseObject({ success: z.literal(true) });

const faktorFelder = {
  code: z
    .union([z.string().max(64), z.number()])
    .nullable()
    .optional(),
  passkey: z.record(z.string(), z.unknown()).nullable().optional(),
};
type Bestaetigung<P extends string, C extends string> = { [K in P]: z.ZodOptional<z.ZodNullable<z.ZodString>> } & {
  [K in C]: typeof faktorFelder.code;
} & { passkey: typeof faktorFelder.passkey };
/** Marke und Eingabe aus einer Hand: Der Wächtertest schickt genau diese Felder. */
export function bestaetigt<
  F extends z.ZodRawShape = Record<never, z.ZodType>,
  const P extends string = 'password',
  const C extends string = 'code',
>(felder: F = {} as F, passwort: P = 'password' as P, code: C = 'code' as C) {
  // null wie fehlend: Die App schickt jedes Feld ihrer Anfrage, auch ein leeres.
  const zusatz = {
    [passwort]: z.string().max(1024).nullable().optional(),
    [code]: faktorFelder.code,
    passkey: faktorFelder.passkey,
  };
  return {
    bestaetigung: { passwort: passwort as NoInfer<P>, code: code as NoInfer<C> },
    eingabe: z.strictObject({ ...felder, ...(zusatz as Bestaetigung<P, C>) }),
  };
}

export const EINFACH = z.union([z.string(), z.number(), z.boolean(), z.null()]);
/** Für jede schreibende Route ohne eigenes Schema: nur einfache Werte und Listen
 * davon. Ein Objekt statt eines Textes ({"$ne":1}) landete sonst als
 * "[object Object]" in der Tabelle oder an einer Prüfung vorbei. */
export const FLACHE_EINGABE = z.record(z.string(), z.union([EINFACH, z.array(EINFACH)]));

/** Eine Route ohne Rumpf: Ein mitgeschicktes Feld wäre ein Missverständnis. */
export const OHNE_RUMPF = z.strictObject({});

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
  zahlOderLeer: z
    .string()
    .regex(/^\d{0,10}$/)
    .transform(v => (v === '' ? null : Number(v))),
  text: (max = 200) => z.string().max(max),
  /** '1' oder 'true' ist ja — so schicken es Oberfläche und App. */
  schalter: z.enum(['0', '1', 'true', 'false']).transform(v => v === '1' || v === 'true'),
  /** Welche Konten des Haushalts eine Liste zeigt (src/haushalt: parseScopeMode). */
  konten: z.union([z.enum(['all', 'own', 'subs', '']), z.string().regex(/^\d{1,10}$/)]),
  /** Ein Konto als Besitzer oder Ziel; leer heisst „das eigene“. */
  konto: z.string().regex(/^\d{0,10}$/),
};
/** Seiten einer langen Liste; ohne page_size alles (ältere App-Stände). */
export const SEITE = { page: Q.zahl(), page_size: Q.zahl() };
/** Was eine Seite über die ganze Liste sagt (src/infra/seite.ts). */
export const SEITEN_ANGABE = { total: ganz, page: ganz, page_size: ganz };
export const KENNUNG = z.union([ganz, z.string().regex(/^-?\d{1,12}$/)]);
export const TEXT = (max = 200) => z.string().max(max);
export const ZUSTAND = z.union([z.enum(['N', 'U', 'n', 'u']), z.literal('')]);
export const JA_NEIN = z.union([z.boolean(), z.literal(0), z.literal(1), z.enum(['0', '1', 'true', 'false'])]);
/** Einstellungen als Schlüssel und einfacher Wert; welche gelten, prüft die Route. */
export const EINSTELLUNGEN = z.record(z.string().max(64), EINFACH);

/** Ein Konto in Besitzerlisten. */
export const KontoName = z.looseObject({ id: ganz, username: z.string() });
