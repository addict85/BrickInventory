/** A process of its own for the catalog import, so the import's large heap
 * does not hit the job process. The work is done by src/catalog/csvImport.ts. */
import { errorMessage, logAndContinue } from '../src/infra/error';
import { READ_CONTRACT } from '../src/services';
import { createImportAccess, createCatalogImports, csvRow } from '../src/catalog';

// Without an IPC channel to stderr instead of a TypeError.
function post(msg: Record<string, unknown>) {
  if (typeof process.send === 'function') process.send(msg);
  else console.error('[csv-worker] kein IPC-Kanal — Meldung verworfen:', JSON.stringify(msg).slice(0, 200));
}

const db = createImportAccess();
const pool = db.pool;
const TASKS = createCatalogImports(db, post, READ_CONTRACT);

type Aufgabe = keyof typeof TASKS;

// The error is already reported; a second one while closing does not hold up the exit.
async function endWithError() {
  await pool.end().catch(logAndContinue('csv-worker:end'));
  process.exit(1);
}

process.on('message', async (msg: { task?: string } | null) => {
  const task = String(msg?.task);
  // What arrives via IPC is checked by no compiler: without this check
  // TASKS['constructor']() would be an empty "success" that sets the daily marker.
  if (!Object.hasOwn(TASKS, task)) {
    // Goes to the server log, not a user message — hence untranslated.
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
    post({ type: 'error', task, error: errorMessage(e) });
    await endWithError();
  }
});

// For test/csv-import-db.test.js; in operation it runs exclusively via fork().
export { TASKS, csvRow };
