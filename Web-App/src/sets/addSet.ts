/** Capturing sets: web, app, CSV, wanted XML and wishlist under the same rules. Whatever needs the
 * network (catalog, image, market price) does not hold up the request; it runs as a job. */
import { rebrickableSetImage } from '../images';
import { normalisiereSetNummer, possibleSetNumber } from '../infra/setNumber';
import { fachfehler } from '../infra/errorTexts';
import * as repo from './repository/sets';
import { versuche, valueOr } from '../infra/result';
import type { SetsContext } from './context';

/** An acquisition: one row in set_acquisitions, the only place for purchase price and condition. */
export interface Acquisition {
  konto: number;
  setNumber: string;
  menge: number;
  kaufpreis?: number | null;
  zustand?: string | null;
  /** Only with a purchase price: an estimated price without an amount would say nothing. */
  geschaetzt?: boolean;
  waehrung?: string | null;
  recordedAt?: string | null;
}

/** Call in a transaction with its context (`t`). */
export async function bookEntry(sk: SetsContext, e: Acquisition) {
  const pp = e.kaufpreis !== null && e.kaufpreis !== undefined && !Number.isNaN(e.kaufpreis) ? e.kaufpreis : null;
  const cond = e.zustand === 'N' || e.zustand === 'U' ? e.zustand : 'N';
  await sk.inventory.bookDailyEntry('set', e.konto, [e.setNumber], {
    quantity: e.menge,
    price: pp,
    condition: cond,
    geschaetzt: !!e.geschaetzt,
    currency: e.waehrung ?? null,
    createdAt: e.recordedAt ?? null,
  });
}

export interface ExistingSet {
  set_number: string;
  owner_user_id: number;
  /** Otherwise it belongs to another account in the household. */
  is_self: boolean;
}

/** In the SCOPE, not only in the own account: web app and app should treat the same
 * input the same way. No catch: null would otherwise mean "not there". */
export async function findSetInScope(
  sk: SetsContext,
  viewerId: number,
  setNumber: string,
): Promise<ExistingSet | null> {
  const sn = normalisiereSetNummer(setNumber);
  const row = await repo.setInScope(sk.db, await sk.household.scopeIds(viewerId), sn, viewerId);
  if (!row) return null;
  return { set_number: row.set_number, owner_user_id: row.user_id, is_self: row.user_id === viewerId };
}

/** For "does this already exist?": without a hit the number as it would be created. */
export async function setPresent(sk: SetsContext, viewerId: number, setNumber: string) {
  const hits = await findSetInScope(sk, viewerId, setNumber);
  return { exists: !!hits, ...(hits ?? { set_number: normalisiereSetNummer(setNumber) }) };
}

/** ergaenzen (= new): created; zweit: an existing set topped up; csv: from the CSV import. */
export type ReworkKind = 'zweit' | 'neu' | 'csv' | 'ergaenzen';

/** A number is typed, not a sentence: the lenient normalization (for CSV) would turn text into a set. */
const TYPED_NUMBER = /^[A-Za-z0-9]{1,20}(-\d{1,3})?$/;

export interface NewSet {
  requester: number;
  /** The request's wish; schreibziel() checks the direction in the household. */
  ownerWish?: unknown;
  setNumber: string;
  menge?: number;
  kaufpreis?: number | null;
  zustand?: string | null;
  lagerort?: string | null;
  recordedAt?: string | null;
  waehrung?: string | null;
  /** Typed input: only a number, not a sentence. */
  streng?: boolean;
  /** Until the job starts; the stream completes by itself and only needs it as a fallback. */
  supplementAfterSeconds?: number;
  /** An import books an account's file and tops up; typed means "in scope" exists. */
  ifPresent?: 'melden' | 'aufstocken';
  /** The CSV import only asks Brickset in the follow-up work ('csv'). */
  nacharbeit?: ReworkKind;
}

export type SetRecorded =
  | ({ action: 'exists' } & ExistingSet)
  | { action: 'updated'; set_number: string; besitzer: number }
  | {
      action: 'added';
      set_number: string;
      name: string;
      katalog_offen: boolean;
      ergaenzung: 'ausstehend';
      besitzer: number;
    };

/** THE one way to capture, without network and under the lock per set number: otherwise two
 * requests (even from two accounts in the household) would create the set twice. The job fetches the catalog. */
export async function acquireSet(sk: SetsContext, e: NewSet): Promise<SetRecorded> {
  const raw = String(e.setNumber ?? '').trim();
  if (!raw) fachfehler('ungueltig', 'set_number_erforderlich');
  if (e.streng && !TYPED_NUMBER.test(raw)) fachfehler('ungueltig', 'setnummer_ungueltig');
  const sn = normalisiereSetNummer(raw);
  if (!possibleSetNumber(sn)) fachfehler('ungueltig', 'setnummer_ungueltig');
  const besitzer = await sk.household.schreibziel(e.requester, e.ownerWish);
  const zustand = await sk.einstellungen.conditionForPrice(e.zustand ?? null, null, besitzer);
  const ort = await sk.inventory.locationService.locationForNewEntry(besitzer, e.lagerort ?? null);
  const kaufpreis = e.kaufpreis ?? null;
  const acquisition = {
    konto: besitzer,
    setNumber: sn,
    menge: e.menge ?? 1,
    kaufpreis,
    zustand,
    waehrung: kaufpreis === null ? null : (e.waehrung ?? null),
    recordedAt: e.recordedAt ?? null,
  };

  return sk.transaktion(async t => {
    await repo.addLockSet(t.db, sn, besitzer);
    const followUp = (art: ReworkKind) =>
      // In the same transaction: a created set without a job would stay without a catalog forever.
      t.jobQueue.placeOwnJobOne(
        'nacharbeit',
        { set_number: sn, user_id: besitzer, art: e.nacharbeit ?? art },
        {
          userId: besitzer,
          schluessel: `nacharbeit:${besitzer}:${sn}`,
          maxAttempts: 5,
          afterSeconds: e.supplementAfterSeconds ?? 0,
        },
      );
    if (e.ifPresent === 'aufstocken' && (await repo.setRowOfAccount(t.db, besitzer, sn))) {
      await bookEntry(t, acquisition);
      // Only a named place: the account's default would otherwise move an already sorted set.
      if (ort && e.lagerort) await t.inventory.locationService.setLocation('set', [besitzer], [sn], ort);
      await followUp('zweit');
      return { action: 'updated' as const, set_number: sn, besitzer };
    }
    if (e.ifPresent !== 'aufstocken') {
      const present = await findSetInScope(t, e.requester, sn);
      if (present) return { action: 'exists' as const, ...present };
    }
    const katalog = await t.catalog.rememberCatalogPlaceholder(sn);
    await t.inventory.putSetAn(besitzer, sn);
    await bookEntry(t, acquisition);
    if (ort) await t.inventory.locationService.setLocation('set', [besitzer], [sn], ort);
    await followUp('ergaenzen');
    return {
      action: 'added' as const,
      set_number: sn,
      name: katalog?.name ?? `Set ${sn}`,
      katalog_offen: !katalog || katalog.platzhalter,
      ergaenzung: 'ausstehend' as const,
      besitzer,
    };
  });
}

export type Progress = (n: { step: string; set: string }) => void;

/** Rebrickable, then Brickset for gaps, then the image. `disrupted`: Rebrickable
 * did not answer (unlike "does not know the number"). */
async function fetchCatalog(sk: SetsContext, sn: string, withBrickset: boolean, sendProgress: Progress | null) {
  let name: string | null = null,
    year: number | null = null,
    theme: string | null = null,
    pieces: number | null = null,
    minifigs: number | null = null,
    imageUrl: string | null = null,
    themeId: number | null = null;
  const rbResult = await versuche('set-service:setAngaben', sk.catalog.setInfo(sn));
  const rb = valueOr(rbResult, null);
  if (rb) {
    name = rb.name;
    year = rb.year;
    theme = rb.theme;
    pieces = rb.pieces;
    imageUrl = rb.image_url;
    themeId = ('theme_id' in rb ? rb.theme_id : null) ?? null;
  }
  if (withBrickset) {
    const bs = valueOr(
      await versuche('set-anlegen:brickset-info', sk.externalSources.quellen.brickset.setAngaben(sn)),
      null,
    );
    if (bs) {
      name ??= bs.name;
      year ??= bs.year;
      theme ??= bs.theme;
      pieces ??= bs.pieces;
      minifigs ??= bs.minifigs;
    }
  }
  imageUrl ??= rebrickableSetImage(sn);
  if (sendProgress) sendProgress({ step: 'image', set: sn });
  const frist = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Image timeout')), 15000).unref());
  const image = await versuche('set-anlegen:bild-laden', Promise.race([sk.images.setBildLaden(imageUrl, sn), frist]));
  const local = valueOr(image, null);
  if (local) void versuche('set-anlegen:vorschau', sk.images.createPreview(local));
  // No catch: the catalog is the only place with name, year and image.
  await sk.catalog.rememberSetCatalog(sn, name, year, theme || null, pieces, minifigs, imageUrl, local, themeId);
  return { name, disrupted: !rbResult.ok, bild: !!local };
}

/** What setErfassen(sk) left open; idempotent, so that stream and job do not
 * disturb each other. Throws as long as Rebrickable is disrupted: the job tries again later. */
export async function setSupplement(
  sk: SetsContext,
  sn: string,
  konto: number,
  sendProgress: Progress | null = null,
  withBrickset = true,
): Promise<{ name: string | null }> {
  const stand = await sk.catalog.catalogStatus(sn);
  let name = stand && !stand.platzhalter ? stand.name : null;
  if (!stand || stand.platzhalter || !stand.image_local) {
    const k = await fetchCatalog(sk, sn, withBrickset, sendProgress);
    if (k.disrupted && !k.name) throw new Error(`Katalog für ${sn} nicht erreichbar`);
    name = k.name ?? name;
  }
  for (const z of await repo.entriesWithoutPriceOfSets(sk.db, konto, sn)) {
    const price = await sk.finances.aktuellerMarktpreis(sn, konto, z.condition || null);
    if (price) await sk.inventory.setEstimatedPrice('set', z.id, price);
  }
  return { name };
}
