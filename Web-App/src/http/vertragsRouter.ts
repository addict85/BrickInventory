/** Die HTTP-Seite des API-Vertrags: Router, Prüfung, Typen von req/res; src/contract kennt Express nicht. */
import express from 'express';
import type { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { konfig } from '../infra/konfig';
import { routeZu, type Schluessel, type ResponseBody, type Eingabe, type Abfrage } from '../contract';
import { unbekannteFelder } from '../contract/unknownFields';
import { FLAT_INPUT, Fehler, PATH, type PathOf, type Route } from '../contract/base';
import { LARGEST_ID, idWert } from '../infra/validate';
import { handleRouteError, sendError } from './httpAntwort';

/** Der Typ von `res` in einer Route: tsc meldet, wo die Antwort vom Vertrag abweicht. */
export type Antwort<K extends Schluessel> = [ResponseBody<K>] extends [never]
  ? Response
  : Response<ResponseBody<K> | z.input<typeof Fehler>>;
/** Der Typ von `req` in einer Route: `eingabe`, `abfrage` und `pfad` so, wie der Vertrag sie geprüft hat. */
export type Anfrage<K extends Schluessel, R extends Request = AuthedRequest> = R & {
  eingabe: Eingabe<K>;
  abfrage: Abfrage<K>;
  pfad: PathOf<K>;
};
/** Dasselbe ohne requireToken. */
export type OpenRequest<K extends Schluessel> = Anfrage<K, Request>;

/** Ein Abfragewert ist ein Text: Wiederholt (?a=1&a=2) wird er zur Liste, und
 * `.trim()` oder eine Regex darauf verwechselte den Typ. */
const QUERY_AT_MOST = 4000;

/** Unmittelbar vor der Route: Sie bekommt Abfrage und Rumpf so, wie das Schema sie umwandelt
 * (req.abfrage, req.eingabe), nie roh. */
const IDS = new Set(['id', 'acqId', 'instrId']);

function validateInput(route: Route, req: Request, res: Response, next: NextFunction): void {
  for (const [name, wert] of Object.entries(req.query ?? {}))
    if (typeof wert !== 'string' || wert.length > QUERY_AT_MOST) {
      sendError(req, res, 'ungueltig', 'eingabe_ungueltig', { feld: name.slice(0, 40) });
      return;
    }
  const geprueft = req as unknown as { eingabe: unknown; abfrage: unknown; pfad: Record<string, unknown> };
  geprueft.pfad = Object.create(null) as Record<string, unknown>;
  // Geschrieben wird nur unter Namen aus PATH, nie unter einem aus der Anfrage.
  for (const [name, schema] of Object.entries(PATH as Record<string, z.ZodType>)) {
    if (!Object.hasOwn(req.params ?? {}, name)) continue;
    const r = schema.safeParse(req.params[name]);
    if (!r.success) {
      if (IDS.has(name)) sendError(req, res, 'ungueltig', 'id_ungueltig');
      else sendError(req, res, 'ungueltig', 'eingabe_ungueltig', { feld: name });
      return;
    }
    geprueft.pfad[name] = r.data;
  }
  const fremd = Object.keys(req.params ?? {}).find(name => !Object.hasOwn(PATH, name));
  if (fremd) {
    sendError(req, res, 'ungueltig', 'eingabe_ungueltig', { feld: fremd.slice(0, 40) });
    return;
  }
  if (route.abfrage) {
    const q = route.abfrage.safeParse(req.query ?? {});
    if (!q.success) {
      reportDeviation(req, res, q.error);
      return;
    }
    geprueft.abfrage = q.data;
  } else geprueft.abfrage = {};
  geprueft.eingabe = {};
  if (!route.eingabe && (route.formular || req.method === 'GET')) {
    next();
    return;
  }
  const r = (route.eingabe ?? FLAT_INPUT).safeParse(req.body ?? {});
  if (!r.success) {
    reportDeviation(req, res, r.error);
    return;
  }
  geprueft.eingabe = r.data;
  next();
}

/** Die Prüfer aus validate.ts melden ihren eigenen Fehler, ein unbekanntes Feld seinen Code. */
function reportDeviation(req: Request, res: Response, fehler: z.ZodError): void {
  const erste = fehler.issues[0];
  const eigener = (erste as { params?: { fehler?: unknown } } | undefined)?.params?.fehler;
  if (eigener) {
    handleRouteError(res, eigener, 400, req);
    return;
  }
  if (erste?.code === 'unrecognized_keys') {
    sendError(req, res, 'ungueltig', 'feld_unbekannt', {
      feld: [...(erste.path ?? []), erste.keys[0] ?? ''].join('.').slice(0, 40),
    });
    return;
  }
  sendError(req, res, 'ungueltig', 'eingabe_ungueltig', { feld: (erste?.path ?? []).join('.').slice(0, 40) || '$' });
}

/** Nur in Tests (VERTRAG_PRUEFEN=1): Eine 2xx-Antwort ausserhalb ihres Schemas wird zur 500. Im
 * Betrieb kostete das je Antwort einen Durchlauf über ganze Listen; dort hält tsc den Vertrag. */
function responseAgainstContract(req: Request, res: Response, next: NextFunction): void {
  if (res.locals.contractChecked) {
    next();
    return;
  }
  res.locals.contractChecked = true;
  const senden = res.json.bind(res);
  res.json = (rumpf: unknown) => {
    const schluessel = String(res.locals.contractKey ?? `${req.method} ${req.baseUrl}${req.route?.path ?? ''}`);
    const route = res.statusCode < 300 && req.route ? routeZu(schluessel) : undefined;
    const fehler: string[] = [];
    const pruefe = (teil: string, schema: import('zod').ZodType | undefined, wert: unknown) => {
      const r = schema?.safeParse(wert);
      if (r && !r.success)
        fehler.push(...r.error.issues.slice(0, 8).map(i => `${teil} ${i.path.join('.') || '$'}: ${i.message}`));
    };
    if (route) {
      // Geprüft wird, was hinausgeht: Ein Date wird erst in res.json zum ISO-Text.
      const gesendet = JSON.parse(JSON.stringify(rumpf ?? null));
      pruefe('Antwort', route.antwort, gesendet);
      // Streng nur hier: Ein Feld ausserhalb des Vertrags fehlte in OpenAPI und den Typen der Oberfläche.
      const fremd = !fehler.length && route.antwort ? unbekannteFelder(route.antwort, gesendet) : [];
      if (fremd.length) fehler.push(`Antwort: nicht im Vertrag: ${fremd.join(', ')}`);
      if (!route.formular) pruefe('Anfrage', route.eingabe, req.body ?? {});
    }
    // Auch der Fehlerweg hat eine Form; ohne Prüfung fiel eine 404 ohne Code nicht auf.
    if (res.statusCode >= 400) pruefe('Fehlerantwort', Fehler, JSON.parse(JSON.stringify(rumpf ?? null)));
    if (!fehler.length) return senden(rumpf);
    console.error(`[vertrag] ${schluessel}: ${fehler.join(' | ')}`);
    res.status(500);
    return senden({
      success: false,
      error: `API-Vertrag verletzt: ${schluessel}`,
      code: 'vertrag_verletzt',
      deviations: fehler,
    });
  };
  next();
}

/** Beim Bau des Routers entschieden, nicht je Anfrage: Im Betrieb hängt
 * die Prüfung gar nicht erst in der Kette. */
export function checkContract(): ((req: Request, res: Response, next: NextFunction) => void) | null {
  return konfig().checkContract ? responseAgainstContract : null;
}

/** Middleware, die dem Rest der Kette einen engeren Request zusichert (AuthedRequest hinter requireToken);
 * die Marke `sichert` hat nur, was waechter() baut, keine beliebige Funktion an erster Stelle. */
export type Waechter<R extends Request> = ((req: Request, res: Response, next: NextFunction) => void) & {
  readonly sichert: (r: R) => R;
};
export function guard<R extends Request>(f: (req: Request, res: Response, next: NextFunction) => void): Waechter<R> {
  return Object.assign(f, { sichert: (r: R) => r });
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
/** Die Schlüssel, deren Pfad unter dem Präfix des Routers liegt: Ein anderer kompiliert nicht. */
export type KeyBelow<P extends string> = Schluessel extends infer K
  ? K extends `${Method} ${P}/${string}` | `${Method} ${P}`
    ? K
    : never
  : never;
/** Was eine Route zurückgibt, setzt der Router in die Hülle `{ success: true, … }`. Nur
 * Routen, deren Vertrag `success` nennt, haben eine; die übrigen antworten selbst. */
export type Ergebnis<K extends Schluessel> =
  ResponseBody<K> extends infer R
    ? [keyof R] extends [never]
      ? [R] extends [never]
        ? never
        : Record<string, unknown>
      : 'success' extends keyof R
        ? Omit<R, 'success'>
        : never
    : never;
// biome-ignore lint/suspicious/noConfusingVoidType: Eine Route antwortet auch selbst (`return sendError(…)`), und das ist void.
type ReturnValue<K extends Schluessel> = Ergebnis<K> | Response | undefined | void;
/** Ein Ereignis eines Stroms in derselben Hülle wie die Antwort der Abfrage (Vertrag: `ereignis`). */
export const inShell = <T extends object>(daten: T) => ({ success: true as const, ...daten });

export type Handler<K extends Schluessel, R extends Request> = (
  req: Anfrage<K, R>,
  res: Antwort<K>,
) => ReturnValue<K> | Promise<ReturnValue<K>>;
type IntermediateStep = (req: Request, res: Response, next: NextFunction) => unknown;

interface Vertragswege<P extends string> {
  readonly praefix: P;
  /** Registriert die Route des Vertragsschlüssels: Methode, Pfad und Typen kommen aus ihm.
   * Steht ein Wächter vorn, bekommt die Route seinen Request-Typ. */
  endpunkt<K extends KeyBelow<P>, R extends Request>(
    schluessel: K,
    w: Waechter<R>,
    ...schritte: [...IntermediateStep[], Handler<K, R>]
  ): VertragsRouter<P>;
  endpunkt<K extends KeyBelow<P>>(
    schluessel: K,
    ...schritte: [...IntermediateStep[], Handler<K, Request>]
  ): VertragsRouter<P>;
  /** Hängt einen Router mit gleichem oder längerem Präfix ein. */
  attachOne<Q extends `${P}${string}`>(kind: VertragsRouter<Q>): VertragsRouter<P>;
}
/** Wie express.Router, aber Routen nur über `endpunkt`: Ein Pfad ohne Vertragsschlüssel kompiliert nicht. */
export type VertragsRouter<P extends string> = Omit<
  express.Router,
  'get' | 'post' | 'put' | 'patch' | 'delete' | 'route'
> &
  express.RequestHandler &
  Vertragswege<P>;

/** Ein Router unter einem anderen Präfix als dem seiner Schlüssel: Seine Routen wären
 * unter einem Pfad erreichbar, den der Vertrag nicht kennt. */
export class WrongMounted extends Error {
  constructor(praefix: string, basis: string) {
    super(`Vertragsrouter für ${praefix} ist unter ${basis || '/'} eingehängt`);
  }
}

/** Prüft Eingaben im Betrieb und Antworten in Tests, auch ohne routes/api_v1/index.ts eingehängt. */
export function vertragsRouter<P extends string>(praefix: P, o: { largeIds?: boolean } = {}): VertragsRouter<P> {
  // Wie der Vertrag: Eine andere Schreibung ist eine andere Route (404), nicht dieselbe ohne Eintrag.
  const router = express.Router({ caseSensitive: true });
  const check = checkContract();
  if (check) router.use(check);
  // Eine zu grosse Pfad-ID käme sonst als 500 aus PostgreSQL; Aufträge zählen bigint (largeIds).
  const hoechstens = o.largeIds ? Number.MAX_SAFE_INTEGER : LARGEST_ID;
  for (const name of ['id', 'acqId', 'instrId']) {
    router.param(name, (req, res, next, wert) =>
      idWert(wert, hoechstens) === null ? sendError(req, res, 'ungueltig', 'id_ungueltig') : next(),
    );
  }
  const anmelden = (methode: string, pfad: string, schritte: unknown[]) =>
    (router as unknown as Record<string, (p: string, ...s: unknown[]) => unknown>)[methode.toLowerCase()]?.(
      pfad,
      ...schritte,
    );
  return Object.assign(router, {
    praefix,
    endpunkt(schluessel: string, ...schritte: unknown[]) {
      const route = routeZu(schluessel);
      const [methode = '', pfad = ''] = schluessel.split(' ');
      if (!route || !(pfad === praefix || pfad.startsWith(`${praefix}/`)))
        throw new Error(`${schluessel} steht nicht im Vertrag unter ${praefix}`);
      const handler = schritte.pop() as (req: Request, res: Response) => unknown;
      // Als letzter Schritt vor der Route: Antworten von Anmeldung und Drossel (401, 429) bleiben.
      anmelden(methode, pfad.slice(praefix.length) || '/', [
        ...schritte,
        (req: Request, res: Response, next: NextFunction) => {
          if (req.baseUrl.toLowerCase() !== praefix.toLowerCase()) throw new WrongMounted(praefix, req.baseUrl);
          res.locals.contractKey = schluessel;
          // Hat der Schrittschutz am Eingang (res.locals.schritt gesetzt) diese Route einer anderen
          // Marke zugeordnet als Express, gilt seine Freigabe nicht: zu statt offen.
          if (route.schritt && res.locals.schritt !== undefined && res.locals.schritt !== route.schritt)
            return sendError(req, res, 'verboten', 'schritt_freigabe_noetig');
          validateInput(route, req, res, next);
        },
        async (req: Request, res: Response) => {
          const r = await handler(req, res);
          if (r === undefined || r === res || res.headersSent) return;
          res.json({ success: true, ...(r as object) });
        },
      ]);
      return router;
    },
    attachOne(kind: VertragsRouter<string>) {
      if (!kind.praefix.startsWith(praefix)) throw new WrongMounted(kind.praefix, praefix);
      const rest = kind.praefix.slice(praefix.length);
      if (rest) router.use(rest, kind);
      else router.use(kind);
      return router;
    },
  }) as unknown as VertragsRouter<P>;
}
