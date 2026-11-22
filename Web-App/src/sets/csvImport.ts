/** CSV import of the sets: read rows, start the job, report the state. */
import { beforeThe, errorMessage, publicError } from '../infra/error';
import { buildJobStatus } from '../jobQueue';
import { normalizeSetNumber } from '../infra/setNumber';
import { csvReadIn, defusingUndo, csvDatum, rowsList, csvAny, csvFirst } from '../infra/csvExport';
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

/** Header keys in lower case without BOM; values without the CSV defusing. */
function normalizedRow(raw: Record<string, unknown>): Record<string, string> {
  const row: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw))
    row[k.toLowerCase().trim().replace(/^﻿/, '')] = String(defusingUndo(v) ?? '');
  return row;
}

function importRowOf(row: Record<string, string>, line: number | undefined): ImportRow {
  const rawSn = csvFirst(row, 'set_number', 'setnummer', 'set') || Object.values(row)[0];
  const sn = rawSn ? beforeThe(String(rawSn), ';').trim() : '';
  const leer = { sn, qty: 0, purchasePrice: null, condition: null, acquiredAt: null, ...(line ? { row: line } : {}) };
  if (!sn) return { ...leer, error: { code: 'csv_no_set_number' } };
  const quantityRaw = String(csvAny(row, 'quantity', 'anzahl', 'qty', 'menge') ?? '');
  const qty = csvMenge(quantityRaw);
  if (qty === null) return { ...leer, error: { code: 'csv_quantity_invalid', wert: quantityRaw.trim().slice(0, 20) } };
  const rawPrice = csvAny(row, 'purchase_price', 'kaufpreis', 'einkaufspreis', 'price') ?? '';
  const priceValue = String(rawPrice).trim() !== '' ? parseFloat(String(rawPrice).replace(',', '.')) : null;
  const state = String(csvFirst(row, 'condition', 'zustand', 'kondition') || '')
    .trim()
    .toUpperCase();
  return {
    sn,
    qty,
    ...(line ? { row: line } : {}),
    purchasePrice: priceValue !== null && !Number.isNaN(priceValue) ? priceValue : null,
    condition: ['N', 'U'].includes(state) ? state : null,
    // 05.03.2026 is the 5th of March, not the 3rd of May.
    acquiredAt: csvDatum(csvFirst(row, 'acquired_at', 'erfassungsdatum', 'datum')),
  };
}

/** Column names without case and BOM. */
export function setCsvRows(text: string): { rows: ImportRow[]; skipped: number[] } {
  let parsed: ReturnType<typeof csvReadIn>;
  try {
    parsed = csvReadIn(text);
  } catch (e) {
    failDomain('invalid', 'csv_parse_error', { reason: errorMessage(e) });
  }
  if (!parsed.records.length) {
    if (parsed.skipped.length) failDomain('invalid', 'csv_no_usable_row', { rows: rowsList(parsed.skipped) });
    failDomain('invalid', 'csv_no_data_rows');
  }
  const rows = parsed.records.map((raw, i) => importRowOf(normalizedRow(raw), parsed.rows[i]));
  return { rows, skipped: parsed.skipped };
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
  const { rows, skipped } = setCsvRows(text);
  const existing = await alreadyPresent(sk, userId, rows);
  if (checkOnly) return { total: rows.length, skipped, existing, started: false };
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
  return { total: rows.length, skipped, existing, started: true };
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
  return k.jobQueue.atImportStatus(account => {
    if (String(account) === String(uid)) report();
  });
}
