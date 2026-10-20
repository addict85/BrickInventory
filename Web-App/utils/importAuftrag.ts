import * as db from '../db/database';
import { meldeUndWeiter } from './httpError';
import { fehlerText, antwortSprache } from './fehlerTexte';

/**
 * Der Auftragsdatensatz eines laufenden Imports — EINE Zeile je Konto.
 *
 * ── Warum diese Datei entstanden ist (Marcos Wunsch vom 20.10.) ─────────────
 *
 * „bitte auch noch umsetzen, dass der Import der BL-XML Importe in der
 *  Android-App angezeigt werden (analog den Set-Importen)."
 *
 * Die App zeigt auf ALLEN Reitern einen Balken, sobald ein Import läuft —
 * „egal von wo er gestartet wurde" (MainScaffold.kt, CsvImportBanner). Gefüttert
 * wird er aus `csv_import_jobs` über den Strom /api/v1/sets/import/csv/stream;
 * dieselbe Quelle hat der globale Balken der Webapp
 * (public/js/01-fortschritt.js). Deshalb sieht ihn auch eine ZWEITE Sitzung
 * desselben Kontos: Der Datensatz hängt am Konto, nicht an der Anfrage.
 *
 * Damit der Wanted-Listen-Import dort auftaucht, muss er in denselben
 * Datensatz schreiben. Die Zugriffe darauf lagen in routes/sets.ts — einer
 * Datei, die ihre Helfer ausdrücklich nicht mehr nach aussen reicht („Der
 * Anhang ist leer … kein Router mehr, der Hilfsfunktionen weiterreicht",
 * Nachtrag 131). Sie stehen deshalb jetzt hier.
 *
 * ── Was hier steht und was nicht ────────────────────────────────────────────
 *
 * HIER: der Zustand (die Tabelle), seine Form nach aussen (buildJobStatus) und
 * das Signal, dass er sich geändert hat (Bus + LISTEN/NOTIFY).
 *
 * NICHT hier: der SSE-Endpunkt und die /status-Route. Das ist HTTP-Oberfläche
 * und bleibt in routes/sets.ts; sie holen sich von hier, was sie brauchen.
 *
 * Die englischen Namen sind beim Umzug geblieben. Sie stehen an 29 Stellen in
 * routes/sets.ts, und ein Umzug, der gleichzeitig umbenennt, ist zwei
 * Änderungen in einem Schritt — die zweite davon unbelegt.
 */

// ── Fortschritt: In-Process Event-Bus ───────────────────────────────────────
// Der Import-Worker läuft im selben Prozess und feuert bei jedem Fortschritt
// ein Event pro User. Der SSE-Endpoint (/import/csv/stream) hört darauf und
// schiebt den Stand an verbundene Clients (Webapp + Android), ganz ohne
// Polling. Der bestehende /status-Endpoint bleibt als Fallback erhalten.
import EventEmitter from 'events';
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
  // csvImportBus ist ein prozesslokaler EventEmitter — im Cluster sieht ihn nur
  // der Worker, der den Import ausführt. Ein Client, dessen SSE-Verbindung in
  // einem ANDEREN Worker liegt, bekam davon nichts mit; deshalb gab es einen
  // 10-Sekunden-Poller auf die Datenbank, dauerhaft, pro offener Verbindung.
  // LISTEN/NOTIFY erledigt genau das, wofür der Poller da war — und die
  // Infrastruktur dafür steht bereits (utils/pgNotify.ts).
  require('../utils/pgNotify').notify('csv_import_progress', String(userId)).catch(() => {});
}


async function jobGet(userId: number) {
  const row = await db.get('SELECT * FROM csv_import_jobs WHERE user_id = $1', [userId]);
  if (!row) return null;
  return { ...row, results: row.results || [] };
}

/**
 * Spalten, die jobSet()/jobUpdate() schreiben dürfen.
 *
 * Beide Funktionen bauen ihre SET-/VALUES-Liste aus Object.keys(fields) — die
 * Spaltennamen gehen also UNPARAMETRISIERT ins Statement (Bezeichner lassen
 * sich in SQL nicht binden). Heute rufen nur interne Stellen mit fest
 * verdrahteten Objektliteralen auf, es ist also keine Lücke. Aber es ist genau
 * die Sorte Helfer, die irgendwann jemand mit `...req.body` füttert, und dann
 * ist es eine. Die Prüfung kostet nichts und macht den Fall unmöglich statt
 * unwahrscheinlich.
 */
const JOB_COLUMNS = new Set(['status', 'total', 'done', 'current', 'results', 'error', 'started_at']);

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
    `INSERT INTO csv_import_jobs (user_id, ${colList}, updated_at)
     VALUES ($1, ${valPlaces}, NOW())
     ON CONFLICT (user_id) DO UPDATE SET ${setClauses}, updated_at = NOW()`,
    [userId, ...values]
  );
}

async function jobUpdate(userId: number, fields: Record<string, unknown>) {
  if (!fields || !Object.keys(fields).length) return;
  const keys   = assertJobColumns(fields);
  const values = keys.map(k => fields[k]);
  const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  await db.run(
    `UPDATE csv_import_jobs SET ${setClauses}, updated_at = NOW() WHERE user_id = $1`,
    [userId, ...values]
  );
}


// ── Ein Import, der NICHT der CSV-Import ist, meldet sich hier an ───────────
//
// Der Wanted-Listen-Import ist der erste davon. Er braucht drei Dinge, und
// genau diese drei stehen hier — damit der nächste Import nicht wieder in die
// Tabelle hineinschreibt, sondern diese Funktionen benutzt.

/** Wieviel Zeit mindestens zwischen zwei Meldungen liegt. */
const MELDE_ABSTAND_MS = 300;

/**
 * „Ab jetzt läuft ein Import" — oder eben nicht.
 *
 * Gibt `false` zurück, wenn schon ein Auftrag LÄUFT. Dann bleibt die Anzeige
 * bei dem, der zuerst da war: Der CSV-Import über 380 Sets ist das, worauf
 * jemand wartet; ihn aus dem Balken zu verdrängen, weil nebenher eine
 * Wanted-Liste eingelesen wird, wäre der falsche Tausch. Der Import läuft
 * trotzdem — nur ohne Balken in den anderen Sitzungen.
 *
 * `results: []` und `done: 0` setzen den alten Stand zurück: Sonst stünde die
 * Zahl des letzten Laufs im Balken, bis die erste Meldung kommt.
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
 *
 * Eine Liste mit 2000 Posten würde sonst 2000 UPDATEs und 2000
 * Benachrichtigungen auslösen, für einen Balken, den kein Auge so fein
 * auflöst. Gemeldet wird höchstens alle 300 ms; der Aufrufer sagt mit
 * `unbedingt`, wenn eine Meldung nicht wegfallen darf (die letzte).
 *
 * Der Zeitpunkt wird JE KONTO gemerkt: Zwei Konten im Haushalt, die
 * gleichzeitig importieren, dürfen sich nicht gegenseitig die Meldungen
 * wegdrosseln.
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
 *
 * `results` trägt je Posten ein Ergebnis — daraus rechnet buildJobStatus die
 * Zahlen ok/warn/err, die der Balken nach dem Ende zeigt. Ohne diese Liste
 * stünde dort „0 ok", obwohl alles geklappt hat.
 *
 * ── Drei Ausgänge, nicht zwei (GEMESSEN) ────────────────────────────────────
 *
 * Ein Posten kann angelegt sein, scheitern — ODER offen bleiben, weil sich
 * seine Nummer oder Farbe nicht abbilden liess. Das ist kein Fehler, aber auch
 * kein Erfolg; es ist genau das, wofür buildJobStatus `warn` führt.
 *
 * `done` kommt vom Aufrufer und ist die Zahl der BEARBEITETEN Posten. Hier
 * stand `ok + fehler`, und dann blieb der Balken stehen: Eine Liste mit drei
 * Posten, von denen einer offen blieb, endete bei „2 von 3" — 67 %, für immer.
 * Beim Abbrechen ist dieselbe Zahl richtig: Sie sagt, wie weit es kam.
 */
export async function beendeAuftrag(
  userId: number,
  angaben: { ok: number; warn?: number; fehler: number; done: number; abgebrochen?: boolean },
): Promise<void> {
  const results = [
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
 *
 * Der Balken trägt in beiden Oberflächen ein Kreuz, und der CSV-Import sieht
 * deshalb alle zehn Sets nach, ob sein Auftrag noch `running` ist. Ein
 * Import, der das nicht täte, hätte einen Abbrechen-Knopf, der lügt.
 *
 * Auch `null` heisst abgebrochen: Ist die Zeile weg (ein zweiter Import hat
 * sie ersetzt), gehört die Anzeige nicht mehr uns.
 */
export async function istAbgebrochen(userId: number): Promise<boolean> {
  const stand = await jobGet(userId)
    .catch((e) => { meldeUndWeiter('import-auftrag:abbruch pruefen', e); return null; });
  return !stand || stand.status !== 'running';
}

export { csvImportBus, buildJobStatus, emitJobStatus, jobGet, jobSet, jobUpdate };
