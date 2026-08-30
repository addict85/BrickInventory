/** /api/v1/finance — Bewertungen, PnL, Portfolio-Historie (Logik in ../finance). */
import express from 'express';
import * as db from '../../db/database';
import { handleRouteError } from '../../utils/httpError';
import { requireToken } from './middleware';
import { getPortfolioHistory } from '../../utils/portfolioHistory';
import { getSetting } from '../../utils/settings';
import { scopeIds, parseScopeMode } from '../../utils/household';
import { computeMinifigsValuation, computePartsValuation, computePnl, computeSetsValuation, getRateLimitStatus } from '../../utils/financeCalc';
import { einzelwert } from '../../utils/validate';
const router = express.Router();

// ── FINANCE ───────────────────────────────────────────────────────────────────
router.get('/finance/valuation', requireToken, async (req: AuthedRequest, res) => {
  try {
    const data = await computeSetsValuation(req.apiUser.user_id, await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)));
    // rate_limit wie in /api/finance/valuation (Parität) — die Webapp zeigt
    // damit den API-Verbrauch an; Android kann das Feld ebenfalls nutzen.
    const rlStatus = await getRateLimitStatus('bricklink');
    res.json({ success:true, total_value: data.totals.qty_avg, rate_limit: rlStatus, ...data });
  } catch (e) { handleRouteError(res, e); }
});

// ── Same computation as the webapp (routes/finance.js) — implemented once ────
router.get('/finance/parts-valuation', requireToken, async (req: AuthedRequest, res) => {
  try {
    const data = await computePartsValuation(req.apiUser.user_id, await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)));
    res.json({ success: true, ...data });
  } catch (e) { handleRouteError(res, e); }
});

router.get('/finance/minifigs-valuation', requireToken, async (req: AuthedRequest, res) => {
  try {
    const data = await computeMinifigsValuation(req.apiUser.user_id, await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)));
    res.json({ success: true, ...data });
  } catch (e) { handleRouteError(res, e); }
});

router.get('/finance/pnl', requireToken, async (req: AuthedRequest, res) => {
  try {
    const data = await computePnl(req.apiUser.user_id, await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)));
    res.json({ success: true, ...data });
  } catch (e) { handleRouteError(res, e); }
});

// ── PORTFOLIO HISTORY — uses shared util (identical to webapp) ───────────────
router.get('/finance/portfolio-history', requireToken, async (req: AuthedRequest, res) => {
  const uid    = req.apiUser.user_id;
  // einzelwert(): Ein Abfrageparameter kann als ARRAY ankommen
  // (?period=week&period=year) — Express macht daraus ['week','year'].
  // Ein Array faellt hier zwar auf den Standardzweig (verglichen wird mit ===
  // gegen drei Literale, nichts landet in SQL), wuerde aber unveraendert in der
  // Antwort zurueckgegeben. Derselbe Helfer wie im Anmeldezaehler.
  const period = einzelwert(req.query.period, 'week');
  try {
    const result = await getPortfolioHistory(uid, await scopeIds(uid, parseScopeMode(req.query.accounts)), period, db, getSetting);
    res.json(result);
  } catch (e) { handleRouteError(res, e); }
});


export default router;
