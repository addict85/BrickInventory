/** Die Reihenfolge der Router ist unkritisch: Kein Pfad-Muster eines Routers trifft
 * einen Pfad eines anderen. Innerhalb eines Routers zählt sie (feste Pfade vor
 * `:setNumber` in sets.ts, vor `:id` in vouchers.ts). Die Anmeldung hängt unter /api/v1/auth. */
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
  const router = vertragsRouter();

  router.use(baueEinrichtungRouter(d)); // /einrichtung/stand — öffentlich, vor der Anmeldung
  router.use(bauePdfRouter(d)); // /sets/partslist-pdf/* (literale Pfade)
  router.use(baueSetsRouter(d)); // /sets, /sets/barcode, /sets/:setNumber/*
  router.use(baueSetsLagerRouter(d)); // /storage, /alerts, /sets/:setNumber/{storage,alert}
  router.use(baueSetsImportRouter(d)); // /sets/import/csv/*, /sets/add-stream, /sets/:setNumber/parts
  router.use(baueSetsAnleitungenRouter(d)); // /sets/:setNumber/instructions/*
  router.use(baueAcquisitionsRouter(d)); // Kaufpreis-Erfassungen für Sets/Teile/Figuren
  router.use(bauePartsRouter(d));
  router.use(baueMinifigsRouter(d));
  router.use(baueFinanceRouter(d));
  router.use(baueSettingsRouter(d)); // /settings — Einstellungen, Zugänge, Haushalt
  router.use(baueAdminRouter(d));
  router.use(baueCatalogRouter(d)); // /catalog/* — Rebrickable-Katalog (Browsen/Suchen)
  router.use(baueWantedRouter(d)); // /wanted — Merkliste (eigene Tabelle, siehe 0021)
  router.use(baueVouchersRouter(d)); // /vouchers — Gutscheine (eigene Tabelle, siehe 0026)
  router.use(bauePapierkorbRouter(d)); // /papierkorb — gelöschte Elemente (siehe 0041)
  router.use(baueGeraetRouter(d)); // /geraet — Geräteschlüssel und Schrittfreigabe der App (siehe 0103)
  router.use(baueMiscRouter(d)); // /stats + Endpoint-Übersicht unter /
  return router;
}
