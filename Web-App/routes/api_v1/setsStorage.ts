/** Storage locations and price alerts of the sets; paths of their own, hence independent of the order in sets.ts. */
import { accountGate, viewOf, guardFor } from './middleware';
import { csvReceive } from '../../src/http/fileUpload';
import { zustand } from '../../src/infra/validate';
import { contractRouter } from '../../src/http/contractRouter';
import type { Services } from '../../src/services';
import { failDomain } from '../../src/infra/errorTexts';

export function buildSetsStorageRouter(d: Pick<Services, 'account' | 'finances' | 'inventory' | 'sets'>) {
  const { requireToken } = guardFor(d.account);
  const router = contractRouter('/api/v1');

  router.endpoint('PUT /api/v1/sets/:setNumber/storage', requireToken, async req => {
    const { ort, n } = await d.sets.setLocationOfSets(req.apiUser.user_id, req.pfad.setNumber, req.eingabe.storage);
    return { storage: ort, changed: n };
  });

  /** An alert belongs to exactly ONE account: whoever sets a threshold wants to be
   * notified personally. Hence `user_id` instead of scopeIds() — here that is the rule. */
  router.endpoint('GET /api/v1/sets/:setNumber/alert', requireToken, async req => {
    return { alerts: await d.sets.readSetAlerts(req.apiUser.user_id, req.pfad.setNumber) };
  });

  router.endpoint('PUT /api/v1/sets/:setNumber/alert', requireToken, async req => {
    const alarm = await d.sets.setAlarmOfSets(req.apiUser.user_id, req.pfad.setNumber, req.eingabe || {});
    return { alert: alarm };
  });

  router.endpoint('DELETE /api/v1/sets/:setNumber/alert', requireToken, async req => {
    const n = await d.sets.deleteAlarmOfSets(
      req.apiUser.user_id,
      req.pfad.setNumber,
      req.abfrage.condition ? zustand(req.abfrage.condition) : undefined,
    );
    return { removed: n };
  });

  // Fetch instead of push; without account filter, an alert belongs to one account.
  router.endpoint('GET /api/v1/alerts/pending', requireToken, async req => {
    const r = await d.finances.preisalarm.triggeredSince(req.apiUser.user_id, req.abfrage.since);
    return { alerts: r.alerts, now: r.now };
  });

  // What is set; triggered ones: /alerts/pending.
  router.endpoint('GET /api/v1/alerts', requireToken, async req => {
    return { alerts: await d.finances.preisalarm.allAlerts(req.apiUser.user_id) };
  });

  router.endpoint(
    'POST /api/v1/alerts/import/csv',
    requireToken,
    accountGate('upload'),
    csvReceive.single('file'),
    async req => {
      if (!req.file) failDomain('ungueltig', 'keine_datei');
      return { ...(await d.sets.startAlarmCsvImport(req.apiUser.user_id, req.file.buffer.toString('utf-8'))) };
    },
  );

  router.endpoint('GET /api/v1/storage/locations', requireToken, async req => {
    return { ...(await d.sets.locationsWithDefault(req.apiUser.user_id, req.abfrage.owner)) };
  });

  /** `{ id: null }` turns the default off — one endpoint, because it is a
   * setting with exactly one value. */
  router.endpoint('PUT /api/v1/storage/default', requireToken, async req => {
    // If the field is missing, the client means the same as null.
    return { vorgabe: await d.inventory.setDefault(req.apiUser.user_id, req.eingabe.id ?? null) };
  });

  router.endpoint('POST /api/v1/storage/locations', requireToken, async req => {
    const konto = await d.inventory.storageWriteAccount(req.apiUser.user_id, req.abfrage.owner ?? req.eingabe.owner);
    const { ort, war_neu } = await d.inventory.locationService.createStorage(konto, req.eingabe.name);
    if (!war_neu) failDomain('konflikt', 'lagerort_doppelt');
    return { ort };
  });

  router.endpoint('PUT /api/v1/storage/locations/:id', requireToken, async req => {
    const konto = await d.inventory.storageWriteAccount(req.apiUser.user_id, req.abfrage.owner ?? req.eingabe.owner);
    return { ort: await d.inventory.locationService.renameStorage(konto, req.pfad.id, req.eingabe.name) };
  });

  router.endpoint('DELETE /api/v1/storage/locations/:id', requireToken, async req => {
    const konto = await d.inventory.storageWriteAccount(req.apiUser.user_id, req.abfrage.owner);
    await d.inventory.locationService.deleteStorage(konto, req.pfad.id);
    return {};
  });

  // Spans sets and parts, belongs to no family.
  router.endpoint('GET /api/v1/storage', requireToken, async req => {
    const ids = viewOf(req);
    return { orte: await d.inventory.locationService.storages(ids) };
  });
  return router;
}
