import { kontoSchranke, viewOf, guardFor } from './middleware';
import { csvReceive } from '../../src/http/fileUpload';
import type { CsvImportReport } from '../../src/infra/csvExport';
import { normalizeLocation } from '../../src/inventory';
import { pageFrom } from '../../src/infra/page';
import { Degradations } from '../../src/infra/result';
import { vertragsRouter } from '../../src/http/contractRouter';
import type { Services } from '../../src/services';
import { fachfehler, notFound } from '../../src/infra/errorTexts';

export function buildPartsRouter(
  d: Pick<
    Services,
    'settings' | 'jobQueue' | 'household' | 'account' | 'catalog' | 'finances' | 'inventory' | 'parts' | 'collection'
  >,
) {
  const { requireToken } = guardFor(d.account);
  const router = vertragsRouter('/api/v1');

  router.endpunkt('GET /api/v1/parts', requireToken, async req => {
    const result = await d.parts.readParts(viewOf(req), req.abfrage);
    // page_size: the value ACTUALLY used, not the one requested.
    return { page: req.abfrage.page ?? 1, ...result };
  });

  router.endpunkt('GET /api/v1/parts/categories', requireToken, async req => {
    // The same scope as the color list, otherwise two lists of the same
    // view would filter over different accounts.
    const uids = viewOf(req);
    return { categories: await d.parts.partCategories(uids) };
  });

  router.endpunkt(
    'POST /api/v1/parts/import/csv',
    requireToken,
    kontoSchranke('upload'),
    csvReceive.single('file'),
    async req => {
      if (!req.file) fachfehler('ungueltig', 'keine_datei');
      return {
        ...(await d.collection.runImport<CsvImportReport>(req.apiUser.user_id, 'teile_csv', {
          text: req.file.buffer.toString('utf-8'),
        })),
      };
    },
  );

  router.endpunkt('GET /api/v1/parts/brick-colors', requireToken, async _req => {
    const colors = await d.catalog.colorList();
    return { colors };
  });

  router.endpunkt('POST /api/v1/parts', requireToken, async req => {
    // writeTargetOrNull checks the DIRECTION (main account → own sub-account),
    // not merely the membership in the scope.
    const owner = await d.household.schreibziel(req.apiUser.user_id, req.eingabe.owner_user_id);
    const result = await d.parts.addManualPart(owner, req.eingabe);
    return { ...result };
  });

  router.endpunkt('PUT /api/v1/parts/:partNumber/:colorId', requireToken, async req => {
    // The view says whose card is meant; without the parameter the main account would
    // change its own row on the child's card.
    const besitzer = await d.household.schreibziel(req.apiUser.user_id, req.abfrage.owner, 'kein_zugriff_konto');
    // With a quantity change the response carries the quantity afterwards (with quantity_delta
    // the client would not know it otherwise).
    const r = await d.parts.changeManualPart(besitzer, req.pfad.partNumber, req.pfad.colorId, req.eingabe);
    return { ...r };
  });

  // An address of its own: the color is already part of the address of PUT /parts/:nr/:farbe.
  router.endpunkt('PUT /api/v1/parts/:partNumber/:colorId/color', requireToken, async req => {
    const besitzer = await d.household.schreibziel(req.apiUser.user_id, req.abfrage.owner, 'kein_zugriff_konto');
    // The new color must be present: V.colorId() would turn missing into "no color",
    // a silent clearing with a success message.
    const neueFarbe = req.eingabe.color_id;
    if (neueFarbe == null || neueFarbe < 0) fachfehler('ungueltig', 'farbe_erforderlich');
    const ergebnis = await d.parts.changePartColor(besitzer, req.pfad.partNumber, req.pfad.colorId, neueFarbe, {
      color_name: req.eingabe.color_name ?? null,
      color_hex: req.eingabe.color_hex ?? null,
    });
    return { ...ergebnis };
  });

  router.endpunkt('DELETE /api/v1/parts/:partNumber/:colorId', requireToken, async req => {
    // Without the parameter the own account — unchanged for clients that do not know it.
    const besitzer = await d.household.schreibziel(req.apiUser.user_id, req.abfrage.owner, 'kein_zugriff_konto');
    const geloescht = await d.collection.deletePart(besitzer, req.pfad.partNumber, req.pfad.colorId);
    if (geloescht === null) notFound('teil_nicht_manuell');
    return { papierkorb: [geloescht] };
  });

  router.endpunkt('GET /api/v1/parts/bl-color-map', requireToken, async _req => {
    const result = await d.parts.blColorMap();
    return { ...result };
  });

  /** Per part-color pair `gesamt` (scope) and `lose` (not in a set);
   * which number applies is decided by the human. */
  router.endpunkt('POST /api/v1/parts/owned', requireToken, async req => {
    const teile = req.eingabe.teile ?? [];
    return { bestand: await d.parts.ownedQuantities(viewOf(req), teile) };
  });

  /** Hits ALL rows of the part-color pair: whoever enters "Box 3" means the
   * part, not one of its set rows. */
  router.endpunkt('PUT /api/v1/parts/:partNumber/:colorId/storage', requireToken, async req => {
    const ort = normalizeLocation(req.eingabe.storage);
    const n = await d.inventory.locationService.setLocation(
      'part',
      { schreiber: req.apiUser.user_id },
      [req.pfad.partNumber, req.pfad.colorId],
      ort,
    );
    return { storage: ort, changed: n };
  });

  router.endpunkt('GET /api/v1/parts/manual', requireToken, async req => {
    const ab = new Degradations();
    const alle = await d.parts.readManualParts(
      viewOf(req),
      req.apiUser.user_id,
      { search: req.abfrage.search ?? '', storage: req.abfrage.storage ?? '' },
      ab,
    );
    const { eintraege: parts, ...seite } = pageFrom(alle, req.abfrage);
    return { parts, ...seite, ...ab.detail() };
  });

  router.endpunkt('GET /api/v1/parts/colors', requireToken, async req => {
    return { colors: await d.parts.partColors(viewOf(req)) };
  });

  router.endpunkt('GET /api/v1/parts/stats', requireToken, async req => {
    const stats = await d.parts.partStats(viewOf(req));
    return { stats };
  });

  // The same implementation as for the webapp; it sits at the bottom so fixed paths match first.
  router.endpunkt('GET /api/v1/parts/:partNumber/:colorId/price-history', requireToken, async req => {
    const uid = req.apiUser.user_id;
    const currency = await d.settings.userValue(uid, 'currency', 'EUR');
    const data = await d.finances.priceHistoryPart(viewOf(req), req.pfad.partNumber, req.pfad.colorId, currency);
    return { ...data };
  });

  // In the scope, so the list fits the part list one comes from.
  router.endpunkt('GET /api/v1/parts/:partNumber/:colorId/sets', requireToken, async req => {
    const uids = viewOf(req);
    const { item, sets } = await d.inventory.usingSets(uids, 'parts', {
      part_number: req.pfad.partNumber,
      color_id: req.pfad.colorId,
    });
    return { item, sets };
  });
  return router;
}
