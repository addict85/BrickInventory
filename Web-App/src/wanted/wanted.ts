/** The wanted list — what one WANTS to have, separate from holdings. A helper
 * instead of code in the routes, because both UIs and several entry paths
 * need the same rules. */
import type { Sicht } from '../household';
import * as V from '../infra/validate';
import { fachfehler } from '../infra/errorTexts';
import { moneyInput } from '../infra/geld';
import { publicError } from '../infra/error';
import { Degradations } from '../infra/result';
import { forSet } from '../catalog';
import { imageIfPresent } from '../images';
import { toCsv, csvRowsFromRequest, csvDatum } from '../infra/csvExport';
import { possibleSetNumber, withVersion, normalisiereSetNummer } from '../infra/setNumber';
import type { WantedContext } from './context';

/** Each condition on its own: if BrickLink doesn't know one, the other still
 * comes through, and a missing price is a dash, not an error. */
export async function pricesForBothConditions(k: WantedContext, uid: number, setNumber: string) {
  const currency = String(await k.einstellungen.userValue(uid, 'currency', 'EUR'));
  if (!possibleSetNumber(withVersion(setNumber)) || !(await k.catalog.setKnownInCatalog(setNumber)))
    return { currency, current: {} };
  const guideType = String(await k.einstellungen.userValue(uid, 'price_guide_type', 'sold'));
  const ttlHours = String(await k.einstellungen.userValue(uid, 'price_cache_ttl', '24'));
  const current: Record<string, { condition: string; avg_price: unknown; min_price: unknown; max_price: unknown }> = {};
  // "none" after a fetch failure is not "BrickLink knows none".
  const ab = new Degradations();
  for (const c of ['N', 'U']) {
    const pd = await ab.orElse(
      `marktpreis_${c}`,
      k.finances.fetchPrice(setNumber, c, guideType, currency, ttlHours),
      null,
    );
    // A fallback price from the other condition would otherwise show as "market price (new)"; the list says "none".
    if (pd && !pd.is_fallback)
      current[c] = { condition: c, avg_price: pd.avg_price, min_price: pd.min_price, max_price: pd.max_price };
  }
  return { currency, current, ...ab.detail() };
}

export interface WantedItem {
  set_number: string;
  condition: string;
  created_at: Date | string;
  /** In the household tree, other members' wanted items show up too. */
  user_id: number;
  /** In THIS item's condition, from the cache — null as long as none is known. */
  marktpreis: number | null;
  waehrung: string;
  /** From rb_sets, not stored itself (see migration 0021). */
  name: string | null;
  year: number | null;
  theme_id: number | null;
  num_parts: number | null;
  image_url: string | null;
  /** Local instead of CDN, because the CSP blocks third-party image sources. */
  image_local: string | null;
  owned: boolean;
  /** Travels along: an alert nobody sees anymore is forgotten. */
  alarm: { direction: string; threshold: number; triggered: boolean } | null;
  /** On the item, not the catalog: the button only needs the set number. */
  preisvergleich_url: string;
}

/** Without a value, the user's setting applies, not a hard 'N' — the mix-up once
 * booked an acquisition with the wrong price. */
export async function conditionOrDefault(
  k: WantedContext,
  raw: string | null | undefined,
  userId: number,
): Promise<V.Zustand> {
  return (
    V.optionalCondition(
      String(raw ?? '')
        .trim()
        .toUpperCase(),
    ) ?? V.zustand(await k.einstellungen.userDefaultCondition(userId))
  );
}

/** ON CONFLICT instead of checking first: two devices at once should see no error. */
export async function addWantedItem(
  k: WantedContext,
  userId: number,
  setNumber: string,
  condition: string | null | undefined,
  capturedAt?: string | null,
): Promise<{ merkposten: WantedItem | null; war_neu: boolean }> {
  const sn = normalisiereSetNummer(setNumber);
  const c = await conditionOrDefault(k, condition, userId);
  const r = await k.wanted.markSetWanted(userId, sn, c, capturedAt ?? null);
  const list = await wantedItemsOf(k, [userId], sn);
  return { merkposten: list.find(w => w.condition === c) ?? null, war_neu: !!r?.war_neu };
}

/** No error if there was none — the goal is already met. */
export async function removeWantedItem(
  k: WantedContext,
  userId: number,
  setNumber: string,
  c: V.Zustand,
): Promise<number> {
  const r = await k.wanted.removeWantedEntry(userId, normalisiereSetNummer(setNumber), c);
  return r.changes ?? 0;
}

/** Wanted-item changes read first and write several times afterward (item, alert,
 * holdings): all in one transaction, locked per account on the item. */
function withWantedItemLock<T>(
  k: WantedContext,
  konten: number[],
  sn: string,
  c: string,
  fn: (t: WantedContext) => Promise<T>,
): Promise<T> {
  return k.transaktion(fn, {
    sperren: konten.map(konto => ({ konto, schluessel: `merk:${sn}:${c}` })),
    repeatAtConflict: true,
  });
}

// UPDATE instead of delete-and-recreate: the added date and price alert stay.
export async function moveWantedItem(
  k: WantedContext,
  ofId: number,
  setNumber: string,
  c: V.Zustand,
  zuId: number,
): Promise<{ verschoben: boolean; zusammengefuehrt: boolean }> {
  const sn = normalisiereSetNummer(setNumber);
  if (ofId === zuId) return { verschoben: false, zusammengefuehrt: false };

  return withWantedItemLock(k, [ofId, zuId], sn, c, async t => {
    if (await t.wanted.isWanted(zuId, sn, c)) {
      const route = await removeWantedItem(t, ofId, sn, c);
      await t.finances.preisalarm.loescheAlarm(ofId, sn, c);
      return { verschoben: route > 0, zusammengefuehrt: true };
    }
    const r = await t.wanted.transferWantedEntry(zuId, ofId, sn, c);
    const verschoben = (r.changes ?? 0) > 0;
    // Only carry the alert along if the item really moved.
    if (verschoben) await t.finances.preisalarm.alarmTransfer(zuId, ofId, sn, c);
    return { verschoben, zusammengefuehrt: false };
  });
}

export interface WantedFilter {
  /** Number OR name, substring, case-insensitive. */
  search?: unknown;
  /** 'N' or 'U'. Anything else means: both. */
  condition?: unknown;
  /** Unknown falls back to added_desc. */
  sort?: unknown;
}

/** `userIds`: the wanted list follows the household tree like everything else. */
export async function wantedItemsOf(
  k: WantedContext,
  userIdsChoice: Sicht | number[],
  nurSet?: string,
  waehrung = 'EUR',
  filter?: WantedFilter,
): Promise<WantedItem[]> {
  const userIds = await k.household.scopeFrom(userIdsChoice);
  if (!userIds?.length) return [];
  // Unknown means "both", not "none": an emptied list would look like an empty wanted list.
  const condition = String(filter?.condition ?? '').toUpperCase();
  const rows = await k.wanted.wantedListInScope(
    userIds,
    {
      setOnly: nurSet ? normalisiereSetNummer(nurSet) : null,
      search: String(filter?.search ?? '').trim() || null,
      condition: condition === 'N' || condition === 'U' ? condition : null,
      sort: filter?.sort,
    },
    waehrung,
  );

  // Order the image here: the proxy only leaves a note for previews, but the
  // detail view asks for the full image.
  return rows.map(({ alarm_direction, alarm_threshold, alarm_triggered, ...r }) => {
    // Synchronous and cached — no filesystem access per row. Same naming rule
    // as when storing it (src/images/setImages.ts).
    const local = imageIfPresent(`/images/sets/${String(r.set_number).replace(/[^a-z0-9-]/gi, '_')}.jpg`) ?? null;
    if (!local && r.image_url) k.images.rememberUsed(String(r.image_url), String(r.set_number));
    return {
      ...r,
      waehrung,
      owned: !!r.owned,
      preisvergleich_url: forSet(r.set_number, r.name),
      image_local: local,
      alarm:
        alarm_direction == null
          ? null
          : {
              direction: alarm_direction,
              threshold: Number(alarm_threshold),
              triggered: !!alarm_triggered,
            },
    };
  });
}

/** Via setErfassen(): without network, so with removing the wanted item in one
 * transaction; the job fills in the catalog and an estimated price. */
export async function fulfillWantedItem(
  k: WantedContext,
  readerId: number,
  ownerId: number,
  setNumber: string,
  condition: V.Zustand,
  eingabe: {
    quantity?: unknown;
    purchase_price?: unknown;
    condition?: string | null | undefined;
    storage?: unknown;
  } = {},
): Promise<{ action: string; set_number: string }> {
  const sn = normalisiereSetNummer(setNumber);

  // Two conditions: `condition` is the wanted item's key, which disappears;
  // `eingabe.condition` is the one the set is recorded in.
  const wantedCondition = await conditionOrDefault(k, condition, ownerId);
  const zustand = eingabe.condition == null ? wantedCondition : await conditionOrDefault(k, eingabe.condition, ownerId);
  const menge = V.acquisitionQuantity(eingabe.quantity ?? 1);
  const kaufpreis = moneyInput(eingabe.purchase_price, 'Kaufpreis');

  // Record and remove together: otherwise the set would sit in holdings AND
  // still on the wanted list at the same time.
  return withWantedItemLock(k, [ownerId], sn, wantedCondition, async t => {
    // A wanted item is being fulfilled; without it, this would be a second way to record.
    if (!(await t.wanted.isWanted(ownerId, sn, wantedCondition))) fachfehler('nicht_gefunden', 'nicht_gefunden');
    // Already in scope means "exists", not increase; the wanted item is still done.
    const r = await t.sets.setErfassen({
      requester: readerId,
      ownerWish: ownerId,
      setNumber: sn,
      menge,
      kaufpreis,
      zustand,
      lagerort: eingabe.storage == null ? null : String(eingabe.storage),
    });
    // After the WANTED-ITEM's condition: this is about the entry that was fulfilled.
    await removeWantedItem(t, ownerId, sn, wantedCondition);
    await t.finances.preisalarm.loescheAlarm(ownerId, sn, wantedCondition);
    return r.action === 'added'
      ? { action: 'added', set_number: r.set_number, name: r.name, katalog_offen: r.katalog_offen }
      : { action: 'exists', set_number: r.set_number };
  });
}

/** Only account, set, condition and date: the view derives everything else. */
export async function wantedListCsv(k: WantedContext, uid: number): Promise<string> {
  const rows = await k.wanted.wantedListForExport(uid);

  return toCsv(['set_number', 'condition', 'created_at'], rows);
}

/** The counterpart to wantedListCsv(); runs as a job (src/collection/importJobs.ts). */
export async function importWantedListCsv(k: WantedContext, owner: number, text: string) {
  const { records, cleaned, uebersprungen } = csvRowsFromRequest(text);

  let added = 0,
    updated = 0,
    errors = 0;
  const results: Array<{ set_number: string; action: string; error?: string }> = [];

  for (const row of cleaned) {
    // Last fallback: a file without a header row, first column = set number —
    // the same leniency as the minifig import.
    const setNumber = String(row.set_number || row.Setnummer || row.set_num || Object.values(row)[0] || '').trim();
    if (!setNumber) continue;

    const condition = String(row.condition || row.zustand || row.Zustand || '').trim();
    const am = csvDatum(row.created_at || row.captured_at || row['Auf der Liste seit']);

    try {
      const { war_neu } = await addWantedItem(k, owner, setNumber, condition, am);
      if (war_neu) {
        added++;
        results.push({ set_number: setNumber, action: 'added' });
      } else {
        updated++;
        results.push({ set_number: setNumber, action: 'exists' });
      }
    } catch (e) {
      errors++;
      results.push({ set_number: setNumber, action: 'error', error: publicError(e, 'wanted-csv:zeile').error });
    }
  }
  return { added, updated, errors, records, results, uebersprungen };
}
