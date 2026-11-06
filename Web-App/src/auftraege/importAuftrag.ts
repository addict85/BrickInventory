import * as stand from './repository/importStand';
import { meldeUndWeiter, logAndContinue } from '../infra/fehler';
import { fehlerText, antwortSprache, type FehlerCode, type Sprache } from '../infra/fehlerTexte';

/** EINE Zeile je Konto, damit alle Oberflächen denselben Balken zeigen.
 * Ausführlich: docs/begruendungen/src/auftraege/importAuftrag.ts.md#abschnitt */

// Der Ereignisbus schiebt den Stand ohne Polling an verbundene Ströme; /status bleibt als Rückfall.
import EventEmitter from 'events';
import * as pgNotify from '../../db/pgNotify';
export const csvImportBus = new EventEmitter();
csvImportBus.setMaxListeners(0); // beliebig viele gleichzeitige Streams

/** `isWarning` trennt „hat nicht geklappt" von „ist eine Anmerkung"; sonst
 * stünde jede Anmerkung als Fehler da. */
export type ImportErgebnis = { success?: boolean; isWarning?: boolean; [k: string]: any };

type ImportAuftrag = {
  status?: string | null;
  total?: number | null;
  done?: number | null;
  current?: string | null;
  error?: string | null;
  results?: ImportErgebnis[] | null;
  updated_at?: Date | string | null;
} | null | undefined;

export function buildJobStatus(job: ImportAuftrag, req?: { headers?: Record<string, unknown> }, sprache: Sprache = antwortSprache(req)) {
  if (!job || !job.status) {
    return { success: false, code: 'kein_import_laeuft',
             error: fehlerText('kein_import_laeuft', sprache) };
  }
  const results = (Array.isArray(job.results) ? job.results : []).map((r: ImportErgebnis) =>
    r.code ? { ...r, error: fehlerText(r.code as FehlerCode, sprache, r.vars) } : r);
  // Ein Set, das der Katalog nicht kennt, ist gebucht, aber eine Warnung wert: Grün hiesse „alles bekannt“.
  const ok   = results.filter((r: ImportErgebnis)=>r.success && !r.katalog_offen).length;
  const err  = results.filter((r: ImportErgebnis)=>!r.success && !r.isWarning).length;
  const warn = results.filter((r: ImportErgebnis)=>(!r.success && r.isWarning) || (r.success && r.katalog_offen)).length;
  return {
    success: true,
    status:  job.status,
    total:   job.total  || 0,
    done:    job.done   || 0,
    current: job.current || null,
    ok, err, warn,
    results,
    error:   job.error  || null,
    ...(job.updated_at ? { beendet_am: new Date(job.updated_at).toISOString() } : {}),
  };
}

export async function emitJobStatus(userId: number) {
  try {
    const job = await jobGet(userId);
    // Ohne Request ist die Sprache des Empfängers unbekannt; `code` reist mit.
    csvImportBus.emit(`progress:${userId}`, buildJobStatus(job));
  } catch (_) { /* Fortschritt geht notfalls über den Nachzieh-Timer im Stream */ }
  // Der Bus ist prozesslokal, der Import läuft im Job-Prozess: NOTIFY trägt den Stand in den Web-Prozess.
  pgNotify.notify('csv_import_progress', String(userId)).catch(logAndContinue('import-auftrag:notify'));
}

export const VERWAIST_MIN = 10;

export async function jobGet(userId: number) {
  await stand.markiereVerwaist(userId, fehlerText('import_unterbrochen', 'de'), VERWAIST_MIN);
  const row = await stand.importStand(userId);
  if (!row) return null;
  return { ...row, results: row.results || [] };
}

export async function jobSet(userId: number, fields: Record<string, unknown>) {
  await stand.schreibeImportStand(userId, fields);
}

/** Mit `lauf` schreibt nur der Import, dessen Kennung noch eingetragen ist;
 * ein abgelöster Lauf hört an der Rückgabe auf. */
export async function jobUpdate(userId: number, fields: Record<string, unknown>, lauf?: string): Promise<boolean> {
  if (!fields || !Object.keys(fields).length) return true;
  const n = await stand.aendereImportStand(userId, fields, lauf);
  return !lauf || n > 0;
}

/** Nach einem Neustart auch dann, wenn die Zeile als verwaist markiert wurde;
 * abgebrochen oder abgelöst bleibt sie (dann: null). */
export async function setzeImportFort(userId: number, lauf: string):
    Promise<{ results: ImportErgebnis[]; current: string | null } | null> {
  const z = await stand.setzeLaufFort(userId, lauf);
  return z ? { results: Array.isArray(z.results) ? z.results : [], current: z.current ?? null } : null;
}

// ── Andere Importe als CSV melden sich hier an, statt selbst in die Tabelle zu schreiben.

const MELDE_ABSTAND_MS = 300;

/** `false`, wenn schon ein Auftrag LÄUFT: Der Balken bleibt bei dem, der zuerst
 * da war; der Import läuft trotzdem.
 * Ausführlich: docs/begruendungen/src/auftraege/importAuftrag.ts.md#starteauftrag */
export async function starteAuftrag(
  userId: number, angaben: { total: number; current?: string | null },
): Promise<boolean> {
  // Scheitert das Lesen, wird NICHT gestartet: Einen fremden Import im Zweifel
  // zu überschreiben ist der teurere Fehler.
  const laufend = await jobGet(userId)
    .catch((e) => { meldeUndWeiter('import-auftrag:stand lesen', e); return { status: 'running' }; });
  if (laufend && (laufend.status === 'running' || laufend.status === 'pending')) return false;
  await jobSet(userId, {
    status: 'running',
    total: angaben.total,
    done: 0,
    current: angaben.current ?? null,
    results: JSON.stringify([]),
    error: null,
    started_at: new Date().toISOString(),
  });
  await emitJobStatus(userId);
  return true;
}

/** Gedrosselt, damit ein schneller Import nicht jede Zeile in die Datenbank schreibt.
 * Ausführlich: docs/begruendungen/src/auftraege/importAuftrag.ts.md#zuletzt */
const _zuletzt = new Map<number, number>();
export async function meldeAuftrag(
  userId: number,
  angaben: { done: number; total?: number; current?: string | null },
  unbedingt = false,
): Promise<void> {
  const jetzt = Date.now();
  if (!unbedingt && jetzt - (_zuletzt.get(userId) ?? 0) < MELDE_ABSTAND_MS) return;
  _zuletzt.set(userId, jetzt);
  await jobUpdate(userId, {
    done: angaben.done,
    ...(angaben.total !== undefined ? { total: angaben.total } : {}),
    ...(angaben.current !== undefined ? { current: angaben.current } : {}),
  });
  await emitJobStatus(userId);
}

// Ausführlich: docs/begruendungen/src/auftraege/importAuftrag.ts.md#beendeauftrag
export async function beendeAuftrag(
  userId: number,
  angaben: { ok: number; warn?: number; fehler: number; done: number; abgebrochen?: boolean },
  zeilen?: ImportErgebnis[],
): Promise<void> {
  const results = zeilen ?? [
    ...Array.from({ length: angaben.ok }, () => ({ success: true })),
    ...Array.from({ length: angaben.warn ?? 0 }, () => ({ success: false, isWarning: true })),
    ...Array.from({ length: angaben.fehler }, () => ({ success: false })),
  ];
  await jobUpdate(userId, {
    status: angaben.abgebrochen ? 'cancelled' : 'done',
    current: null,
    done: angaben.done,
    results: JSON.stringify(results),
  });
  _zuletzt.delete(userId);
  await emitJobStatus(userId);
}

// Ausführlich: docs/begruendungen/src/auftraege/importAuftrag.ts.md#istabgebrochen
export async function istAbgebrochen(userId: number): Promise<boolean> {
  const stand = await jobGet(userId)
    .catch((e) => { meldeUndWeiter('import-auftrag:abbruch pruefen', e); return null; });
  return !stand || stand.status !== 'running';
}

/** Weckt, wenn ein anderer Prozess den Stand eines Kontos schrieb; gibt das Abmelden zurück. */
export function beiImportStand(f: (konto?: string) => void): () => void {
  pgNotify.listen('csv_import_progress', f);
  return () => pgNotify.unlisten('csv_import_progress', f);
}
