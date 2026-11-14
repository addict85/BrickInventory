import { fehlerAntwort, sendeFehler } from '../../src/http/httpAntwort';
import { kontoSchranke, sichtVon, waechterFuer } from './middleware';
import { csvEmpfang } from '../../src/http/dateiEmpfang';
import type { CsvImportBericht } from '../../src/infra/csvExport';
import { normalisiereLagerort } from '../../src/bestand';
import { seiteAus } from '../../src/infra/seite';
import { Abstriche } from '../../src/infra/ergebnis';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';

export function bauePartsRouter(
  d: Pick<
    Dienste,
    'einstellungen' | 'auftraege' | 'haushalt' | 'konto' | 'katalog' | 'finanzen' | 'bestand' | 'teile' | 'sammlung'
  >,
) {
  const { requireToken } = waechterFuer(d.konto);
  const router = vertragsRouter('/api/v1');

  router.endpunkt('GET /api/v1/parts', requireToken, async req => {
    const result = await d.teile.getParts(sichtVon(req), req.abfrage);
    // page_size: der TATSÄCHLICH verwendete Wert, nicht der angefragte.
    return { page: req.abfrage.page ?? 1, ...result };
  });

  router.endpunkt('GET /api/v1/parts/categories', requireToken, async req => {
    // Dasselbe Blickfeld wie die Farbliste, sonst filtern zwei Listen derselben
    // Ansicht über verschiedene Konten.
    const uids = sichtVon(req);
    return { categories: await d.teile.getPartsCategories(uids) };
  });

  router.endpunkt(
    'POST /api/v1/parts/import/csv',
    requireToken,
    kontoSchranke('upload'),
    csvEmpfang.single('file'),
    async (req, res) => {
      if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
      return {
        ...(await d.auftraege.importAlsAuftrag<CsvImportBericht>(req.apiUser.user_id, 'teile_csv', {
          text: req.file.buffer.toString('utf-8'),
        })),
      };
    },
  );

  router.endpunkt('GET /api/v1/parts/brick-colors', requireToken, async _req => {
    const colors = await d.katalog.farbliste();
    return { colors };
  });

  router.endpunkt('POST /api/v1/parts', requireToken, async req => {
    // schreibzielOderNull prüft die RICHTUNG (Hauptkonto → eigenes Unterkonto),
    // nicht bloss die Mitgliedschaft im Blickfeld.
    const owner = await d.haushalt.schreibziel(req.apiUser.user_id, req.eingabe.owner_user_id);
    const result = await d.teile.addManualPart(owner, req.eingabe);
    return { ...result };
  });

  router.endpunkt('PUT /api/v1/parts/:partNumber/:colorId', requireToken, async req => {
    // Die Ansicht sagt, wessen Karte gemeint ist; ohne Parameter änderte das
    // Hauptkonto auf der Karte des Kindes die eigene Zeile.
    const besitzer = await d.haushalt.schreibziel(req.apiUser.user_id, req.abfrage.owner, 'kein_zugriff_konto');
    // Mit Mengenänderung trägt die Antwort die Menge danach (bei quantity_delta
    // weiss der Client sie sonst nicht).
    const r = await d.teile.updateManualPart(besitzer, req.pfad.partNumber, req.pfad.colorId, req.eingabe);
    return { ...r };
  });

  // Eigene Adresse: Die Farbe ist schon Teil der Adresse von PUT /parts/:nr/:farbe.
  router.endpunkt('PUT /api/v1/parts/:partNumber/:colorId/color', requireToken, async (req, res) => {
    const besitzer = await d.haushalt.schreibziel(req.apiUser.user_id, req.abfrage.owner, 'kein_zugriff_konto');
    // Die neue Farbe muss dastehen: V.colorId() machte aus fehlend „keine Farbe",
    // ein stilles Leeren mit Erfolgsmeldung.
    const roh = req.eingabe.color_id;
    const neueFarbe = Number(roh);
    if (roh === undefined || roh === null || neueFarbe < 0) return sendeFehler(req, res, 400, 'farbe_erforderlich');
    const ergebnis = await d.teile.aendereTeilFarbe(besitzer, req.pfad.partNumber, req.pfad.colorId, neueFarbe, {
      color_name: req.eingabe.color_name ?? null,
      color_hex: req.eingabe.color_hex ?? null,
    });
    return { ...ergebnis };
  });

  router.endpunkt('DELETE /api/v1/parts/:partNumber/:colorId', requireToken, async (req, res) => {
    // Ohne Parameter das eigene Konto — unverändert für Clients, die ihn nicht kennen.
    const besitzer = await d.haushalt.schreibziel(req.apiUser.user_id, req.abfrage.owner, 'kein_zugriff_konto');
    const geloescht = await d.sammlung.loescheTeil(besitzer, req.pfad.partNumber, req.pfad.colorId);
    if (geloescht === null) return sendeFehler(req, res, 404, 'teil_nicht_manuell');
    return { papierkorb: [geloescht] };
  });

  router.endpunkt('GET /api/v1/parts/bl-color-map', requireToken, async _req => {
    const result = await d.teile.getBlColorMap();
    return { ...result };
  });

  /** Je Teil-Farb-Paar `gesamt` (Blickfeld) und `lose` (nicht in einem Set);
   * welche Zahl gilt, entscheidet der Mensch. */
  router.endpunkt('POST /api/v1/parts/owned', requireToken, async req => {
    const teile = req.eingabe.teile ?? [];
    return { bestand: await d.teile.getOwnedQuantities(sichtVon(req), teile) };
  });

  /** Trifft ALLE Zeilen des Teil-Farb-Paares: Wer „Kiste 3" einträgt, meint das
   * Teil, nicht eine seiner Set-Zeilen. */
  router.endpunkt('PUT /api/v1/parts/:partNumber/:colorId/storage', requireToken, async req => {
    const ort = normalisiereLagerort(req.eingabe.storage);
    const n = await d.bestand.lagerortDienst.setzeLagerort(
      'part',
      { schreiber: req.apiUser.user_id },
      [req.pfad.partNumber, String(req.pfad.colorId)],
      ort,
    );
    return { storage: ort, changed: n };
  });

  router.endpunkt('GET /api/v1/parts/manual', requireToken, async req => {
    const ab = new Abstriche();
    const alle = await d.teile.getManualParts(
      sichtVon(req),
      req.apiUser.user_id,
      { search: req.abfrage.search ?? '', storage: req.abfrage.storage ?? '' },
      ab,
    );
    const { eintraege: parts, ...seite } = seiteAus(alle, req.abfrage);
    return { parts, ...seite, ...ab.angabe() };
  });

  router.endpunkt('GET /api/v1/parts/colors', requireToken, async req => {
    return { colors: await d.teile.getPartsColors(sichtVon(req)) };
  });

  router.endpunkt('GET /api/v1/parts/stats', requireToken, async req => {
    const stats = await d.teile.getPartsStats(sichtVon(req));
    return { stats };
  });

  // Dieselbe Umsetzung wie für die Webapp; steht unten, damit feste Pfade vorher greifen.
  router.endpunkt('GET /api/v1/parts/:partNumber/:colorId/price-history', requireToken, async req => {
    const uid = req.apiUser.user_id;
    const currency = await d.einstellungen.getSetting(uid, 'currency', 'EUR');
    const data = await d.finanzen.preisverlaufTeil(sichtVon(req), req.pfad.partNumber, req.pfad.colorId, currency);
    return { ...data };
  });

  // Im Blickfeld, damit die Liste zur Teileliste passt, aus der man kommt.
  router.endpunkt('GET /api/v1/parts/:partNumber/:colorId/sets', requireToken, async req => {
    const uids = sichtVon(req);
    const { item, sets } = await d.bestand.verwendendeSets(uids, 'parts', {
      part_number: req.pfad.partNumber,
      color_id: req.pfad.colorId,
    });
    return { item, sets };
  });

  router.use(fehlerAntwort);
  return router;
}
