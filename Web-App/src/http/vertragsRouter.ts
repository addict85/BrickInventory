/** Die HTTP-Seite des API-Vertrags: Router, Eingabe- und Antwortprüfung und
 * die Typen von req/res einer Route. src/vertrag selbst kennt Express nicht. */
import express from 'express';
import type { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { konfig } from '../infra/konfig';
import { routeZu, type Schluessel, type AntwortRumpf, type Eingabe, type Abfrage } from '../vertrag';
import { unbekannteFelder } from '../vertrag/unbekannteFelder';
import { FLACHE_EINGABE, Fehler, PFAD, type PfadVon } from '../vertrag/grund';
import { GROESSTE_ID, idWert } from '../infra/validate';
import { handleRouteError, sendeFehler } from './httpAntwort';

/** Der Typ von `res` in einer Route: tsc meldet, wo die Antwort vom Vertrag abweicht. */
export type Antwort<K extends Schluessel> = Response<AntwortRumpf<K> | z.input<typeof Fehler>>;
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

export function eingabePruefen(req: Request, res: Response, next: NextFunction): void {
  for (const [name, wert] of Object.entries(req.query ?? {}))
    if (typeof wert !== 'string' || wert.length > ABFRAGE_HOECHSTENS) {
      sendeFehler(req, res, 400, 'eingabe_ungueltig', { feld: name.slice(0, 40) });
      return;
    }
  const route = req.route ? routeZu(`${req.method} ${req.baseUrl}${req.route.path}`) : undefined;
  const geprueft = req as unknown as { eingabe: unknown; abfrage: unknown; pfad: Record<string, unknown> };
  geprueft.pfad = Object.create(null) as Record<string, unknown>;
  // Geschrieben wird nur unter Namen aus PFAD, nie unter einem aus der Anfrage.
  if (route)
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
  const fremd = route && Object.keys(req.params ?? {}).find(name => !Object.hasOwn(PFAD, name));
  if (fremd) {
    sendeFehler(req, res, 400, 'eingabe_ungueltig', { feld: fremd.slice(0, 40) });
    return;
  }
  if (route?.abfrage) {
    const q = route.abfrage.safeParse(req.query ?? {});
    if (!q.success) {
      meldeAbweichung(req, res, q.error);
      return;
    }
    geprueft.abfrage = q.data;
  } else geprueft.abfrage = {};
  geprueft.eingabe = {};
  if (!route?.eingabe && (route?.formular || req.method === 'GET')) {
    next();
    return;
  }
  const r = (route?.eingabe ?? FLACHE_EINGABE).safeParse(req.body ?? {});
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
    const schluessel = `${req.method} ${req.baseUrl}${req.route?.path ?? ''}`;
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
type Schritt<R extends Request, S extends Response> = (req: R & Geprueft, res: S, next: NextFunction) => unknown;
/** Was eingabePruefen setzt, passt zu jedem Anfrage<K>: Den Typ nennt der Vertrag der Route. */
type Geprueft = { eingabe: never; abfrage: never; pfad: never };
type Bewacht = <R extends Request, S extends Response>(
  pfad: string,
  w: Waechter<R>,
  ...schritte: Schritt<R, S>[]
) => VertragsRouter;
type Offen = <S extends Response>(pfad: string, ...schritte: Schritt<Request, S>[]) => VertragsRouter;
/** Wie express.Router; steht ein Wächter vorn, bekommen die Schritte dahinter seinen Request-Typ. */
export type VertragsRouter = express.Router & {
  get: Bewacht & Offen;
  post: Bewacht & Offen;
  put: Bewacht & Offen;
  patch: Bewacht & Offen;
  delete: Bewacht & Offen;
};

/** Ein Router, der Eingaben im Betrieb und seine Antworten in Tests gegen den
 * Vertrag prüft — auch dort, wo ein Test ihn ohne routes/api_v1/index.ts einhängt. */
export function vertragsRouter(o: { grosseIds?: boolean } = {}): VertragsRouter {
  // Wie der Vertrag: Eine andere Schreibung ist eine andere Route (404), nicht dieselbe ohne Eintrag.
  const router = express.Router({ caseSensitive: true });
  const pruefung = vertragPruefen();
  if (pruefung) router.use(pruefung);
  // Als letzter Schritt vor der Route, nach Anmeldung und Drossel: Deren
  // Antworten (401, 429) bleiben, wie sie sind.
  for (const m of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    const anmelden = router[m].bind(router) as (pfad: unknown, ...schritte: unknown[]) => express.Router;
    Object.assign(router, {
      [m]: (pfad: unknown, ...schritte: unknown[]) =>
        anmelden(pfad, ...schritte.slice(0, -1), eingabePruefen, ...schritte.slice(-1)),
    });
  }
  // Jede Pfad-ID an einer Stelle: Eine zu grosse lief sonst bis in PostgreSQL
  // und kam als 500 zurück. Aufträge zählen bigint (grosseIds).
  const hoechstens = o.grosseIds ? Number.MAX_SAFE_INTEGER : GROESSTE_ID;
  for (const name of ['id', 'acqId', 'instrId']) {
    router.param(name, (req, res, next, wert) =>
      idWert(wert, hoechstens) === null ? sendeFehler(req, res, 400, 'id_ungueltig') : next(),
    );
  }
  return router as VertragsRouter;
}
