/** Rights and default of the storage locations: need household and account, hence via the
 * context; the places themselves (storageLocation.ts) only take an access. */
import type { InventoryContext } from './context';
import * as storages from './repository/storageLocation';
import { failDomain } from '../infra/errorTexts';
import { locationsOf, DEFAULT_KEY, type Storage } from './storageLocation';

/** Intersection instead of refusal; without a view filter, because the question is "may I?". */
export async function storageAccounts(
  k: InventoryContext,
  userRow: number,
  wish: string | number | undefined,
  write: boolean,
): Promise<number[]> {
  const wanted = String(wish ?? '')
    .split(',')
    .map(x => parseInt(x.trim(), 10))
    .filter(Number.isFinite);
  if (!wanted.length) return [userRow];
  const allowed = write ? await k.household.writeScope(userRow) : await k.household.scopeIds(userRow);
  return wanted.filter(id => allowed.includes(id));
}

/** ONE account per write call, so that every place can fail on its own; 403 without the right. */
export async function storageWriteAccount(
  k: InventoryContext,
  userRow: number,
  wish: string | number | undefined,
): Promise<number> {
  const konto = (await storageAccounts(k, userRow, wish, true))[0];
  if (konto === undefined) failDomain('verboten', 'kein_schreibrecht');
  return konto;
}

/** The stock of the requested accounts, as far as the account may see them. */
export async function locationsFor(k: InventoryContext, userRow: number, wish: string | undefined): Promise<Storage[]> {
  return locationsOf(k, await storageAccounts(k, userRow, wish, false));
}

/** `null` deletes it. A foreign place is rejected, not ignored: the
 * star would otherwise be on the wrong entry. */
export async function setDefault(k: InventoryContext, userId: number, id: number | null): Promise<Storage | null> {
  if (id === null) {
    await k.einstellungen.deleteUserSetting(userId, DEFAULT_KEY);
    return null;
  }
  const ort = await storages.locationOfAccount(k.db, id, userId);
  if (!ort) failDomain('nicht_gefunden', 'lagerort_unbekannt');
  // Via the account's settings: user_settings belongs there.
  await k.einstellungen.setUserSetting(userId, DEFAULT_KEY, String(id));
  return { id: parseInt(String(ort.id), 10), user_id: userId, name: ort.name };
}
