import express from 'express';
import { fehlerAntwort } from '../../src/infra/httpError';
import { requireToken } from './middleware';
import { getPortfolioHistory } from '../../src/finanzen/portfolioHistory';
import { scopeIds, parseScopeMode } from '../../src/haushalt/haushalt';
import { computeMinifigsValuation, computePartsValuation, computePnl, computeSetsValuation } from '../../src/finanzen/financeCalc';
import { einzelwert } from '../../src/infra/validate';
const router = express.Router();

router.get('/finance/valuation', requireToken, async (req: AuthedRequest, res) => {
  const data = await computeSetsValuation(req.apiUser.user_id, await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)));
  // Kein `rate_limit` in der Antwort: Er kostete drei Abfragen je Aufruf und
  // steht in der Überwachung.
  // Ausführlich: docs/begruendungen/routes/api_v1/finance.ts.md#get-finance-valuation
  res.json({ success:true, total_value: data.totals.qty_avg, ...data });
});

router.get('/finance/parts-valuation', requireToken, async (req: AuthedRequest, res) => {
  const data = await computePartsValuation(req.apiUser.user_id, await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)));
  res.json({ success: true, ...data });
});

router.get('/finance/minifigs-valuation', requireToken, async (req: AuthedRequest, res) => {
  const data = await computeMinifigsValuation(req.apiUser.user_id, await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)));
  res.json({ success: true, ...data });
});

router.get('/finance/pnl', requireToken, async (req: AuthedRequest, res) => {
  const data = await computePnl(req.apiUser.user_id, await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)));
  res.json({ success: true, ...data });
});

router.get('/finance/portfolio-history', requireToken, async (req: AuthedRequest, res) => {
  const uid    = req.apiUser.user_id;
  // einzelwert(): ?period=a&period=b kommt als Array an und ginge sonst
  // unverändert in die Antwort zurück.
  const period = einzelwert(req.query.period, 'week');
  const result = await getPortfolioHistory(uid, await scopeIds(uid, parseScopeMode(req.query.accounts)), period);
  res.json(result);
});


router.use(fehlerAntwort);

export default router;
