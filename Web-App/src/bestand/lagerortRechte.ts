/** Rechte und Vorgabe der Lagerorte: brauchen Haushalt und Konto, darum über den
 * Kontext; die Orte selbst (lagerort.ts) nehmen nur einen Zugang. */
import type { BestandKontext } from './kontext';
import * as orte from './repository/lagerort';
import { fachfehler } from '../infra/fehlerTexte';
import { orteVon, VORGABE_SCHLUESSEL, type Lagerort } from './lagerort';

/** Schnittmenge statt Absage; ohne Ansichtsfilter, denn die Frage ist „darf ich?“. */
export async function lagerKonten(
  k: BestandKontext,
  nutzer: number,
  wunsch: string | number | undefined,
  schreiben: boolean,
): Promise<number[]> {
  const gewuenscht = String(wunsch ?? '')
    .split(',')
    .map(x => parseInt(x.trim(), 10))
    .filter(Number.isFinite);
  if (!gewuenscht.length) return [nutzer];
  const erlaubt = schreiben ? await k.haushalt.schreibbereich(nutzer) : await k.haushalt.blickfeldIds(nutzer);
  return gewuenscht.filter(id => erlaubt.includes(id));
}

/** EIN Konto je Schreibaufruf, damit jeder Ort für sich scheitern kann; 403 ohne Recht. */
export async function lagerSchreibkonto(
  k: BestandKontext,
  nutzer: number,
  wunsch: string | number | undefined,
): Promise<number> {
  const konto = (await lagerKonten(k, nutzer, wunsch, true))[0];
  if (konto === undefined) fachfehler('verboten', 'kein_schreibrecht');
  return konto;
}

/** Der Vorrat der gewünschten Konten, soweit das Konto sie sehen darf. */
export async function orteFuer(k: BestandKontext, nutzer: number, wunsch: string | undefined): Promise<Lagerort[]> {
  return orteVon(k, await lagerKonten(k, nutzer, wunsch, false));
}

/** `null` löscht sie. Ein fremder Ort wird abgelehnt, nicht ignoriert: Der
 * Stern stünde sonst am falschen Eintrag. */
export async function setzeVorgabe(k: BestandKontext, userId: number, id: number | null): Promise<Lagerort | null> {
  if (id === null) {
    await k.einstellungen.deleteUserSetting(userId, VORGABE_SCHLUESSEL);
    return null;
  }
  const ort = await orte.ortDesKontos(k.db, id, userId);
  if (!ort) fachfehler('nicht_gefunden', 'lagerort_unbekannt');
  // Über die Einstellungen des Kontos: user_settings gehört dorthin.
  await k.konto.setUserSetting(userId, VORGABE_SCHLUESSEL, String(id));
  return { id: parseInt(String(ort.id), 10), user_id: userId, name: ort.name };
}
