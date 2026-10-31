import * as db from '../../db/database';
import { meldeUndWeiter, logAndContinue } from '../infra/httpError';
import { fehlerText, antwortSprache } from '../infra/fehlerTexte';

/**
 * Der Auftragsdatensatz eines laufenden Imports — EINE Zeile je Konto.
 * Ausführlich: docs/begruendungen/src/auftraege/importAuftrag.ts.md#abschnitt
 */

// ── Fortschritt: In-Process Event-Bus ───────────────────────────────────────
// Der Import-Worker läuft im selben Prozess und feuert bei jedem Fortschritt
// ein Event pro User. Der SSE-Endpoint (/import/csv/stream) hört darauf und
// schiebt den Stand an verbundene Clients (Webapp + Android), ganz ohne
// Polling. Der bestehende /status-Endpoint bleibt als Fallback erhalten.
import EventEmitter from 'events';
import * as pgNotify from '../../db/pgNotify';
const csvImportBus = new EventEmitter();
csvImportBus.setMaxListeners(0); // beliebig viele gleichzeitige Streams

// Baut das Status-Objekt aus einem Job-Datensatz — gemeinsam genutzt von
/**
 * Ein Ergebnis je Set im CSV-Import — nur die drei Felder, nach denen hier
 * gezaehlt wird. `isWarning` trennt „hat nicht geklappt" von „ist eine
 * Anmerkung"; ohne die Unterscheidung stuende jede Anmerkung als Fehler da.
 */
type ImportErgebnis = { success?: boolean; isWarning?: boolean; [k: string]: any };

/** Ein Auftragsdatensatz aus import_jobs, soweit buildJobStatus ihn liest. */
type ImportAuftrag = {
  status?: string | null;
  total?: number | null;
  done?: number | null;
  current?: string | null;
  error?: string | null;
  results?: ImportErgebnis[] | null;
} | null | undefined;

// /status (Polling-Fallback) und /stream (SSE).
function buildJobStatus(job: ImportAuftrag, req?: any) {
  if (!job || !job.status) {
    return { success: false, code: 'kein_import_laeuft',
             error: fehlerText('kein_import_laeuft', antwortSprache(req)) };
  }
  const results = Array.isArray(job.results) ? job.results : [];
  const ok   = results.filter((r: ImportErgebnis)=>r.success).length;
  const err  = results.filter((r: ImportErgebnis)=>!r.success && !r.isWarning).length;
  const warn = results.filter((r: ImportErgebnis)=>!r.success &&  r.isWarning).length;
  return {
    success: true,
    status:  job.status,
    total:   job.total  || 0,
    done:    job.done   || 0,
    current: job.current || null,
    ok, err, warn,
    results,
    error:   job.error  || null,
  };
}

// Wird vom Import-Worker nach jedem jobUpdate aufgerufen: liest den frischen
// Stand und feuert ihn an alle SSE-Listener dieses Users.
async function emitJobStatus(userId: number) {
  try {
    const job = await jobGet(userId);
    // Ohne Request: Diese Meldung geht an den Ereignisbus, nicht an eine
    // bestimmte Anfrage — die Sprache des Empfaengers ist hier unbekannt. Sie
    // traegt aber `code`, und der Client kann daraus selbst etwas machen.
    csvImportBus.emit(`progress:${userId}`, buildJobStatus(job));
  } catch (_) { /* Fortschritt geht notfalls über den Nachzieh-Timer im Stream */ }
  // Über Prozessgrenzen hinweg signalisieren.
  //
  // csvImportBus ist prozesslokal; der Import läuft im Job-Prozess, der
  // SSE-Strom im Web-Prozess. Das NOTIFY trägt den Fortschritt hinüber.
  pgNotify.notify('csv_import_progress', String(userId)).catch(logAndContinue('import-auftrag:notify'));
}


/** Ohne Lebenszeichen seit so vielen Minuten gilt ein laufender Auftrag als verwaist. */
export const VERWAIST_MIN = 10;

async function jobGet(userId: number) {
  // Lief der Auftrag in einem Prozess, den es nicht mehr gibt (Neustart,
  // Absturz), schreibt niemand mehr. „running" bliebe sonst stehen und sperrte
  // jeden weiteren Import. Ein Set braucht höchstens gut vier Minuten.
  await db.run(
    `UPDATE import_stand SET status = 'error', current = NULL, error = $2, updated_at = NOW()
      WHERE user_id = $1 AND status IN ('running', 'pending')
        AND updated_at < NOW() - make_interval(mins => $3)`,
    [userId, fehlerText('import_unterbrochen', 'de'), VERWAIST_MIN]);
  const row = await db.get('SELECT * FROM import_stand WHERE user_id = $1', [userId]);
  if (!row) return null;
  return { ...row, results: row.results || [] };
}

/**
 * Spalten, die jobSet()/jobUpdate() schreiben dürfen.
 * Ausführlich: docs/begruendungen/src/auftraege/importAuftrag.ts.md#job-columns
 */
const JOB_COLUMNS = new Set(['status', 'total', 'done', 'current', 'results', 'error', 'started_at', 'run_id']);

/**
 * @param {Record<string, unknown>} fields
 * @returns {string[]} geprüfte Spaltennamen
 */
// Der Injektionsschutz dieser Datei: Die Schluessel landen als SPALTENNAMEN
// im Abfragetext (dort hilft keine Parameterbindung), deshalb die
// Positivliste. Der Typ sagt, dass beliebige Schluessel hereinkommen
// duerfen — genau darum wird hier geprueft.
function assertJobColumns(fields: Record<string, unknown>): string[] {
  const keys = Object.keys(fields);
  for (const k of keys) {
    if (!JOB_COLUMNS.has(k)) throw new Error(`jobSet: unerlaubte Spalte "${k}"`);
  }
  return keys;
}

async function jobSet(userId: number, fields: Record<string, unknown>) {
  const keys   = assertJobColumns(fields);
  const values = keys.map(k => fields[k]);
  // Build: INSERT ... ON CONFLICT (user_id) DO UPDATE SET k=$n, ...
  const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const colList    = keys.join(', ');
  const valPlaces  = keys.map((_, i) => `$${i + 2}`).join(', ');
  await db.run(
    `INSERT INTO import_stand (user_id, ${colList}, updated_at)
     VALUES ($1, ${valPlaces}, NOW())
     ON CONFLICT (user_id) DO UPDATE SET ${setClauses}, updated_at = NOW()`,
    [userId, ...values]
  );
}

/**
 * Mit `lauf` schreibt nur der Import, dessen Kennung noch eingetragen ist;
 * die Rückgabe sagt, ob er das noch ist. Ein abgelöster Lauf hört daran auf.
 */
async function jobUpdate(userId: number, fields: Record<string, unknown>, lauf?: string): Promise<boolean> {
  if (!fields || !Object.keys(fields).length) return true;
  const keys   = assertJobColumns(fields);
  const values = keys.map(k => fields[k]);
  const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const r = await db.run(
    `UPDATE import_stand SET ${setClauses}, updated_at = NOW()
      WHERE user_id = $1${lauf ? ` AND run_id = $${keys.length + 2} AND status = 'running'` : ''}`,
    lauf ? [userId, ...values, lauf] : [userId, ...values]
  );
  return !lauf || (r?.changes ?? 0) > 0;
}


/**
 * Ein CSV-Lauf nimmt seine Zeile wieder auf — nach einem Neustart auch dann,
 * wenn jobGet() sie inzwischen als verwaist markiert hat. Abgebrochen oder von
 * einem neuen Lauf abgelöst, bleibt sie, wie sie ist (dann: null).
 */
async function setzeImportFort(userId: number, lauf: string):
    Promise<{ results: ImportErgebnis[]; current: string | null } | null> {
  const z = await db.get(
    `UPDATE import_stand SET status = 'running', error = NULL, updated_at = NOW()
      WHERE user_id = $1 AND run_id = $2 AND status IN ('running', 'error')
      RETURNING results, current`, [userId, lauf]);
  return z ? { results: Array.isArray(z.results) ? z.results : [], current: z.current ?? null } : null;
}

// ── Ein Import, der NICHT der CSV-Import ist, meldet sich hier an ───────────
//
// Der Wanted-Listen-Import ist der erste davon. Er braucht drei Dinge, und
// genau diese drei stehen hier — damit der nächste Import nicht wieder in die
// Tabelle hineinschreibt, sondern diese Funktionen benutzt.

/** Wieviel Zeit mindestens zwischen zwei Meldungen liegt. */
const MELDE_ABSTAND_MS = 300;

/**
 * Gibt `false` zurück, wenn schon ein Auftrag LÄUFT. Dann bleibt die Anzeige
 * bei dem, der zuerst da war: Der CSV-Import über 380 Sets ist das, worauf
 * jemand wartet; ihn aus dem Balken zu verdrängen, weil nebenher eine
 * Wanted-Liste eingelesen wird, wäre der falsche Tausch. Der Import läuft …
 * Ausführlich: docs/begruendungen/src/auftraege/importAuftrag.ts.md#starteauftrag
 */
export async function starteAuftrag(
  userId: number, angaben: { total: number; current?: string | null },
): Promise<boolean> {
  // Scheitert das Lesen, wird es GEMELDET und der Auftrag NICHT gestartet:
  // Ohne den Stand wissen wir nicht, ob gerade ein fremder Import läuft, und
  // ihn im Zweifel zu überschreiben ist der teurere Fehler.
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

/**
 * Fortschritt melden — GEDROSSELT.
 * Ausführlich: docs/begruendungen/src/auftraege/importAuftrag.ts.md#zuletzt
 */
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

/**
 * Der Auftrag ist durch.
 * Ausführlich: docs/begruendungen/src/auftraege/importAuftrag.ts.md#beendeauftrag
 */
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

/**
 * Hat jemand abgebrochen?
 * Ausführlich: docs/begruendungen/src/auftraege/importAuftrag.ts.md#istabgebrochen
 */
export async function istAbgebrochen(userId: number): Promise<boolean> {
  const stand = await jobGet(userId)
    .catch((e) => { meldeUndWeiter('import-auftrag:abbruch pruefen', e); return null; });
  return !stand || stand.status !== 'running';
}

export { csvImportBus, buildJobStatus, emitJobStatus, jobGet, jobSet, jobUpdate, setzeImportFort };
export type { ImportErgebnis };
