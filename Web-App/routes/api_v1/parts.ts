import { kontoSchranke, viewOf, guardFor } from './middleware';
import { csvReceive } from '../../src/http/dateiEmpfang';
import type { CsvImportReport } from '../../src/infra/csvExport';
import { normalizeLocation } from '../../src/bestand';
import { pageFrom } from '../../src/infra/seite';
import { Degradations } from '../../src/infra/ergebnis';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';
import { fachfehler, notFound } from '../../src/infra/fehlerTexte';

export function buildPartsRouter(
  d: Pick<
    Dienste,
    'settings' | 'auftraege' | 'household' | 'konto' | 'katalog' | 'finanzen' | 'bestand' | 'parts' | 'collection'
  >,
) {
  const { requireToken } = guardFor(d.konto);
  const router = vertragsRouter('/api/v1');

  router.endpunkt('GET /api/v1/parts', requireToken, async req => {
    const result = await d.parts.readParts(viewOf(req), req.abfrage);
    // page_size: der TATSÄCHLICH verwendete Wert, nicht der angefragte.
    return { page: req.abfrage.page ?? 1, ...result };
  });

  router.endpunkt('GET /api/v1/parts/categories', requireToken, async req => {
    // Dasselbe Blickfeld wie die Farbliste, sonst filtern zwei Listen derselben
    // Ansicht über verschiedene Konten.
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
    const colors = await d.katalog.colorList();
    return { colors };
  });

  router.endpunkt('POST /api/v1/parts', requireToken, async req => {
    // writeTargetOrNull prüft die RICHTUNG (Hauptkonto → eigenes Unterkonto),
    // nicht bloss die Mitgliedschaft im Blickfeld.
    const owner = await d.household.schreibziel(req.apiUser.user_id, req.eingabe.owner_user_id);
    const result = await d.parts.addManualPart(owner, req.eingabe);
    return { ...result };
  });

  router.endpunkt('PUT /api/v1/parts/:partNumber/:colorId', requireToken, async req => {
    // Die Ansicht sagt, wessen Karte gemeint ist; ohne Parameter änderte das
    // Hauptkonto auf der Karte des Kindes die eigene Zeile.
    const besitzer = await d.household.schreibziel(req.apiUser.user_id, req.abfrage.owner, 'kein_zugriff_konto');
    // Mit Mengenänderung trägt die Antwort die Menge danach (bei quantity_delta
    // weiss der Client sie sonst nicht).
    const r = await d.parts.changeManualPart(besitzer, req.pfad.partNumber, req.pfad.colorId, req.eingabe);
    return { ...r };
  });

  // Eigene Adresse: Die Farbe ist schon Teil der Adresse von PUT /parts/:nr/:farbe.
  router.endpunkt('PUT /api/v1/parts/:partNumber/:colorId/color', requireToken, async req => {
    const besitzer = await d.household.schreibziel(req.apiUser.user_id, req.abfrage.owner, 'kein_zugriff_konto');
    // Die neue Farbe muss dastehen: V.colorId() machte aus fehlend „keine Farbe",
    // ein stilles Leeren mit Erfolgsmeldung.
    const neueFarbe = req.eingabe.color_id;
    if (neueFarbe == null || neueFarbe < 0) fachfehler('ungueltig', 'farbe_erforderlich');
    const ergebnis = await d.parts.changePartColor(besitzer, req.pfad.partNumber, req.pfad.colorId, neueFarbe, {
      color_name: req.eingabe.color_name ?? null,
      color_hex: req.eingabe.color_hex ?? null,
    });
    return { ...ergebnis };
  });

  router.endpunkt('DELETE /api/v1/parts/:partNumber/:colorId', requireToken, async req => {
    // Ohne Parameter das eigene Konto — unverändert für Clients, die ihn nicht kennen.
    const besitzer = await d.household.schreibziel(req.apiUser.user_id, req.abfrage.owner, 'kein_zugriff_konto');
    const geloescht = await d.collection.deletePart(besitzer, req.pfad.partNumber, req.pfad.colorId);
    if (geloescht === null) notFound('teil_nicht_manuell');
    return { papierkorb: [geloescht] };
  });

  router.endpunkt('GET /api/v1/parts/bl-color-map', requireToken, async _req => {
    const result = await d.parts.blColorMap();
    return { ...result };
  });

  /** Je Teil-Farb-Paar `gesamt` (Blickfeld) und `lose` (nicht in einem Set);
   * welche Zahl gilt, entscheidet der Mensch. */
  router.endpunkt('POST /api/v1/parts/owned', requireToken, async req => {
    const teile = req.eingabe.teile ?? [];
    return { bestand: await d.parts.ownedQuantities(viewOf(req), teile) };
  });

  /** Trifft ALLE Zeilen des Teil-Farb-Paares: Wer „Kiste 3" einträgt, meint das
   * Teil, nicht eine seiner Set-Zeilen. */
  router.endpunkt('PUT /api/v1/parts/:partNumber/:colorId/storage', requireToken, async req => {
    const ort = normalizeLocation(req.eingabe.storage);
    const n = await d.bestand.locationService.setLocation(
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
    return { parts, ...seite, ...ab.angabe() };
  });

  router.endpunkt('GET /api/v1/parts/colors', requireToken, async req => {
    return { colors: await d.parts.partColors(viewOf(req)) };
  });

  router.endpunkt('GET /api/v1/parts/stats', requireToken, async req => {
    const stats = await d.parts.partStats(viewOf(req));
    return { stats };
  });

  // Dieselbe Umsetzung wie für die Webapp; steht unten, damit feste Pfade vorher greifen.
  router.endpunkt('GET /api/v1/parts/:partNumber/:colorId/price-history', requireToken, async req => {
    const uid = req.apiUser.user_id;
    const currency = await d.settings.userValue(uid, 'currency', 'EUR');
    const data = await d.finanzen.priceHistoryPart(viewOf(req), req.pfad.partNumber, req.pfad.colorId, currency);
    return { ...data };
  });

  // Im Blickfeld, damit die Liste zur Teileliste passt, aus der man kommt.
  router.endpunkt('GET /api/v1/parts/:partNumber/:colorId/sets', requireToken, async req => {
    const uids = viewOf(req);
    const { item, sets } = await d.bestand.usingSets(uids, 'parts', {
      part_number: req.pfad.partNumber,
      color_id: req.pfad.colorId,
    });
    return { item, sets };
  });
  return router;
}
