/** Unbekannte Bearer-Token kosten Datenbankabfragen, bevor apiDrossel ein Konto
 * kennt. Gezählt wird in rate_limit_attempts, damit mehrere Web-Prozesse dieselbe
 * Grenze teilen; geschrieben wird nur beim Fehlversuch, die Sperre selbst merkt sich
 * jeder Prozess, damit ein gültiger Token keine zusätzliche Abfrage kostet.
 * Ersetzte Token einer Familie zählen nicht mit (Wiederverwendungserkennung). */
import { drosselAdresse, zaehleAnfrage } from './loginLimiter';
import { loescheZaehlerMitPraefix } from './repository/anmeldezaehler';
import { meldeFehler } from '../infra/fehler';

export const FEHLVERSUCH_FENSTER_MS = 60_000;
export const FEHLVERSUCH_MAX = 60;
const BUCKET = 'token-fehlversuch';

/** Adresse → Ende der Sperre, nur als Abkürzung: Die Zählung steht in der Datenbank. */
const gesperrtBis = new Map<string, number>();

export async function zaehleFehlversuch(ip: string | null | undefined, jetzt = Date.now()): Promise<void> {
  if (!ip) return;
  const st = await zaehleAnfrage(BUCKET, ip, FEHLVERSUCH_FENSTER_MS);
  if (st.count <= FEHLVERSUCH_MAX) return;
  gesperrtBis.set(drosselAdresse(ip), jetzt + Math.min(st.waitMin * 60_000, FEHLVERSUCH_FENSTER_MS));
  if (gesperrtBis.size > 5000) for (const [k, bis] of gesperrtBis) if (bis <= jetzt) gesperrtBis.delete(k);
}

export function zuVieleFehlversuche(ip: string | null | undefined, jetzt = Date.now()): boolean {
  if (!ip) return false;
  const bis = gesperrtBis.get(drosselAdresse(ip));
  return bis !== undefined && jetzt < bis;
}

/** Nur die Abkürzung dieses Prozesses; ein anderer Prozess hat seine eigene. */
export function vergissSperrenImProzess(): void {
  gesperrtBis.clear();
}

export async function vergissFehlversuche(): Promise<void> {
  gesperrtBis.clear();
  await loescheZaehlerMitPraefix(`${BUCKET}|`).catch((e: unknown) => meldeFehler('token-fehlversuch:vergessen', e));
}
