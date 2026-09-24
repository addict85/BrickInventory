/**
 * /api/v1/wanted — die Merkliste.
 *
 * Die Regeln stehen in utils/merkliste.ts, nicht hier. Diese Datei tut das,
 * was eine Route tun soll: Blickfeld bestimmen, Schreibrecht prüfen, Fehler
 * übersetzen.
 */
import express from 'express';
import { handleRouteError, pfadParam } from '../../utils/httpError';
import { sendeFehler } from '../../utils/fehlerTexte';
import { requireToken } from './middleware';
import { scopeIds, parseScopeMode, resolveWriteTarget } from '../../utils/household';
import { legeMerkpostenAn, loescheMerkposten, verschiebeMerkposten, uebernimm, merkpostenVon } from '../../utils/merkliste';
import { getSetting } from '../../utils/settings';
import { fetchPrice } from '../../utils/financeCalc';

const router = express.Router();
type AuthedRequest = express.Request & { apiUser: { user_id: number } };

/**
 * Die Liste des Blickfelds.
 *
 * Marcos Festlegung: Der Kontenbaum gilt wie überall — der Grossvater sieht
 * die Merkposten der Enkel. Hier ist das nicht nur konsequent, sondern der
 * Zweck: Wer ein Geschenk sucht, schaut genau dort nach.
 */
router.get('/wanted', requireToken, async (req: AuthedRequest, res) => {
  try {
    const ids = await scopeIds(req.apiUser.user_id, parseScopeMode(req.query.accounts));
    // Die Waehrung des LESERS: Der Marktpreis in der Liste steht in der
    // Waehrung, in der er alles andere sieht. price_cache ist je Waehrung
    // verschluesselt, deshalb gehoert sie in die Abfrage und nicht daneben.
    const waehrung = await getSetting(req.apiUser.user_id, 'currency', 'EUR');
    res.json({ success: true, merkposten: await merkpostenVon(ids, undefined, waehrung) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

/**
 * Einen Merkposten eintragen — aus dem Katalog-Detail, per Setnummer oder per
 * Barcode. Alle drei Wege landen hier; die Clients unterscheiden sich nur
 * darin, woher die Nummer kommt.
 *
 * owner_user_id wie beim Erfassen eines Sets: Der Grossvater trägt einen
 * Merkposten für den Enkel ein. resolveWriteTarget prüft die RICHTUNG, nicht bloss
 * die Mitgliedschaft im Blickfeld — sonst könnte der Enkel für den Grossvater
 * schreiben.
 */
router.post('/wanted', requireToken, async (req: AuthedRequest, res) => {
  const { set_number, condition, owner_user_id } = req.body;
  if (!set_number) return sendeFehler(req, res, 400, 'set_number_erforderlich');
  try {
    const owner = await resolveWriteTarget(req.apiUser.user_id, owner_user_id);
    if (owner === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');
    const { merkposten, war_neu } = await legeMerkpostenAn(owner, set_number, condition);
    res.json({ success: true, war_neu, merkposten });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

/**
 * Den Inhaber eines Merkpostens aendern.
 *
 * Marcos Befund: „Auf dem Detail-Dialog der Merkliste kann der Inhaber
 * nicht geaendert werden." Stimmt — waehlbar war er nur beim Erfassen.
 *
 * ── Warum ZWEI Kontenpruefungen ────────────────────────────────────────────
 *
 * Verschieben heisst hier: aus einem Konto heraus UND in ein anderes hinein.
 * Beide Richtungen muessen erlaubt sein, sonst schoebe ein Enkel den Merkposten
 * des Grossvaters zu sich — oder seinen eigenen dorthin, wo er nichts zu
 * schreiben hat. resolveWriteTarget() prueft genau diese Richtung.
 *
 * Die Regel selbst steht in utils/merkliste.ts (verschiebeMerkposten): Das
 * Aufnahmedatum bleibt, der Preisalarm zieht mit, und ein Merkposten, den das
 * Zielkonto schon hat, wird zusammengefuehrt statt verdoppelt.
 */
router.put('/wanted/:setNumber/:condition/inhaber', requireToken, async (req: AuthedRequest, res) => {
  try {
    const von = await resolveWriteTarget(req.apiUser.user_id, req.body?.owner_user_id);
    const zu  = await resolveWriteTarget(req.apiUser.user_id, req.body?.neuer_inhaber);
    if (von === null || zu === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');
    const r = await verschiebeMerkposten(von, pfadParam(req, 'setNumber'),
                                     pfadParam(req, 'condition'), zu);
    res.json({ success: true, ...r, owner_user_id: zu });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

/**
 * Merkposten entfernen.
 *
 * Der Zustand steht im Pfad, weil er zum Schlüssel gehört: Wer sich dasselbe
 * Set neu UND gebraucht wünscht, hat zwei Einträge, und „lösch den Merkposten auf
 * 75192" wäre mehrdeutig.
 */
router.delete('/wanted/:setNumber/:condition', requireToken, async (req: AuthedRequest, res) => {
  try {
    const owner = await resolveWriteTarget(req.apiUser.user_id, req.query.owner_user_id);
    if (owner === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');
    const weg = await loescheMerkposten(owner, pfadParam(req, 'setNumber'), pfadParam(req, 'condition'));
    res.json({ success: true, geloescht: weg });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

/**
 * Die Marktpreise eines Merkpostens — BEIDE Zustände, frisch geholt.
 *
 * ── Warum es diese Route gibt ──────────────────────────────────────────────
 *
 * Marcos Frage: „Wieso werden die Preise nicht sofort angezeigt?"
 *
 * Weil bisher niemand sie holte. /sets/:sn/price-history LIEST nur den Cache,
 * und in den schrieb bis zu dieser Änderung allein der Preislauf — der kannte
 * `sets` und `price_alerts`, aber nicht die Merkliste. Ein Merkposten ohne
 * Preisalarm hatte deshalb NIE einen Preis.
 *
 * /sets/:sn/price wäre der fertige Weg gewesen, antwortet aber mit 404, wenn
 * einem das Set nicht gehört — für einen Merkposten also ausgeschlossen.
 *
 * ── Warum beide Zustände ───────────────────────────────────────────────────
 *
 * Weil das Set-Detail sie ebenfalls beide zeigt: Wer auf ein gebrauchtes
 * wartet, will trotzdem wissen, was ein neues kostet. Die Antwort trägt
 * deshalb dieselbe Form wie `current` in /price-history — die Oberflächen
 * zeichnen sie mit derselben Funktion.
 *
 * ── Was sie NICHT tut ──────────────────────────────────────────────────────
 *
 * Sie fragt nicht bei jedem Öffnen bei BrickLink an: fetchPrice() bedient
 * sich am Cache, solange dessen Alter unter price_cache_ttl liegt. Der erste
 * Aufruf für ein Set kostet zwei Abrufe, die folgenden keinen.
 */
router.get('/wanted/:setNumber/preise', requireToken, async (req: AuthedRequest, res) => {
  const sn = pfadParam(req, 'setNumber');
  try {
    const uid = req.apiUser.user_id;
    const currency  = await getSetting(uid, 'currency', 'EUR');
    const guideType = await getSetting(uid, 'price_guide_type', 'sold');
    const ttlHours  = await getSetting(uid, 'price_cache_ttl', '24');
    const current: Record<string, unknown> = {};
    for (const c of ['N', 'U']) {
      // Einzeln gefangen: Fuer ein Set, das BrickLink nicht kennt, soll der
      // ANDERE Zustand trotzdem ankommen — und ein fehlender Preis ist kein
      // Fehler, sondern ein Strich in der Anzeige.
      try {
        const pd = await fetchPrice(sn, c, guideType, currency, ttlHours);
        current[c] = { condition: c, avg_price: pd.avg_price,
                       min_price: pd.min_price, max_price: pd.max_price };
      } catch { /* kein Preis fuer diesen Zustand */ }
    }
    res.json({ success: true, set_number: sn, currency, current });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

/**
 * Den Merkposten in die Galerie übernehmen.
 *
 * Die Regel steht in utils/merkliste.ts:uebernimm() — sie ruft addSet(),
 * die eine Wahrheit fürs Erfassen, und räumt danach Eintrag und Preisalarm
 * weg (Marcos Festlegung). Hier bleibt nur, wer schreiben darf.
 */
router.post('/wanted/:setNumber/:condition/uebernehmen', requireToken, async (req: AuthedRequest, res) => {
  try {
    const owner = await resolveWriteTarget(req.apiUser.user_id, req.body?.owner_user_id);
    if (owner === null) return sendeFehler(req, res, 403, 'kein_schreibrecht');
    const r = await uebernimm(req.apiUser.user_id, owner,
      pfadParam(req, 'setNumber'), pfadParam(req, 'condition'), req.body ?? {});
    res.json({ success: true, ...r });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

export default router;
