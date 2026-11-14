import { fehlerAntwort, sendeFehler } from '../../src/http/httpAntwort';
import { kontoSchranke, sichtVon, waechterFuer } from './middleware';
import { normalisiereLagerort } from '../../src/bestand';
import { csvEmpfang } from '../../src/http/dateiEmpfang';
import type { CsvImportBericht } from '../../src/infra/csvExport';
import { seiteAus } from '../../src/infra/seite';
import { Abstriche } from '../../src/infra/ergebnis';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';

export function baueMinifigsRouter(
  d: Pick<
    Dienste,
    'einstellungen' | 'auftraege' | 'haushalt' | 'konto' | 'finanzen' | 'bestand' | 'figuren' | 'sammlung'
  >,
) {
  const { requireToken } = waechterFuer(d.konto);
  const router = vertragsRouter('/api/v1');

  router.endpunkt('GET /api/v1/minifigs', requireToken, async req => {
    // Ohne page_size unverändertes Verhalten — die Android-App ruft so auf.
    const r = await d.figuren.getMinifigs(sichtVon(req), req.abfrage);
    return { figs: r.figs, total: r.total };
  });

  router.endpunkt('POST /api/v1/minifigs', requireToken, async req => {
    const owner = await d.haushalt.schreibziel(req.apiUser.user_id, req.eingabe.owner_user_id);
    const result = await d.figuren.addManualFig(owner, req.eingabe);
    return { ...result };
  });

  router.endpunkt('PUT /api/v1/minifigs/:figNumber', requireToken, async req => {
    // Ohne den Parameter das eigene Konto.
    const besitzer = await d.haushalt.schreibziel(req.apiUser.user_id, req.abfrage.owner, 'kein_zugriff_konto');
    const r = await d.figuren.updateManualFig(besitzer, req.pfad.figNumber, req.eingabe);
    return { ...r };
  });

  // Trifft alle Zeilen der Figur im Schreibbereich: Gemeint ist die Figur, nicht eine Zeile.
  router.endpunkt('PUT /api/v1/minifigs/:figNumber/storage', requireToken, async req => {
    const ort = normalisiereLagerort(req.eingabe.storage);
    const n = await d.bestand.lagerortDienst.setzeLagerort(
      'fig',
      { schreiber: req.apiUser.user_id },
      [req.pfad.figNumber],
      ort,
    );
    return { storage: ort, changed: n };
  });

  router.endpunkt('DELETE /api/v1/minifigs/:figNumber', requireToken, async (req, res) => {
    // Ohne den Parameter das eigene Konto.
    const besitzer = await d.haushalt.schreibziel(req.apiUser.user_id, req.abfrage.owner, 'kein_zugriff_konto');
    const geloescht = await d.sammlung.loescheFigur(besitzer, req.pfad.figNumber);
    if (geloescht === null) return sendeFehler(req, res, 404, 'minifig_nicht_manuell');
    return { papierkorb: [geloescht] };
  });

  router.endpunkt('GET /api/v1/minifigs/manual', requireToken, async req => {
    const ab = new Abstriche();
    const alle = await d.figuren.getManualMinifigs(
      sichtVon(req),
      req.apiUser.user_id,
      { search: req.abfrage.search ?? '' },
      ab,
    );
    const { eintraege: figs, ...seite } = seiteAus(alle, req.abfrage);
    return { figs, ...seite, ...ab.angabe() };
  });

  /** Dieselbe Gruppierung wie die Liste, damit Kennzahl und Liste übereinstimmen. */
  router.endpunkt('GET /api/v1/minifigs/stats', requireToken, async req => {
    const stats = await d.figuren.getMinifigStats(sichtVon(req));
    return { stats };
  });

  router.endpunkt('GET /api/v1/minifigs/:figNumber/price-history', requireToken, async req => {
    const uid = req.apiUser.user_id;
    const currency = await d.einstellungen.getSetting(uid, 'currency', 'EUR');
    // Blickfeld: Ohne blickfeldIds() fände sich für eine Figur des Unterkontos keine Erfassung.
    const data = await d.finanzen.preisverlaufFigur(sichtVon(req), req.pfad.figNumber, currency);
    return { ...data };
  });

  router.endpunkt('GET /api/v1/minifigs/:figNumber/parts', requireToken, async req => {
    return { ...(await d.figuren.teileDerFigur(req.pfad.figNumber)) };
  });

  router.endpunkt(
    'POST /api/v1/minifigs/import/csv',
    requireToken,
    kontoSchranke('upload'),
    csvEmpfang.single('file'),
    async (req, res) => {
      if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
      return {
        ...(await d.auftraege.importAlsAuftrag<CsvImportBericht>(req.apiUser.user_id, 'figuren_csv', {
          text: req.file.buffer.toString('utf-8'),
        })),
      };
    },
  );

  // Dieselbe Abfrage wie bei Teilen (src/bestand/gemeinsam.ts), im Blickfeld des Haushalts.
  router.endpunkt('GET /api/v1/minifigs/:figNumber/sets', requireToken, async req => {
    const uids = sichtVon(req);
    const { item, sets } = await d.bestand.verwendendeSets(uids, 'minifigs', {
      fig_number: req.pfad.figNumber,
    });
    return { item, sets };
  });

  router.use(fehlerAntwort);
  return router;
}
