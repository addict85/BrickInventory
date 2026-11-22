/** THE one place where wiring happens: areas and the clients
 * (via src/externalSources) arise from one database access. The entry point (server.ts, scripts,
 * test helpers) holds the result and passes it on; there is no process store. */
import path from 'node:path';
import { createJobs, type Login, type JobKind } from '../src/jobQueue';
import { dbConfigFromEnvironment, createDb, type Db } from '../db/database';
import { createSets } from '../src/sets';
import { createHousehold } from '../src/household';
import { createMail } from '../src/mail';
import { createIdempotency } from '../src/idempotency';
import { createInventory } from '../src/inventory';
import { createParts } from '../src/parts';
import { createMinifigs } from '../src/minifigs';
import { createWanted } from '../src/wanted';
import { createVouchers } from '../src/vouchers';
import { createCollection } from '../src/collection';
import { createManagement } from '../src/management';
import { createCatalog } from '../src/catalog';
import { type ImageWorker, createImages } from '../src/images';
import { createFinances } from '../src/finances';
import { createAccount } from '../src/account';
import { createFactors } from '../src/factors';
import { createProfile } from '../src/profile';
import { createForeignSources, type Sources } from '../src/externalSources';
import { createSettings } from '../src/settings';
import { createThrottle } from '../src/throttle';
import { createDevices } from '../src/devices';
import { config, type AppConfig } from '../src/infra/config';
import { systemClock, type Clock } from '../src/infra/clock';
import { LESEVERTRAG, type Services } from '../src/services';

export type { Services } from '../src/services';

/** What a test provides instead of the real thing: own image works, own external sources. */
export interface Components {
  bildwerk?: ImageWorker;
  /** Replaced clients (src/externalSources/sources.ts), read at call time. */
  sources?: Partial<Sources>;
  /** Test helpers only: every factory stores its context here (insight). */
  contexts?: Record<string, unknown>;
  /** The configuration; without a value that of the process (src/infra/config.ts). */
  config?: Readonly<AppConfig>;
  /** The services' time (k.uhr); without a value that of the system. */
  clock?: Clock;
}
type Assigned = Components & { config: Readonly<AppConfig>; clock: Clock };

// The catalog import runs in a process of its own; its entry point lives in the build under jobs/.
const IMPORT_PROCESS = path.join(__dirname, '..', 'jobs', 'csvImportWorker.js');

/** All areas over one access, from bottom to top: each gets the services
 * of the lower ones it needs as part of its context. Whoever needs a higher one
 * listens to an event of the lower one (e.g. atSetImageLoaded); there is no late binding. */
export function buildServices(db: Db, components: Components = {}): Services {
  const d = buildAreas(db, {
    ...components,
    config: components.config ?? config(),
    clock: components.clock ?? systemClock,
  });
  registerJobTypes(d);
  return d;
}

/** Every declared kind (JobPayloads): the compiler requires each here, startup checks their registration. */
export const DECLARED_KINDS: Record<JobKind, true> = {
  account_files: true,
  brickset: true,
  catalog_followup: true,
  cleanup: true,
  cleanup_daily: true,
  csv_import: true,
  csv_sync: true,
  exchange_rates: true,
  followup: true,
  image_demand: true,
  image_followup: true,
  images: true,
  images_reload: true,
  instructions: true,
  pdf: true,
  price_refresh: true,
  prices: true,
  revocation_list: true,
  rework: true,
};

export class KindNotSignedIn extends Error {}

/** Every area registers its job kinds with payload and executor; the queue knows none. */
function registerJobTypes(d: Services): void {
  const kinds: Login[] = [
    ...d.images.jobKinds(),
    ...d.account.jobKinds(),
    ...d.catalog.jobKinds(IMPORT_PROCESS),
    ...d.finances.jobKinds(),
    ...d.sets.jobKinds(),
    ...d.collection.jobKinds(),
    ...d.parts.jobKinds(),
    ...d.management.jobTypes(),
  ];
  for (const a of kinds) d.jobQueue.registerKind(a);
  const signedIn = new Set(d.jobQueue.signedInKinds().map(a => a.kind));
  const isMissing = Object.keys(DECLARED_KINDS).filter(a => !signedIn.has(a as JobKind));
  if (isMissing.length) throw new KindNotSignedIn(`Auftragsart ohne Anmeldung: ${isMissing.join(', ')}`);
}

type Show = ReturnType<typeof inspectIn>;

/** One callback per area that stores its context; without storage none. */
function inspectIn(contexts: Record<string, unknown> | undefined) {
  return (name: string) =>
    contexts
      ? (k: unknown) => {
          contexts[name] = k;
        }
      : undefined;
}

/** The areas up to the catalog: they only need each other and the access. */
function buildRationale(db: Db, { bildwerk, sources, config, clock }: Assigned, zeige: Show) {
  const throttle = createThrottle({ db, clock }, zeige('throttle'));
  const settings = createSettings({ db, clock, throttle, readContract: LESEVERTRAG }, zeige('settings'));
  const mail = createMail({ clock, settings, config }, zeige('mail'));
  const jobQueue = createJobs({ db, clock, settings, readContract: LESEVERTRAG }, zeige('jobQueue'));
  const household = createHousehold({ db, clock, settings, readContract: LESEVERTRAG }, zeige('household'));
  const devices = createDevices({ db, clock, config, jobQueue, readContract: LESEVERTRAG }, zeige('devices'));
  const factors = createFactors({ db, clock, config, settings }, zeige('factors'));
  const account = createAccount(
    { db, clock, config, settings, jobQueue, household, mail, throttle, devices, factors },
    zeige('account'),
  );
  const profile = createProfile({ db, clock, config, settings, account, mail }, zeige('profile'));
  const idempotency = createIdempotency({ db, clock }, zeige('idempotency'));
  const externalSources = createForeignSources(
    { db, clock, settings, jobQueue, ersatz: sources },
    zeige('externalSources'),
  );
  const images = createImages(
    { db, clock, config, jobQueue, household, externalSources, bildwerk, readContract: LESEVERTRAG },
    zeige('images'),
  );
  const catalog = createCatalog(
    { db, clock, settings, jobQueue, household, externalSources, images, throttle, readContract: LESEVERTRAG },
    zeige('catalog'),
  );
  // The entry on the set is made by the catalog (higher); it listens to the images instead of them calling it.
  images.atSetImageLoaded((sn, source) => catalog.enterSetImageLocal(sn, source));
  return {
    throttle,
    settings: settings,
    mail,
    jobQueue,
    household,
    devices,
    factors,
    account,
    profile,
    idempotency,
    externalSources,
    images,
    catalog,
  };
}

function buildAreas(db: Db, components: Assigned): Services {
  const zeige = inspectIn(components.contexts);
  const reason = buildRationale(db, components, zeige);
  const { throttle, settings, mail, jobQueue, household, factors } = reason;
  const { account, idempotency, externalSources, images, catalog } = reason;
  const { config, clock } = components;
  const finances = createFinances(
    { db, clock, config, settings, jobQueue, household, catalog, externalSources, mail, readContract: LESEVERTRAG },
    zeige('finances'),
  );
  const inventory = createInventory(
    { db, clock, settings, household, account, catalog, finances, readContract: LESEVERTRAG },
    zeige('inventory'),
  );
  const sets = createSets(
    {
      db,
      clock,
      config,
      catalog,
      externalSources,
      images,
      finances,
      household,
      jobQueue,
      inventory,
      settings,
      account,
    },
    zeige('sets'),
  );
  const parts = createParts(
    { db, clock, settings, jobQueue, household, catalog, externalSources, finances, inventory },
    zeige('parts'),
  );
  const minifigs = createMinifigs(
    { db, clock, settings, household, catalog, externalSources, jobQueue, finances, inventory },
    zeige('minifigs'),
  );
  const wanted = createWanted(
    { db, clock, settings, household, catalog, externalSources, images, finances, sets },
    zeige('wanted'),
  );
  const vouchers = createVouchers({ db, clock, settings, account, externalSources, throttle }, zeige('vouchers'));
  const collection = createCollection(
    { db, clock, household, jobQueue, catalog, finances, inventory, sets, parts, minifigs, wanted },
    zeige('collection'),
  );
  const management = createManagement(
    {
      db,
      clock,
      settings: settings,
      jobQueue,
      factors,
      account,
      idempotency,
      catalog,
      externalSources,
      images,
      finances,
      inventory,
      sets,
      wanted,
      vouchers,
      mail,
    },
    zeige('management'),
  );
  return { ...reason, finances, inventory, sets, parts, minifigs, wanted, vouchers, collection, management };
}

/** The process's access including the first start, wired. The first start creates the first
 * account via the services that only arise after the access. */
export function wireProcess(): { db: Db; dienste: Services } {
  const finished: { d: Services | null } = { d: null };
  const db = createDb(dbConfigFromEnvironment(), {
    firstStart: async () => {
      if (!finished.d) throw new Error('Erststart vor der Verdrahtung');
      await finished.d.account.createStartAdmin();
    },
  });
  finished.d = buildServices(db);
  return { db, dienste: finished.d };
}
