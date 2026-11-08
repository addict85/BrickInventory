/** Unbekannte Bearer-Token kosten Datenbankabfragen, bevor apiDrossel ein Konto
 * kennt; gezählt wird im Prozess. Ersetzte Token einer Familie zählen nicht mit,
 * damit die Wiederverwendungserkennung nicht an dieser Sperre hängt. */
import { drosselAdresse } from './loginLimiter';

export const FEHLVERSUCH_FENSTER_MS = 60_000;
export const FEHLVERSUCH_MAX = 60;

const zaehler = new Map<string, { count: number; seit: number }>();

export function zaehleFehlversuch(ip: string | null | undefined, jetzt = Date.now()): void {
  if (!ip) return;
  const schluessel = drosselAdresse(ip);
  const e = zaehler.get(schluessel);
  if (!e || jetzt - e.seit > FEHLVERSUCH_FENSTER_MS) zaehler.set(schluessel, { count: 1, seit: jetzt });
  else e.count++;
  if (zaehler.size > 5000) for (const [k, v] of zaehler) if (jetzt - v.seit > FEHLVERSUCH_FENSTER_MS) zaehler.delete(k);
}

export function zuVieleFehlversuche(ip: string | null | undefined, jetzt = Date.now()): boolean {
  if (!ip) return false;
  const e = zaehler.get(drosselAdresse(ip));
  return !!e && jetzt - e.seit <= FEHLVERSUCH_FENSTER_MS && e.count > FEHLVERSUCH_MAX;
}

export function vergissFehlversuche(): void {
  zaehler.clear();
}
