import { fehlerAntwort } from '../../src/infra/httpAntwort';
import { requireToken, sichtVon } from './middleware';
import { getPortfolioHistory } from '../../src/finanzen/portfolioHistory';
import { computeMinifigsValuation, computePartsValuation, computePnl, computeSetsValuation } from '../../src/finanzen/financeCalc';
import { einzelwert } from '../../src/infra/validate';
import { vertragsRouter } from '../../src/infra/vertrag/pruefen';
import type { Anfrage, Antwort } from '../../src/infra/vertrag';
const router = vertragsRouter();

router.get('/finance/valuation', requireToken, async (req: Anfrage<'GET /api/v1/finance/valuation'>, res: Antwort<'GET /api/v1/finance/valuation'>) => {
  const data = await computeSetsValuation(req.apiUser.user_id, sichtVon(req));
  // Kein `rate_limit` in der Antwort: Er kostete drei Abfragen je Aufruf und
  // steht in der Überwachung.
  // Ausführlich: docs/begruendungen/routes/api_v1/finance.ts.md#get-finance-valuation
  res.json({ success:true, total_value: data.totals.qty_avg, ...data });
});

router.get('/finance/parts-valuation', requireToken, async (req: Anfrage<'GET /api/v1/finance/parts-valuation'>, res: Antwort<'GET /api/v1/finance/parts-valuation'>) => {
  const data = await computePartsValuation(req.apiUser.user_id, sichtVon(req));
  res.json({ success: true, ...data });
});

router.get('/finance/minifigs-valuation', requireToken, async (req: Anfrage<'GET /api/v1/finance/minifigs-valuation'>, res: Antwort<'GET /api/v1/finance/minifigs-valuation'>) => {
  const data = await computeMinifigsValuation(req.apiUser.user_id, sichtVon(req));
  res.json({ success: true, ...data });
});

router.get('/finance/pnl', requireToken, async (req: Anfrage<'GET /api/v1/finance/pnl'>, res: Antwort<'GET /api/v1/finance/pnl'>) => {
  const data = await computePnl(req.apiUser.user_id, sichtVon(req));
  res.json({ success: true, ...data });
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
