/** /api/v1/finance — Bewertungen, PnL, Portfolio-Historie (Logik in ../finance). */
import express from 'express';
import * as db from '../../db/database';
import { handleRouteError } from '../../utils/httpError';
import { requireToken } from './middleware';
import { getPortfolioHistory } from '../../utils/portfolioHistory';
import { getSetting } from '../../utils/settings';
import { scopeIds, parseScopeMode } from '../../utils/household';
import { computeMinifigsValuation, computePartsValuation, computePnl, computeSetsValuation } from '../../utils/financeCalc';
import { einzelwert } from '../../utils/validate';
const router = express.Router();

// ── FINANCE ───────────────────────────────────────────────────────────────────
router.get('/finance/valuation', requireToken, async (req: AuthedRequest, res) => {
  try {
    const data = await computeSetsValuation(req.apiUser.user_id, await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)));
    // ── Kein `rate_limit` mehr in dieser Antwort ────────────────────────────
    //
    // Hier stand `rate_limit: await getRateLimitStatus('bricklink')`, mit der
    // Begründung „wie in /api/finance/valuation (Parität) — die Webapp zeigt
    // damit den API-Verbrauch an". Beides stimmte nicht: routes/finance.ts hat
    // das Feld gar nicht, und was Einstellungsseite und Android anzeigen, ist
    // `rate_limits` (Plural) aus /v1/admin/cache-stats. Den Singular las kein
    // einziger Verbraucher — nachgemessen über beide Clients in diesem Ablagen.
    //
    // Gekostet hat er drei Datenbankabfragen JE AUFRUF (gemessen, nicht
    // geschätzt: getRateLimitStatus holt Zähler, Datum und Grenze einzeln) —
    // bei jedem Öffnen des Finanzreiters und nach jedem Erfassen, weil
    // loadValuation() daran hängt.
    res.json({ success:true, total_value: data.totals.qty_avg, ...data });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── Same computation as the webapp (routes/finance.js) — implemented once ────
router.get('/finance/parts-valuation', requireToken, async (req: AuthedRequest, res) => {
  try {
    const data = await computePartsValuation(req.apiUser.user_id, await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)));
    res.json({ success: true, ...data });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.get('/finance/minifigs-valuation', requireToken, async (req: AuthedRequest, res) => {
  try {
    const data = await computeMinifigsValuation(req.apiUser.user_id, await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)));
    res.json({ success: true, ...data });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.get('/finance/pnl', requireToken, async (req: AuthedRequest, res) => {
  try {
    const data = await computePnl(req.apiUser.user_id, await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts)));
    res.json({ success: true, ...data });
  } catch (e) { handleRouteError(res, e, undefined, req); }
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
  } catch (e) { handleRouteError(res, e, undefined, req); }
});


export default router;
