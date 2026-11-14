/** Die Mount-Reihenfolge ist unkritisch: Die Module haben keine überlappenden
 * Pfad-Muster. Die Anmeldung hängt als eigener Router unter /api/v1/auth. */
import { baueSetsRouter } from './sets';
import { baueSetsLagerRouter } from './setsLager';
import { baueSetsImportRouter } from './setsImport';
import { baueSetsAnleitungenRouter } from './setsAnleitungen';
import { bauePdfRouter } from './pdf';
import { baueAcquisitionsRouter } from './acquisitions';
import { bauePartsRouter } from './parts';
import { baueMinifigsRouter } from './minifigs';
import { baueFinanceRouter } from './finance';
import { baueSettingsRouter } from './settings';
import { baueAdminRouter } from './admin';
import { baueMiscRouter } from './misc';
import { baueCatalogRouter } from './catalog';
import { baueWantedRouter } from './wanted';
import { baueVouchersRouter } from './vouchers';
import { bauePapierkorbRouter } from './papierkorb';
import { baueGeraetRouter } from './geraet';
import { baueEinrichtungRouter } from './einrichtung';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';

export function baueApiRouter(
  d: Pick<
    Dienste,
    | 'einstellungen'
    | 'mail'
    | 'auftraege'
    | 'haushalt'
    | 'konto'
    | 'katalog'
    | 'bilder'
    | 'finanzen'
    | 'bestand'
    | 'sets'
    | 'teile'
    | 'figuren'
    | 'merkliste'
    | 'gutscheine'
    | 'sammlung'
    | 'verwaltung'
  >,
) {
  const router = vertragsRouter('/api/v1');

  router.haengeEin(baueEinrichtungRouter(d)); // /einrichtung/stand — öffentlich, vor der Anmeldung
  router.haengeEin(bauePdfRouter(d)); // /sets/partslist-pdf/* (literale Pfade)
  router.haengeEin(baueSetsRouter(d)); // /sets, /sets/barcode, /sets/:setNumber/*
  router.haengeEin(baueSetsLagerRouter(d)); // /storage, /alerts, /sets/:setNumber/{storage,alert}
  router.haengeEin(baueSetsImportRouter(d)); // /sets/import/csv/*, /sets/add-stream, /sets/:setNumber/parts
  router.haengeEin(baueSetsAnleitungenRouter(d)); // /sets/:setNumber/instructions/*
  router.haengeEin(baueAcquisitionsRouter(d)); // Kaufpreis-Erfassungen für Sets/Teile/Figuren
  router.haengeEin(bauePartsRouter(d));
  router.haengeEin(baueMinifigsRouter(d));
  router.haengeEin(baueFinanceRouter(d));
  router.haengeEin(baueSettingsRouter(d)); // /settings — Einstellungen, Zugänge, Haushalt
  router.haengeEin(baueAdminRouter(d));
  router.haengeEin(baueCatalogRouter(d)); // /catalog/* — Rebrickable-Katalog (Browsen/Suchen)
  router.haengeEin(baueWantedRouter(d)); // /wanted — Merkliste (eigene Tabelle, siehe 0021)
  router.haengeEin(baueVouchersRouter(d)); // /vouchers — Gutscheine (eigene Tabelle, siehe 0026)
  router.haengeEin(bauePapierkorbRouter(d)); // /papierkorb — gelöschte Elemente (siehe 0041)
  router.haengeEin(baueGeraetRouter(d)); // /geraet — Geräteschlüssel und Schrittfreigabe der App (siehe 0103)
  router.haengeEin(baueMiscRouter(d)); // /stats + Endpoint-Übersicht unter /
  return router;
}
