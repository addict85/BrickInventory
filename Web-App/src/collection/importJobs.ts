/** The imports other than the set CSV (which continues row-by-row in setCsvImport.ts).
 * The route submits and waits (runImport). */
import { csvImportReport } from '../infra/csvExport';
import { Fachfehler } from '../infra/fehlerTexte';
import { z } from 'zod';
import type { JobRow, JobContext, Fortschritt } from '../jobQueue';
import { SetCsvPayload } from '../sets';
import { importWantedXml } from './wantedXmlImport';
import type { CollectionContext } from './context';

const KONTO = z.number().int().positive();
const text = z.string();

/** A correction to the wanted-list preview; the import matches `blId` against the entry. */
export const WantedCorrection = z.object({
  index: z.number().int().min(0),
  blId: z.string().max(64),
  art: z.enum(['part', 'fig', 'set']),
  rbId: z.string().max(64).nullish(),
  rbFarbe: z.number().int().nullish(),
  menge: z.number().optional(),
  zustand: z.string().max(16).nullish(),
  kaufpreis: z.number().nullish(),
});
export const WantedCorrections = z.array(WantedCorrection).max(100_000);

const ImportPayloadSchema = z.discriminatedUnion('quelle', [
  z.object({ user_id: KONTO, quelle: z.literal('teile_csv'), eingabe: z.object({ text }) }),
  z.object({ user_id: KONTO, quelle: z.literal('figuren_csv'), eingabe: z.object({ text }) }),
  z.object({ user_id: KONTO, quelle: z.literal('merkliste_csv'), eingabe: z.object({ text, owner: KONTO }) }),
  z.object({
    user_id: KONTO,
    quelle: z.literal('alarme_csv'),
    eingabe: z.object({ text, waehrung: z.string().min(1).max(8) }),
  }),
  z.object({
    user_id: KONTO,
    quelle: z.literal('wanted_xml'),
    eingabe: z.object({
      xml: text,
      fileName: z.string().max(200),
      schreiben: z.boolean(),
      viaRebrickable: z.boolean(),
      korrekturen: WantedCorrections.optional(),
    }),
  }),
]);
export const CsvImportPayload = z.union([ImportPayloadSchema, SetCsvPayload]);

declare module '../jobQueue/jobs' {
  interface JobPayloads {
    csv_import: typeof CsvImportPayload;
  }
}

export type ImportSource = z.input<typeof ImportPayloadSchema>['quelle'];
/** What the import needs from the source. */
export type ImportInput<Q extends ImportSource> = Extract<
  z.input<typeof ImportPayloadSchema>,
  { quelle: Q }
>['eingabe'];

/** The route submits and waits; the import runs in the job process. */
export function runImport<T = Record<string, unknown>, Q extends ImportSource = ImportSource>(
  k: CollectionContext,
  uid: number,
  quelle: Q,
  eingabe: ImportInput<Q>,
  o: { fortschritt?: (f: Fortschritt) => void; wartenMs?: number } = {},
): Promise<T> {
  // tsc doesn't link Q to the union's branch; it's checked when enqueuing.
  const nutzlast = { user_id: uid, quelle, eingabe } as z.input<typeof ImportPayloadSchema>;
  return k.jobQueue.waitOnJob<T, 'csv_import'>('csv_import', nutzlast, { ...o, userId: uid });
}

export type ImportPayload = z.output<typeof ImportPayloadSchema>;

async function resultFrom(kx: CollectionContext, n: ImportPayload, k: JobContext): Promise<Record<string, unknown>> {
  const uid = n.user_id;
  switch (n.quelle) {
    case 'teile_csv':
      return csvImportReport(await kx.parts.importPartsCsv(uid, n.eingabe.text));
    case 'figuren_csv':
      return csvImportReport(await kx.minifigs.importMinifigsCsv(uid, n.eingabe.text));
    case 'merkliste_csv':
      return csvImportReport(await kx.wanted.importWantedListCsv(n.eingabe.owner, n.eingabe.text));
    case 'alarme_csv':
      return kx.finances.preisalarm.alertsFromCsv(uid, n.eingabe.waehrung, n.eingabe.text);
    case 'wanted_xml':
      return importWantedXml(kx, uid, n.eingabe, k);
  }
}

/** A business error is a result (the request reports it with a code), not a job failure. */
async function runImportFrom(kx: CollectionContext, n: ImportPayload, k: JobContext, a: JobRow): Promise<void> {
  try {
    await kx.jobQueue.setResult(a.id, await resultFrom(kx, n, k));
  } catch (e) {
    if (!(e instanceof Fachfehler)) throw e;
    await kx.jobQueue.setSlotError(a.id, e);
  }
}

export { runImportFrom };
