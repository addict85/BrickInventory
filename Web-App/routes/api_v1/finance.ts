import { fehlerAntwort } from '../../src/http/httpAntwort';
import { FEHLER, antwortSprache, fehlerText, type FehlerCode } from '../../src/infra/fehlerTexte';
import { requireToken, sichtVon } from './middleware';
import { einzelwert } from '../../src/infra/validate';
import { seiteAus } from '../../src/infra/seite';
import { vertragsRouter, type Anfrage, type Antwort } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../startup/verdrahtung';

/** Preisfehler kommen mit Code aus der Bewertung; der Text folgt der Sprache der Anfrage, nicht dem Server. */
function uebersetzt<T extends { error?: unknown; error_code?: unknown }>(
  zeilen: T[],
  req: Parameters<typeof antwortSprache>[0],
): T[] {
  const sprache = antwortSprache(req);
  return zeilen.map(z =>
    typeof z.error_code === 'string' && z.error_code in FEHLER
      ? { ...z, error: fehlerText(z.error_code as FehlerCode, sprache) }
      : z,
  );
}

export function baueFinanceRouter(d: Dienste) {
  const router = vertragsRouter();

  router.get(
    '/finance/valuation',
    requireToken,
    async (req: Anfrage<'GET /api/v1/finance/valuation'>, res: Antwort<'GET /api/v1/finance/valuation'>) => {
      const data = await d.finanzen.computeSetsValuation(req.apiUser.user_id, sichtVon(req));
      // Kein `rate_limit` in der Antwort: Er kostete drei Abfragen je Aufruf und
      // steht in der Überwachung.
      const { eintraege: sets, ...seite } = seiteAus(uebersetzt(data.sets, req), req.abfrage);
      res.json({
        success: true,
        total_value: data.totals.qty_avg,
        wert_gesamt: Number(data.totals.qty_avg),
        ...data,
        sets,
        ...seite,
      });
    },
  );

  router.get(
    '/finance/parts-valuation',
    requireToken,
    async (
      req: Anfrage<'GET /api/v1/finance/parts-valuation'>,
      res: Antwort<'GET /api/v1/finance/parts-valuation'>,
    ) => {
      const data = await d.finanzen.computePartsValuation(req.apiUser.user_id, sichtVon(req));
      const { eintraege: parts, ...seite } = seiteAus(uebersetzt(data.parts, req), req.abfrage);
      res.json({ success: true, ...data, parts, ...seite });
    },
  );

  router.get(
    '/finance/minifigs-valuation',
    requireToken,
    async (
      req: Anfrage<'GET /api/v1/finance/minifigs-valuation'>,
      res: Antwort<'GET /api/v1/finance/minifigs-valuation'>,
    ) => {
      const data = await d.finanzen.computeMinifigsValuation(req.apiUser.user_id, sichtVon(req));
      const { eintraege: figs, ...seite } = seiteAus(uebersetzt(data.figs, req), req.abfrage);
      res.json({ success: true, ...data, figs, ...seite });
    },
  );

  router.get(
    '/finance/pnl',
    requireToken,
    async (req: Anfrage<'GET /api/v1/finance/pnl'>, res: Antwort<'GET /api/v1/finance/pnl'>) => {
      const data = await d.finanzen.computePnl(req.apiUser.user_id, sichtVon(req));
      const { eintraege: sets, ...seite } = seiteAus(data.sets, req.abfrage);
      res.json({ success: true, ...data, sets, ...seite });
    },
  );

  router.get(
    '/finance/portfolio-history',
    requireToken,
    async (
      req: Anfrage<'GET /api/v1/finance/portfolio-history'>,
      res: Antwort<'GET /api/v1/finance/portfolio-history'>,
    ) => {
      const uid = req.apiUser.user_id;
      // einzelwert(): ?period=a&period=b kommt als Array an und ginge sonst
      // unverändert in die Antwort zurück.
      const period = einzelwert(req.abfrage.period, 'week');
      res.json({ success: true, ...(await d.finanzen.getPortfolioHistory(uid, sichtVon(req), period)) });
    },
  );

  router.use(fehlerAntwort);
  return router;
}
