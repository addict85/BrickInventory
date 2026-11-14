/** Lagerorte und Preisalarme der Sets; eigene Pfade, deshalb ohne Rücksicht auf die Reihenfolge in sets.ts. */
import { fehlerAntwort, sendeFehler } from '../../src/http/httpAntwort';
import { kontoSchranke, sichtVon, waechterFuer } from './middleware';
import { csvEmpfang } from '../../src/http/dateiEmpfang';
import { zustand } from '../../src/infra/validate';
import { vertragsRouter, type Anfrage, type Antwort } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../startup/verdrahtung';

export function baueSetsLagerRouter(d: Dienste) {
  const { requireToken } = waechterFuer(d.konto);
  const router = vertragsRouter();

  router.put(
    '/sets/:setNumber/storage',
    requireToken,
    async (
      req: Anfrage<'PUT /api/v1/sets/:setNumber/storage'>,
      res: Antwort<'PUT /api/v1/sets/:setNumber/storage'>,
    ) => {
      const { ort, n } = await d.sets.lagerortDesSetsSetzen(
        req.apiUser.user_id,
        req.pfad.setNumber,
        req.eingabe.storage,
      );
      res.json({ success: true, storage: ort, changed: n });
    },
  );

  /** Ein Alarm gehört genau EINEM Konto: Wer eine Schwelle setzt, will selbst
   * benachrichtigt werden. Deshalb `user_id` statt blickfeldIds() — hier die Regel. */
  router.get(
    '/sets/:setNumber/alert',
    requireToken,
    async (req: Anfrage<'GET /api/v1/sets/:setNumber/alert'>, res: Antwort<'GET /api/v1/sets/:setNumber/alert'>) => {
      res.json({ success: true, alerts: await d.sets.setAlarmeLesen(req.apiUser.user_id, req.pfad.setNumber) });
    },
  );

  router.put(
    '/sets/:setNumber/alert',
    requireToken,
    async (req: Anfrage<'PUT /api/v1/sets/:setNumber/alert'>, res: Antwort<'PUT /api/v1/sets/:setNumber/alert'>) => {
      const alarm = await d.sets.alarmDesSetsSetzen(req.apiUser.user_id, req.pfad.setNumber, req.eingabe || {});
      res.json({ success: true, alert: alarm });
    },
  );

  router.delete(
    '/sets/:setNumber/alert',
    requireToken,
    async (
      req: Anfrage<'DELETE /api/v1/sets/:setNumber/alert'>,
      res: Antwort<'DELETE /api/v1/sets/:setNumber/alert'>,
    ) => {
      const n = await d.sets.alarmDesSetsLoeschen(
        req.apiUser.user_id,
        req.pfad.setNumber,
        req.abfrage.condition ? zustand(req.abfrage.condition) : undefined,
      );
      res.json({ success: true, removed: n });
    },
  );

  // Abholen statt Schieben; ohne Kontofilter, ein Alarm gehört einem Konto.
  router.get(
    '/alerts/pending',
    requireToken,
    async (req: Anfrage<'GET /api/v1/alerts/pending'>, res: Antwort<'GET /api/v1/alerts/pending'>) => {
      const r = await d.finanzen.preisalarm.ausgeloesteSeit(req.apiUser.user_id, req.abfrage.since);
      res.json({ success: true, alerts: r.alerts, now: r.now });
    },
  );

  // Was gesetzt ist; ausgelöst: /alerts/pending.
  router.get(
    '/alerts',
    requireToken,
    async (req: Anfrage<'GET /api/v1/alerts'>, res: Antwort<'GET /api/v1/alerts'>) => {
      res.json({ success: true, alerts: await d.finanzen.preisalarm.alleAlarme(req.apiUser.user_id) });
    },
  );

  router.post(
    '/alerts/import/csv',
    requireToken,
    kontoSchranke('upload'),
    csvEmpfang.single('file'),
    async (req: Anfrage<'POST /api/v1/alerts/import/csv'>, res: Antwort<'POST /api/v1/alerts/import/csv'>) => {
      if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
      res.json({
        success: true,
        ...(await d.sets.alarmCsvImportStarten(req.apiUser.user_id, req.file.buffer.toString('utf-8'))),
      });
    },
  );

  router.get(
    '/storage/locations',
    requireToken,
    async (req: Anfrage<'GET /api/v1/storage/locations'>, res: Antwort<'GET /api/v1/storage/locations'>) => {
      res.json({ success: true, ...(await d.sets.lagerorteMitVorgabe(req.apiUser.user_id, req.abfrage.owner)) });
    },
  );

  /** `{ id: null }` schaltet die Vorgabe ab — ein Endpunkt, weil es eine
   * Einstellung mit genau einem Wert ist. */
  router.put(
    '/storage/default',
    requireToken,
    async (req: Anfrage<'PUT /api/v1/storage/default'>, res: Antwort<'PUT /api/v1/storage/default'>) => {
      // Fehlt das Feld, meint der Client dasselbe wie null.
      const roh = req.eingabe.id;
      const id = roh === null || roh === undefined ? null : Number(roh);
      res.json({ success: true, vorgabe: await d.bestand.setzeVorgabe(req.apiUser.user_id, id) });
    },
  );

  router.post(
    '/storage/locations',
    requireToken,
    async (req: Anfrage<'POST /api/v1/storage/locations'>, res: Antwort<'POST /api/v1/storage/locations'>) => {
      const konto = await d.bestand.lagerSchreibkonto(req.apiUser.user_id, req.abfrage.owner ?? req.eingabe.owner);
      const { ort, war_neu } = await d.bestand.lagerortDienst.legeOrtAn(konto, req.eingabe.name);
      if (!war_neu) return sendeFehler(req, res, 409, 'lagerort_doppelt');
      res.json({ success: true, ort });
    },
  );

  router.put(
    '/storage/locations/:id',
    requireToken,
    async (req: Anfrage<'PUT /api/v1/storage/locations/:id'>, res: Antwort<'PUT /api/v1/storage/locations/:id'>) => {
      const konto = await d.bestand.lagerSchreibkonto(req.apiUser.user_id, req.abfrage.owner ?? req.eingabe.owner);
      res.json({
        success: true,
        ort: await d.bestand.lagerortDienst.benenneOrtUm(konto, req.pfad.id, req.eingabe.name),
      });
    },
  );

  router.delete(
    '/storage/locations/:id',
    requireToken,
    async (
      req: Anfrage<'DELETE /api/v1/storage/locations/:id'>,
      res: Antwort<'DELETE /api/v1/storage/locations/:id'>,
    ) => {
      const konto = await d.bestand.lagerSchreibkonto(req.apiUser.user_id, req.abfrage.owner);
      await d.bestand.lagerortDienst.loescheOrt(konto, req.pfad.id);
      res.json({ success: true });
    },
  );

  // Spannt Sets und Teile, gehört keiner Familie.
  router.get(
    '/storage',
    requireToken,
    async (req: Anfrage<'GET /api/v1/storage'>, res: Antwort<'GET /api/v1/storage'>) => {
      const ids = sichtVon(req);
      res.json({ success: true, orte: await d.bestand.lagerortDienst.lagerorte(ids) });
    },
  );

  router.use(fehlerAntwort);
  return router;
}
