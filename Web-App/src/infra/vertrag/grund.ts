/** Bausteine des API-Vertrags. Antworten sind offene Objekte (looseObject):
 * Ein zusätzliches Feld bricht keinen Client (die App liest mit
 * ignoreUnknownKeys). Eingaben und Abfragen sind geschlossen (strictObject):
 * Ein vertippter Feldname ist 400 statt still ignoriert. */
import { z } from 'zod';
import { FEHLER, type FehlerCode } from '../fehlerTexte';

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
}

/** Bestätigte und geheime Antworten wiederholt die Idempotenz nie: Eine
 * Wiederholung mit falschem Passwort bekäme sonst die gespeicherte Antwort. */
export function nichtWiederholbar(route: Route | undefined): boolean {
  return !!(route?.geheim || route?.bestaetigung);
}

export const ganz = z.number().int();
/** Ein Zeitpunkt als ISO-Text. Die Marke trägt nur der TS-Typ: In der Route
 * darf dort noch ein Date stehen, res.json schreibt es als Text (Draht). */
export const zeit = z.string().brand<'Zeit'>();
type Zeit = z.output<typeof zeit>;
/** Ohne die Indexsignatur der offenen Objekte: Sonst passte kein Interface
 * (ihm fehlt sie), und ein vertippter Feldname fiele nicht auf. */
export type Draht<T> = T extends Zeit ? string | Date
  : T extends readonly (infer E)[] ? Draht<E>[]
  : T extends object ? { [K in keyof T as string extends K ? never : K]: Draht<T[K]> } : T;

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

const faktorFelder = { code: z.union([z.string().max(64), z.number()]).nullable().optional(),
  passkey: z.record(z.string(), z.unknown()).nullable().optional() };
type Bestaetigung<P extends string, C extends string> = { [K in P]: z.ZodOptional<z.ZodNullable<z.ZodString>> }
  & { [K in C]: typeof faktorFelder.code } & { passkey: typeof faktorFelder.passkey };
/** Marke und Eingabe aus einer Hand: Der Wächtertest schickt genau diese Felder. */
export function bestaetigt<F extends z.ZodRawShape = Record<never, z.ZodType>, const P extends string = 'password', const C extends string = 'code'>(
  felder: F = {} as F, passwort: P = 'password' as P, code: C = 'code' as C) {
  // null wie fehlend: Die App schickt jedes Feld ihrer Anfrage, auch ein leeres.
  const zusatz = { [passwort]: z.string().max(1024).nullable().optional(), [code]: faktorFelder.code, passkey: faktorFelder.passkey };
  return { bestaetigung: { passwort: passwort as NoInfer<P>, code: code as NoInfer<C> },
    eingabe: z.strictObject({ ...felder, ...(zusatz as Bestaetigung<P, C>) }) };
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
  return z.strictObject(Object.fromEntries(Object.entries(felder).map(([k, s]) => [k, s.optional()])) as
    { [K in keyof T]: z.ZodOptional<T[K]> });
}
/** Bausteine der Abfragen; eine Zahl kommt als Ziffern an und geht als Zahl weiter. */
export const Q = {
  zahl: (max = 1_000_000_000) => z.string().regex(/^\d{1,10}$/).transform(Number).pipe(z.number().int().max(max)),
  /** Ein leerer Wert ist keine Angabe (null), wie ihn ein leeres Auswahlfeld schickt. */
  zahlOderLeer: z.string().regex(/^\d{0,10}$/).transform(v => v === '' ? null : Number(v)),
  text: (max = 200) => z.string().max(max),
  /** '1' oder 'true' ist ja — so schicken es Oberfläche und App. */
  schalter: z.enum(['0', '1', 'true', 'false']).transform(v => v === '1' || v === 'true'),
  /** Welche Konten des Haushalts eine Liste zeigt (src/haushalt: parseScopeMode). */
  konten: z.union([z.enum(['all', 'own', 'subs', '']), z.string().regex(/^\d{1,10}$/)]),
  /** Ein Konto als Besitzer oder Ziel; leer heisst „das eigene“. */
  konto: z.string().regex(/^\d{0,10}$/),
};
/** Formulare und Apps schicken Zahlen auch als Text; geprüft wird im Dienst. */
export const ZAHL = z.union([z.number(), z.string().max(40)]);
export const KENNUNG = z.union([ganz, z.string().regex(/^-?\d{1,12}$/)]);
export const TEXT = (max = 200) => z.string().max(max);
export const ZUSTAND = z.union([z.enum(['N', 'U', 'n', 'u']), z.literal('')]);
export const JA_NEIN = z.union([z.boolean(), z.literal(0), z.literal(1), z.enum(['0', '1', 'true', 'false'])]);
/** Einstellungen als Schlüssel und einfacher Wert; welche gelten, prüft die Route. */
export const EINSTELLUNGEN = z.record(z.string().max(64), EINFACH);

/** Ein Konto in Besitzerlisten. */
export const KontoName = z.looseObject({ id: ganz, username: z.string() });
