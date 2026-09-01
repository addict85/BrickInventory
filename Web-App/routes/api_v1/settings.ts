/**
 * /api/v1/settings — Benutzereinstellungen.
 *
 * effective_condition wird serverseitig aufgelöst (User-Override → globaler
 * Default → 'N'); die Android-App übernimmt diesen Wert als Vorauswahl für
 * neue Einträge.
 */
import express from 'express';
import * as db from '../../db/database';
import { handleRouteError } from '../../utils/httpError';
import { requireToken } from './middleware';
import { householdStatus, createInvite, redeemInvite, unlink } from '../../utils/household';
import { setUserSetting, effectiveCondition, globalDefaultCondition } from '../../utils/settings';
const router = express.Router();

router.get('/settings', requireToken, async (req: AuthedRequest, res) => {
  const uid = req.apiUser.user_id;
  const rows = await db.all('SELECT key, value FROM user_settings WHERE user_id = $1', [uid]);
  const settings: Record<string,string> = { currency:'EUR', price_condition:'N', price_cache_ttl:'24', default_price_condition:'N', user_default_condition:'' };
  rows.forEach(r => { settings[r.key] = r.value; });
  // Effektiver Zustand: eigener Wert → globaler Standard → 'N'. Die Regel
  // steht in utils/settings.ts, damit sie nicht neben dem Webapp-Weg ein
  // zweites Mal existiert (Etappe 6).
  settings['effective_condition'] = await effectiveCondition(uid);
  // Globales App-Design (vom Admin gesetzt) — die App wendet es an
  const themeRow = await db.get("SELECT value FROM global_settings WHERE key='app_theme'").catch(()=>null);
  settings['app_theme'] = themeRow?.value || 'classic';
  res.json({ success:true, settings });
});

router.put('/settings', requireToken, async (req: AuthedRequest, res) => {
  const uid = req.apiUser.user_id;
  const allowed = ['currency','price_cache_ttl'];
  let updated = 0;
  for (const key of allowed) {
    if (req.body[key]!==undefined) {
      // Zentrale Stelle — stösst bei einer ECHTEN Währungsänderung den
      // Preis-Job an (Begründung in utils/settings.ts). Parität zur Webapp.
      await setUserSetting(uid, key, String(req.body[key]));
      updated++;
    }
  }
  res.json({ success:true, updated });
});

// GET /api/v1/settings/default-condition — der GLOBALE Default (Monitoring-UI).
// Für den effektiven, benutzerspezifischen Wert: GET /settings (effective_condition).
router.get('/settings/default-condition', requireToken, async (_req: AuthedRequest, res) => {
  try {
    res.json({ success: true, condition: await globalDefaultCondition() });
  } catch (e) { handleRouteError(res, e); }
});

/**
 * GET /api/v1/settings/user/default-condition — der EFFEKTIVE Wert des
 * Nutzers, zum Vorbelegen der Erfassungsformulare.
 *
 * Etappe 6: Vorher gab es diesen Wert nur auf zwei ganz verschiedenen Wegen —
 * die Webapp über eine eigene Route mit eigener Abfrage, die App als Feld in
 * GET /settings. Die Route hier bedient jetzt beide; das Feld in /settings
 * bleibt, weil die App es in derselben Antwort mitliest.
 */
router.get('/settings/user/default-condition', requireToken, async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, condition: await effectiveCondition(req.apiUser.user_id) });
  } catch (e) { handleRouteError(res, e); }
});

// POST /api/v1/settings/user/default-condition — benutzerspezifischer Default.
// Token-authentifiziertes Pendant zu /api/settings/user/default-condition:
// die Android-App lief vorher gegen den Session-Endpoint und scheiterte mit
// Bearer-Token still an requireLogin.
router.post('/settings/user/default-condition', requireToken, async (req: AuthedRequest, res) => {
  const condition = String(req.body?.condition ?? '');
  if (!['N','U',''].includes(condition)) return res.status(400).json({ success: false, error: 'N oder U erwartet' });
  try {
    if (condition === '') {
      // Leeren → auf globalen Standard zurückfallen
      await db.run("DELETE FROM user_settings WHERE user_id=$1 AND key='user_default_condition'", [req.apiUser.user_id]);
    } else {
      // setUserSetting() statt eigenem INSERT: Es soll GENAU EINE Schreibstelle
      // für Benutzereinstellungen geben (Nachtrag 43). Hier stand ein zweites,
      // wortgleiches ON CONFLICT — harmlos, solange nichts dazukommt, aber die
      // Regel gilt nur, wenn sie ausnahmslos gilt.
      await setUserSetting(req.apiUser.user_id, 'user_default_condition', condition);
    }
    res.json({ success: true, condition: condition || null });
  } catch (e) { handleRouteError(res, e); }
});

// ── Haushalt: Konten verknüpfen ──────────────────────────────────────────────
// Gegenstücke zu /api/settings/household*. Dieselbe Umsetzung
// (utils/household.ts), damit die App nicht ihre eigenen Regeln bekommt.
router.get('/settings/household', requireToken, async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, ...(await householdStatus(req.apiUser.user_id)) });
  } catch (e) { handleRouteError(res, e); }
});

router.post('/settings/household/invite', requireToken, async (req: AuthedRequest, res) => {
  try {
    const r = await createInvite(req.apiUser.user_id);
    if ((r as any).error) return res.status(409).json({ success: false, error: (r as any).error });
    res.json({ success: true, ...r });
  } catch (e) { handleRouteError(res, e); }
});

router.post('/settings/household/redeem', requireToken, async (req: AuthedRequest, res) => {
  try {
    const r = await redeemInvite(req.apiUser.user_id, String(req.body?.code || ''));
    if ((r as any).error) return res.status(409).json({ success: false, error: (r as any).error });
    res.json({ success: true, ...r });
  } catch (e) { handleRouteError(res, e); }
});

router.post('/settings/household/unlink', requireToken, async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, ...(await unlink(req.apiUser.user_id, req.body?.sub_user_id)) });
  } catch (e) { handleRouteError(res, e); }
});

export default router;
