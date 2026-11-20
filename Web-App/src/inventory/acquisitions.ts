/** Exactly ONE row per day, element, condition, price and currency: identical
 * purchases of one day are added up. */
import { priceColumn, keyColumns } from '../../db/stockQuantity';
import * as repo from './repository/purchaseAcquisitions';
import { zustand } from '../infra/validate';
import type { InventoryContext } from './context';

export type AcquisitionKind = 'set' | 'part' | 'fig';

export interface AcquisitionInput {
  quantity: number;
  /** null = not captured. */
  price?: number | null;
  condition?: string | null;
  /** If missing, today counts. */
  createdAt?: string | null;
  /** An inserted market price, not a paid amount. */
  geschaetzt?: boolean;
  /** If missing, the database sets the account's. */
  currency?: string | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

/** @param keyValues key values in the order of SHAPES[kind].keys
 * @returns { merged } — true if an existing row was topped up */
export async function addPurchaseAtTag(
  k: InventoryContext,
  kind: AcquisitionKind,
  userId: number,
  keyValues: (string | number)[],
  input: AcquisitionInput,
): Promise<{ merged: boolean }> {
  const qty = Math.max(1, parseInt(String(input.quantity), 10) || 1);
  const price = num(input.price);
  const cond = zustand(input.condition);
  const geschaetzt = price != null && !!input.geschaetzt;

  // One statement instead of read-compute-write: concurrent acquisitions
  // add up. Merged only with the same price, origin and currency.
  const merged = await repo.addEntryAdd(k.db, kind, userId, keyValues, {
    menge: qty,
    preis: price,
    zustand: cond,
    geschaetzt,
    waehrung: input.currency ?? null,
    am: input.createdAt || null,
  });
  return { merged };
}

/** So that an edit does not fail on the unique daily index.
 * @param condition the condition the row has AFTER the edit
 * @returns the colliding id, or null */
export async function purchaseAtSameTag(
  k: InventoryContext,
  kind: AcquisitionKind,
  userId: number,
  keyValues: unknown[],
  day: string,
  excludeId: number | null,
  condition: string | null = null,
  features: { preis?: unknown; geschaetzt?: boolean; waehrung?: string | null } = {},
): Promise<number | null> {
  const cond = zustand(condition);
  return repo.sameEntryAtTag(k.db, kind, userId, keyValues, day, excludeId ?? -1, {
    zustand: cond,
    preis: num(features.preis),
    geschaetzt: !!features.geschaetzt,
    waehrung: features.waehrung ?? null,
  });
}

/** @returns {{quantity:number, amount:number|null, priced_rows:number}} */
export function acquisitionTotals(rows: { quantity?: unknown; purchase_price?: unknown; unit_price?: unknown }[]): {
  quantity: number;
  amount: number | null;
  priced_rows: number;
} {
  let quantity = 0,
    amount = 0,
    priced = 0;
  for (const r of rows || []) {
    const menge = Number(r?.quantity) || 0;
    quantity += menge;
    // purchase_price or unit_price per table — the fallback rule ONCE instead of
    // in every client.
    const roh = r?.purchase_price ?? r?.unit_price;
    const preis = roh === null || roh === undefined ? null : Number(roh);
    if (preis !== null && Number.isFinite(preis)) {
      amount += preis * menge;
      priced++;
    }
  }
  return {
    quantity,
    // Floating point would otherwise yield 33.980000000000004.
    amount: priced ? Math.round(amount * 100) / 100 : null,
    priced_rows: priced,
  };
}

type WithPrice = {
  quantity?: unknown;
  purchase_price?: unknown;
  unit_price?: unknown;
  currency?: string | null | undefined;
  created_at?: unknown;
};

/** Sum in the viewer's currency, at the rate of the purchase day as in the finances: otherwise
 * 3 × 260.66 USD would show up as euros. Without a rate the row counts in `ohne_kurs`, not in the sum. */
export async function erfassungenInKontowaehrung<T extends WithPrice>(k: InventoryContext, rows: T[], viewer: number) {
  const preise = rows.map(r => {
    const roh = r.purchase_price ?? r.unit_price;
    return roh === null || roh === undefined ? null : Number(roh);
  });
  const tage = rows.map(r => {
    const d = r.created_at ? new Date(String(r.created_at)) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
  });
  const umgerechnet = await k.kaufErfassungen.inCurrencyOfAccount(
    viewer,
    preise,
    rows.map(r => r.currency ?? null),
    tage,
  );
  const acquisitions = rows.map((r, i) => ({ ...r, preis_konto: umgerechnet.amounts[i] ?? null }));
  return {
    acquisitions,
    totals: {
      ...acquisitionTotals(acquisitions.map(a => ({ quantity: a.quantity, purchase_price: a.preis_konto }))),
      currency: umgerechnet.waehrung,
      ohne_kurs: acquisitions.filter((a, i) => preise[i] != null && a.preis_konto == null).length,
    },
  };
}

/** If an identical row already exists on the same day, the quantity moves there
 * instead of failing on the unique index.
 * @returns true if something was changed */
export async function setEstimatedPrice(
  kx: InventoryContext,
  kind: AcquisitionKind,
  id: number,
  preis: number,
): Promise<boolean> {
  return kx.transaktion(
    async t => {
      const z = await repo.lockEntry(t.db, kind, id);
      if (!z || z[priceColumn(kind)] != null) return false;
      const keys = keyColumns(kind).map(s => z[s]);
      const ziel = await purchaseAtSameTag(t, kind, z.user_id, keys, z.tag, id, z.condition, {
        preis,
        geschaetzt: true,
        waehrung: z.currency,
      });
      if (ziel) await repo.putEntryTogether(t.db, kind, id, ziel, z.quantity);
      else await repo.setPriceEstimated(t.db, kind, id, preis);
      return true;
    },
    { repeatAtConflict: true },
  ); // locks the row, then the target row: two amendments can cross
}
