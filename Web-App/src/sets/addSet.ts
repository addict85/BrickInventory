/** Capturing sets: web, app, CSV, wanted XML and wishlist under the same rules. Whatever needs the
 * network (catalog, image, market price) does not hold up the request; it runs as a job. */
import { rebrickableSetImage } from '../images';
import { normalizeSetNumber, possibleSetNumber } from '../infra/setNumber';
import { failDomain } from '../infra/errorTexts';
import * as repo from './repository/sets';
import { attempts, valueOr } from '../infra/result';
import type { SetsContext } from './context';

/** An acquisition: one row in set_acquisitions, the only place for purchase price and condition. */
export interface Acquisition {
  account: number;
  setNumber: string;
  quantity: number;
  purchasePrice?: number | null;
  condition?: string | null;
  /** Only with a purchase price: an estimated price without an amount would say nothing. */
  estimated?: boolean;
  currency?: string | null;
  recordedAt?: string | null;
}

/** Call in a transaction with its context (`t`). */
export async function bookEntry(sk: SetsContext, e: Acquisition) {
  const pp =
    e.purchasePrice !== null && e.purchasePrice !== undefined && !Number.isNaN(e.purchasePrice)
      ? e.purchasePrice
      : null;
  const cond = e.condition === 'N' || e.condition === 'U' ? e.condition : 'N';
  await sk.inventory.bookDailyEntry('set', e.account, [e.setNumber], {
    quantity: e.quantity,
    price: pp,
    condition: cond,
    estimated: !!e.estimated,
    currency: e.currency ?? null,
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
  const sn = normalizeSetNumber(setNumber);
  const row = await repo.setInScope(sk.db, await sk.household.scopeIds(viewerId), sn, viewerId);
  if (!row) return null;
  return { set_number: row.set_number, owner_user_id: row.user_id, is_self: row.user_id === viewerId };
}

/** For "does this already exist?": without a hit the number as it would be created. */
export async function setPresent(sk: SetsContext, viewerId: number, setNumber: string) {
  const hits = await findSetInScope(sk, viewerId, setNumber);
  return { exists: !!hits, ...(hits ?? { set_number: normalizeSetNumber(setNumber) }) };
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
  quantity?: number;
  purchasePrice?: number | null;
  condition?: string | null;
  storage?: string | null;
  recordedAt?: string | null;
  currency?: string | null;
  /** Typed input: only a number, not a sentence. */
  strict?: boolean;
  /** Until the job starts; the stream completes by itself and only needs it as a fallback. */
  supplementAfterSeconds?: number;
  /** An import books an account's file and tops up; typed means "in scope" exists. */
  ifPresent?: 'melden' | 'aufstocken';
  /** The CSV import only asks Brickset in the follow-up work ('csv'). */
  rework?: ReworkKind;
}

export type SetRecorded =
  | ({ action: 'exists' } & ExistingSet)
  | { action: 'updated'; set_number: string; owner: number }
  | {
      action: 'added';
      set_number: string;
      name: string;
      catalog_pending: boolean;
      supplement: 'pending';
      owner: number;
    };

/** THE one way to capture, without network and under the lock per set number: otherwise two
 * requests (even from two accounts in the household) would create the set twice. The job fetches the catalog. */
export async function acquireSet(sk: SetsContext, e: NewSet): Promise<SetRecorded> {
  const raw = String(e.setNumber ?? '').trim();
  if (!raw) failDomain('invalid', 'set_number_required');
  if (e.strict && !TYPED_NUMBER.test(raw)) failDomain('invalid', 'set_number_invalid');
  const sn = normalizeSetNumber(raw);
  if (!possibleSetNumber(sn)) failDomain('invalid', 'set_number_invalid');
  const owner = await sk.household.writeTarget(e.requester, e.ownerWish);
  const condition = await sk.settings.conditionForPrice(e.condition ?? null, null, owner);
  const location = await sk.inventory.locationService.locationForNewEntry(owner, e.storage ?? null);
  const purchasePrice = e.purchasePrice ?? null;
  const acquisition = {
    account: owner,
    setNumber: sn,
    quantity: e.quantity ?? 1,
    purchasePrice,
    condition,
    currency: purchasePrice === null ? null : (e.currency ?? null),
    recordedAt: e.recordedAt ?? null,
  };

  return sk.transact(async t => {
    await repo.addLockSet(t.db, sn, owner);
    const followUp = (kind: ReworkKind) =>
      // In the same transaction: a created set without a job would stay without a catalog forever.
      t.jobQueue.placeOwnJobOne(
        'rework',
        { set_number: sn, user_id: owner, kind: e.rework ?? kind },
        {
          userId: owner,
          key: `rework:${owner}:${sn}`,
          maxAttempts: 5,
          afterSeconds: e.supplementAfterSeconds ?? 0,
        },
      );
    if (e.ifPresent === 'aufstocken' && (await repo.setRowOfAccount(t.db, owner, sn))) {
      await bookEntry(t, acquisition);
      // Only a named place: the account's default would otherwise move an already sorted set.
      if (location && e.storage) await t.inventory.locationService.setLocation('set', [owner], [sn], location);
      await followUp('zweit');
      return { action: 'updated' as const, set_number: sn, owner };
    }
    if (e.ifPresent !== 'aufstocken') {
      const present = await findSetInScope(t, e.requester, sn);
      if (present) return { action: 'exists' as const, ...present };
    }
    const catalog = await t.catalog.rememberCatalogPlaceholder(sn);
    await t.inventory.createSet(owner, sn);
    await bookEntry(t, acquisition);
    if (location) await t.inventory.locationService.setLocation('set', [owner], [sn], location);
    await followUp('ergaenzen');
    return {
      action: 'added' as const,
      set_number: sn,
      name: catalog?.name ?? `Set ${sn}`,
      catalog_pending: !catalog || catalog.placeholder,
      supplement: 'pending' as const,
      owner,
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
  const rbResult = await attempts('set-service:setAngaben', sk.catalog.setInfo(sn));
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
      await attempts('set-anlegen:brickset-info', sk.externalSources.sources.brickset.setDetails(sn)),
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
  const deadline = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Image timeout')), 15000).unref());
  const image = await attempts(
    'set-anlegen:bild-laden',
    Promise.race([sk.images.loadSetImage(imageUrl, sn), deadline]),
  );
  const local = valueOr(image, null);
  if (local) void attempts('set-anlegen:vorschau', sk.images.createPreview(local));
  // No catch: the catalog is the only place with name, year and image.
  await sk.catalog.rememberSetCatalog(sn, name, year, theme || null, pieces, minifigs, imageUrl, local, themeId);
  return { name, disrupted: !rbResult.ok, image: !!local };
}

/** What setErfassen(sk) left open; idempotent, so that stream and job do not
 * disturb each other. Throws as long as Rebrickable is disrupted: the job tries again later. */
export async function setSupplement(
  sk: SetsContext,
  sn: string,
  account: number,
  sendProgress: Progress | null = null,
  withBrickset = true,
): Promise<{ name: string | null }> {
  const state = await sk.catalog.catalogStatus(sn);
  let name = state && !state.placeholder ? state.name : null;
  if (!state || state.placeholder || !state.image_local) {
    const k = await fetchCatalog(sk, sn, withBrickset, sendProgress);
    if (k.disrupted && !k.name) throw new Error(`Katalog für ${sn} nicht erreichbar`);
    name = k.name ?? name;
  }
  for (const z of await repo.entriesWithoutPriceOfSets(sk.db, account, sn)) {
    const price = await sk.finances.currentMarketPrice(sn, account, z.condition || null);
    if (price) await sk.inventory.setEstimatedPrice('set', z.id, price);
  }
  return { name };
}
