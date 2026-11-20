/** Eigener Prozess für den Katalog-Import, damit der grosse Heap des Imports
 * den Job-Prozess nicht trifft. Die Arbeit macht src/katalog/csvImport.ts. */
import { fehlertext, logAndContinue } from '../src/infra/fehler';
import { LESEVERTRAG } from '../src/dienste';
import { createImportAccess, createCatalogImports, csvRow } from '../src/katalog';

// Ohne IPC-Kanal nach stderr statt TypeError.
function post(msg: Record<string, unknown>) {
  if (typeof process.send === 'function') process.send(msg);
  else console.error('[csv-worker] kein IPC-Kanal — Meldung verworfen:', JSON.stringify(msg).slice(0, 200));
}

const db = createImportAccess();
const pool = db.pool;
const TASKS = createCatalogImports(db, post, LESEVERTRAG);

type Aufgabe = keyof typeof TASKS;

// Der Fehler ist schon gemeldet; ein zweiter beim Schliessen hält den Ausstieg nicht auf.
async function endWithError() {
  await pool.end().catch(logAndContinue('csv-worker:end'));
  process.exit(1);
}

process.on('message', async (msg: { task?: string } | null) => {
  const task = String(msg?.task);
  // Was per IPC ankommt, prüft kein Übersetzer: Ohne diese Prüfung wäre
  // TASKS['constructor']() ein leerer „Erfolg“, der den Tagesmarker setzt.
  if (!Object.hasOwn(TASKS, task)) {
    // Geht ins Serverprotokoll, keine Nutzermeldung — deshalb unübersetzt.
    post({ type: 'error', task, error: `Unbekannte Aufgabe: ${task}` });
    return endWithError();
  }
  try {
    const total = await TASKS[task as Aufgabe]();
    post({ type: 'done', filename: task, total });
    post({ type: 'complete', task });
    await pool.end();
    process.exit(0);
  } catch (e) {
    post({ type: 'error', task, error: fehlertext(e) });
    await endWithError();
  }
});

// Für test/csv-import-db.test.js; der Betrieb geht ausschliesslich über fork().
export { TASKS, csvRow };
