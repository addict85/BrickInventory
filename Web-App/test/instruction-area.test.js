/**
 * A range behind the end of the file is not a “file not found".
 *
 * Counter-check (performed): in responseOnFileError() again unconditionally
 * `res.status(404)` set → step “416" turns red, the others stay green.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const { deliverFile } = require('./helpers/sources').buildAndRequire()('src/http/serveFile.js');
const { portOf } = require('./helpers/server');

const DATEI = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anleitung-')), 'BI-3004.pdf');
fs.writeFileSync(DATEI, Buffer.alloc(5000, 7));
const SIZE = fs.statSync(DATEI).size;

/** Server with EXACTLY the body the instruction route in server.ts has. */
function starte() {
  const app = express();
  app.get('/data/instructions/*pfad', (_req, res) => deliverFile(res, DATEI));
  app.get('/fehlt', (_req, res) => deliverFile(res, DATEI + '.gibtesnicht'));
  const srv = app.listen(0);
  const basis = `http://127.0.0.1:${portOf(srv)}`;
  return { srv, basis };
}

test('range requests to an instruction', async t => {
  const { srv, basis } = starte();
  t.after(() => srv.close());

  const fetchIt = async (path, range) => await fetch(basis + path, range ? { headers: { Range: range } } : undefined);

  await t.test('without a range the whole file comes', async () => {
    const r = await fetchIt('/data/instructions/BI-3004.pdf');
    assert.equal(r.status, 200);
    assert.equal((await r.arrayBuffer()).byteLength, SIZE);
  });

  await t.test('a range in the middle is continued', async () => {
    // That is the NORMAL case after an abort: the app has half and
    // fetches the rest. If this step fails, the resume path itself is broken.
    const r = await fetchIt('/data/instructions/BI-3004.pdf', 'bytes=2500-');
    assert.equal(r.status, 206);
    assert.equal(r.headers.get('content-range'), `bytes 2500-${SIZE - 1}/${SIZE}`);
  });

  await t.test('a range BEHIND the end of the file is 416, not 404', async () => {
    const r = await fetchIt('/data/instructions/BI-3004.pdf', `bytes=${SIZE}-`);
    assert.equal(
      r.status,
      416,
      'Genau Marcos Befund: Die Datei ist da, der Bereich ist es nicht. 404 ' +
        'behauptet das Gegenteil und schickt jede Fehlersuche in die Irre.',
    );
    // The length is the information with which a client can correct
    // itself — it must accompany the 416.
    assert.equal(r.headers.get('content-range'), `bytes */${SIZE}`);
  });

  await t.test('a missing file stays 404', async () => {
    // The opposite direction, so that the rule does not turn green because
    // nothing answers 404 anymore.
    const r = await fetchIt('/fehlt');
    assert.equal(r.status, 404);
  });
});
