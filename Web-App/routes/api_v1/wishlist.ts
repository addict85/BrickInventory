/**
 * /api/v1/wishlist — die Wunschliste.
 *
 * Die Regeln stehen in utils/wunschliste.ts, nicht hier. Diese Datei tut das,
 * was eine Route tun soll: Blickfeld bestimmen, Schreibrecht prüfen, Fehler
 * übersetzen.
 */
import express from 'express';
import { handleRouteError, pfadParam } from '../../utils/httpError';
import { sendeFehler } from '../../utils/fehlerTexte';
import { requireToken } from './middleware';
import { scopeIds, parseScopeMode, resolveWriteTarget } from '../../utils/household';
import { legeWunschAn, loescheWunsch, uebernimm, wuenscheVon } from '../../utils/wunschliste';

const router = express.Router();
type AuthedRequest = express.Request & { apiUser: { user_id: number } };

/**
 * Die Liste des Blickfelds.
 *
 * Marcos Festlegung: Der Kontenbaum gilt wie überall — der Grossvater sieht
 * die Wünsche der Enkel. Hier ist das nicht nur konsequent, sondern der
 * Zweck: Wer ein Geschenk sucht, schaut genau dort nach.
 */
router.get('/wishlist', requireToken, async (req: AuthedRequest, res) => {
  try {
    const ids = await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts));
    res.json({ success: true, wuensche: await wuenscheVon(ids) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

/**
 * Einen Wunsch eintragen — aus dem Katalog-Detail, per Setnummer oder per
 * Barcode. Alle drei Wege landen hier; die Clients unterscheiden sich nur
 * darin, woher die Nummer kommt.
 *
 * owner_user_id wie beim Erfassen eines Sets: Der Grossvater trägt einen
 * Wunsch für den Enkel ein. resolveWriteTarget prüft die RICHTUNG, nicht bloss
 * die Mitgliedschaft im Blickfeld — sonst könnte der Enkel für den Grossvater
 * schreiben.
 */
router.post('/wishlist', requireToken, async (req: AuthedRequest, res) => {
  const { set_number, condition, notiz, owner_user_id } = req.body;
  if (!set_number) return sendeFehler(req, res, 400, 'set_number_erforderlich');
  try {
    const owner = await resolveWriteTarget(req.apiUser.user_id, owner_user_id);
    if (owner === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');
    const { wunsch, war_neu } = await legeWunschAn(owner, set_number, condition, notiz);
    res.json({ success: true, war_neu, wunsch });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

/**
 * Wunsch entfernen.
 *
 * Der Zustand steht im Pfad, weil er zum Schlüssel gehört: Wer sich dasselbe
 * Set neu UND gebraucht wünscht, hat zwei Einträge, und „lösch den Wunsch auf
 * 75192" wäre mehrdeutig.
 */
router.delete('/wishlist/:setNumber/:condition', requireToken, async (req: AuthedRequest, res) => {
  try {
    const owner = await resolveWriteTarget(req.apiUser.user_id, req.query.owner_user_id);
    if (owner === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');
    const weg = await loescheWunsch(owner, pfadParam(req, 'setNumber'), pfadParam(req, 'condition'));
    res.json({ success: true, geloescht: weg });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

/**
 * Den Wunsch in die Galerie übernehmen.
 *
 * Die Regel steht in utils/wunschliste.ts:uebernimm() — sie ruft addSet(),
 * die eine Wahrheit fürs Erfassen, und räumt danach Eintrag und Preisalarm
 * weg (Marcos Festlegung). Hier bleibt nur, wer schreiben darf.
 */
router.post('/wishlist/:setNumber/:condition/uebernehmen', requireToken, async (req: AuthedRequest, res) => {
  try {
    const owner = await resolveWriteTarget(req.apiUser.user_id, req.body?.owner_user_id);
    if (owner === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');
    const r = await uebernimm(req.apiUser.user_id, owner,
      pfadParam(req, 'setNumber'), pfadParam(req, 'condition'), req.body ?? {});
    res.json({ success: true, ...r });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

export default router;
