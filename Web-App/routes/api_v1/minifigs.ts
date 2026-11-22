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
  const router = contractRouter('/api/v1');

  router.endpoint('GET /api/v1/minifigs', requireToken, async req => {
    // Without page_size unchanged behavior — the Android app calls it that way.
    const r = await d.minifigs.readMinifigs(viewOf(req), req.abfrage);
    return { figs: r.figs, total: r.total };
  });

  router.endpoint('POST /api/v1/minifigs', requireToken, async req => {
    const owner = await d.household.writeTarget(req.apiUser.user_id, req.eingabe.owner_user_id);
    const result = await d.minifigs.addManualMinifig(owner, req.eingabe);
    return { ...result };
  });

  router.endpoint('PUT /api/v1/minifigs/:figNumber', requireToken, async req => {
    // Without the parameter the own account.
    const owner = await d.household.writeTarget(req.apiUser.user_id, req.abfrage.owner, 'kein_zugriff_konto');
    const r = await d.minifigs.updateManualMinifig(owner, req.pfad.figNumber, req.eingabe);
    return { ...r };
  });

  // Hits all rows of the minifig in the write scope: the minifig is meant, not a row.
  router.endpoint('PUT /api/v1/minifigs/:figNumber/storage', requireToken, async req => {
    const ort = normalizeLocation(req.eingabe.storage);
    const n = await d.inventory.locationService.setLocation(
      'fig',
      { schreiber: req.apiUser.user_id },
      [req.pfad.figNumber],
      ort,
    );
    return { storage: ort, changed: n };
  });

  router.endpoint('DELETE /api/v1/minifigs/:figNumber', requireToken, async req => {
    // Without the parameter the own account.
    const owner = await d.household.writeTarget(req.apiUser.user_id, req.abfrage.owner, 'kein_zugriff_konto');
    const deleted = await d.collection.deleteMinifig(owner, req.pfad.figNumber);
    if (deleted === null) notFound('minifig_nicht_manuell');
    return { papierkorb: [deleted] };
  });

  router.endpoint('GET /api/v1/minifigs/manual', requireToken, async req => {
    const ab = new Degradations();
    const all = await d.minifigs.readManualMinifigs(
      viewOf(req),
      req.apiUser.user_id,
      { search: req.abfrage.search ?? '' },
      ab,
    );
    const { eintraege: figs, ...page } = pageFrom(all, req.abfrage);
    return { figs, ...page, ...ab.detail() };
  });

  /** The same grouping as the list, so metric and list agree. */
  router.endpoint('GET /api/v1/minifigs/stats', requireToken, async req => {
    const stats = await d.minifigs.minifigStats(viewOf(req));
    return { stats };
  });

  router.endpoint('GET /api/v1/minifigs/:figNumber/price-history', requireToken, async req => {
    const uid = req.apiUser.user_id;
    const currency = await d.settings.userValue(uid, 'currency', 'EUR');
    // Scope: without scopeIds() no acquisition would be found for a minifig of the sub-account.
    const data = await d.finances.priceHistoryMinifig(viewOf(req), req.pfad.figNumber, currency);
    return { ...data };
  });

  router.endpoint('GET /api/v1/minifigs/:figNumber/parts', requireToken, async req => {
    return { ...(await d.minifigs.partsOfMinifig(req.pfad.figNumber)) };
  });

  router.endpoint(
    'POST /api/v1/minifigs/import/csv',
    requireToken,
    accountGate('upload'),
    csvReceive.single('file'),
    async req => {
      if (!req.file) failDomain('ungueltig', 'keine_datei');
      return {
        ...(await d.collection.runImport<CsvImportReport>(req.apiUser.user_id, 'figuren_csv', {
          text: req.file.buffer.toString('utf-8'),
        })),
      };
    },
  );

  // The same query as for parts (src/inventory/shared.ts), in the household's scope.
  router.endpoint('GET /api/v1/minifigs/:figNumber/sets', requireToken, async req => {
    const uids = viewOf(req);
    const { item, sets } = await d.inventory.usingSets(uids, 'minifigs', {
      fig_number: req.pfad.figNumber,
    });
    return { item, sets };
  });
  return router;
}
