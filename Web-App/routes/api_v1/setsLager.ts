/** Lagerorte und Preisalarme der Sets; eigene Pfade, deshalb ohne Rücksicht auf die Reihenfolge in sets.ts. */
import { kontoSchranke, viewOf, guardFor } from './middleware';
import { csvReceive } from '../../src/http/fileUpload';
import { zustand } from '../../src/infra/validate';
import { vertragsRouter } from '../../src/http/contractRouter';
import type { Dienste } from '../../src/services';
import { fachfehler } from '../../src/infra/errorTexts';

export function buildSetsStorageRouter(d: Pick<Dienste, 'account' | 'finances' | 'inventory' | 'sets'>) {
  const { requireToken } = guardFor(d.account);
  const router = vertragsRouter('/api/v1');

  router.endpunkt('PUT /api/v1/sets/:setNumber/storage', requireToken, async req => {
    const { ort, n } = await d.sets.setLocationOfSets(req.apiUser.user_id, req.pfad.setNumber, req.eingabe.storage);
    return { storage: ort, changed: n };
  });

  /** Ein Alarm gehört genau EINEM Konto: Wer eine Schwelle setzt, will selbst
   * benachrichtigt werden. Deshalb `user_id` statt scopeIds() — hier die Regel. */
  router.endpunkt('GET /api/v1/sets/:setNumber/alert', requireToken, async req => {
    return { alerts: await d.sets.readSetAlerts(req.apiUser.user_id, req.pfad.setNumber) };
  });

  router.endpunkt('PUT /api/v1/sets/:setNumber/alert', requireToken, async req => {
    const alarm = await d.sets.setAlarmOfSets(req.apiUser.user_id, req.pfad.setNumber, req.eingabe || {});
    return { alert: alarm };
  });

  router.endpunkt('DELETE /api/v1/sets/:setNumber/alert', requireToken, async req => {
    const n = await d.sets.deleteAlarmOfSets(
      req.apiUser.user_id,
      req.pfad.setNumber,
      req.abfrage.condition ? zustand(req.abfrage.condition) : undefined,
    );
    return { removed: n };
  });

  // Abholen statt Schieben; ohne Kontofilter, ein Alarm gehört einem Konto.
  router.endpunkt('GET /api/v1/alerts/pending', requireToken, async req => {
    const r = await d.finances.preisalarm.triggeredSince(req.apiUser.user_id, req.abfrage.since);
    return { alerts: r.alerts, now: r.now };
  });

  // Was gesetzt ist; ausgelöst: /alerts/pending.
  router.endpunkt('GET /api/v1/alerts', requireToken, async req => {
    return { alerts: await d.finances.preisalarm.alleAlarme(req.apiUser.user_id) };
  });

  router.endpunkt(
    'POST /api/v1/alerts/import/csv',
    requireToken,
    kontoSchranke('upload'),
    csvReceive.single('file'),
    async req => {
      if (!req.file) fachfehler('ungueltig', 'keine_datei');
      return { ...(await d.sets.startAlarmCsvImport(req.apiUser.user_id, req.file.buffer.toString('utf-8'))) };
    },
  );

  router.endpunkt('GET /api/v1/storage/locations', requireToken, async req => {
    return { ...(await d.sets.locationsWithDefault(req.apiUser.user_id, req.abfrage.owner)) };
  });

  /** `{ id: null }` schaltet die Vorgabe ab — ein Endpunkt, weil es eine
   * Einstellung mit genau einem Wert ist. */
  router.endpunkt('PUT /api/v1/storage/default', requireToken, async req => {
    // Fehlt das Feld, meint der Client dasselbe wie null.
    return { vorgabe: await d.inventory.setDefault(req.apiUser.user_id, req.eingabe.id ?? null) };
  });

  router.endpunkt('POST /api/v1/storage/locations', requireToken, async req => {
    const konto = await d.inventory.lagerSchreibkonto(req.apiUser.user_id, req.abfrage.owner ?? req.eingabe.owner);
    const { ort, war_neu } = await d.inventory.locationService.putLocationAn(konto, req.eingabe.name);
    if (!war_neu) fachfehler('konflikt', 'lagerort_doppelt');
    return { ort };
  });

  router.endpunkt('PUT /api/v1/storage/locations/:id', requireToken, async req => {
    const konto = await d.inventory.lagerSchreibkonto(req.apiUser.user_id, req.abfrage.owner ?? req.eingabe.owner);
    return { ort: await d.inventory.locationService.benenneOrtUm(konto, req.pfad.id, req.eingabe.name) };
  });

  router.endpunkt('DELETE /api/v1/storage/locations/:id', requireToken, async req => {
    const konto = await d.inventory.lagerSchreibkonto(req.apiUser.user_id, req.abfrage.owner);
    await d.inventory.locationService.loescheOrt(konto, req.pfad.id);
    return {};
  });

  // Spannt Sets und Teile, gehört keiner Familie.
  router.endpunkt('GET /api/v1/storage', requireToken, async req => {
    const ids = viewOf(req);
    return { orte: await d.inventory.locationService.lagerorte(ids) };
  });
  return router;
}
