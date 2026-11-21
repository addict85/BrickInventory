/** Rights and default of the storage locations: need household and account, hence via the
 * context; the places themselves (storageLocation.ts) only take an access. */
import type { InventoryContext } from './context';
import * as orte from './repository/storageLocation';
import { fachfehler } from '../infra/errorTexts';
import { locationsOf, DEFAULT_KEY, type Lagerort } from './storageLocation';

/** Intersection instead of refusal; without a view filter, because the question is "may I?". */
export async function storageAccounts(
  k: InventoryContext,
  nutzer: number,
  wish: string | number | undefined,
  schreiben: boolean,
): Promise<number[]> {
  const gewuenscht = String(wish ?? '')
    .split(',')
    .map(x => parseInt(x.trim(), 10))
    .filter(Number.isFinite);
  if (!gewuenscht.length) return [nutzer];
  const erlaubt = schreiben ? await k.household.schreibbereich(nutzer) : await k.household.scopeIds(nutzer);
  return gewuenscht.filter(id => erlaubt.includes(id));
}

/** ONE account per write call, so that every place can fail on its own; 403 without the right. */
export async function lagerSchreibkonto(
  k: InventoryContext,
  nutzer: number,
  wish: string | number | undefined,
): Promise<number> {
  const konto = (await storageAccounts(k, nutzer, wish, true))[0];
  if (konto === undefined) fachfehler('verboten', 'kein_schreibrecht');
  return konto;
}

/** The stock of the requested accounts, as far as the account may see them. */
export async function locationsFor(k: InventoryContext, nutzer: number, wish: string | undefined): Promise<Lagerort[]> {
  return locationsOf(k, await storageAccounts(k, nutzer, wish, false));
}

/** `null` deletes it. A foreign place is rejected, not ignored: the
 * star would otherwise be on the wrong entry. */
export async function setDefault(k: InventoryContext, userId: number, id: number | null): Promise<Lagerort | null> {
  if (id === null) {
    await k.einstellungen.deleteUserSetting(userId, DEFAULT_KEY);
    return null;
  }
  const ort = await orte.locationOfAccount(k.db, id, userId);
  if (!ort) fachfehler('nicht_gefunden', 'lagerort_unbekannt');
  // Via the account's settings: user_settings belongs there.
  await k.einstellungen.setUserSetting(userId, DEFAULT_KEY, String(id));
  return { id: parseInt(String(ort.id), 10), user_id: userId, name: ort.name };
}
