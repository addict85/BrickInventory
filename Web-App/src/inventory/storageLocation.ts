/** The storage location is attached to sets, parts and figures; listing and clearing are
 * therefore here once instead of per route (setting: lagerortSetzen.ts). */
import type { InventoryContext } from './context';
import * as places from './repository/storageLocation';
import type { StorageTable } from './repository/storageLocation';
import { asIds, type Sicht, type ScopeInput } from '../household';
import { failDomain } from '../infra/errorTexts';

/** Domain-wise, not technical (the column is TEXT): the name must fit on a
 * tile, and a refusal is better than a truncated name. */
export const LOCATION_MAX_CHARS = 60;

export type LagerArt = StorageTable;

/** Empty and NULL are the same: an empty text would be a place called "nothing"
 * in every selection list (db/migrations/0018-lagerort.sql). */
export function normalizeLocation(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (s.length > LOCATION_MAX_CHARS) failDomain('ungueltig', 'lagerort_zu_lang');
  return s;
}

/** `user_id`, because a list can span several accounts and the
 * UI must know whose entry it is editing. */
export interface Storage {
  id: number;
  user_id: number;
  name: string;
}

function nameOrError(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) failDomain('ungueltig', 'lagerort_leer');
  if (s.length > LOCATION_MAX_CHARS) failDomain('ungueltig', 'lagerort_zu_lang');
  return s;
}

/** Who may see whose list is decided by the household; the IDs come along. */
export async function locationsOf(k: InventoryContext, userIds: number[]): Promise<Storage[]> {
  const rows = await places.locationsTheAccounts(k.db, userIds);
  type Row = { id: string | number; user_id: string | number; name: string };
  return ((rows as Row[]) || []).map(r => ({
    id: parseInt(String(r.id), 10),
    user_id: parseInt(String(r.user_id), 10),
    name: r.name,
  }));
}

/** No error if it exists: when setting a storage location a refusal would be nonsense. */
export async function createStorage(
  k: InventoryContext,
  userId: number,
  name: string | undefined,
): Promise<{ ort: Storage; war_neu: boolean }> {
  const n = nameOrError(name);
  const isNew = await places.addLocationOne(k.db, userId, n);
  if (isNew) return { ort: { id: parseInt(String(isNew.id), 10), user_id: userId, name: isNew.name }, war_neu: true };
  const alt = await places.ortNachName(k.db, userId, n);
  // Without a hit something other than a duplicate went wrong — better a
  // refusal than a silent "already there".
  if (!alt) failDomain('intern', 'lagerort_unbekannt');
  return { ort: { id: parseInt(String(alt.id), 10), user_id: userId, name: alt.name }, war_neu: false };
}

/** The assignment is an ID; the new name thus applies everywhere immediately. */
export async function renameStorage(
  k: InventoryContext,
  userId: number,
  id: number,
  name: string | undefined,
): Promise<Storage> {
  const isNew = nameOrError(name);
  const alt = await places.ortName(k.db, id, userId);
  if (!alt) failDomain('nicht_gefunden', 'lagerort_unbekannt');
  // The refusal beforehand is easier to understand than the error at the index.
  const collision = await places.otherLocationSameNamed(k.db, userId, isNew, id);
  if (collision) failDomain('konflikt', 'lagerort_doppelt');
  await places.writeLocationNames(k.db, id, userId, isNew);
  return { id, user_id: userId, name: isNew };
}

/** Refusal as long as something is still in it: silent clearing would lose assignments
 * the deleting user did not have in view, with no way back. */
export async function deleteStorage(k: InventoryContext, userId: number, id: number): Promise<void> {
  const ort = await places.ortName(k.db, id, userId);
  if (!ort) failDomain('nicht_gefunden', 'lagerort_unbekannt');
  // All three tables, via the ID: otherwise a place could be deleted that
  // only holds figures or is assigned with a different spelling.
  const belegt = await places.locationOccupancy(k.db, k.lesevertrag, userId, id);
  if (parseInt(String(belegt?.n ?? 0), 10) > 0) failDomain('konflikt', 'lagerort_in_benutzung');
  await places.removeLocation(k.db, id, userId);
}

/** ONE query over all tables, so that not every UI merges by itself. */
export async function lagerorte(k: InventoryContext, scopeChoice: Sicht | ScopeInput) {
  const scope = await k.household.scopeFrom(scopeChoice);
  const uids = asIds(scope);
  // Grouped by NAME, on purpose: "basement" of grandfather and grandchild
  // are two stock rows, but belong together in the overview.
  const rows = await places.locationsWithInventory(k.db, k.lesevertrag, uids);
  // SUM() comes from the driver as a string; hence parseInt below.
  type Row = { ort: string; sets: string | number; teile: string | number; figuren: string | number };
  return ((rows as Row[]) || []).map(r => ({
    ort: r.ort,
    sets: parseInt(String(r.sets), 10) || 0,
    teile: parseInt(String(r.teile), 10) || 0,
    figuren: parseInt(String(r.figuren), 10) || 0,
  }));
}

/** For the default the ID counts: a renamed place stays the default. */
export const DEFAULT_KEY = 'default_storage_id';

/** Only a place of the account: a default whose place was deleted is none, and a foreign ID does not count. */
export async function defaultOf(k: InventoryContext, userId: number): Promise<Storage | null> {
  const id = Number.parseInt(String((await k.einstellungen.userValue(userId, DEFAULT_KEY)) ?? '').trim(), 10);
  const row = Number.isInteger(id) ? await places.locationOfAccount(k.db, id, userId) : undefined;
  if (!row) return null;
  return { id: parseInt(String(row.id), 10), user_id: parseInt(String(row.user_id), 10), name: row.name };
}

/** Without a place passed along the default applies — for every acquisition path. */
export async function locationForNewEntry(k: InventoryContext, userId: number, given: unknown): Promise<string | null> {
  // The length limit first: a place that is too long should be refused before anything
  // is created.
  const ort = normalizeLocation(given);
  if (ort) return ort;
  if (given !== undefined && given !== null) return null;
  return (await defaultOf(k, userId))?.name ?? null;
}
