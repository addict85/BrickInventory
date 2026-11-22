import { z } from 'zod';
import { type ImportResult, JobInterrupted, type JobContext } from '../jobQueue';
import { setErfassen } from './addSet';
import { fehlertext } from '../infra/error';
import { Fachfehler, errorText, type ErrorCode } from '../infra/errorTexts';
import type { SetsContext } from './context';

/** After every set the state is in import_status; a restart continues
 * there. If `current` is still set after a crash, it is uncertain whether the set
 * was booked — it is not booked again but reported. */
const CsvRowSchema = z.object({
  sn: z.string(),
  qty: z.number().int(),
  purchasePrice: z.number().nullable(),
  condition: z.string().nullable(),
  acquiredAt: z.string().nullable(),
  // Line of the file and, if it already failed while reading, why: the result then names it in its place.
  zeile: z.number().int().optional(),
  fehler: z
    .object({ code: z.enum(['csv_menge_ungueltig', 'csv_keine_setnummer']), wert: z.string().optional() })
    .optional(),
});
/** Part of the kind 'csv_import', which the collection registers (src/collection/jobKinds.ts). */
export const SetCsvPayload = z.object({
  user_id: z.number().int().positive(),
  lauf: z.string().min(1),
  rows: z.array(CsvRowSchema),
});
export type CsvPayload = z.output<typeof SetCsvPayload>;
export type CsvRow = CsvPayload['rows'][number];

async function importRow(sk: SetsContext, z: CsvRow, userId: number): Promise<ImportResult> {
  const wo = z.zeile ? { zeile: z.zeile } : {};
  if (z.fehler) {
    const vars = z.fehler.wert !== undefined ? { wert: z.fehler.wert } : undefined;
    return {
      set_number: z.sn,
      ...wo,
      success: false,
      code: z.fehler.code,
      ...(vars ? { vars } : {}),
      error: errorText(z.fehler.code, 'de', vars),
    };
  }
  return { ...(await bookRow(sk, z, userId)), ...wo };
}

/** Without network (setErfassen); the deadline only catches a stuck database. After a
 * timeout the attempt may still book, hence no retry. */
async function bookRow(sk: SetsContext, z: CsvRow, userId: number): Promise<ImportResult> {
  let alarm: NodeJS.Timeout | undefined;
  try {
    const r = await Promise.race([
      setErfassen(sk, {
        requester: userId,
        setNumber: z.sn,
        menge: z.qty,
        kaufpreis: z.purchasePrice,
        zustand: z.condition,
        recordedAt: z.acquiredAt,
        ifPresent: 'aufstocken',
        nacharbeit: 'csv',
      }),
      new Promise<never>((_, rej) => {
        alarm = setTimeout(() => rej(new Error('Timeout')), sk.konfig.csvRowDeadlineMs);
      }),
    ]).finally(() => clearTimeout(alarm));
    return {
      set_number: z.sn,
      success: true,
      action: r.action,
      menge: z.qty,
      ...(r.action === 'added' && r.katalog_offen ? { katalog_offen: true } : {}),
    };
  } catch (e) {
    const msg = fehlertext(e) || 'Unbekannter Fehler';
    const isWarning = msg.includes('Timeout');
    console[isWarning ? 'warn' : 'error'](`CSV: ${z.sn} ${isWarning ? 'WARNING' : 'FAILED'}: ${msg}`);
    const code: ErrorCode | undefined =
      e instanceof Fachfehler ? e.code : isWarning ? 'import_zeitueberschreitung' : undefined;
    return {
      set_number: z.sn,
      success: false,
      error: msg,
      isWarning,
      ...(code ? { code, ...(e instanceof Fachfehler && e.vars ? { vars: e.vars } : {}) } : {}),
    };
  }
}

async function runCsvImportFrom(sk: SetsContext, n: CsvPayload, k: JobContext): Promise<void> {
  const userId = Number(n.user_id),
    lauf = String(n.lauf),
    rows = n.rows ?? [];
  const stand = await sk.jobQueue.setImportFort(userId, lauf);
  if (!stand) return;
  const results = stand.results;
  const schreibe = () =>
    sk.jobQueue.jobUpdate(userId, { done: results.length, results: JSON.stringify(results), current: null }, lauf);

  if (stand.current && results.length < rows.length) {
    results.push({
      set_number: rows[results.length]!.sn,
      success: false,
      isWarning: true,
      code: 'import_zeile_unterbrochen',
      error: errorText('import_zeile_unterbrochen', 'de'),
    });
    if (!(await schreibe())) return;
  }
  for (let i = results.length; i < rows.length; i++) {
    if (k.beendet) throw new JobInterrupted();
    const z = rows[i]!;
    // Aborted, superseded or assigned elsewhere: stop without writing into foreign rows.
    if (!(await k.lebenszeichen()) || !(await sk.jobQueue.jobUpdate(userId, { current: z.sn }, lauf))) return;
    await sk.jobQueue.reportJobStatus(userId);
    results.push(await importRow(sk, z, userId));
    if (!(await schreibe())) return;
    await sk.jobQueue.reportJobStatus(userId);
  }
  await sk.jobQueue.jobUpdate(userId, { status: 'done', current: null }, lauf);
  await sk.jobQueue.reportJobStatus(userId);
  console.log(
    `CSV import done: ${results.filter(r => r.success).length} ok, ${results.filter(r => !r.success).length} errors`,
  );
}

/** The status line shows the error instead of running forever. */
async function csvImportGivenUp(k: SetsContext, n: CsvPayload, fehler: string): Promise<void> {
  console.error(`CSV import fatal error: ${fehler}`);
  await k.jobQueue.jobUpdate(Number(n.user_id), { status: 'error', error: fehler, current: null }, String(n.lauf));
  await k.jobQueue.reportJobStatus(Number(n.user_id));
}

export { runCsvImportFrom, csvImportGivenUp };
