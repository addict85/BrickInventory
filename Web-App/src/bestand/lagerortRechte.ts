/** Rechte und Vorgabe der Lagerorte: brauchen Haushalt und Konto, darum über den
 * Kontext; die Orte selbst (lagerort.ts) nehmen nur einen Zugang. */
import type { InventoryContext } from './kontext';
import * as orte from './repository/lagerort';
import { fachfehler } from '../infra/fehlerTexte';
import { locationsOf, DEFAULT_KEY, type Lagerort } from './lagerort';

/** Schnittmenge statt Absage; ohne Ansichtsfilter, denn die Frage ist „darf ich?“. */
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

/** EIN Konto je Schreibaufruf, damit jeder Ort für sich scheitern kann; 403 ohne Recht. */
export async function lagerSchreibkonto(
  k: InventoryContext,
  nutzer: number,
  wish: string | number | undefined,
): Promise<number> {
  const konto = (await storageAccounts(k, nutzer, wish, true))[0];
  if (konto === undefined) fachfehler('verboten', 'kein_schreibrecht');
  return konto;
}

/** Der Vorrat der gewünschten Konten, soweit das Konto sie sehen darf. */
export async function locationsFor(k: InventoryContext, nutzer: number, wish: string | undefined): Promise<Lagerort[]> {
  return locationsOf(k, await storageAccounts(k, nutzer, wish, false));
}

/** `null` löscht sie. Ein fremder Ort wird abgelehnt, nicht ignoriert: Der
 * Stern stünde sonst am falschen Eintrag. */
export async function setDefault(k: InventoryContext, userId: number, id: number | null): Promise<Lagerort | null> {
  if (id === null) {
    await k.einstellungen.deleteUserSetting(userId, DEFAULT_KEY);
    return null;
  }
  const ort = await orte.locationOfAccount(k.db, id, userId);
  if (!ort) fachfehler('nicht_gefunden', 'lagerort_unbekannt');
  // Über die Einstellungen des Kontos: user_settings gehört dorthin.
  await k.einstellungen.setUserSetting(userId, DEFAULT_KEY, String(id));
  return { id: parseInt(String(ort.id), 10), user_id: userId, name: ort.name };
}
