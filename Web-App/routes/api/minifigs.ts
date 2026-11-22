import { accountGate, viewOf, guardFor } from './middleware';
import { normalizeLocation } from '../../src/inventory';
import { csvReceive } from '../../src/http/fileUpload';
import type { CsvImportReport } from '../../src/infra/csvExport';
import { pageFrom } from '../../src/infra/page';
import { Degradations } from '../../src/infra/result';
import { contractRouter } from '../../src/http/contractRouter';
import type { Services } from '../../src/services';
import { failDomain, notFound } from '../../src/infra/errorTexts';

export function buildMinifigsRouter(
  d: Pick<
    Services,
    'settings' | 'jobQueue' | 'household' | 'account' | 'finances' | 'inventory' | 'minifigs' | 'collection'
  >,
) {
  const { requireToken } = guardFor(d.account);
  const router = contractRouter('/api/v2');

  router.endpoint('GET /api/v2/minifigs', requireToken, async req => {
    // Without page_size unchanged behavior — the Android app calls it that way.
    const r = await d.minifigs.readMinifigs(viewOf(req), req.queryArgs);
    return { figs: r.figs, total: r.total };
  });

  router.endpoint('POST /api/v2/minifigs', requireToken, async req => {
    const owner = await d.household.writeTarget(req.apiUser.user_id, req.input.owner_user_id);
    const result = await d.minifigs.addManualMinifig(owner, req.input);
    return { ...result };
  });

  router.endpoint('PUT /api/v2/minifigs/:figNumber', requireToken, async req => {
    // Without the parameter the own account.
    const owner = await d.household.writeTarget(req.apiUser.user_id, req.queryArgs.owner, 'no_account_access');
    const r = await d.minifigs.updateManualMinifig(owner, req.pathArgs.figNumber, req.input);
    return { ...r };
  });

  // Hits all rows of the minifig in the write scope: the minifig is meant, not a row.
  router.endpoint('PUT /api/v2/minifigs/:figNumber/storage', requireToken, async req => {
    const location = normalizeLocation(req.input.storage);
    const n = await d.inventory.locationService.setLocation(
      'fig',
      { schreiber: req.apiUser.user_id },
      [req.pathArgs.figNumber],
      location,
    );
    return { storage: location, changed: n };
  });

  router.endpoint('DELETE /api/v2/minifigs/:figNumber', requireToken, async req => {
    // Without the parameter the own account.
    const owner = await d.household.writeTarget(req.apiUser.user_id, req.queryArgs.owner, 'no_account_access');
    const deleted = await d.collection.deleteMinifig(owner, req.pathArgs.figNumber);
    if (deleted === null) notFound('minifig_not_manual');
    return { trash: [deleted] };
  });

  router.endpoint('GET /api/v2/minifigs/manual', requireToken, async req => {
    const ab = new Degradations();
    const all = await d.minifigs.readManualMinifigs(
      viewOf(req),
      req.apiUser.user_id,
      { search: req.queryArgs.search ?? '' },
      ab,
    );
    const { entries: figs, ...page } = pageFrom(all, req.queryArgs);
    return { figs, ...page, ...ab.detail() };
  });

  /** The same grouping as the list, so metric and list agree. */
  router.endpoint('GET /api/v2/minifigs/stats', requireToken, async req => {
    const stats = await d.minifigs.minifigStats(viewOf(req));
    return { stats };
  });

  router.endpoint('GET /api/v2/minifigs/:figNumber/price-history', requireToken, async req => {
    const uid = req.apiUser.user_id;
    const currency = await d.settings.userValue(uid, 'currency', 'EUR');
    // Scope: without scopeIds() no acquisition would be found for a minifig of the sub-account.
    const data = await d.finances.priceHistoryMinifig(viewOf(req), req.pathArgs.figNumber, currency);
    return { ...data };
  });

  router.endpoint('GET /api/v2/minifigs/:figNumber/parts', requireToken, async req => {
    return { ...(await d.minifigs.partsOfMinifig(req.pathArgs.figNumber)) };
  });

  router.endpoint(
    'POST /api/v2/minifigs/import/csv',
    requireToken,
    accountGate('upload'),
    csvReceive.single('file'),
    async req => {
      if (!req.file) failDomain('ungueltig', 'no_file');
      return {
        ...(await d.collection.runImport<CsvImportReport>(req.apiUser.user_id, 'figuren_csv', {
          text: req.file.buffer.toString('utf-8'),
        })),
      };
    },
  );

  // The same query as for parts (src/inventory/shared.ts), in the household's scope.
  router.endpoint('GET /api/v2/minifigs/:figNumber/sets', requireToken, async req => {
    const uids = viewOf(req);
    const { item, sets } = await d.inventory.usingSets(uids, 'minifigs', {
      fig_number: req.pathArgs.figNumber,
    });
    return { item, sets };
  });
  return router;
}
