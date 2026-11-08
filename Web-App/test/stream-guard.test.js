/**
 * Eine Datei, die zwischen Prüfung und Auslieferung verschwindet, darf den
 * Prozess NICHT beenden.
 * Ausführlich: docs/begruendungen/test/stream-guard.test.js.md#kopf
 *
 * Gegenprobe (durchgeführt): streamFileToResponse wieder durch
 * `createReadStream(...).pipe(res)` ersetzt → Kindprozess endet mit Code 7.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
require('./helpers/sources').buildAndRequire();

const CHILD = `
const http = require('http');
const { streamFileToResponse } = require(${JSON.stringify(path.join(ROOT, 'dist/src/http/httpAntwort.js'))});
process.on('uncaughtException', e => { console.log('CRASH:' + (e.code || e.message)); process.exit(7); });
const srv = http.createServer((req, res) => {
  // Die Datei war da, als geprüft wurde — beim Öffnen ist sie weg.
  streamFileToResponse(res, '/tmp/verschwunden-' + Date.now() + '.bin');
});
srv.listen(0, async () => {
  let status = 0;
  try { const r = await fetch('http://localhost:' + srv.address().port + '/'); status = r.status; }
  catch (e) { console.log('FETCH-FEHLER:' + e.message); }
  console.log('STATUS:' + status);
  setTimeout(() => { srv.close(); process.exit(0); }, 300);
});
`;

test('eine verschwundene Datei beim Ausliefern beendet den Prozess nicht', async () => {
  const file = path.join(os.tmpdir(), `stream-guard-${process.pid}.js`);
  fs.writeFileSync(file, CHILD);
  try {
    let out = '';
    try {
      out = execFileSync(process.execPath, [file], { encoding: 'utf8', timeout: 20000 });
    } catch (e) {
      assert.fail(`Der Kindprozess ist nicht sauber beendet worden (Exitcode ${e.status}). ` +
                  `Ausgabe: ${(e.stdout || '').toString().trim() || '(leer)'}`);
    }
    assert.ok(!out.includes('CRASH:'), `der Lesefehler hat den Prozess abgeschossen: ${out.trim()}`);
    // Solange noch keine Kopfzeilen raus sind, wird der Fehler als 404 gemeldet
    // statt die Verbindung wortlos fallen zu lassen.
    assert.match(out, /STATUS:404/, `erwartet wurde HTTP 404, Ausgabe: ${out.trim()}`);
  } finally {
    fs.rmSync(file, { force: true });
  }
});
