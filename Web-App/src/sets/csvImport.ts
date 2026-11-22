/** CSV import of the sets: read rows, start the job, report the state. */
import { beforeThe, errorMessage, publicError } from '../infra/error';
import { buildJobStatus } from '../jobQueue';
import { normalizeSetNumber } from '../infra/setNumber';
import { csvReadIn, defusingUndo, csvDatum, rowsList } from '../infra/csvExport';
import { failDomain, type Language } from '../infra/errorTexts';
import { randomUUID } from 'node:crypto';
import * as repo from './repository/setDetail';
import { attempts } from '../infra/result';
import type { SetsContext } from './context';

export interface ImportRow {
  sn: string;
  qty: number;
  purchasePrice: number | null;
  condition: string | null;
  acquiredAt: string | null;
  row?: number;
  error?: { code: 'csv_quantity_invalid' | 'csv_no_set_number'; wert?: string };
}

/** Turning "x" into a 1 and "-2" into a 2 would silently book something other than what is in the file. */
function csvMenge(raw: string): number | null {
  const s = raw.trim();
  if (s === '') return 1;
  return /^\d{1,6}$/.test(s) && Number(s) >= 1 ? Number(s) : null;
}

/** Column names without case and BOM. */
export function setCsvRows(text: string): { rows: ImportRow[]; uebersprungen: number[] } {
  let parsed: ReturnType<typeof csvReadIn>;
  try {
    parsed = csvReadIn(text);
  } catch (e) {
    failDomain('ungueltig', 'csv_parse_error', { reason: errorMessage(e) });
  }
  if (!parsed.records.length) {
    if (parsed.uebersprungen.length)
      failDomain('ungueltig', 'csv_no_usable_row', { zeilen: rowsList(parsed.uebersprungen) });
    failDomain('ungueltig', 'csv_no_data_rows');
  }
  const rows: ImportRow[] = [];
  for (const [i, raw] of parsed.records.entries()) {
    const line = parsed.zeilen[i];
    const row: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw))
      row[
        k
          .toLowerCase()
          .trim()
          .replace(/^\uFEFF/, '')
      ] = String(defusingUndo(v) ?? '');
    const rawSn = row.set_number || row.setnummer || row.set || Object.values(row)[0];
    const sn = rawSn ? beforeThe(String(rawSn), ';').trim() : '';
    const leer = { sn, qty: 0, purchasePrice: null, condition: null, acquiredAt: null, ...(line ? { row: line } : {}) };
    if (!sn) {
      rows.push({ ...leer, error: { code: 'csv_no_set_number' } });
      continue;
    }
    const quantityRaw = String(row.quantity ?? row.anzahl ?? row.qty ?? row.menge ?? '');
    const qty = csvMenge(quantityRaw);
    if (qty === null) {
      rows.push({ ...leer, error: { code: 'csv_quantity_invalid', wert: quantityRaw.trim().slice(0, 20) } });
      continue;
    }
    const rawPrice = row.purchase_price ?? row.kaufpreis ?? row.einkaufspreis ?? row.price ?? '';
    const priceValue = String(rawPrice).trim() !== '' ? parseFloat(String(rawPrice).replace(',', '.')) : null;
    const state = String(row.condition || row.zustand || row.kondition || '')
      .trim()
      .toUpperCase();
    rows.push({
      sn,
      qty,
      ...(line ? { row: line } : {}),
      purchasePrice: priceValue !== null && !Number.isNaN(priceValue) ? priceValue : null,
      condition: ['N', 'U'].includes(state) ? state : null,
      // 05.03.2026 is the 5th of March, not the 3rd of May.
      acquiredAt: csvDatum(row.acquired_at || row.erfassungsdatum || row.datum),
    });
  }
  return { rows, uebersprungen: parsed.uebersprungen };
}

/** For existing sets the import increases the quantity, the single capture rejects it: the UI asks. */
async function alreadyPresent(sk: SetsContext, userId: number, rows: ImportRow[]): Promise<string[]> {
  const da = new Set((await repo.setsWithQuantity(sk.db, userId)).map(s => s.set_number));
  const hits = rows
    .filter(r => !r.error)
    .map(r => normalizeSetNumber(r.sn))
    .filter(sn => da.has(sn));
  return [...new Set(hits)];
}

/** A running import of the same account is aborted; `checkOnly` only reads. */
export async function startSetCsvImport(sk: SetsContext, userId: number, text: string, checkOnly = false) {
  const { rows, uebersprungen } = setCsvRows(text);
  const existing = await alreadyPresent(sk, userId, rows);
  if (checkOnly) return { total: rows.length, uebersprungen, existing, started: false };
  const running = await sk.jobQueue.jobGet(userId);
  if (running && running.status === 'running') await sk.jobQueue.jobUpdate(userId, { status: 'cancelled' });
  const lauf = randomUUID();
  await sk.jobQueue.jobSet(userId, {
    status: 'running',
    total: rows.length,
    done: 0,
    current: null,
    results: JSON.stringify([]),
    error: null,
    run_id: lauf,
  });
  try {
    await sk.jobQueue.placeJobOne('csv_import', { user_id: userId, lauf, rows }, { userId, maxAttempts: 3 });
  } catch (e) {
    await attempts(
      'csv-import:fehler vermerken',
      sk.jobQueue.jobUpdate(userId, { status: 'error', error: publicError(e, 'csv-import:einstellen').error }, lauf),
    );
    throw e;
  }
  await sk.jobQueue.reportJobStatus(userId);
  return { total: rows.length, uebersprungen, existing, started: true };
}

export async function cancelSetCsvImport(k: SetsContext, userId: number) {
  // No catch: if recording fails, the import would keep running while the response said "aborted".
  await k.jobQueue.jobUpdate(userId, { status: 'cancelled' });
  await k.jobQueue.reportJobStatus(userId);
}

type Header = { headers?: Record<string, unknown> };

export async function csvImportStand(k: SetsContext, uid: number, req: Header) {
  return buildJobStatus(await k.jobQueue.jobGet(uid), req);
}

/** In the open stream there is no status code any more: a read error becomes "no import". */
export async function csvImportStatusForStream(k: SetsContext, uid: number, req: Header, language: Language) {
  return buildJobStatus(await k.jobQueue.jobGet(uid), req, language);
}

/** Reports every state of this account's CSV import, from this and from other processes. */
export function subscribeCsvImportStatus(k: SetsContext, uid: number, report: () => void): () => void {
  return k.jobQueue.atImportStatus(konto => {
    if (String(konto) === String(uid)) report();
  });
}
