// The response of api(method, path) according to the contract (contract.d.ts). The path
// is matched as in Express: placeholders as ${string}, the query after
// "?" does not count. If several routes match, the most specific applies; if none matches
// (path assembled at runtime), the response is unchecked (any).
import type { Route, Strom } from '../frontend-types/contract';

type OhneAbfrage<P extends string> = P extends `${infer B}?${string}` ? B : P;
type Genau<M, P, R = Route> = R extends { m: M; p: infer Q } ? (P extends Q ? R : never) : never;
// `${pfad}${scopeQuery()}`: the query is appended at the end as ${string}.
type MitAnhang<M, P, R = Route> = R extends { m: M; p: infer Q extends string }
  ? P extends `${Q}${string}`
    ? R
    : never
  : never;
// With a suffix, specificity is compared on `${Q}${string}`: `/v1/stats…`
// is more specific than `/v1/…`, although `/v1/stats` does not match `/v1/`.
type Muster<Q, Anhang> = Anhang extends true ? `${Q & string}${string}` : Q;
type Genaueste<R, Anhang, Alle = R> = R extends { p: infer Q }
  ? [
      Alle extends { p: infer Q2 }
        ? Muster<Q2, Anhang> extends Muster<Q, Anhang>
          ? Muster<Q, Anhang> extends Muster<Q2, Anhang>
            ? never
            : Alle
          : never
        : never,
    ] extends [never]
    ? R
    : never
  : never;
type Treffer<M, P extends string> = [Genau<M, OhneAbfrage<P>>] extends [never]
  ? Genaueste<MitAnhang<M, P>, true>
  : Genaueste<Genau<M, OhneAbfrage<P>>, false>;

/** What api() delivers on every failure: network, status without JSON, error from the server. */
export type ApiFehler = {
  success: false;
  error: string;
  status: number;
  code?: string;
  networkError?: boolean;
  // Depending on the error the server attaches fields (passkey, unverified, details).
  [feld: string]: unknown;
};

/** The named fields of a type, without index signature. */
type Benannt<T> = keyof { [K in keyof T as string extends K ? never : number extends K ? never : K]: 0 };

/** A route's response on success, with the HTTP status that api() attaches. */
export type ApiErfolg<M extends string, P extends string> = Treffer<M, P>['a'] & {
  status: number;
  ausZwischenspeicher?: boolean;
  error?: string | null;
};

/** In the error case the fields of the success response are missing: `d.sets` is then
 * undefined, not unknown — readable without checking `success`, but with
 * strictNullChecks only with a fallback. */
type FehlerZu<A> = ApiFehler & { [K in Exclude<Benannt<A>, Benannt<ApiFehler>>]?: undefined };

export type ApiAntwort<M extends string, P extends string> = [Treffer<M, P>] extends [never]
  ? // biome-ignore lint/suspicious/noExplicitAny: paths outside the contract (assembled) stay unchecked; unknown would require a check at every call site without gain.
    any
  : ApiErfolg<M, P> | FehlerZu<Treffer<M, P>['a']>;

/** apiData(): the response unchanged on success, otherwise null. */
export type ApiDaten<M extends string, P extends string> = [Treffer<M, P>] extends [never]
  ? // biome-ignore lint/suspicious/noExplicitAny: as with ApiAntwort — a path outside the contract has no response type.
    any
  : Treffer<M, P>['a'] | null;

/** strom(): an event according to the contract; a path outside stays unknown. */
type StromTreffer<P extends string, S = Strom> = S extends { p: infer Q; e: infer E }
  ? OhneAbfrage<P> extends Q
    ? E
    : never
  : never;
export type StromEreignis<P extends string> = [StromTreffer<P>] extends [never] ? unknown : StromTreffer<P>;
