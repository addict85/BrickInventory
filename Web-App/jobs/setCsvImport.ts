import type { z } from 'zod';
import { konfig } from '../src/infra/konfig';
import type { SetCsvNutzlast } from '../src/auftraege/nutzlasten';
import { addSetWithDate, nacharbeitEinstellen } from '../src/sets/setService';
import { emitJobStatus, jobUpdate, setzeImportFort, type ImportErgebnis } from '../src/auftraege/importAuftrag';
import { fehlertext } from '../src/infra/fehler';
import { Fachfehler, fehlerText, type FehlerCode } from '../src/infra/fehlerTexte';
import { AuftragUnterbrochen, type AuftragsKontext } from './auftragsWorker';

/** Nach jedem Set steht der Stand in import_stand; ein Neustart setzt dort
 * fort. Steht `current` nach einem Absturz noch da, ist ungewiss, ob das Set
 * gebucht wurde — es wird nicht noch einmal gebucht, sondern gemeldet. */
export type CsvNutzlast = z.output<typeof SetCsvNutzlast>;
export type CsvZeile = CsvNutzlast['rows'][number];

const zeilenFrist = () => konfig().csvZeileFristMs;

async function importiereZeile(z: CsvZeile, userId: number): Promise<ImportErgebnis> {
  for (let versuch = 1; ; versuch++) {
    let wecker: NodeJS.Timeout | undefined;
    try {
      const r = await Promise.race([
        addSetWithDate(z.sn, z.qty, userId, z.purchasePrice, z.condition, z.acquiredAt),
        new Promise<never>((_, rej) => { wecker = setTimeout(() => rej(new Error('Timeout')), zeilenFrist()); }),
      ]).finally(() => clearTimeout(wecker));
      await nacharbeitEinstellen(r.set_number ?? z.sn, userId, 'csv');
      return { set_number: z.sn, success: true, action: r.action, menge: z.qty,
               ...('katalog_offen' in r && r.katalog_offen ? { katalog_offen: true } : {}) };
    } catch (e) {
      const msg = fehlertext(e) || 'Unbekannter Fehler';
      const isTimeout = msg.includes('Timeout');
      const isRateLimit = msg.includes('429') || msg.includes('rate limit') || msg.includes('Daily limit');
      // Nur ein Kontingent-Fehler wird wiederholt: Nach einer Zeitüberschreitung
      // läuft der erste Versuch weiter und bucht womöglich noch.
      if (isRateLimit && !isTimeout && versuch < 2) {
        console.warn(`CSV: ${z.sn} retry after ${msg}...`);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      const isWarning = isTimeout || isRateLimit;
      console[isWarning ? 'warn' : 'error'](`CSV: ${z.sn} ${isWarning ? 'WARNING' : 'FAILED'}: ${msg}`);
      const code: FehlerCode | undefined = e instanceof Fachfehler ? e.code
        : isTimeout ? 'import_zeitueberschreitung' : isRateLimit ? 'import_kontingent' : undefined;
      return { set_number: z.sn, success: false, error: msg, isWarning,
               ...(code ? { code, ...(e instanceof Fachfehler && e.vars ? { vars: e.vars } : {}) } : {}) };
    }
  }
}

async function fuehreCsvImportAus(n: CsvNutzlast, k: AuftragsKontext): Promise<void> {
  const userId = Number(n.user_id), lauf = String(n.lauf), rows = n.rows ?? [];
  const stand = await setzeImportFort(userId, lauf);
  if (!stand) return;
  const results = stand.results;
  const schreibe = () => jobUpdate(userId, { done: results.length, results: JSON.stringify(results), current: null }, lauf);

  if (stand.current && results.length < rows.length) {
    results.push({ set_number: rows[results.length]!.sn, success: false, isWarning: true,
                   code: 'import_zeile_unterbrochen', error: fehlerText('import_zeile_unterbrochen', 'de') });
    if (!await schreibe()) return;
  }
  for (let i = results.length; i < rows.length; i++) {
    if (k.beendet) throw new AuftragUnterbrochen();
    const z = rows[i]!;
    // Abgebrochen, abgelöst oder anderswo vergeben: aufhören, ohne in fremde
    // Zeilen zu schreiben.
    if (!await k.lebenszeichen() || !await jobUpdate(userId, { current: z.sn }, lauf)) return;
    await emitJobStatus(userId);
    results.push(await importiereZeile(z, userId));
    if (!await schreibe()) return;
    await emitJobStatus(userId);
  }
  await jobUpdate(userId, { status: 'done', current: null }, lauf);
  await emitJobStatus(userId);
  console.log(`CSV import done: ${results.filter(r => r.success).length} ok, ${results.filter(r => !r.success).length} errors`);
}

/** Die Statuszeile zeigt den Fehler, statt ewig zu laufen. */
async function csvImportAufgegeben(n: CsvNutzlast, fehler: string): Promise<void> {
  console.error(`CSV import fatal error: ${fehler}`);
  await jobUpdate(Number(n.user_id), { status: 'error', error: fehler, current: null }, String(n.lauf));
  await emitJobStatus(Number(n.user_id));
}

export { fuehreCsvImportAus, csvImportAufgegeben };
