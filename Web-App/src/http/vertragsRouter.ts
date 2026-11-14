/** Die HTTP-Seite des API-Vertrags: Router, Eingabe- und Antwortprüfung und
 * die Typen von req/res einer Route. src/vertrag selbst kennt Express nicht. */
import express from 'express';
import type { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { konfig } from '../infra/konfig';
import { routeZu, type Schluessel, type AntwortRumpf, type Eingabe, type Abfrage } from '../vertrag';
import { unbekannteFelder } from '../vertrag/unbekannteFelder';
import { FLACHE_EINGABE, Fehler, PFAD, type PfadVon, type Route } from '../vertrag/grund';
import { GROESSTE_ID, idWert } from '../infra/validate';
import { handleRouteError, sendeFehler } from './httpAntwort';

/** Der Typ von `res` in einer Route: tsc meldet, wo die Antwort vom Vertrag abweicht. */
export type Antwort<K extends Schluessel> = [AntwortRumpf<K>] extends [never]
  ? Response
  : Response<AntwortRumpf<K> | z.input<typeof Fehler>>;
/** Der Typ von `req` in einer Route: `eingabe`, `abfrage` und `pfad` so, wie der Vertrag sie geprüft hat. */
export type Anfrage<K extends Schluessel, R extends Request = AuthedRequest> = R & {
  eingabe: Eingabe<K>;
  abfrage: Abfrage<K>;
  pfad: PfadVon<K>;
};
/** Dasselbe ohne requireToken. */
export type OffeneAnfrage<K extends Schluessel> = Anfrage<K, Request>;

/** Ein Abfragewert ist ein Text: Wiederholt (?a=1&a=2) wird er zur Liste, und
 * `.trim()` oder eine Regex darauf verwechselte den Typ. */
const ABFRAGE_HOECHSTENS = 4000;

/** Im Betrieb, unmittelbar vor der Route: Abfrage und Rumpf gegen den Vertrag.
 * Die Route bekommt das Ergebnis (req.abfrage, req.eingabe), nicht den rohen
 * Rumpf: Was das Schema umwandelt oder abweist, sieht sie nie anders. */
const KENNUNGEN = new Set(['id', 'acqId', 'instrId']);

function eingabePruefen(route: Route, req: Request, res: Response, next: NextFunction): void {
  for (const [name, wert] of Object.entries(req.query ?? {}))
    if (typeof wert !== 'string' || wert.length > ABFRAGE_HOECHSTENS) {
      sendeFehler(req, res, 400, 'eingabe_ungueltig', { feld: name.slice(0, 40) });
      return;
    }
  const geprueft = req as unknown as { eingabe: unknown; abfrage: unknown; pfad: Record<string, unknown> };
  geprueft.pfad = Object.create(null) as Record<string, unknown>;
  // Geschrieben wird nur unter Namen aus PFAD, nie unter einem aus der Anfrage.
  for (const [name, schema] of Object.entries(PFAD as Record<string, z.ZodType>)) {
    if (!Object.hasOwn(req.params ?? {}, name)) continue;
    const r = schema.safeParse(req.params[name]);
    if (!r.success) {
      if (KENNUNGEN.has(name)) sendeFehler(req, res, 400, 'id_ungueltig');
      else sendeFehler(req, res, 400, 'eingabe_ungueltig', { feld: name });
      return;
    }
    geprueft.pfad[name] = r.data;
  }
  const fremd = Object.keys(req.params ?? {}).find(name => !Object.hasOwn(PFAD, name));
  if (fremd) {
    sendeFehler(req, res, 400, 'eingabe_ungueltig', { feld: fremd.slice(0, 40) });
    return;
  }
  if (route.abfrage) {
    const q = route.abfrage.safeParse(req.query ?? {});
    if (!q.success) {
      meldeAbweichung(req, res, q.error);
      return;
    }
    geprueft.abfrage = q.data;
  } else geprueft.abfrage = {};
  geprueft.eingabe = {};
  if (!route.eingabe && (route.formular || req.method === 'GET')) {
    next();
    return;
  }
  const r = (route.eingabe ?? FLACHE_EINGABE).safeParse(req.body ?? {});
  if (!r.success) {
    meldeAbweichung(req, res, r.error);
    return;
  }
  geprueft.eingabe = r.data;
  next();
}

/** Die Prüfer aus validate.ts melden ihren eigenen Fehler, ein unbekanntes Feld seinen Code. */
function meldeAbweichung(req: Request, res: Response, fehler: z.ZodError): void {
  const erste = fehler.issues[0];
  const eigener = (erste as { params?: { fehler?: unknown } } | undefined)?.params?.fehler;
  if (eigener) {
    handleRouteError(res, eigener, 400, req);
    return;
  }
  if (erste?.code === 'unrecognized_keys') {
    sendeFehler(req, res, 400, 'feld_unbekannt', {
      feld: [...(erste.path ?? []), erste.keys[0] ?? ''].join('.').slice(0, 40),
    });
    return;
  }
  sendeFehler(req, res, 400, 'eingabe_ungueltig', { feld: (erste?.path ?? []).join('.').slice(0, 40) || '$' });
}

/** Nur in Tests (VERTRAG_PRUEFEN=1, gesetzt von test/helpers/sources.js):
 * Jede 2xx-Antwort einer Route mit Vertrag läuft durch ihr Schema, und eine
 * Abweichung wird zur 500, die der Test sieht. In Produktion kostete das je
 * Antwort einen Durchlauf über ganze Listen, ohne dass ein Nutzer etwas davon
 * hätte: Gehalten wird der Vertrag beim Übersetzen (tsc) und in den Tests. */
function antwortGegenVertrag(req: Request, res: Response, next: NextFunction): void {
  if (res.locals.vertragGeprueft) {
    next();
    return;
  }
  res.locals.vertragGeprueft = true;
  const senden = res.json.bind(res);
  res.json = (rumpf: unknown) => {
    const schluessel = String(res.locals.vertragsSchluessel ?? `${req.method} ${req.baseUrl}${req.route?.path ?? ''}`);
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
      abweichungen: fehler,
    });
  };
  next();
}

/** Beim Bau des Routers entschieden, nicht je Anfrage: Im Betrieb hängt
 * die Prüfung gar nicht erst in der Kette. */
export function vertragPruefen(): ((req: Request, res: Response, next: NextFunction) => void) | null {
  return konfig().vertragPruefen ? antwortGegenVertrag : null;
}

/** Middleware, die dem Rest der Kette einen engeren Request zusichert (z. B.
 * AuthedRequest hinter requireToken). Die Marke `sichert` hat nur, was mit
 * waechter() gebaut ist: Eine beliebige Funktion an erster Stelle sichert nichts zu. */
export type Waechter<R extends Request> = ((req: Request, res: Response, next: NextFunction) => void) & {
  readonly sichert: (r: R) => R;
};
export function waechter<R extends Request>(f: (req: Request, res: Response, next: NextFunction) => void): Waechter<R> {
  return Object.assign(f, { sichert: (r: R) => r });
}

type Methode = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
/** Die Schlüssel, deren Pfad unter dem Präfix des Routers liegt: Ein anderer kompiliert nicht. */
export type SchluesselUnter<P extends string> = Schluessel extends infer K
  ? K extends `${Methode} ${P}/${string}` | `${Methode} ${P}`
    ? K
    : never
  : never;
/** Was eine Route zurückgibt, setzt der Router in die Hülle `{ success: true, … }`. Nur
 * Routen, deren Vertrag `success` nennt, haben eine; die übrigen antworten selbst. */
export type Ergebnis<K extends Schluessel> =
  AntwortRumpf<K> extends infer R
    ? [keyof R] extends [never]
      ? [R] extends [never]
        ? never
        : Record<string, unknown>
      : 'success' extends keyof R
        ? Omit<R, 'success'>
        : never
    : never;
// biome-ignore lint/suspicious/noConfusingVoidType: Eine Route antwortet auch selbst (`return sendeFehler(…)`), und das ist void.
type Rueckgabe<K extends Schluessel> = Ergebnis<K> | Response | undefined | void;
export type Handler<K extends Schluessel, R extends Request> = (
  req: Anfrage<K, R>,
  res: Antwort<K>,
) => Rueckgabe<K> | Promise<Rueckgabe<K>>;
type Zwischenschritt = (req: Request, res: Response, next: NextFunction) => unknown;

interface Vertragswege<P extends string> {
  readonly praefix: P;
  /** Registriert die Route des Vertragsschlüssels: Methode, Pfad und Typen kommen aus ihm.
   * Steht ein Wächter vorn, bekommt die Route seinen Request-Typ. */
  endpunkt<K extends SchluesselUnter<P>, R extends Request>(
    schluessel: K,
    w: Waechter<R>,
    ...schritte: [...Zwischenschritt[], Handler<K, R>]
  ): VertragsRouter<P>;
  endpunkt<K extends SchluesselUnter<P>>(
    schluessel: K,
    ...schritte: [...Zwischenschritt[], Handler<K, Request>]
  ): VertragsRouter<P>;
  /** Hängt einen Router mit gleichem oder längerem Präfix ein. */
  haengeEin<Q extends `${P}${string}`>(kind: VertragsRouter<Q>): VertragsRouter<P>;
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
export class FalschEingehaengt extends Error {
  constructor(praefix: string, basis: string) {
    super(`Vertragsrouter für ${praefix} ist unter ${basis || '/'} eingehängt`);
  }
}

/** Ein Router, der Eingaben im Betrieb und seine Antworten in Tests gegen den Vertrag
 * prüft — auch dort, wo ein Test ihn ohne routes/api_v1/index.ts einhängt. */
export function vertragsRouter<P extends string>(praefix: P, o: { grosseIds?: boolean } = {}): VertragsRouter<P> {
  // Wie der Vertrag: Eine andere Schreibung ist eine andere Route (404), nicht dieselbe ohne Eintrag.
  const router = express.Router({ caseSensitive: true });
  const pruefung = vertragPruefen();
  if (pruefung) router.use(pruefung);
  // Jede Pfad-ID an einer Stelle: Eine zu grosse lief sonst bis in PostgreSQL
  // und kam als 500 zurück. Aufträge zählen bigint (grosseIds).
  const hoechstens = o.grosseIds ? Number.MAX_SAFE_INTEGER : GROESSTE_ID;
  for (const name of ['id', 'acqId', 'instrId']) {
    router.param(name, (req, res, next, wert) =>
      idWert(wert, hoechstens) === null ? sendeFehler(req, res, 400, 'id_ungueltig') : next(),
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
      // Die Prüfung als letzter Schritt vor der Route, nach Anmeldung und Drossel:
      // Deren Antworten (401, 429) bleiben, wie sie sind.
      anmelden(methode, pfad.slice(praefix.length) || '/', [
        ...schritte,
        (req: Request, res: Response, next: NextFunction) => {
          if (req.baseUrl.toLowerCase() !== praefix.toLowerCase()) throw new FalschEingehaengt(praefix, req.baseUrl);
          res.locals.vertragsSchluessel = schluessel;
          eingabePruefen(route, req, res, next);
        },
        async (req: Request, res: Response) => {
          const r = await handler(req, res);
          if (r === undefined || r === res || res.headersSent) return;
          res.json({ success: true, ...(r as object) });
        },
      ]);
      return router;
    },
    haengeEin(kind: VertragsRouter<string>) {
      if (!kind.praefix.startsWith(praefix)) throw new FalschEingehaengt(kind.praefix, praefix);
      const rest = kind.praefix.slice(praefix.length);
      if (rest) router.use(rest, kind);
      else router.use(kind);
      return router;
    },
  }) as unknown as VertragsRouter<P>;
}
