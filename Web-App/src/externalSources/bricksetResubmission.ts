import { z } from 'zod';
import { auftragsart, nextTimeOfDay, type Anmeldung, type Bearbeiter } from '../jobQueue';
import type { ForeignSourcesContext } from './context';

/** Je Set ein Auftrag, fällig zur eingestellten Uhrzeit. `versuch` zählt über
 * Aufträge hinweg: Nach 30 Tagen ohne Kontingent gibt Brickset auf. */
export const BRICKSET_AT_MOST = 30;
export const BRICKSET_TIME_OF_DAY = { setting: 'job_time_brickset_retry', vorgabe: '04:00' } as const;
export const BricksetPayload = z.object({
  set_number: z.string().min(1).max(64),
  versuch: z.number().int().optional(),
});

declare module '../jobQueue/jobs' {
  interface JobPayloads {
    brickset: typeof BricksetPayload;
  }
}

/** Typ und Anmeldung der Art stehen hier, wo sie eingereiht wird; den Lauf gibt der Katalog, der die Sets kennt. */
export function bricksetJobType(ausfuehren: Bearbeiter<'brickset'>['ausfuehren']): Anmeldung {
  return auftragsart({ art: 'brickset', nutzlast: BricksetPayload, ausfuehren, exklusiv: true });
}

const schluessel = (sn: string) => `brickset:${sn}`;

/** Bald (Störung der Gegenseite) oder zur Tageszeit. */
export async function bricksetDueAb(k: ForeignSourcesContext, bald: boolean): Promise<Date> {
  if (bald) return new Date(k.uhr.jetzt() + 30 * 60_000);
  const zeit = await k.jobQueue.dailyTimeOfDay(BRICKSET_TIME_OF_DAY.setting, BRICKSET_TIME_OF_DAY.vorgabe);
  return nextTimeOfDay(zeit, k.uhr.datum());
}

/** @returns vorgemerkt false, wenn es schon BRICKSET_AT_MOST Mal vorgemerkt war */
export async function bricksetReserve(k: ForeignSourcesContext, sn: string, fehler: string, bald = false) {
  const r = await k.jobQueue.wiedervorlage.rememberBefore(
    'brickset',
    schluessel(sn),
    versuch => ({ set_number: sn, versuch }),
    {
      dueAb: await bricksetDueAb(k, bald),
      fehler,
      hoechstens: BRICKSET_AT_MOST,
    },
  );
  return { ...r, hoechstens: BRICKSET_AT_MOST };
}

export function bricksetForgotten(k: ForeignSourcesContext, sn: string): Promise<void> {
  return k.jobQueue.wiedervorlage.vergiss(schluessel(sn));
}

/** Ohne Nummer alle; die Pause der Art (Kontingent erschöpft) endet mit. */
export async function bricksetNow(k: ForeignSourcesContext, sn?: string): Promise<void> {
  await k.jobQueue.endPause('brickset');
  await k.jobQueue.wiedervorlage.jetzt('brickset', sn ? schluessel(sn) : undefined);
}

export function bricksetPrefer(k: ForeignSourcesContext, bis: Date): Promise<void> {
  return k.jobQueue.wiedervorlage.prefer('brickset', bis);
}

export function bricksetNumbers(k: ForeignSourcesContext) {
  return k.jobQueue.wiedervorlage.zahlen('brickset');
}

export async function bricksetWaiting(k: ForeignSourcesContext) {
  return (await k.jobQueue.wiedervorlage.wartende('brickset')).map(z => {
    const n = BricksetPayload.safeParse(z.payload);
    return {
      set_number: n.success ? n.data.set_number : '',
      versuch: (n.success ? n.data.versuch : undefined) ?? 1,
      faellig_ab: z.due_at,
      fehler: z.error_message,
      erstellt: z.created_at,
    };
  });
}
