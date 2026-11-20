/** Der Lagerort hängt an Sets, Teilen und Figuren; auflisten und räumen stehen
 * deshalb einmal hier statt je Route (setzen: lagerortSetzen.ts). */
import type { InventoryContext } from './context';
import * as orte from './repository/storageLocation';
import type { StorageTable } from './repository/storageLocation';
import { asIds, type Sicht, type ScopeInput } from '../household';
import { fachfehler } from '../infra/errorTexts';

/** Fachlich, nicht technisch (die Spalte ist TEXT): Der Name muss auf eine
 * Kachel passen, und eine Absage ist besser als ein abgeschnittener Name. */
export const LOCATION_MAX_CHARS = 60;

export type LagerArt = StorageTable;

/** Leer und NULL sind dasselbe: Ein leerer Text wäre ein Ort namens „nichts"
 * in jeder Auswahlliste (db/migrations/0018-lagerort.sql). */
export function normalizeLocation(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (s.length > LOCATION_MAX_CHARS) fachfehler('ungueltig', 'lagerort_zu_lang');
  return s;
}

/** `user_id`, weil eine Liste über mehrere Konten spannen kann und die
 * Oberfläche wissen muss, wessen Eintrag sie bearbeitet. */
export interface Lagerort {
  id: number;
  user_id: number;
  name: string;
}

function nameOrError(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) fachfehler('ungueltig', 'lagerort_leer');
  if (s.length > LOCATION_MAX_CHARS) fachfehler('ungueltig', 'lagerort_zu_lang');
  return s;
}

/** Wer wessen Liste sehen darf, entscheidet der Haushalt; die IDs kommen mit. */
export async function locationsOf(k: InventoryContext, userIds: number[]): Promise<Lagerort[]> {
  const rows = await orte.locationsTheAccounts(k.db, userIds);
  type Zeile = { id: string | number; user_id: string | number; name: string };
  return ((rows as Zeile[]) || []).map(r => ({
    id: parseInt(String(r.id), 10),
    user_id: parseInt(String(r.user_id), 10),
    name: r.name,
  }));
}

/** Kein Fehler, wenn es ihn gibt: Beim Setzen eines Lagerorts wäre die Absage Unfug. */
export async function putLocationAn(
  k: InventoryContext,
  userId: number,
  name: string | undefined,
): Promise<{ ort: Lagerort; war_neu: boolean }> {
  const n = nameOrError(name);
  const neu = await orte.addLocationOne(k.db, userId, n);
  if (neu) return { ort: { id: parseInt(String(neu.id), 10), user_id: userId, name: neu.name }, war_neu: true };
  const alt = await orte.ortNachName(k.db, userId, n);
  // Ohne Treffer ging etwas anderes schief als ein Duplikat — lieber eine
  // Absage als ein stilles „schon da".
  if (!alt) fachfehler('intern', 'lagerort_unbekannt');
  return { ort: { id: parseInt(String(alt.id), 10), user_id: userId, name: alt.name }, war_neu: false };
}

/** Die Zuordnung ist eine ID; der neue Name gilt damit überall sofort. */
export async function benenneOrtUm(
  k: InventoryContext,
  userId: number,
  id: number,
  name: string | undefined,
): Promise<Lagerort> {
  const neu = nameOrError(name);
  const alt = await orte.ortName(k.db, id, userId);
  if (!alt) fachfehler('nicht_gefunden', 'lagerort_unbekannt');
  // Die Absage vorher ist verständlicher als der Fehler am Index.
  const collision = await orte.otherLocationSameNamed(k.db, userId, neu, id);
  if (collision) fachfehler('konflikt', 'lagerort_doppelt');
  await orte.writeLocationNames(k.db, id, userId, neu);
  return { id, user_id: userId, name: neu };
}

/** Absage, solange noch etwas darin liegt: Stilles Leeren verlöre Zuordnungen,
 * die der Löschende nicht im Blick hatte, ohne Weg zurück. */
export async function loescheOrt(k: InventoryContext, userId: number, id: number): Promise<void> {
  const ort = await orte.ortName(k.db, id, userId);
  if (!ort) fachfehler('nicht_gefunden', 'lagerort_unbekannt');
  // Alle drei Tabellen, über die ID: Sonst liesse sich ein Ort löschen, in dem
  // nur Figuren liegen oder der anders geschrieben zugeordnet ist.
  const belegt = await orte.locationOccupancy(k.db, k.lesevertrag, userId, id);
  if (parseInt(String(belegt?.n ?? 0), 10) > 0) fachfehler('konflikt', 'lagerort_in_benutzung');
  await orte.removeLocation(k.db, id, userId);
}

/** EINE Abfrage über alle Tabellen, damit nicht jede Oberfläche selbst zusammenführt. */
export async function lagerorte(k: InventoryContext, scopeChoice: Sicht | ScopeInput) {
  const blickfeld = await k.household.scopeFrom(scopeChoice);
  const uids = asIds(blickfeld);
  // Über den NAMEN gruppiert, absichtlich: „Keller" von Grossvater und Enkel
  // sind zwei Vorratszeilen, gehören in der Übersicht aber zusammen.
  const rows = await orte.locationsWithInventory(k.db, k.lesevertrag, uids);
  // SUM() kommt als Zeichenkette aus dem Treiber; deshalb parseInt darunter.
  type Zeile = { ort: string; sets: string | number; teile: string | number; figuren: string | number };
  return ((rows as Zeile[]) || []).map(r => ({
    ort: r.ort,
    sets: parseInt(String(r.sets), 10) || 0,
    teile: parseInt(String(r.teile), 10) || 0,
    figuren: parseInt(String(r.figuren), 10) || 0,
  }));
}

/** Für die Vorgabe zählt die ID: Ein umbenannter Ort bleibt die Vorgabe. */
export const DEFAULT_KEY = 'default_storage_id';

/** Nur ein Ort des Kontos: Eine Vorgabe, deren Ort gelöscht wurde, ist keine, und eine fremde ID gilt nicht. */
export async function vorgabeVon(k: InventoryContext, userId: number): Promise<Lagerort | null> {
  const id = Number.parseInt(String((await k.einstellungen.userValue(userId, DEFAULT_KEY)) ?? '').trim(), 10);
  const row = Number.isInteger(id) ? await orte.locationOfAccount(k.db, id, userId) : undefined;
  if (!row) return null;
  return { id: parseInt(String(row.id), 10), user_id: parseInt(String(row.user_id), 10), name: row.name };
}

/** Ohne mitgegebenen Ort gilt die Vorgabe — für jeden Erfassungsweg. */
export async function locationForNewEntry(k: InventoryContext, userId: number, given: unknown): Promise<string | null> {
  // Die Längengrenze zuerst: Ein zu langer Ort soll absagen, bevor etwas
  // angelegt ist.
  const ort = normalizeLocation(given);
  if (ort) return ort;
  if (given !== undefined && given !== null) return null;
  return (await vorgabeVon(k, userId))?.name ?? null;
}
