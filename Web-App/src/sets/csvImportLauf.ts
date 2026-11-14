import type { z } from 'zod';
import { type SetCsvNutzlast, type ImportErgebnis, AuftragUnterbrochen, type AuftragsKontext } from '../auftraege';
import { setErfassen } from './erfassen';
import { fehlertext } from '../infra/fehler';
import { Fachfehler, fehlerText, type FehlerCode } from '../infra/fehlerTexte';
import type { SetsKontext } from './kontext';

/** Nach jedem Set steht der Stand in import_stand; ein Neustart setzt dort
 * fort. Steht `current` nach einem Absturz noch da, ist ungewiss, ob das Set
 * gebucht wurde — es wird nicht noch einmal gebucht, sondern gemeldet. */
export type CsvNutzlast = z.output<typeof SetCsvNutzlast>;
export type CsvZeile = CsvNutzlast['rows'][number];

async function importiereZeile(sk: SetsKontext, z: CsvZeile, userId: number): Promise<ImportErgebnis> {
  const wo = z.zeile ? { zeile: z.zeile } : {};
  if (z.fehler) {
    const vars = z.fehler.wert !== undefined ? { wert: z.fehler.wert } : undefined;
    return {
      set_number: z.sn,
      ...wo,
      success: false,
      code: z.fehler.code,
      ...(vars ? { vars } : {}),
      error: fehlerText(z.fehler.code, 'de', vars),
    };
  }
  return { ...(await bucheZeile(sk, z, userId)), ...wo };
}

/** Ohne Netz (setErfassen); die Frist fängt nur eine klemmende Datenbank. Nach einer
 * Zeitüberschreitung bucht der Versuch womöglich noch, deshalb keine Wiederholung. */
async function bucheZeile(sk: SetsKontext, z: CsvZeile, userId: number): Promise<ImportErgebnis> {
  let wecker: NodeJS.Timeout | undefined;
  try {
    const r = await Promise.race([
      setErfassen(sk, {
        anfragender: userId,
        setNumber: z.sn,
        menge: z.qty,
        kaufpreis: z.purchasePrice,
        zustand: z.condition,
        erfasstAm: z.acquiredAt,
        wennVorhanden: 'aufstocken',
        nacharbeit: 'csv',
      }),
      new Promise<never>((_, rej) => {
        wecker = setTimeout(() => rej(new Error('Timeout')), sk.konfig.csvZeileFristMs);
      }),
    ]).finally(() => clearTimeout(wecker));
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
    const code: FehlerCode | undefined =
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

async function fuehreCsvImportAus(sk: SetsKontext, n: CsvNutzlast, k: AuftragsKontext): Promise<void> {
  const userId = Number(n.user_id),
    lauf = String(n.lauf),
    rows = n.rows ?? [];
  const stand = await sk.auftraege.setzeImportFort(userId, lauf);
  if (!stand) return;
  const results = stand.results;
  const schreibe = () =>
    sk.auftraege.jobUpdate(userId, { done: results.length, results: JSON.stringify(results), current: null }, lauf);

  if (stand.current && results.length < rows.length) {
    results.push({
      set_number: rows[results.length]!.sn,
      success: false,
      isWarning: true,
      code: 'import_zeile_unterbrochen',
      error: fehlerText('import_zeile_unterbrochen', 'de'),
    });
    if (!(await schreibe())) return;
  }
  for (let i = results.length; i < rows.length; i++) {
    if (k.beendet) throw new AuftragUnterbrochen();
    const z = rows[i]!;
    // Abgebrochen, abgelöst oder anderswo vergeben: aufhören, ohne in fremde Zeilen zu schreiben.
    if (!(await k.lebenszeichen()) || !(await sk.auftraege.jobUpdate(userId, { current: z.sn }, lauf))) return;
    await sk.auftraege.emitJobStatus(userId);
    results.push(await importiereZeile(sk, z, userId));
    if (!(await schreibe())) return;
    await sk.auftraege.emitJobStatus(userId);
  }
  await sk.auftraege.jobUpdate(userId, { status: 'done', current: null }, lauf);
  await sk.auftraege.emitJobStatus(userId);
  console.log(
    `CSV import done: ${results.filter(r => r.success).length} ok, ${results.filter(r => !r.success).length} errors`,
  );
}

/** Die Statuszeile zeigt den Fehler, statt ewig zu laufen. */
async function csvImportAufgegeben(k: SetsKontext, n: CsvNutzlast, fehler: string): Promise<void> {
  console.error(`CSV import fatal error: ${fehler}`);
  await k.auftraege.jobUpdate(Number(n.user_id), { status: 'error', error: fehler, current: null }, String(n.lauf));
  await k.auftraege.emitJobStatus(Number(n.user_id));
}

export { fuehreCsvImportAus, csvImportAufgegeben };
