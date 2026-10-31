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

/** Jede Fehlerantwort (src/infra/fehlerTexte.ts). */
export const Fehler = z.looseObject({
  success: z.literal(false),
  error: z.string(),
  code: z.string().optional(),
});

export const Erfolg = z.looseObject({ success: z.literal(true) });

/** Ein Konto in Besitzerlisten. */
export const KontoName = z.looseObject({ id: ganz, username: z.string() });
