import { AUFTRAG_KANAL, zieheVor, beendePause } from './dienst';
import { naechsteUhrzeit, taeglicheUhrzeit } from './zeitplan';
import type { AuftraegeKontext } from './kontext';

/** Einer je Set, fällig zur eingestellten Uhrzeit. `versuch` zählt über
 * Aufträge hinweg: Nach 30 Tagen ohne Kontingent gibt Brickset auf. */
export const BRICKSET_HOECHSTENS = 30;
const schluessel = (sn: string) => `brickset:${sn}`;

/** Bald (Störung der Gegenseite) oder zur Tageszeit. */
export async function bricksetFaelligAb(k: AuftraegeKontext, bald: boolean): Promise<Date> {
  if (bald) return new Date(Date.now() + 30 * 60_000);
  return naechsteUhrzeit(await taeglicheUhrzeit(k, 'brickset_retry'));
}

/** @returns false, wenn es schon BRICKSET_HOECHSTENS Mal vorgemerkt war. */
export async function bricksetVormerken(
  k: AuftraegeKontext,
  sn: string,
  fehler: string,
  bald = false,
): Promise<{ versuch: number; vorgemerkt: boolean }> {
  const versuch = (await k.auftraege.hoechsterBricksetVersuch(schluessel(sn))) + 1;
  if (versuch > BRICKSET_HOECHSTENS) {
    await bricksetAusWiedervorlage(k, sn);
    return { versuch, vorgemerkt: false };
  }
  await k.auftraege.merkeBricksetVor(
    schluessel(sn),
    { set_number: sn, versuch },
    await bricksetFaelligAb(k, bald),
    fehler,
  );
  await k.db.benachrichtigung.notify(AUFTRAG_KANAL, 'brickset');
  return { versuch, vorgemerkt: true };
}

export async function bricksetAusWiedervorlage(k: AuftraegeKontext, sn: string): Promise<void> {
  await k.auftraege.loescheOffenen(schluessel(sn));
}

export async function bricksetJetzt(k: AuftraegeKontext, sn?: string): Promise<void> {
  await beendePause(k, 'brickset');
  await zieheVor(k, 'brickset', sn ? schluessel(sn) : undefined);
}

/** Nach einer Änderung des Zeitplans: Was später fällig war, kommt bis `bis` dran. */
export async function bricksetTermineVorziehen(k: AuftraegeKontext, bis: Date): Promise<void> {
  await k.auftraege.zieheBricksetTermineVor(bis);
}

export function bricksetListe(k: AuftraegeKontext) {
  return k.auftraege.bricksetWiedervorlage();
}

export async function bricksetZahlen(k: AuftraegeKontext): Promise<{ wartend: number; faellig: number }> {
  const z = await k.auftraege.bricksetWartende();
  return { wartend: z?.wartend ?? 0, faellig: z?.faellig ?? 0 };
}
