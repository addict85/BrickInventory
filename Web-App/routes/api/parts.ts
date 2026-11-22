import { accountGate, viewOf, guardFor } from './middleware';
import { csvReceive } from '../../src/http/fileUpload';
import type { CsvImportReport } from '../../src/infra/csvExport';
import { normalizeLocation } from '../../src/inventory';
import { pageFrom } from '../../src/infra/page';
import { Degradations } from '../../src/infra/result';
import { contractRouter } from '../../src/http/contractRouter';
import type { Services } from '../../src/services';
import { failDomain, notFound } from '../../src/infra/errorTexts';

export function buildPartsRouter(
  d: Pick<
    Services,
    'settings' | 'jobQueue' | 'household' | 'account' | 'catalog' | 'finances' | 'inventory' | 'parts' | 'collection'
  >,
) {
  const { requireToken } = guardFor(d.account);
  const router = contractRouter('/api/v2');

  router.endpoint('GET /api/v2/parts', requireToken, async req => {
    const result = await d.parts.readParts(viewOf(req), req.queryArgs);
    // page_size: the value ACTUALLY used, not the one requested.
    return { page: req.queryArgs.page ?? 1, ...result };
  });

  router.endpoint('GET /api/v2/parts/categories', requireToken, async req => {
    // The same scope as the color list, otherwise two lists of the same
    // view would filter over different accounts.
    const uids = viewOf(req);
    return { categories: await d.parts.partCategories(uids) };
  });

  router.endpoint(
    'POST /api/v2/parts/import/csv',
    requireToken,
    accountGate('upload'),
    csvReceive.single('file'),
    async req => {
      if (!req.file) failDomain('ungueltig', 'no_file');
      return {
        ...(await d.collection.runImport<CsvImportReport>(req.apiUser.user_id, 'teile_csv', {
          text: req.file.buffer.toString('utf-8'),
        })),
      };
    },
  );

  router.endpoint('GET /api/v2/parts/brick-colors', requireToken, async _req => {
    const colors = await d.catalog.colorList();
    return { colors };
  });

  router.endpoint('POST /api/v2/parts', requireToken, async req => {
    // writeTargetOrNull checks the DIRECTION (main account → own sub-account),
    // not merely the membership in the scope.
    const owner = await d.household.writeTarget(req.apiUser.user_id, req.input.owner_user_id);
    const result = await d.parts.addManualPart(owner, req.input);
    return { ...result };
  });

  router.endpoint('PUT /api/v2/parts/:partNumber/:colorId', requireToken, async req => {
    // The view says whose card is meant; without the parameter the main account would
    // change its own row on the child's card.
    const owner = await d.household.writeTarget(req.apiUser.user_id, req.queryArgs.owner, 'no_account_access');
    // With a quantity change the response carries the quantity afterwards (with quantity_delta
    // the client would not know it otherwise).
    const r = await d.parts.changeManualPart(owner, req.pathArgs.partNumber, req.pathArgs.colorId, req.input);
    return { ...r };
  });

  // An address of its own: the color is already part of the address of PUT /parts/:nr/:farbe.
  router.endpoint('PUT /api/v2/parts/:partNumber/:colorId/color', requireToken, async req => {
    const owner = await d.household.writeTarget(req.apiUser.user_id, req.queryArgs.owner, 'no_account_access');
    // The new color must be present: V.colorId() would turn missing into "no color",
    // a silent clearing with a success message.
    const newColor = req.input.color_id;
    if (newColor == null || newColor < 0) failDomain('ungueltig', 'color_required');
    const result = await d.parts.changePartColor(owner, req.pathArgs.partNumber, req.pathArgs.colorId, newColor, {
      color_name: req.input.color_name ?? null,
      color_hex: req.input.color_hex ?? null,
    });
    return { ...result };
  });

  router.endpoint('DELETE /api/v2/parts/:partNumber/:colorId', requireToken, async req => {
    // Without the parameter the own account — unchanged for clients that do not know it.
    const owner = await d.household.writeTarget(req.apiUser.user_id, req.queryArgs.owner, 'no_account_access');
    const deleted = await d.collection.deletePart(owner, req.pathArgs.partNumber, req.pathArgs.colorId);
    if (deleted === null) notFound('part_not_manual');
    return { trash: [deleted] };
  });

  router.endpoint('GET /api/v2/parts/bl-color-map', requireToken, async _req => {
    const result = await d.parts.blColorMap();
    return { ...result };
  });

  /** Per part-color pair `gesamt` (scope) and `lose` (not in a set);
   * which number applies is decided by the human. */
  router.endpoint('POST /api/v2/parts/owned', requireToken, async req => {
    const parts = req.input.parts ?? [];
    return { holding: await d.parts.ownedQuantities(viewOf(req), parts) };
  });

  /** Hits ALL rows of the part-color pair: whoever enters "Box 3" means the
   * part, not one of its set rows. */
  router.endpoint('PUT /api/v2/parts/:partNumber/:colorId/storage', requireToken, async req => {
    const location = normalizeLocation(req.input.storage);
    const n = await d.inventory.locationService.setLocation(
      'part',
      { schreiber: req.apiUser.user_id },
      [req.pathArgs.partNumber, req.pathArgs.colorId],
      location,
    );
    return { storage: location, changed: n };
  });

  router.endpoint('GET /api/v2/parts/manual', requireToken, async req => {
    const ab = new Degradations();
    const all = await d.parts.readManualParts(
      viewOf(req),
      req.apiUser.user_id,
      { search: req.queryArgs.search ?? '', storage: req.queryArgs.storage ?? '' },
      ab,
    );
    const { entries: parts, ...page } = pageFrom(all, req.queryArgs);
    return { parts, ...page, ...ab.detail() };
  });

  router.endpoint('GET /api/v2/parts/colors', requireToken, async req => {
    return { colors: await d.parts.partColors(viewOf(req)) };
  });

  router.endpoint('GET /api/v2/parts/stats', requireToken, async req => {
    const stats = await d.parts.partStats(viewOf(req));
    return { stats };
  });

  // The same implementation as for the webapp; it sits at the bottom so fixed paths match first.
  router.endpoint('GET /api/v2/parts/:partNumber/:colorId/price-history', requireToken, async req => {
    const uid = req.apiUser.user_id;
    const currency = await d.settings.userValue(uid, 'currency', 'EUR');
    const data = await d.finances.priceHistoryPart(
      viewOf(req),
      req.pathArgs.partNumber,
      req.pathArgs.colorId,
      currency,
    );
    return { ...data };
  });

  // In the scope, so the list fits the part list one comes from.
  router.endpoint('GET /api/v2/parts/:partNumber/:colorId/sets', requireToken, async req => {
    const uids = viewOf(req);
    const { item, sets } = await d.inventory.usingSets(uids, 'parts', {
      part_number: req.pathArgs.partNumber,
      color_id: req.pathArgs.colorId,
    });
    return { item, sets };
  });
  return router;
}
