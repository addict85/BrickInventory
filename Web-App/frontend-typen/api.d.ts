// Die Antwort von api(method, path) nach dem Vertrag (vertrag.d.ts). Der Pfad
// wird wie bei Express zugeordnet: Platzhalter als ${string}, die Abfrage nach
// „?“ zählt nicht. Passen mehrere Routen, gilt die genaueste; passt keine
// (Pfad zur Laufzeit zusammengesetzt), ist die Antwort ungeprüft (any).
import type { Route } from './vertrag';

type OhneAbfrage<P extends string> = P extends `${infer B}?${string}` ? B : P;
type Genau<M, P, R = Route> = R extends { m: M; p: infer Q } ? (P extends Q ? R : never) : never;
// `${pfad}${scopeQuery()}`: die Abfrage hängt als ${string} hinten an.
type MitAnhang<M, P, R = Route> = R extends { m: M; p: infer Q extends string } ? (P extends `${Q}${string}` ? R : never) : never;
// Mit Anhang vergleicht sich die Genauigkeit an `${Q}${string}`: `/v1/stats…`
// ist genauer als `/v1/…`, obwohl `/v1/stats` nicht auf `/v1/` passt.
type Muster<Q, Anhang> = Anhang extends true ? `${Q & string}${string}` : Q;
type Genaueste<R, Anhang, Alle = R> = R extends { p: infer Q }
  ? ([Alle extends { p: infer Q2 }
      ? (Muster<Q2, Anhang> extends Muster<Q, Anhang> ? (Muster<Q, Anhang> extends Muster<Q2, Anhang> ? never : Alle) : never)
      : never] extends [never] ? R : never)
  : never;
type Treffer<M, P extends string> = [Genau<M, OhneAbfrage<P>>] extends [never]
  ? Genaueste<MitAnhang<M, P>, true>
  : Genaueste<Genau<M, OhneAbfrage<P>>, false>;

/** Was api() bei jedem Fehlschlag liefert: Netz, Status ohne JSON, Fehler vom Server. */
export type ApiFehler = {
  success: false;
  error: string;
  status: number;
  code?: string;
  networkError?: boolean;
  // Der Server hängt je nach Fehler Felder an (passkey, unverified, details).
  [feld: string]: unknown;
};

/** Die benannten Felder eines Typs, ohne Indexsignatur. */
type Benannt<T> = keyof { [K in keyof T as string extends K ? never : number extends K ? never : K]: 0 };

/** Antwort einer Route bei Erfolg, mit dem HTTP-Status, den api() anhängt. */
export type ApiErfolg<M extends string, P extends string> = Treffer<M, P>['a'] & { status: number; ausZwischenspeicher?: boolean; error?: string | null };

/** Im Fehlerfall fehlen die Felder der Erfolgsantwort: `d.sets` ist dann
 * undefined, nicht unbekannt — ohne Prüfung auf `success` lesbar, mit
 * strictNullChecks aber nur mit Rückfall. */
type FehlerZu<A> = ApiFehler & { [K in Exclude<Benannt<A>, Benannt<ApiFehler>>]?: undefined };

export type ApiAntwort<M extends string, P extends string> = [Treffer<M, P>] extends [never]
  ? any
  : ApiErfolg<M, P> | FehlerZu<Treffer<M, P>['a']>;

/** apiDaten(): die Antwort unverändert bei Erfolg, sonst null. */
export type ApiDaten<M extends string, P extends string> = [Treffer<M, P>] extends [never] ? any : Treffer<M, P>['a'] | null;
