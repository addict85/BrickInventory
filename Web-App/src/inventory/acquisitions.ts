/** Pro Tag, Element, Zustand, Preis und Währung genau EINE Zeile: Gleiche
 * Käufe eines Tages werden zusammengezählt. */
import { priceColumn, keyColumns } from '../../db/stockQuantity';
import * as repo from './repository/purchaseAcquisitions';
import { zustand } from '../infra/validate';
import type { InventoryContext } from './context';

export type AcquisitionKind = 'set' | 'part' | 'fig';

export interface AcquisitionInput {
  quantity: number;
  /** null = nicht erfasst. */
  price?: number | null;
  condition?: string | null;
  /** Fehlt er, zählt heute. */
  createdAt?: string | null;
  /** Ein eingesetzter Marktpreis, kein bezahlter Betrag. */
  geschaetzt?: boolean;
  /** Fehlt sie, setzt die Datenbank die des Kontos. */
  currency?: string | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

/** @param keyValues Schlüsselwerte in der Reihenfolge von SHAPES[kind].keys
 * @returns { merged } — true, wenn eine bestehende Zeile aufgestockt wurde */
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

  // Eine Anweisung statt Lesen-Rechnen-Schreiben: Gleichzeitige Erfassungen
  // addieren sich. Zusammengelegt nur bei gleichem Preis, Herkunft und Währung.
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

/** Damit eine Bearbeitung nicht am eindeutigen Tagesindex scheitert.
 * @param condition der Zustand, den die Zeile NACH der Bearbeitung hat
 * @returns die kollidierende id, oder null */
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
    // purchase_price oder unit_price je Tabelle — die Rückfallregel EINMAL statt
    // in jedem Client.
    const roh = r?.purchase_price ?? r?.unit_price;
    const preis = roh === null || roh === undefined ? null : Number(roh);
    if (preis !== null && Number.isFinite(preis)) {
      amount += preis * menge;
      priced++;
    }
  }
  return {
    quantity,
    // Gleitkomma liefert sonst 33.980000000000004.
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

/** Summe in der Währung des Betrachters, zum Kurs des Kauftags wie in den Finanzen: Sonst stünden
 * 3 × 260,66 USD als Euro darin. Ohne Kurs zählt die Zeile in `ohne_kurs`, nicht in der Summe. */
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

/** Gibt es am selben Tag schon eine gleiche Zeile, wandert die Menge dorthin,
 * statt am eindeutigen Index zu scheitern.
 * @returns true, wenn etwas geändert wurde */
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
  ); // sperrt die Zeile, dann die Zielzeile: zwei Nachträge können sich kreuzen
}
