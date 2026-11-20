import { reportError, logAndContinue } from '../infra/fehler';
import { errorText, responseLanguage, type ErrorCode, type Sprache } from '../infra/fehlerTexte';

/** EINE Zeile je Konto, damit alle Oberflächen denselben Balken zeigen. */

import type { JobsContext } from './kontext';
import { signal } from '../infra/ereignis';
/** Der Stand eines Kontos ist neu geschrieben, in diesem oder einem anderen Prozess; die Nutzlast nennt das Konto. */
const IMPORT_STAND = signal('csv_import_progress');

/** `isWarning` trennt „hat nicht geklappt" von „ist eine Anmerkung"; sonst
 * stünde jede Anmerkung als Fehler da. */
export type ImportResult = {
  success?: boolean;
  isWarning?: boolean;
  vars?: Record<string, string | number>;
  [k: string]: unknown;
};

type ImportJob =
  | {
      status?: string | null;
      total?: number | null;
      done?: number | null;
      current?: string | null;
      error?: string | null;
      results?: ImportResult[] | null;
      updated_at?: Date | string | null;
    }
  | null
  | undefined;

export function buildJobStatus(
  job: ImportJob,
  req?: { headers?: Record<string, unknown> },
  sprache: Sprache = responseLanguage(req),
) {
  if (!job?.status) {
    return { success: false, code: 'kein_import_laeuft', error: errorText('kein_import_laeuft', sprache) };
  }
  const results = (Array.isArray(job.results) ? job.results : []).map((r: ImportResult) =>
    r.code ? { ...r, error: errorText(r.code as ErrorCode, sprache, r.vars) } : r,
  );
  // Ein Set, das der Katalog nicht kennt, ist gebucht, aber eine Warnung wert: Grün hiesse „alles bekannt“.
  const ok = results.filter((r: ImportResult) => r.success && !r.katalog_offen).length;
  const err = results.filter((r: ImportResult) => !r.success && !r.isWarning).length;
  const warn = results.filter(
    (r: ImportResult) => (!r.success && r.isWarning) || (r.success && r.katalog_offen),
  ).length;
  return {
    success: true,
    status: job.status,
    total: job.total || 0,
    done: job.done || 0,
    current: job.current || null,
    ok,
    err,
    warn,
    results,
    error: job.error || null,
    ...(job.updated_at ? { beendet_am: new Date(job.updated_at).toISOString() } : {}),
  };
}

/** Die Ströme lesen den Stand selbst nach; geht das Signal verloren, holt ihn ihr Nachzieh-Takt. */
export async function emitJobStatus(k: JobsContext, userId: number) {
  await IMPORT_STAND.melde(k.db.notification, String(userId)).catch(logAndContinue('import-auftrag:notify'));
}

export const ORPHANED_MIN = 10;

export async function jobGet(k: JobsContext, userId: number) {
  await k.importStand.markOrphaned(userId, errorText('import_unterbrochen', 'de'), ORPHANED_MIN);
  const row = await k.importStand.importStand(userId);
  if (!row) return null;
  return { ...row, results: row.results || [] };
}

export async function jobSet(k: JobsContext, userId: number, fields: Record<string, unknown>) {
  await k.importStand.writeImportStatus(userId, fields);
}

/** Mit `lauf` schreibt nur der Import, dessen Kennung noch eingetragen ist;
 * ein abgelöster Lauf hört an der Rückgabe auf. */
export async function jobUpdate(
  k: JobsContext,
  userId: number,
  fields: Record<string, unknown>,
  lauf?: string,
): Promise<boolean> {
  if (!fields || !Object.keys(fields).length) return true;
  const n = await k.importStand.changeImportStatus(userId, fields, lauf);
  return !lauf || n > 0;
}

/** Nach einem Neustart auch dann, wenn die Zeile als verwaist markiert wurde;
 * abgebrochen oder abgelöst bleibt sie (dann: null). */
export async function setImportFort(
  k: JobsContext,
  userId: number,
  lauf: string,
): Promise<{ results: ImportResult[]; current: string | null } | null> {
  const z = await k.importStand.setRunFort(userId, lauf);
  return z ? { results: Array.isArray(z.results) ? z.results : [], current: z.current ?? null } : null;
}

// ── Andere Importe als CSV melden sich hier an, statt selbst in die Tabelle zu schreiben.

const REPORT_GAP_MS = 300;

/** `false`, wenn schon ein Auftrag LÄUFT: Der Balken bleibt bei dem, der zuerst
 * da war; der Import läuft trotzdem. */
export async function startJob(
  k: JobsContext,
  userId: number,
  angaben: { total: number; current?: string | null },
): Promise<boolean> {
  // Scheitert das Lesen, wird NICHT gestartet: Einen fremden Import im Zweifel
  // zu überschreiben ist der teurere Fehler.
  const laufend = await jobGet(k, userId).catch(e => {
    reportError('import-auftrag:stand lesen', e);
    return { status: 'running' };
  });
  if (laufend && (laufend.status === 'running' || laufend.status === 'pending')) return false;
  await jobSet(k, userId, {
    status: 'running',
    total: angaben.total,
    done: 0,
    current: angaben.current ?? null,
    results: JSON.stringify([]),
    error: null,
    started_at: k.uhr.datum().toISOString(),
  });
  await emitJobStatus(k, userId);
  return true;
}

const gemeldet = (k: JobsContext) => k.faecher.fach('importGemeldet', () => new Map<number, number>());

/** Gedrosselt, damit ein schneller Import nicht jede Zeile in die Datenbank schreibt. */
export async function reportJob(
  k: JobsContext,
  userId: number,
  angaben: { done: number; total?: number; current?: string | null },
  unbedingt = false,
): Promise<void> {
  const jetzt = k.uhr.jetzt();
  const _lastly = gemeldet(k);
  if (!unbedingt && jetzt - (_lastly.get(userId) ?? 0) < REPORT_GAP_MS) return;
  _lastly.set(userId, jetzt);
  await jobUpdate(k, userId, {
    done: angaben.done,
    ...(angaben.total !== undefined ? { total: angaben.total } : {}),
    ...(angaben.current !== undefined ? { current: angaben.current } : {}),
  });
  await emitJobStatus(k, userId);
}

// Ergebnisse je Posten, sonst zeigt der Balken „0 ok“; offen bleibt ein eigener Ausgang (warn).
export async function beendeAuftrag(
  k: JobsContext,
  userId: number,
  angaben: { ok: number; warn?: number; fehler: number; done: number; abgebrochen?: boolean },
  zeilen?: ImportResult[],
): Promise<void> {
  const results = zeilen ?? [
    ...Array.from({ length: angaben.ok }, () => ({ success: true })),
    ...Array.from({ length: angaben.warn ?? 0 }, () => ({ success: false, isWarning: true })),
    ...Array.from({ length: angaben.fehler }, () => ({ success: false })),
  ];
  await jobUpdate(k, userId, {
    status: angaben.abgebrochen ? 'cancelled' : 'done',
    current: null,
    done: angaben.done,
    results: JSON.stringify(results),
  });
  gemeldet(k).delete(userId);
  await emitJobStatus(k, userId);
}

// Ohne diese Frage hätte der Balken ein Kreuz, das lügt; auch eine fehlende Zeile heisst abgebrochen.
export async function isAborted(k: JobsContext, userId: number): Promise<boolean> {
  const stand = await jobGet(k, userId).catch(e => {
    reportError('import-auftrag:abbruch pruefen', e);
    return null;
  });
  return stand?.status !== 'running';
}

/** Weckt, wenn ein Prozess den Stand eines Kontos schrieb; gibt das Abmelden zurück. */
export function atImportStatus(k: JobsContext, f: (konto?: string) => void): () => void {
  return IMPORT_STAND.horche(k.db.notification, f);
}
