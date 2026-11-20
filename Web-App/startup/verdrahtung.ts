/** Die eine Stelle, an der verdrahtet wird: Bereiche und die Klienten
 * (über src/externalSources) entstehen aus einem Datenbankzugang. Der Einstieg (server.ts, Skripte,
 * Testhilfen) hält das Ergebnis und reicht es weiter; einen Prozess-Speicher gibt es nicht. */
import path from 'node:path';
import { createJobs, type Anmeldung, type JobKind } from '../src/auftraege';
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
import { createAccount } from '../src/konto';
import { createFactors } from '../src/factors';
import { createProfile } from '../src/profile';
import { createForeignSources, type Quellen } from '../src/externalSources';
import { createSettings } from '../src/settings';
import { createThrottle } from '../src/throttle';
import { createDevices } from '../src/devices';
import { konfig, type Konfig } from '../src/infra/konfig';
import { systemClock, type Uhr } from '../src/infra/uhr';
import { LESEVERTRAG, type Dienste } from '../src/dienste';

export type { Dienste } from '../src/dienste';

/** Was ein Test statt des Echten gibt: eigenes Bildwerk, eigene Fremdquellen. */
export interface Components {
  bildwerk?: ImageWorker;
  /** Ersetzte Klienten (src/externalSources/sources.ts), gelesen beim Aufruf. */
  quellen?: Partial<Quellen>;
  /** Nur Testhilfen: Hier legt jede Fabrik ihren Kontext ab (Einblick). */
  contexts?: Record<string, unknown>;
  /** Die Konfiguration; ohne Angabe die des Prozesses (src/infra/konfig.ts). */
  konfig?: Readonly<Konfig>;
  /** Die Zeit der Dienste (k.uhr); ohne Angabe die des Systems. */
  uhr?: Uhr;
}
type Gesetzt = Components & { konfig: Readonly<Konfig>; uhr: Uhr };

// Der Katalog-Import läuft in einem eigenen Prozess; sein Einstieg liegt im Bau unter jobs/.
const IMPORT_PROCESS = path.join(__dirname, '..', 'jobs', 'csvImportWorker.js');

/** Alle Bereiche über einen Zugang, von unten nach oben: Jeder bekommt die Dienste
 * der tieferen, die er braucht, als Teil seines Kontexts. Wer einen höheren braucht,
 * horcht auf ein Ereignis des tieferen (etwa atSetImageLoaded); späte Bindung gibt es nicht. */
export function buildServices(db: Db, components: Components = {}): Dienste {
  const d = buildAreas(db, {
    ...components,
    konfig: components.konfig ?? konfig(),
    uhr: components.uhr ?? systemClock,
  });
  reportJobTypesAn(d);
  return d;
}

/** Jede deklarierte Art (JobPayloads): Der Übersetzer verlangt hier jede, der Start prüft ihre Anmeldung. */
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

/** Jeder Bereich meldet seine Auftragsarten mit Nutzlast und Ausführer; die Warteschlange kennt keine. */
function reportJobTypesAn(d: Dienste): void {
  const arten: Anmeldung[] = [
    ...d.images.auftragsarten(),
    ...d.konto.auftragsarten(),
    ...d.catalog.auftragsarten(IMPORT_PROCESS),
    ...d.finances.auftragsarten(),
    ...d.sets.auftragsarten(),
    ...d.collection.jobKinds(),
    ...d.parts.jobKinds(),
    ...d.management.jobTypes(),
  ];
  for (const a of arten) d.auftraege.reportKindAn(a);
  const angemeldet = new Set(d.auftraege.signedInKinds().map(a => a.art));
  const fehlt = Object.keys(DECLARED_KINDS).filter(a => !angemeldet.has(a as JobKind));
  if (fehlt.length) throw new KindNotSignedIn(`Auftragsart ohne Anmeldung: ${fehlt.join(', ')}`);
}

type Show = ReturnType<typeof inspectIn>;

/** Je Bereich ein Rückruf, der seinen Kontext ablegt; ohne Ablage keiner. */
function inspectIn(contexts: Record<string, unknown> | undefined) {
  return (name: string) =>
    contexts
      ? (k: unknown) => {
          contexts[name] = k;
        }
      : undefined;
}

/** Die Bereiche bis zum Katalog: Sie brauchen nur einander und den Zugang. */
function buildReason(db: Db, { bildwerk, quellen, konfig, uhr }: Gesetzt, zeige: Show) {
  const throttle = createThrottle({ db, uhr }, zeige('throttle'));
  const einstellungen = createSettings({ db, uhr, throttle, lesevertrag: LESEVERTRAG }, zeige('settings'));
  const mail = createMail({ uhr, einstellungen, konfig }, zeige('mail'));
  const auftraege = createJobs({ db, uhr, einstellungen, lesevertrag: LESEVERTRAG }, zeige('auftraege'));
  const household = createHousehold({ db, uhr, einstellungen, lesevertrag: LESEVERTRAG }, zeige('household'));
  const devices = createDevices({ db, uhr, konfig, auftraege, lesevertrag: LESEVERTRAG }, zeige('devices'));
  const factors = createFactors({ db, uhr, konfig, einstellungen }, zeige('factors'));
  const konto = createAccount(
    { db, uhr, konfig, einstellungen, auftraege, household, mail, throttle, devices, factors },
    zeige('konto'),
  );
  const profile = createProfile({ db, uhr, konfig, einstellungen, konto, mail }, zeige('profile'));
  const idempotency = createIdempotency({ db, uhr }, zeige('idempotency'));
  const externalSources = createForeignSources(
    { db, uhr, einstellungen, auftraege, ersatz: quellen },
    zeige('externalSources'),
  );
  const images = createImages(
    { db, uhr, konfig, auftraege, household, externalSources, bildwerk, lesevertrag: LESEVERTRAG },
    zeige('images'),
  );
  const catalog = createCatalog(
    { db, uhr, einstellungen, auftraege, household, externalSources, images, throttle, lesevertrag: LESEVERTRAG },
    zeige('catalog'),
  );
  // Den Eintrag beim Set macht der Katalog (höher); er horcht auf die Bilder, statt dass sie ihn rufen.
  images.atSetImageLoaded((sn, quelle) => catalog.enterSetImageLocal(sn, quelle));
  return {
    throttle,
    settings: einstellungen,
    mail,
    auftraege,
    household,
    devices,
    factors,
    konto,
    profile,
    idempotency,
    externalSources,
    images,
    catalog,
  };
}

function buildAreas(db: Db, components: Gesetzt): Dienste {
  const zeige = inspectIn(components.contexts);
  const grund = buildReason(db, components, zeige);
  const { throttle, settings: einstellungen, mail, auftraege, household, factors } = grund;
  const { konto, idempotency, externalSources, images, catalog } = grund;
  const { konfig, uhr } = components;
  const finances = createFinances(
    { db, uhr, konfig, einstellungen, auftraege, household, catalog, externalSources, mail, lesevertrag: LESEVERTRAG },
    zeige('finances'),
  );
  const inventory = createInventory(
    { db, uhr, einstellungen, household, konto, catalog, finances, lesevertrag: LESEVERTRAG },
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
      auftraege,
      inventory,
      einstellungen,
      konto,
    },
    zeige('sets'),
  );
  const parts = createParts(
    { db, uhr, einstellungen, auftraege, household, catalog, externalSources, finances, inventory },
    zeige('parts'),
  );
  const minifigs = createMinifigs(
    { db, uhr, einstellungen, household, catalog, externalSources, auftraege, finances, inventory },
    zeige('minifigs'),
  );
  const wanted = createWanted(
    { db, uhr, einstellungen, household, catalog, externalSources, images, finances, sets },
    zeige('wanted'),
  );
  const vouchers = createVouchers({ db, uhr, einstellungen, konto, externalSources, throttle }, zeige('vouchers'));
  const collection = createCollection(
    { db, uhr, household, auftraege, catalog, finances, inventory, sets, parts, minifigs, wanted },
    zeige('collection'),
  );
  const management = createManagement(
    {
      db,
      uhr,
      settings: einstellungen,
      auftraege,
      factors,
      konto,
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

/** Der Zugang des Prozesses samt Erststart, verdrahtet. Der Erststart legt das erste
 * Konto über die Dienste an, die erst nach dem Zugang entstehen. */
export function wireProcess(): { db: Db; dienste: Dienste } {
  const fertig: { d: Dienste | null } = { d: null };
  const db = createDb(dbKonfigFromEnvironment(), {
    firstStart: async () => {
      if (!fertig.d) throw new Error('Erststart vor der Verdrahtung');
      await fertig.d.konto.putStartAdminAn();
    },
  });
  fertig.d = buildServices(db);
  return { db, dienste: fertig.d };
}
