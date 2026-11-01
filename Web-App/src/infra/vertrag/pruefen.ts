import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { konfig } from '../konfig';
import { routeZu } from './index';
import { GROESSTE_ID, idWert } from '../validate';
import { sendeFehler } from '../fehlerTexte';

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
    if (!fehler.length) return senden(rumpf);
    console.error(`[vertrag] ${schluessel}: ${fehler.join(' | ')}`);
    res.status(500);
    return senden({ success: false, error: `API-Vertrag verletzt: ${schluessel}`, code: 'vertrag_verletzt', abweichungen: fehler });
  };
  next();
}

/** Ein Router, der seine Antworten in Tests gegen den Vertrag prüft — auch
 * dort, wo ein Test ihn ohne routes/api_v1/index.ts einhängt. */
export function vertragsRouter(o: { grosseIds?: boolean } = {}): express.Router {
  const router = express.Router();
  router.use(vertragPruefen);
  // Jede Pfad-ID an einer Stelle: Eine zu grosse lief sonst bis in PostgreSQL
  // und kam als 500 zurück. Aufträge zählen bigint (grosseIds).
  const hoechstens = o.grosseIds ? Number.MAX_SAFE_INTEGER : GROESSTE_ID;
  for (const name of ['id', 'acqId', 'instrId']) {
    router.param(name, (req, res, next, wert) =>
      idWert(wert, hoechstens) === null ? sendeFehler(req, res, 400, 'id_ungueltig') : next());
  }
  return router;
}
