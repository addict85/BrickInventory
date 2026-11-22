/**
 * Files are delivered even if the installation lives under a
 * dot folder (~/.local/…, a working tree under .claude/).
 *
 * Counter-check (measured on 28.10.2026): in sendeDatei() again
 * `res.sendFile(pfad, fertig)` → red: “a file under a dot folder
 * arrives” (404).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require(path.join(__dirname, '..', 'node_modules', 'express'));
const { deliverFile } = require('./helpers/sources').buildAndRequire()('src/http/serveFile.js');

const FOLDER = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'punkt-')), '.versteckt', 'daten');
fs.mkdirSync(FOLDER, { recursive: true });
const DATEI = path.join(FOLDER, 'gutschein.pdf');
fs.writeFileSync(DATEI, '%PDF-1.4 probe');
fs.writeFileSync(path.join(FOLDER, '.geheim'), 'nicht ausliefern');

test('delivery under a dot folder', async t => {
  const app = express();
  app.get('/datei', (_req, res) => deliverFile(res, DATEI));
  app.get('/punktdatei', (_req, res) => deliverFile(res, path.join(FOLDER, '.geheim')));
  const srv = app.listen(0);
  t.after(() => srv.close());
  const basis = `http://127.0.0.1:${srv.address().port}`;

  await t.test('a file under a dot folder arrives', async () => {
    const r = await fetch(basis + '/datei');
    assert.equal(r.status, 200);
    assert.equal(await r.text(), '%PDF-1.4 probe');
  });

  await t.test('a file that itself starts with a dot stays hidden', async () => {
    assert.equal((await fetch(basis + '/punktdatei')).status, 404);
  });
});
