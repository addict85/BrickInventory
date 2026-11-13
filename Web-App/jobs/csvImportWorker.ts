/** Eigener Prozess für den Katalog-Import, damit der grosse Heap des Imports
 * den Job-Prozess nicht trifft. Die Arbeit macht src/katalog/csvImport.ts. */
import { Pool } from 'pg';
import { fehlertext, logAndContinue } from '../src/infra/fehler';
import { datenbankVerbindung, systemVerbindung } from '../src/infra/konfig';
import { katalogImporte, parseCsvLine } from '../src/katalog';

// Ohne IPC-Kanal nach stderr statt TypeError.
function send(msg: Record<string, unknown>) {
  if (typeof process.send === 'function') process.send(msg);
  else console.error('[csv-worker] kein IPC-Kanal — Meldung verworfen:', JSON.stringify(msg).slice(0, 200));
}

// Der Abgleich von rb_sets fragt, ob irgendein Konto ein Set hält: über Kontogrenzen,
// also als Systemrolle; die Laufzeitrolle sähe ohne Konto keine Zeile und löschte es.
const pool = new Pool(systemVerbindung() ?? datenbankVerbindung());
const TASKS = katalogImporte(pool, send);

type Aufgabe = keyof typeof TASKS;

process.on('message', async (msg: { task?: string } | null) => {
  const task = String(msg?.task);
  // Was per IPC ankommt, prüft kein Übersetzer: Ohne diese Prüfung wäre
  // TASKS['constructor']() ein leerer „Erfolg“, der den Tagesmarker setzt.
  if (!Object.hasOwn(TASKS, task)) {
    // Geht ins Serverprotokoll, keine Nutzermeldung — deshalb unübersetzt.
    send({ type: 'error', task, error: `Unbekannte Aufgabe: ${task}` });
    await pool.end().catch(logAndContinue('csv-worker:end'));
    process.exit(1);
    return;
  }
  try {
    const total = await TASKS[task as Aufgabe]();
    send({ type: 'done', filename: task, total });
    send({ type: 'complete', task });
    await pool.end();
    process.exit(0);
  } catch (e) {
    send({ type: 'error', task, error: fehlertext(e) });
    await pool.end().catch(logAndContinue('csv-worker:end'));
    process.exit(1);
  }
});

// Für test/csv-import-db.test.js; der Betrieb geht ausschliesslich über fork().
export { TASKS, parseCsvLine };
