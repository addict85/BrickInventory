import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { konfig } from '../konfig';
import { routeZu } from './index';
import { FLACHE_EINGABE, Fehler } from './grund';
import { GROESSTE_ID, idWert } from '../validate';
import { sendeFehler } from '../fehlerTexte';
import { handleRouteError } from '../httpAntwort';

/** Ein Abfragewert ist ein Text: Wiederholt (?a=1&a=2) wird er zur Liste, und
 * `.trim()` oder eine Regex darauf verwechselte den Typ. */
const ABFRAGE_HOECHSTENS = 4000;

/** Im Betrieb, unmittelbar vor der Route: Abfrage und Rumpf gegen den Vertrag.
 * Ohne das kam z. B. username:["abc"] an USERNAME_RE vorbei (test() macht
 * daraus "abc") bis ins SQL. Die Prüfer aus validate.ts melden ihren eigenen
 * Fehler, damit die Antwort dieselbe bleibt wie aus der Route. */
export function eingabePruefen(req: Request, res: Response, next: NextFunction): void {
  for (const [name, wert] of Object.entries(req.query ?? {}))
    if (typeof wert !== 'string' || wert.length > ABFRAGE_HOECHSTENS)
      return sendeFehler(req, res, 400, 'eingabe_ungueltig', { feld: name.slice(0, 40) });
  const route = req.route ? routeZu(`${req.method} ${req.baseUrl}${req.route.path}`) : undefined;
  if (route?.formular || (!route?.eingabe && req.method === 'GET')) return next();
  const r = (route?.eingabe ?? FLACHE_EINGABE).safeParse(req.body ?? {});
  if (r.success) return next();
  const erste = r.error.issues[0];
  const eigener = (erste as { params?: { fehler?: unknown } } | undefined)?.params?.fehler;
  if (eigener) return handleRouteError(res, eigener, 400, req);
  sendeFehler(req, res, 400, 'eingabe_ungueltig', { feld: (erste?.path ?? []).join('.').slice(0, 40) || '$' });
}

/** Nur in Tests (VERTRAG_PRUEFEN=1, gesetzt von test/helpers/sources.js):
 * Jede 2xx-Antwort einer Route mit Vertrag läuft durch ihr Schema, und eine
 * Abweichung wird zur 500, die der Test sieht. In Produktion kostete das je
 * Antwort einen Durchlauf über ganze Listen, ohne dass ein Nutzer etwas davon
 * hätte: Gehalten wird der Vertrag beim Übersetzen (tsc) und in den Tests. */
export function vertragPruefen(req: Request, res: Response, next: NextFunction): void {
  if (res.locals.vertragGeprueft || !konfig().vertragPruefen) return next();
  res.locals.vertragGeprueft = true;
  const senden = res.json.bind(res);
  res.json = (rumpf: unknown) => {
    const schluessel = `${req.method} ${req.baseUrl}${req.route?.path ?? ''}`;
    const route = res.statusCode < 300 && req.route ? routeZu(schluessel) : undefined;
    const fehler: string[] = [];
    const pruefe = (teil: string, schema: import('zod').ZodType | undefined, wert: unknown) => {
      const r = schema?.safeParse(wert);
      if (r && !r.success) fehler.push(...r.error.issues.slice(0, 8)
        .map(i => `${teil} ${i.path.join('.') || '$'}: ${i.message}`));
    };
    if (route) {
      // Geprüft wird, was hinausgeht: Ein Date wird erst in res.json zum ISO-Text.
      pruefe('Antwort', route.antwort, JSON.parse(JSON.stringify(rumpf ?? null)));
      if (!route.formular) pruefe('Anfrage', route.eingabe, req.body);
    }
    // Auch der Fehlerweg hat eine Form; ohne Prüfung fiel eine 404 ohne Code nicht auf.
    if (res.statusCode >= 400) pruefe('Fehlerantwort', Fehler, JSON.parse(JSON.stringify(rumpf ?? null)));
    if (!fehler.length) return senden(rumpf);
    console.error(`[vertrag] ${schluessel}: ${fehler.join(' | ')}`);
    res.status(500);
    return senden({ success: false, error: `API-Vertrag verletzt: ${schluessel}`, code: 'vertrag_verletzt', abweichungen: fehler });
  };
  next();
}

/** Ein Router, der Eingaben im Betrieb und seine Antworten in Tests gegen den
 * Vertrag prüft — auch dort, wo ein Test ihn ohne routes/api_v1/index.ts einhängt. */
export function vertragsRouter(o: { grosseIds?: boolean } = {}): express.Router {
  // Wie der Vertrag: Eine andere Schreibung ist eine andere Route (404), nicht dieselbe ohne Eintrag.
  const router = express.Router({ caseSensitive: true });
  router.use(vertragPruefen);
  // Als letzter Schritt vor der Route, nach Anmeldung und Drossel: Deren
  // Antworten (401, 429) bleiben, wie sie sind.
  for (const m of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    const anmelden = router[m].bind(router) as (pfad: unknown, ...schritte: unknown[]) => express.Router;
    Object.assign(router, { [m]: (pfad: unknown, ...schritte: unknown[]) =>
      anmelden(pfad, ...schritte.slice(0, -1), eingabePruefen, ...schritte.slice(-1)) });
  }
  // Jede Pfad-ID an einer Stelle: Eine zu grosse lief sonst bis in PostgreSQL
  // und kam als 500 zurück. Aufträge zählen bigint (grosseIds).
  const hoechstens = o.grosseIds ? Number.MAX_SAFE_INTEGER : GROESSTE_ID;
  for (const name of ['id', 'acqId', 'instrId']) {
    router.param(name, (req, res, next, wert) =>
      idWert(wert, hoechstens) === null ? sendeFehler(req, res, 400, 'id_ungueltig') : next());
  }
  return router;
}
