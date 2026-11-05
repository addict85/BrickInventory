/** Bausteine des API-Vertrags. Antworten sind offene Objekte (looseObject):
 * Der Vertrag nennt, worauf sich Clients verlassen dürfen; ein zusätzliches
 * Feld bricht keinen von ihnen (die App liest mit ignoreUnknownKeys). */
import { z } from 'zod';

export interface Route {
  /** Der Rumpf einer 2xx-Antwort. Fehlt er, ist die Antwort kein JSON (`art`). */
  antwort?: z.ZodType;
  /** Der JSON-Rumpf der Anfrage, gebaut aus src/infra/validate.ts. */
  eingabe?: z.ZodType;
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

export const Erfolg = z.looseObject({ success: z.literal(true) });

const faktorFelder = { code: z.union([z.string().max(64), z.number()]).nullable().optional(),
  passkey: z.record(z.string(), z.unknown()).nullable().optional() };
/** Marke und Eingabe aus einer Hand: Der Wächtertest schickt genau diese Felder. */
export function bestaetigt(felder: Record<string, z.ZodType> = {}, passwort = 'password', code = 'code') {
  return { bestaetigung: { passwort, code },
    eingabe: z.looseObject({ ...felder, [passwort]: z.string().max(1024).optional(),
      [code]: faktorFelder.code, passkey: faktorFelder.passkey }) };
}

const EINFACH = z.union([z.string(), z.number(), z.boolean(), z.null()]);
/** Für jede schreibende Route ohne eigenes Schema: nur einfache Werte und Listen
 * davon. Ein Objekt statt eines Textes ({"$ne":1}) landete sonst als
 * "[object Object]" in der Tabelle oder an einer Prüfung vorbei. */
export const FLACHE_EINGABE = z.record(z.string(), z.union([EINFACH, z.array(EINFACH)]));

/** Eine Route ohne Rumpf: Ein mitgeschicktes Feld wäre ein Missverständnis. */
export const OHNE_RUMPF = z.strictObject({});
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
