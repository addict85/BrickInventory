import { notify } from '../../db/pgNotify';
import { AUFTRAG_KANAL, zieheVor, beendePause } from './dienst';
import * as repo from './repository/auftraege';
import { naechsteUhrzeit, taeglicheUhrzeit } from './zeitplan';

/**
 * Die Brickset-Wiedervorlage als Aufträge der Art 'brickset' — einer je Set,
 * fällig zur eingestellten Uhrzeit (job_time_brickset_retry). `versuch` in der
 * Nutzlast zählt die Wiedervorlagen über Aufträge hinweg: Nach 30 Tagen ohne
 * Kontingent gibt Brickset für dieses Set auf (clients/brickset.ts).
 */
export const BRICKSET_HOECHSTENS = 30;
const schluessel = (sn: string) => `brickset:${sn}`;

/** Wann ein vorgemerktes Set wieder dran ist: bald (Störung der Gegenseite) oder zur Tageszeit. */
export async function bricksetFaelligAb(bald: boolean): Promise<Date> {
  if (bald) return new Date(Date.now() + 30 * 60_000);
  return naechsteUhrzeit(await taeglicheUhrzeit('brickset_retry'));
}

/**
 * Ein Set (wieder) vormerken. @returns false, wenn es schon BRICKSET_HOECHSTENS
 * Mal vorgemerkt war — dann ist es aus der Wiedervorlage genommen.
 */
export async function bricksetVormerken(sn: string, fehler: string, bald = false): Promise<{ versuch: number; vorgemerkt: boolean }> {
  const versuch = await repo.hoechsterBricksetVersuch(schluessel(sn)) + 1;
  if (versuch > BRICKSET_HOECHSTENS) { await bricksetAusWiedervorlage(sn); return { versuch, vorgemerkt: false }; }
  await repo.merkeBricksetVor(schluessel(sn), { set_number: sn, versuch }, await bricksetFaelligAb(bald), fehler);
  await notify(AUFTRAG_KANAL, 'brickset');
  return { versuch, vorgemerkt: true };
}

/** Aus der Wiedervorlage nehmen (Erfolg, endgültiger Fehler, Verwaltung). */
export async function bricksetAusWiedervorlage(sn: string): Promise<void> {
  await repo.loescheOffenen(schluessel(sn));
}

/** Jetzt abarbeiten — ein Set oder alle (nach einem höheren Kontingent). */
export async function bricksetJetzt(sn?: string): Promise<void> {
  await beendePause('brickset');
  await zieheVor('brickset', sn ? schluessel(sn) : undefined);
}

/** Die Wiedervorlage für die Verwaltung, im Format der früheren Tabelle. */
export function bricksetListe(): Promise<any[]> {
  return repo.bricksetWiedervorlage();
}

/** Wartende und davon heute fällige Einträge. */
export async function bricksetZahlen(): Promise<{ wartend: number; faellig: number }> {
  const z = await repo.bricksetWartende();
  return { wartend: z?.wartend ?? 0, faellig: z?.faellig ?? 0 };
}
