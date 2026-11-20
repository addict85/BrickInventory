/** Die Reihenfolge der Router hier ist unkritisch: Kein Pfad-Muster und keine
 * Middleware eines Routers trifft einen Pfad eines anderen (test/api-router-reihenfolge).
 * Innerhalb eines Routers zählt sie (feste Pfade vor `:setNumber` in sets.ts). */
import { buildSetsRouter } from './sets';
import { buildSetsStorageRouter } from './setsLager';
import { buildSetsImportRouter } from './setsImport';
import { buildSetsInstructionsRouter } from './setsAnleitungen';
import { buildPdfRouter } from './pdf';
import { buildAcquisitionsRouter } from './acquisitions';
import { buildPartsRouter } from './parts';
import { buildMinifigsRouter } from './minifigs';
import { buildFinanceRouter } from './finance';
import { buildSettingsRouter } from './settings';
import { buildAdminRouter } from './admin';
import { buildMiscRouter } from './misc';
import { buildCatalogRouter } from './catalog';
import { buildWantedRouter } from './wanted';
import { buildVouchersRouter } from './vouchers';
import { buildTrashRouter } from './papierkorb';
import { buildDeviceRouter } from './geraet';
import { buildSetupRouter } from './einrichtung';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';

export function buildApiRouter(
  d: Pick<
    Dienste,
    | 'settings'
    | 'mail'
    | 'auftraege'
    | 'household'
    | 'devices'
    | 'konto'
    | 'profile'
    | 'katalog'
    | 'externalSources'
    | 'images'
    | 'finances'
    | 'bestand'
    | 'sets'
    | 'parts'
    | 'minifigs'
    | 'wanted'
    | 'vouchers'
    | 'collection'
    | 'management'
  >,
) {
  const router = vertragsRouter('/api/v1');

  router.attachOne(buildSetupRouter(d)); // /einrichtung/stand (öffentlich, siehe loginAtInbox)
  router.attachOne(buildPdfRouter(d)); // /sets/partslist-pdf/*
  router.attachOne(buildSetsRouter(d)); // /sets, /sets/barcode, /sets/:setNumber/*
  router.attachOne(buildSetsStorageRouter(d)); // /storage, /alerts, /sets/:setNumber/{storage,alert}
  router.attachOne(buildSetsImportRouter(d)); // /sets/import/csv/*, /sets/add-stream, /sets/:setNumber/parts
  router.attachOne(buildSetsInstructionsRouter(d)); // /sets/:setNumber/instructions/*
  router.attachOne(buildAcquisitionsRouter(d)); // Kaufpreis-Erfassungen für Sets/Teile/Figuren
  router.attachOne(buildPartsRouter(d));
  router.attachOne(buildMinifigsRouter(d));
  router.attachOne(buildFinanceRouter(d));
  router.attachOne(buildSettingsRouter(d)); // /settings — Einstellungen, Zugänge, Haushalt
  router.attachOne(buildAdminRouter(d));
  router.attachOne(buildCatalogRouter(d)); // /catalog/* — Rebrickable-Katalog (Browsen/Suchen)
  router.attachOne(buildWantedRouter(d)); // /wanted — wanted list (own table, see 0021)
  router.attachOne(buildVouchersRouter(d)); // /vouchers — Gutscheine (eigene Tabelle, siehe 0026)
  router.attachOne(buildTrashRouter(d)); // /papierkorb — gelöschte Elemente (siehe 0041)
  router.attachOne(buildDeviceRouter(d)); // /geraet — Geräteschlüssel und Schrittfreigabe der App (siehe 0103)
  router.attachOne(buildMiscRouter(d)); // /stats + Endpoint-Übersicht unter /
  return router;
}
