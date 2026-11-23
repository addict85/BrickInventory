/**
 * A file that disappears between check and delivery must NOT end the
 * process.
 *
 * Counter-check (carried out): streamFileToResponse replaced again by
 * `createReadStream(...).pipe(res)` → child process ends with code 7.
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
const { streamFileToResponse } = require(${JSON.stringify(path.join(ROOT, 'dist/src/http/httpResponse.js'))});
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

test('a vanished file during delivery does not end the process', async () => {
  const file = path.join(os.tmpdir(), `stream-guard-${process.pid}.js`);
  fs.writeFileSync(file, CHILD);
  try {
    let out = '';
    try {
      out = execFileSync(process.execPath, [file], { encoding: 'utf8', timeout: 20000 });
    } catch (e) {
      assert.fail(
        `The child process did not exit cleanly (exit code ${e.status}). ` +
          `Output: ${(e.stdout || '').toString().trim() || '(empty)'}`,
      );
    }
    assert.ok(!out.includes('CRASH:'), `the read error killed the process: ${out.trim()}`);
    // As long as no headers are out yet, the error is reported as 404
    // instead of silently dropping the connection.
    assert.match(out, /STATUS:404/, `expected HTTP 404, output: ${out.trim()}`);
  } finally {
    fs.rmSync(file, { force: true });
  }
});
