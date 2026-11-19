/** The wanted list — what one WANTS to have, separate from holdings. A helper
 * instead of code in the routes, because both UIs and several entry paths
 * need the same rules. */
import type { Sicht } from '../haushalt';
import * as V from '../infra/validate';
import { fachfehler } from '../infra/fehlerTexte';
import { geldEingabe } from '../infra/geld';
import { oeffentlicherFehler } from '../infra/fehler';
import { Abstriche } from '../infra/ergebnis';
import { fuerSet } from '../katalog';
import { bildFallsVorhanden } from '../bilder';
import { toCsv, csvZeilenAusAnfrage, csvDatum } from '../infra/csvExport';
import { moeglicheSetNummer, mitVersion, normalisiereSetNummer } from '../infra/setNummer';
import type { WantedContext } from './context';

/** Each condition on its own: if BrickLink doesn't know one, the other still
 * comes through, and a missing price is a dash, not an error. */
export async function pricesForBothConditions(k: WantedContext, uid: number, setNumber: string) {
  const currency = String(await k.einstellungen.userValue(uid, 'currency', 'EUR'));
  if (!moeglicheSetNummer(mitVersion(setNumber)) || !(await k.katalog.setBekanntImKatalog(setNumber)))
    return { currency, current: {} };
  const guideType = String(await k.einstellungen.userValue(uid, 'price_guide_type', 'sold'));
  const ttlHours = String(await k.einstellungen.userValue(uid, 'price_cache_ttl', '24'));
  const current: Record<string, { condition: string; avg_price: unknown; min_price: unknown; max_price: unknown }> = {};
  // "none" after a fetch failure is not "BrickLink knows none".
  const ab = new Abstriche();
  for (const c of ['N', 'U']) {
    const pd = await ab.oder(
      `marktpreis_${c}`,
      k.finanzen.holePreis(setNumber, c, guideType, currency, ttlHours),
      null,
    );
    // A fallback price from the other condition would otherwise show as "market price (new)"; the list says "none".
    if (pd && !pd.is_fallback)
      current[c] = { condition: c, avg_price: pd.avg_price, min_price: pd.min_price, max_price: pd.max_price };
  }
  return { currency, current, ...ab.angabe() };
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
  roh: string | null | undefined,
  userId: number,
): Promise<V.Zustand> {
  return (
    V.optionalCondition(
      String(roh ?? '')
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
  aufgenommenAm?: string | null,
): Promise<{ merkposten: WantedItem | null; war_neu: boolean }> {
  const sn = normalisiereSetNummer(setNumber);
  const c = await conditionOrDefault(k, condition, userId);
  const r = await k.wanted.markSetWanted(userId, sn, c, aufgenommenAm ?? null);
  const liste = await wantedItemsOf(k, [userId], sn);
  return { merkposten: liste.find(w => w.condition === c) ?? null, war_neu: !!r?.war_neu };
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
    wiederholeBeiKonflikt: true,
  });
}

// UPDATE instead of delete-and-recreate: the added date and price alert stay.
export async function moveWantedItem(
  k: WantedContext,
  vonId: number,
  setNumber: string,
  c: V.Zustand,
  zuId: number,
): Promise<{ verschoben: boolean; zusammengefuehrt: boolean }> {
  const sn = normalisiereSetNummer(setNumber);
  if (vonId === zuId) return { verschoben: false, zusammengefuehrt: false };

  return withWantedItemLock(k, [vonId, zuId], sn, c, async t => {
    if (await t.wanted.isWanted(zuId, sn, c)) {
      const weg = await removeWantedItem(t, vonId, sn, c);
      await t.finanzen.preisalarm.loescheAlarm(vonId, sn, c);
      return { verschoben: weg > 0, zusammengefuehrt: true };
    }
    const r = await t.wanted.transferWantedEntry(zuId, vonId, sn, c);
    const verschoben = (r.changes ?? 0) > 0;
    // Only carry the alert along if the item really moved.
    if (verschoben) await t.finanzen.preisalarm.alarmUebertragen(zuId, vonId, sn, c);
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
  userIdsWahl: Sicht | number[],
  nurSet?: string,
  waehrung = 'EUR',
  filter?: WantedFilter,
): Promise<WantedItem[]> {
  const userIds = await k.haushalt.blickfeldAus(userIdsWahl);
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
    // as when storing it (src/bilder/setImages.ts).
    const lokal = bildFallsVorhanden(`/images/sets/${String(r.set_number).replace(/[^a-z0-9-]/gi, '_')}.jpg`) ?? null;
    if (!lokal && r.image_url) k.bilder.merkeGebraucht(String(r.image_url), String(r.set_number));
    return {
      ...r,
      waehrung,
      owned: !!r.owned,
      preisvergleich_url: fuerSet(r.set_number, r.name),
      image_local: lokal,
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
  leserId: number,
  besitzerId: number,
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
  const wantedCondition = await conditionOrDefault(k, condition, besitzerId);
  const zustand =
    eingabe.condition == null ? wantedCondition : await conditionOrDefault(k, eingabe.condition, besitzerId);
  const menge = V.acquisitionQuantity(eingabe.quantity ?? 1);
  const kaufpreis = geldEingabe(eingabe.purchase_price, 'Kaufpreis');

  // Record and remove together: otherwise the set would sit in holdings AND
  // still on the wanted list at the same time.
  return withWantedItemLock(k, [besitzerId], sn, wantedCondition, async t => {
    // A wanted item is being fulfilled; without it, this would be a second way to record.
    if (!(await t.wanted.isWanted(besitzerId, sn, wantedCondition))) fachfehler('nicht_gefunden', 'nicht_gefunden');
    // Already in scope means "exists", not increase; the wanted item is still done.
    const r = await t.sets.setErfassen({
      anfragender: leserId,
      besitzerWunsch: besitzerId,
      setNumber: sn,
      menge,
      kaufpreis,
      zustand,
      lagerort: eingabe.storage == null ? null : String(eingabe.storage),
    });
    // After the WANTED-ITEM's condition: this is about the entry that was fulfilled.
    await removeWantedItem(t, besitzerId, sn, wantedCondition);
    await t.finanzen.preisalarm.loescheAlarm(besitzerId, sn, wantedCondition);
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
  const { records, bereinigt, uebersprungen } = csvZeilenAusAnfrage(text);

  let added = 0,
    updated = 0,
    errors = 0;
  const results: Array<{ set_number: string; action: string; error?: string }> = [];

  for (const row of bereinigt) {
    // Last fallback: a file without a header row, first column = set number —
    // the same leniency as the minifig import.
    const setNumber = String(row.set_number || row.Setnummer || row.set_num || Object.values(row)[0] || '').trim();
    if (!setNumber) continue;

    const condition = String(row.condition || row.zustand || row.Zustand || '').trim();
    const am = csvDatum(row.created_at || row.aufgenommen_am || row['Auf der Liste seit']);

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
      results.push({ set_number: setNumber, action: 'error', error: oeffentlicherFehler(e, 'wanted-csv:zeile').error });
    }
  }
  return { added, updated, errors, records, results, uebersprungen };
}
