/** Lagerorte und Preisalarme der Sets; eigene Pfade, deshalb ohne Rücksicht auf die Reihenfolge in sets.ts. */
import { fehlerAntwort, sendeFehler } from '../../src/http/httpAntwort';
import { kontoSchranke, sichtVon, waechterFuer } from './middleware';
import { csvEmpfang } from '../../src/http/dateiEmpfang';
import { zustand } from '../../src/infra/validate';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';

export function baueSetsLagerRouter(d: Pick<Dienste, 'konto' | 'finanzen' | 'bestand' | 'sets'>) {
  const { requireToken } = waechterFuer(d.konto);
  const router = vertragsRouter('/api/v1');

  router.endpunkt('PUT /api/v1/sets/:setNumber/storage', requireToken, async req => {
    const { ort, n } = await d.sets.lagerortDesSetsSetzen(req.apiUser.user_id, req.pfad.setNumber, req.eingabe.storage);
    return { storage: ort, changed: n };
  });

  /** Ein Alarm gehört genau EINEM Konto: Wer eine Schwelle setzt, will selbst
   * benachrichtigt werden. Deshalb `user_id` statt blickfeldIds() — hier die Regel. */
  router.endpunkt('GET /api/v1/sets/:setNumber/alert', requireToken, async req => {
    return { alerts: await d.sets.setAlarmeLesen(req.apiUser.user_id, req.pfad.setNumber) };
  });

  router.endpunkt('PUT /api/v1/sets/:setNumber/alert', requireToken, async req => {
    const alarm = await d.sets.alarmDesSetsSetzen(req.apiUser.user_id, req.pfad.setNumber, req.eingabe || {});
    return { alert: alarm };
  });

  router.endpunkt('DELETE /api/v1/sets/:setNumber/alert', requireToken, async req => {
    const n = await d.sets.alarmDesSetsLoeschen(
      req.apiUser.user_id,
      req.pfad.setNumber,
      req.abfrage.condition ? zustand(req.abfrage.condition) : undefined,
    );
    return { removed: n };
  });

  // Abholen statt Schieben; ohne Kontofilter, ein Alarm gehört einem Konto.
  router.endpunkt('GET /api/v1/alerts/pending', requireToken, async req => {
    const r = await d.finanzen.preisalarm.ausgeloesteSeit(req.apiUser.user_id, req.abfrage.since);
    return { alerts: r.alerts, now: r.now };
  });

  // Was gesetzt ist; ausgelöst: /alerts/pending.
  router.endpunkt('GET /api/v1/alerts', requireToken, async req => {
    return { alerts: await d.finanzen.preisalarm.alleAlarme(req.apiUser.user_id) };
  });

  router.endpunkt(
    'POST /api/v1/alerts/import/csv',
    requireToken,
    kontoSchranke('upload'),
    csvEmpfang.single('file'),
    async (req, res) => {
      if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
      return { ...(await d.sets.alarmCsvImportStarten(req.apiUser.user_id, req.file.buffer.toString('utf-8'))) };
    },
  );

  router.endpunkt('GET /api/v1/storage/locations', requireToken, async req => {
    return { ...(await d.sets.lagerorteMitVorgabe(req.apiUser.user_id, req.abfrage.owner)) };
  });

  /** `{ id: null }` schaltet die Vorgabe ab — ein Endpunkt, weil es eine
   * Einstellung mit genau einem Wert ist. */
  router.endpunkt('PUT /api/v1/storage/default', requireToken, async req => {
    // Fehlt das Feld, meint der Client dasselbe wie null.
    const roh = req.eingabe.id;
    const id = roh === null || roh === undefined ? null : Number(roh);
    return { vorgabe: await d.bestand.setzeVorgabe(req.apiUser.user_id, id) };
  });

  router.endpunkt('POST /api/v1/storage/locations', requireToken, async (req, res) => {
    const konto = await d.bestand.lagerSchreibkonto(req.apiUser.user_id, req.abfrage.owner ?? req.eingabe.owner);
    const { ort, war_neu } = await d.bestand.lagerortDienst.legeOrtAn(konto, req.eingabe.name);
    if (!war_neu) return sendeFehler(req, res, 409, 'lagerort_doppelt');
    return { ort };
  });

  router.endpunkt('PUT /api/v1/storage/locations/:id', requireToken, async req => {
    const konto = await d.bestand.lagerSchreibkonto(req.apiUser.user_id, req.abfrage.owner ?? req.eingabe.owner);
    return { ort: await d.bestand.lagerortDienst.benenneOrtUm(konto, req.pfad.id, req.eingabe.name) };
  });

  router.endpunkt('DELETE /api/v1/storage/locations/:id', requireToken, async req => {
    const konto = await d.bestand.lagerSchreibkonto(req.apiUser.user_id, req.abfrage.owner);
    await d.bestand.lagerortDienst.loescheOrt(konto, req.pfad.id);
    return {};
  });

  // Spannt Sets und Teile, gehört keiner Familie.
  router.endpunkt('GET /api/v1/storage', requireToken, async req => {
    const ids = sichtVon(req);
    return { orte: await d.bestand.lagerortDienst.lagerorte(ids) };
  });

  router.use(fehlerAntwort);
  return router;
}
