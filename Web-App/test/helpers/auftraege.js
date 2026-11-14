'use strict';
/**
 * Importe laufen als Auftrag im Job-Prozess (src/auftraege/importAlsAuftrag.ts);
 * im Test arbeitet sie ein Worker in diesem Prozess ab, sonst wartete die
 * Anfrage vergeblich.
 *
 *   importWorker(t, _req);
 *
 * @param {{ after: (f: () => unknown) => void }} t
 * @param {(pfad: string) => any} _req  buildAndRequire() der Testdatei
 */
function importWorker(t, _req) {
  const { starteAuftragsWorker, stoppeAuftragsWorker } = _req('jobs/auftraegeStarten.js');
  starteAuftragsWorker(require('./sources').testDienste(), { arten: ['csv_import'], taktMs: 50 });
  // Auch die LISTEN-Verbindung: Sie hielte den Testprozess sonst am Leben.
  t.after(async () => {
    await stoppeAuftragsWorker();
    await require('./sources').testZugang().benachrichtigung.close();
  });
}

module.exports = { importWorker };
