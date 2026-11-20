import type { Schreiber } from '../household';
import type { DbInterface } from '../../db/database';
import * as repo from './repository/trash';
import * as kauf from './repository/purchaseAcquisitions';
import type { PaperKind } from './repository/trash';
import type { InventoryContext } from './context';
import type { InventoryReadContract } from './readContract';
import { fachfehler, notFound } from '../infra/errorTexts';

export type Art = PaperKind;
export const RETENTION_DAYS = 30;

const ERFASSUNGEN: Record<Art, string> = {
  set: 'set_acquisitions',
  teil: 'part_acquisitions',
  figur: 'minifig_acquisitions',
};

function parameter(art: Art, userId: number, nummer: string, colorId: number | null) {
  return art === 'teil' ? [userId, nummer, colorId] : [userId, nummer];
}

/** In the deletion's transaction, BEFORE the DELETEs: if storing fails,
 * nothing is deleted either.
 * @returns the entry's id, or null if there was no master row */
export async function putInTrash(
  k: InventoryContext,
  art: Art,
  userId: number,
  nummer: string,
  colorId: number | null = null,
): Promise<number | null> {
  const p = parameter(art, userId, nummer, colorId);
  const zeilen = await repo.inventoryRows(k.db, art, p);
  const stamm = repo.tablesTheKind(art)[0] ?? '';
  if (!zeilen[stamm]?.length) return null;

  const name = await repo.bezeichnung(k.db, art, userId, nummer, colorId);
  return repo.putEntryAn(k.db, userId, art, nummer, art === 'teil' ? colorId : null, name, zeilen);
}

/** Individual purchases of a set that a quantity reduction removed: the inventory row stays, hence an
 * entry without a `sets` row. Restoring puts the quantities back (placePurchasesAgainHer).
 * @param zeilen per purchase the whole row, `quantity` = the removed quantity */
export async function putPurchasesInTrash(
  k: InventoryContext,
  userId: number,
  nummer: string,
  zeilen: Record<string, unknown>[],
): Promise<number | null> {
  if (!zeilen.length) return null;
  const name = await repo.bezeichnung(k.db, 'set', userId, nummer, null);
  const leer = Object.fromEntries(repo.tablesTheKind('set').map(t => [t, [] as unknown[]]));
  return repo.putEntryAn(k.db, userId, 'set', nummer, null, name, { ...leer, set_acquisitions: zeilen });
}

/** Back into the row the quantity came from; if it no longer exists, into an identical row of the same day
 * (the unique index allows no second one), otherwise as a new row. Without an inventory row the set has
 * gone entirely in the meantime: then restore its entry first. */
async function placePurchasesAgainHer(
  tx: DbInterface,
  l: InventoryReadContract,
  e: { user_id: number; nummer: string },
  kaeufe: Kauf[],
) {
  if (!(await repo.hatSetRow(tx, l, e.user_id, e.nummer))) return false;
  for (const k of kaeufe) {
    const menge = Number(k.quantity) || 0;
    if (await kauf.stallEntryOn(tx, 'set', Number(k.id), e.user_id, menge)) continue;
    const gleich = await kauf.sameEntryAtTag(tx, 'set', e.user_id, [e.nummer], String(k.day), -1, {
      zustand: String(k.condition ?? 'N'),
      preis: k.purchase_price == null ? null : Number(k.purchase_price),
      geschaetzt: !!k.price_estimated,
      waehrung: k.currency == null ? null : String(k.currency),
    });
    if (gleich && (await kauf.stallEntryOn(tx, 'set', gleich, e.user_id, menge))) continue;
    await repo.writeBack(tx, 'set', { set_acquisitions: [k] });
  }
  return true;
}
type Kauf = Record<string, unknown>;

export interface PapierkorbEintrag {
  id: number;
  user_id: number;
  type: Art;
  number: string;
  color_id: number | null;
  label: string | null;
  anzahl: number;
  deleted_at: string;
  endgueltig_am: string;
}

export async function listTrash(k: InventoryContext, uidsChoice: Schreiber | number[]): Promise<PapierkorbEintrag[]> {
  const uids = await k.household.writeAreaFrom(uidsChoice);
  const rows = await k.papierkorb.eintraege(uids, RETENTION_DAYS);
  return rows.map(r => {
    const erfassungen = r.rows?.[ERFASSUNGEN[r.type]] ?? [];
    const { rows: _z, ...rest } = r;
    return { ...rest, anzahl: erfassungen.reduce((s, e) => s + (Number(e.quantity) || 0), 0) };
  });
}

export type Wiederherstellung = { type: Art; number: string; user_id: number };

/** If the element exists again in the meantime, a unique index applies — then
 * nothing is changed and the entry stays. */
export async function placeAgainHer(
  k: InventoryContext,
  uidsChoice: Schreiber | number[],
  id: number,
): Promise<Wiederherstellung> {
  const uids = await k.household.writeAreaFrom(uidsChoice);
  try {
    return await k.transaktion(async (t): Promise<Wiederherstellung> => {
      const e = await repo.lockTrashEntry(t.db, id, uids);
      if (!e) notFound();
      const art = e.type as Art;
      const kaeufe = art === 'set' && !e.rows?.sets?.length ? (e.rows?.set_acquisitions ?? []) : null;
      if (kaeufe) {
        if (!(await placePurchasesAgainHer(t.db, t.lesevertrag, { user_id: e.user_id, nummer: e.number }, kaeufe)))
          notFound();
        await repo.removeTrashEntry(t.db, id);
        return { type: art, number: e.number, user_id: e.user_id };
      }
      await repo.writeBack(t.db, art, e.rows ?? {});
      await repo.removeTrashEntry(t.db, id);
      return { type: art, number: e.number, user_id: e.user_id };
    });
  } catch (err) {
    if ((err as { code?: string })?.code === '23505') fachfehler('konflikt', 'papierkorb_schon_vorhanden');
    throw err;
  }
}

export async function deleteFinal(k: InventoryContext, uidsChoice: Schreiber | number[], id: number): Promise<void> {
  const uids = await k.household.writeAreaFrom(uidsChoice);
  if (!(await k.papierkorb.removeEntryOfAccount(id, uids))) notFound();
}

export async function emptyTrash(k: InventoryContext, uidsChoice: Schreiber | number[]): Promise<number> {
  const uids = await k.household.writeAreaFrom(uidsChoice);
  return k.papierkorb.removeAll(uids);
}

export async function cleanTrashOn(k: InventoryContext): Promise<number> {
  return k.papierkorb.removeOlder(RETENTION_DAYS);
}
