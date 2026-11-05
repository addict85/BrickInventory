import { fehlerAntwort } from '../../src/infra/httpAntwort';
import { requireToken, sichtVon } from './middleware';
import { getPortfolioHistory } from '../../src/finanzen/portfolioHistory';
import { computeMinifigsValuation, computePartsValuation, computePnl, computeSetsValuation } from '../../src/finanzen/financeCalc';
import { einzelwert } from '../../src/infra/validate';
import { vertragsRouter } from '../../src/infra/vertrag/pruefen';
import { seiteAus } from '../../src/infra/seite';
import type { Anfrage, Antwort } from '../../src/infra/vertrag';
const router = vertragsRouter();

router.get('/finance/valuation', requireToken, async (req: Anfrage<'GET /api/v1/finance/valuation'>, res: Antwort<'GET /api/v1/finance/valuation'>) => {
  const data = await computeSetsValuation(req.apiUser.user_id, sichtVon(req));
  // Kein `rate_limit` in der Antwort: Er kostete drei Abfragen je Aufruf und
  // steht in der Überwachung.
  // Ausführlich: docs/begruendungen/routes/api_v1/finance.ts.md#get-finance-valuation
  const { eintraege: sets, ...seite } = seiteAus(data.sets, req.abfrage);
  res.json({ success: true, total_value: data.totals.qty_avg, wert_gesamt: Number(data.totals.qty_avg), ...data, sets, ...seite });
});

router.get('/finance/parts-valuation', requireToken, async (req: Anfrage<'GET /api/v1/finance/parts-valuation'>, res: Antwort<'GET /api/v1/finance/parts-valuation'>) => {
  const data = await computePartsValuation(req.apiUser.user_id, sichtVon(req));
  const { eintraege: parts, ...seite } = seiteAus(data.parts, req.abfrage);
  res.json({ success: true, ...data, parts, ...seite });
});

router.get('/finance/minifigs-valuation', requireToken, async (req: Anfrage<'GET /api/v1/finance/minifigs-valuation'>, res: Antwort<'GET /api/v1/finance/minifigs-valuation'>) => {
  const data = await computeMinifigsValuation(req.apiUser.user_id, sichtVon(req));
  const { eintraege: figs, ...seite } = seiteAus(data.figs, req.abfrage);
  res.json({ success: true, ...data, figs, ...seite });
});

router.get('/finance/pnl', requireToken, async (req: Anfrage<'GET /api/v1/finance/pnl'>, res: Antwort<'GET /api/v1/finance/pnl'>) => {
  const data = await computePnl(req.apiUser.user_id, sichtVon(req));
  const { eintraege: sets, ...seite } = seiteAus(data.sets, req.abfrage);
  res.json({ success: true, ...data, sets, ...seite });
});

router.get('/finance/portfolio-history', requireToken, async (req: Anfrage<'GET /api/v1/finance/portfolio-history'>, res: Antwort<'GET /api/v1/finance/portfolio-history'>) => {
  const uid    = req.apiUser.user_id;
  // einzelwert(): ?period=a&period=b kommt als Array an und ginge sonst
  // unverändert in die Antwort zurück.
  const period = einzelwert(req.abfrage.period, 'week');
  const result = await getPortfolioHistory(uid, sichtVon(req), period);
  res.json(result);
});


router.use(fehlerAntwort);

export default router;
