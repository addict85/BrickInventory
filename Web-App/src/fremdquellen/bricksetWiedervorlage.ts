import { z } from 'zod';
import { naechsteUhrzeit } from '../auftraege';
import type { FremdquellenKontext } from './kontext';

/** Je Set ein Auftrag, fällig zur eingestellten Uhrzeit. `versuch` zählt über
 * Aufträge hinweg: Nach 30 Tagen ohne Kontingent gibt Brickset auf. */
export const BRICKSET_HOECHSTENS = 30;
export const BRICKSET_UHRZEIT = { einstellung: 'job_time_brickset_retry', vorgabe: '04:00' } as const;
export const BricksetNutzlast = z.object({
  set_number: z.string().min(1).max(64),
  versuch: z.number().int().optional(),
});

declare module '../auftraege/auftraege' {
  interface AuftragsNutzlasten {
    brickset: typeof BricksetNutzlast;
  }
}

const schluessel = (sn: string) => `brickset:${sn}`;

/** Bald (Störung der Gegenseite) oder zur Tageszeit. */
export async function bricksetFaelligAb(k: FremdquellenKontext, bald: boolean): Promise<Date> {
  if (bald) return new Date(k.uhr.jetzt() + 30 * 60_000);
  const zeit = await k.auftraege.taeglicheUhrzeit(BRICKSET_UHRZEIT.einstellung, BRICKSET_UHRZEIT.vorgabe);
  return naechsteUhrzeit(zeit, k.uhr.datum());
}

/** @returns vorgemerkt false, wenn es schon BRICKSET_HOECHSTENS Mal vorgemerkt war */
export async function bricksetVormerken(k: FremdquellenKontext, sn: string, fehler: string, bald = false) {
  const r = await k.auftraege.wiedervorlage.merkeVor(
    'brickset',
    schluessel(sn),
    versuch => ({ set_number: sn, versuch }),
    {
      faelligAb: await bricksetFaelligAb(k, bald),
      fehler,
      hoechstens: BRICKSET_HOECHSTENS,
    },
  );
  return { ...r, hoechstens: BRICKSET_HOECHSTENS };
}

export function bricksetVergessen(k: FremdquellenKontext, sn: string): Promise<void> {
  return k.auftraege.wiedervorlage.vergiss(schluessel(sn));
}

/** Ohne Nummer alle; die Pause der Art (Kontingent erschöpft) endet mit. */
export async function bricksetJetzt(k: FremdquellenKontext, sn?: string): Promise<void> {
  await k.auftraege.beendePause('brickset');
  await k.auftraege.wiedervorlage.jetzt('brickset', sn ? schluessel(sn) : undefined);
}

/** Nach einer Änderung der Uhrzeit: Was später fällig war, kommt bis `bis` dran. */
export function bricksetVorziehen(k: FremdquellenKontext, bis: Date): Promise<void> {
  return k.auftraege.wiedervorlage.vorziehen('brickset', bis);
}

export function bricksetZahlen(k: FremdquellenKontext) {
  return k.auftraege.wiedervorlage.zahlen('brickset');
}

/** Die wartenden Sets mit Zahl der Versuche, nach Fälligkeit. */
export async function bricksetWartende(k: FremdquellenKontext) {
  return (await k.auftraege.wiedervorlage.wartende('brickset')).map(z => {
    const n = BricksetNutzlast.safeParse(z.nutzlast);
    return {
      set_number: n.success ? n.data.set_number : '',
      versuch: (n.success ? n.data.versuch : undefined) ?? 1,
      faellig_ab: z.faellig_ab,
      fehler: z.fehler,
      erstellt: z.erstellt,
    };
  });
}
