/** The order of the routers here is not critical: no path pattern and no
 * middleware of one router hits a path of another (test/api-router-reihenfolge).
 * Within a router it matters (fixed paths before `:setNumber` in sets.ts). */
import { buildSetsRouter } from './sets';
import { buildSetsStorageRouter } from './setsLager';
import { buildSetsImportRouter } from './setsImport';
import { buildSetsInstructionsRouter } from './setsInstructions';
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
import { buildTrashRouter } from './trash';
import { buildDeviceRouter } from './device';
import { buildSetupRouter } from './setup';
import { vertragsRouter } from '../../src/http/contractRouter';
import type { Services } from '../../src/services';

export function buildApiRouter(
  d: Pick<
    Services,
    | 'settings'
    | 'mail'
    | 'jobQueue'
    | 'household'
    | 'devices'
    | 'account'
    | 'profile'
    | 'catalog'
    | 'externalSources'
    | 'images'
    | 'finances'
    | 'inventory'
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

  router.attachOne(buildSetupRouter(d)); // /einrichtung/stand (public, see loginAtInbox)
  router.attachOne(buildPdfRouter(d)); // /sets/partslist-pdf/*
  router.attachOne(buildSetsRouter(d)); // /sets, /sets/barcode, /sets/:setNumber/*
  router.attachOne(buildSetsStorageRouter(d)); // /storage, /alerts, /sets/:setNumber/{storage,alert}
  router.attachOne(buildSetsImportRouter(d)); // /sets/import/csv/*, /sets/add-stream, /sets/:setNumber/parts
  router.attachOne(buildSetsInstructionsRouter(d)); // /sets/:setNumber/instructions/*
  router.attachOne(buildAcquisitionsRouter(d)); // purchase price acquisitions for sets/parts/minifigs
  router.attachOne(buildPartsRouter(d));
  router.attachOne(buildMinifigsRouter(d));
  router.attachOne(buildFinanceRouter(d));
  router.attachOne(buildSettingsRouter(d)); // /settings — settings, accesses, household
  router.attachOne(buildAdminRouter(d));
  router.attachOne(buildCatalogRouter(d)); // /catalog/* — Rebrickable catalog (browse/search)
  router.attachOne(buildWantedRouter(d)); // /wanted — wanted list (own table, see 0021)
  router.attachOne(buildVouchersRouter(d)); // /vouchers — vouchers (own table, see 0026)
  router.attachOne(buildTrashRouter(d)); // /papierkorb — deleted items (see 0041)
  router.attachOne(buildDeviceRouter(d)); // /geraet — the app's device key and step release (see 0103)
  router.attachOne(buildMiscRouter(d)); // /stats + endpoint overview under /
  return router;
}
