/** Storage locations and price alerts of the sets; paths of their own, hence independent of the order in sets.ts. */
import { accountGate, viewOf, guardFor } from './middleware';
import { csvReceive } from '../../src/http/fileUpload';
import { conditionOf } from '../../src/infra/validate';
import { contractRouter } from '../../src/http/contractRouter';
import type { Services } from '../../src/services';
import { failDomain } from '../../src/infra/errorTexts';

export function buildSetsStorageRouter(d: Pick<Services, 'account' | 'finances' | 'inventory' | 'sets'>) {
  const { requireToken } = guardFor(d.account);
  const router = contractRouter('/api/v2');

  router.endpoint('PUT /api/v2/sets/:setNumber/storage', requireToken, async req => {
    const { location, n } = await d.sets.setLocationOfSets(
      req.apiUser.user_id,
      req.pathArgs.setNumber,
      req.input.storage,
    );
    return { storage: location, changed: n };
  });

  /** An alert belongs to exactly ONE account: whoever sets a threshold wants to be
   * notified personally. Hence `user_id` instead of scopeIds() — here that is the rule. */
  router.endpoint('GET /api/v2/sets/:setNumber/alert', requireToken, async req => {
    return { alerts: await d.sets.readSetAlerts(req.apiUser.user_id, req.pathArgs.setNumber) };
  });

  router.endpoint('PUT /api/v2/sets/:setNumber/alert', requireToken, async req => {
    const alarm = await d.sets.setAlarmOfSets(req.apiUser.user_id, req.pathArgs.setNumber, req.input || {});
    return { alert: alarm };
  });

  router.endpoint('DELETE /api/v2/sets/:setNumber/alert', requireToken, async req => {
    const n = await d.sets.deleteAlarmOfSets(
      req.apiUser.user_id,
      req.pathArgs.setNumber,
      req.queryArgs.condition ? conditionOf(req.queryArgs.condition) : undefined,
    );
    return { removed: n };
  });

  // Fetch instead of push; without account filter, an alert belongs to one account.
  router.endpoint('GET /api/v2/alerts/pending', requireToken, async req => {
    const r = await d.finances.priceAlert.triggeredSince(req.apiUser.user_id, req.queryArgs.since);
    return { alerts: r.alerts, now: r.now };
  });

  // What is set; triggered ones: /alerts/pending.
  router.endpoint('GET /api/v2/alerts', requireToken, async req => {
    return { alerts: await d.finances.priceAlert.allAlerts(req.apiUser.user_id) };
  });

  router.endpoint(
    'POST /api/v2/alerts/import/csv',
    requireToken,
    accountGate('upload'),
    csvReceive.single('file'),
    async req => {
      if (!req.file) failDomain('invalid', 'no_file');
      return { ...(await d.sets.startAlarmCsvImport(req.apiUser.user_id, req.file.buffer.toString('utf-8'))) };
    },
  );

  router.endpoint('GET /api/v2/storage/locations', requireToken, async req => {
    return { ...(await d.sets.locationsWithDefault(req.apiUser.user_id, req.queryArgs.owner)) };
  });

  /** `{ id: null }` turns the default off — one endpoint, because it is a
   * setting with exactly one value. */
  router.endpoint('PUT /api/v2/storage/default', requireToken, async req => {
    // If the field is missing, the client means the same as null.
    return { preset: await d.inventory.setDefault(req.apiUser.user_id, req.input.id ?? null) };
  });

  router.endpoint('POST /api/v2/storage/locations', requireToken, async req => {
    const account = await d.inventory.storageWriteAccount(req.apiUser.user_id, req.queryArgs.owner ?? req.input.owner);
    const { location, was_new } = await d.inventory.locationService.createStorage(account, req.input.name);
    if (!was_new) failDomain('conflict', 'storage_duplicate');
    return { location };
  });

  router.endpoint('PUT /api/v2/storage/locations/:id', requireToken, async req => {
    const account = await d.inventory.storageWriteAccount(req.apiUser.user_id, req.queryArgs.owner ?? req.input.owner);
    return { location: await d.inventory.locationService.renameStorage(account, req.pathArgs.id, req.input.name) };
  });

  router.endpoint('DELETE /api/v2/storage/locations/:id', requireToken, async req => {
    const account = await d.inventory.storageWriteAccount(req.apiUser.user_id, req.queryArgs.owner);
    await d.inventory.locationService.deleteStorage(account, req.pathArgs.id);
    return {};
  });

  // Spans sets and parts, belongs to no family.
  router.endpoint('GET /api/v2/storage', requireToken, async req => {
    const ids = viewOf(req);
    return { locations: await d.inventory.locationService.storages(ids) };
  });
  return router;
}
