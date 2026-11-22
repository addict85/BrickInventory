/** THE one place where wiring happens: areas and the clients
 * (via src/externalSources) arise from one database access. The entry point (server.ts, scripts,
 * test helpers) holds the result and passes it on; there is no process store. */
import path from 'node:path';
import { createJobs, type Anmeldung, type JobKind } from '../src/jobQueue';
import { dbKonfigFromEnvironment, createDb, type Db } from '../db/database';
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
import { createForeignSources, type Quellen } from '../src/externalSources';
import { createSettings } from '../src/settings';
import { createThrottle } from '../src/throttle';
import { createDevices } from '../src/devices';
import { konfig, type Konfig } from '../src/infra/config';
import { systemClock, type Clock } from '../src/infra/clock';
import { LESEVERTRAG, type Services } from '../src/services';

export type { Services as Dienste } from '../src/services';

/** What a test provides instead of the real thing: own image works, own external sources. */
export interface Components {
  bildwerk?: ImageWorker;
  /** Replaced clients (src/externalSources/sources.ts), read at call time. */
  quellen?: Partial<Quellen>;
  /** Test helpers only: every factory stores its context here (insight). */
  contexts?: Record<string, unknown>;
  /** The configuration; without a value that of the process (src/infra/config.ts). */
  konfig?: Readonly<Konfig>;
  /** The services' time (k.uhr); without a value that of the system. */
  uhr?: Clock;
}
type Assigned = Components & { konfig: Readonly<Konfig>; uhr: Clock };

// The catalog import runs in a process of its own; its entry point lives in the build under jobs/.
const IMPORT_PROCESS = path.join(__dirname, '..', 'jobs', 'csvImportWorker.js');

/** All areas over one access, from bottom to top: each gets the services
 * of the lower ones it needs as part of its context. Whoever needs a higher one
 * listens to an event of the lower one (e.g. atSetImageLoaded); there is no late binding. */
export function buildServices(db: Db, components: Components = {}): Services {
  const d = buildAreas(db, {
    ...components,
    konfig: components.konfig ?? konfig(),
    uhr: components.uhr ?? systemClock,
  });
  registerJobTypes(d);
  return d;
}

/** Every declared kind (JobPayloads): the compiler requires each here, startup checks their registration. */
export const DECLARED_KINDS: Record<JobKind, true> = {
  anleitung: true,
  aufraeumen: true,
  aufraeumen_taeglich: true,
  bild_nachlauf: true,
  bildbedarf: true,
  bilder: true,
  bilder_neu_laden: true,
  brickset: true,
  csv_import: true,
  csv_sync: true,
  katalog_nachzug: true,
  konto_dateien: true,
  nacharbeit: true,
  nachlauf: true,
  pdf: true,
  preise: true,
  preise_nachladen: true,
  wechselkurse: true,
  widerrufsliste: true,
};

export class KindNotSignedIn extends Error {}

/** Every area registers its job kinds with payload and executor; the queue knows none. */
function registerJobTypes(d: Services): void {
  const kinds: Anmeldung[] = [
    ...d.images.auftragsarten(),
    ...d.account.auftragsarten(),
    ...d.catalog.auftragsarten(IMPORT_PROCESS),
    ...d.finances.auftragsarten(),
    ...d.sets.auftragsarten(),
    ...d.collection.jobKinds(),
    ...d.parts.jobKinds(),
    ...d.management.jobTypes(),
  ];
  for (const a of kinds) d.jobQueue.reportKindAn(a);
  const signedIn = new Set(d.jobQueue.signedInKinds().map(a => a.art));
  const fehlt = Object.keys(DECLARED_KINDS).filter(a => !signedIn.has(a as JobKind));
  if (fehlt.length) throw new KindNotSignedIn(`Auftragsart ohne Anmeldung: ${fehlt.join(', ')}`);
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
function buildRationale(db: Db, { bildwerk, quellen, konfig, uhr }: Assigned, zeige: Show) {
  const throttle = createThrottle({ db, uhr }, zeige('throttle'));
  const einstellungen = createSettings({ db, uhr, throttle, lesevertrag: LESEVERTRAG }, zeige('settings'));
  const mail = createMail({ uhr, einstellungen, konfig }, zeige('mail'));
  const jobQueue = createJobs({ db, uhr, einstellungen, lesevertrag: LESEVERTRAG }, zeige('jobQueue'));
  const household = createHousehold({ db, uhr, einstellungen, lesevertrag: LESEVERTRAG }, zeige('household'));
  const devices = createDevices({ db, uhr, konfig, jobQueue, lesevertrag: LESEVERTRAG }, zeige('devices'));
  const factors = createFactors({ db, uhr, konfig, einstellungen }, zeige('factors'));
  const account = createAccount(
    { db, uhr, konfig, einstellungen, jobQueue, household, mail, throttle, devices, factors },
    zeige('account'),
  );
  const profile = createProfile({ db, uhr, konfig, einstellungen, account, mail }, zeige('profile'));
  const idempotency = createIdempotency({ db, uhr }, zeige('idempotency'));
  const externalSources = createForeignSources(
    { db, uhr, einstellungen, jobQueue, ersatz: quellen },
    zeige('externalSources'),
  );
  const images = createImages(
    { db, uhr, konfig, jobQueue, household, externalSources, bildwerk, lesevertrag: LESEVERTRAG },
    zeige('images'),
  );
  const catalog = createCatalog(
    { db, uhr, einstellungen, jobQueue, household, externalSources, images, throttle, lesevertrag: LESEVERTRAG },
    zeige('catalog'),
  );
  // The entry on the set is made by the catalog (higher); it listens to the images instead of them calling it.
  images.atSetImageLoaded((sn, source) => catalog.enterSetImageLocal(sn, source));
  return {
    throttle,
    settings: einstellungen,
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
  const grund = buildRationale(db, components, zeige);
  const { throttle, settings: einstellungen, mail, jobQueue, household, factors } = grund;
  const { account, idempotency, externalSources, images, catalog } = grund;
  const { konfig, uhr } = components;
  const finances = createFinances(
    { db, uhr, konfig, einstellungen, jobQueue, household, catalog, externalSources, mail, lesevertrag: LESEVERTRAG },
    zeige('finances'),
  );
  const inventory = createInventory(
    { db, uhr, einstellungen, household, account, catalog, finances, lesevertrag: LESEVERTRAG },
    zeige('inventory'),
  );
  const sets = createSets(
    {
      db,
      uhr,
      konfig,
      catalog,
      externalSources,
      images,
      finances,
      household,
      jobQueue,
      inventory,
      einstellungen,
      account,
    },
    zeige('sets'),
  );
  const parts = createParts(
    { db, uhr, einstellungen, jobQueue, household, catalog, externalSources, finances, inventory },
    zeige('parts'),
  );
  const minifigs = createMinifigs(
    { db, uhr, einstellungen, household, catalog, externalSources, jobQueue, finances, inventory },
    zeige('minifigs'),
  );
  const wanted = createWanted(
    { db, uhr, einstellungen, household, catalog, externalSources, images, finances, sets },
    zeige('wanted'),
  );
  const vouchers = createVouchers({ db, uhr, einstellungen, account, externalSources, throttle }, zeige('vouchers'));
  const collection = createCollection(
    { db, uhr, household, jobQueue, catalog, finances, inventory, sets, parts, minifigs, wanted },
    zeige('collection'),
  );
  const management = createManagement(
    {
      db,
      uhr,
      settings: einstellungen,
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
  return { ...grund, finances, inventory, sets, parts, minifigs, wanted, vouchers, collection, management };
}

/** The process's access including the first start, wired. The first start creates the first
 * account via the services that only arise after the access. */
export function wireProcess(): { db: Db; dienste: Services } {
  const finished: { d: Services | null } = { d: null };
  const db = createDb(dbKonfigFromEnvironment(), {
    firstStart: async () => {
      if (!finished.d) throw new Error('Erststart vor der Verdrahtung');
      await finished.d.account.putStartAdminAn();
    },
  });
  finished.d = buildServices(db);
  return { db, dienste: finished.d };
}
