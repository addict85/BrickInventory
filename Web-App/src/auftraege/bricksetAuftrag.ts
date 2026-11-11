import { notify } from '../../db/pgNotify';
import { AUFTRAG_KANAL, zieheVor, beendePause } from './dienst';
import { naechsteUhrzeit, taeglicheUhrzeit } from './zeitplan';
import { auftraegeBereich } from './prozess';

/** Einer je Set, fällig zur eingestellten Uhrzeit. `versuch` zählt über
 * Aufträge hinweg: Nach 30 Tagen ohne Kontingent gibt Brickset auf. */
export const BRICKSET_HOECHSTENS = 30;
const schluessel = (sn: string) => `brickset:${sn}`;

/** Bald (Störung der Gegenseite) oder zur Tageszeit. */
export async function bricksetFaelligAb(bald: boolean): Promise<Date> {
  if (bald) return new Date(Date.now() + 30 * 60_000);
  return naechsteUhrzeit(await taeglicheUhrzeit('brickset_retry'));
}

/** @returns false, wenn es schon BRICKSET_HOECHSTENS Mal vorgemerkt war. */
export async function bricksetVormerken(sn: string, fehler: string, bald = false): Promise<{ versuch: number; vorgemerkt: boolean }> {
  const versuch = await auftraegeBereich().auftraege.hoechsterBricksetVersuch(schluessel(sn)) + 1;
  if (versuch > BRICKSET_HOECHSTENS) { await bricksetAusWiedervorlage(sn); return { versuch, vorgemerkt: false }; }
  await auftraegeBereich().auftraege.merkeBricksetVor(schluessel(sn), { set_number: sn, versuch }, await bricksetFaelligAb(bald), fehler);
  await notify(AUFTRAG_KANAL, 'brickset');
  return { versuch, vorgemerkt: true };
}

export async function bricksetAusWiedervorlage(sn: string): Promise<void> {
  await auftraegeBereich().auftraege.loescheOffenen(schluessel(sn));
}

export async function bricksetJetzt(sn?: string): Promise<void> {
  await beendePause('brickset');
  await zieheVor('brickset', sn ? schluessel(sn) : undefined);
}

/** Nach einer Änderung des Zeitplans: Was später fällig war, kommt bis `bis` dran. */
export async function bricksetTermineVorziehen(bis: Date): Promise<void> {
  await auftraegeBereich().auftraege.zieheBricksetTermineVor(bis);
}

export function bricksetListe() {
  return auftraegeBereich().auftraege.bricksetWiedervorlage();
}

export async function bricksetZahlen(): Promise<{ wartend: number; faellig: number }> {
  const z = await auftraegeBereich().auftraege.bricksetWartende();
  return { wartend: z?.wartend ?? 0, faellig: z?.faellig ?? 0 };
}
