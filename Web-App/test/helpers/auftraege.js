'use strict';
/**
 * Importe laufen als Auftrag im Job-Prozess (src/jobQueue/importAsJob.ts);
 * im Test arbeitet sie ein Worker in diesem Prozess ab, sonst wartete die
 * Anfrage vergeblich.
 *
 *   importWorker(t, _req);
 *
 * @param {{ after: (f: () => unknown) => void }} t
 * @param {(pfad: string) => any} _req  buildAndRequire() der Testdatei
 */
function importWorker(t, _req) {
  const { startJobWorker } = _req('jobs/startJobs.js');
  const worker = startJobWorker(require('./sources').testServices(), { arten: ['csv_import'], taktMs: 50 });
  // Auch die LISTEN-Verbindung: Sie hielte den Testprozess sonst am Leben.
  t.after(async () => {
    await worker.stop();
    await require('./sources').testAccess().notification.close();
  });
}

module.exports = { importWorker };
