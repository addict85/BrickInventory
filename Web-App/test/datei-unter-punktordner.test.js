/**
 * Dateien werden auch ausgeliefert, wenn die Installation unter einem
 * Punkt-Ordner liegt (~/.local/…, ein Arbeitsbaum unter .claude/).
 *
 * Gegenprobe (am 28.10.2026 gemessen): in sendeDatei() wieder
 * `res.sendFile(pfad, fertig)` → rot: „eine Datei unter einem Punkt-Ordner
 * kommt an“ (404).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require(path.join(__dirname, '..', 'node_modules', 'express'));
const { liefereDatei } = require('./helpers/sources').buildAndRequire()('src/infra/dateiAusliefern.js');

const ORDNER = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'punkt-')), '.versteckt', 'daten');
fs.mkdirSync(ORDNER, { recursive: true });
const DATEI = path.join(ORDNER, 'gutschein.pdf');
fs.writeFileSync(DATEI, '%PDF-1.4 probe');
fs.writeFileSync(path.join(ORDNER, '.geheim'), 'nicht ausliefern');

test('Auslieferung unter einem Punkt-Ordner', async (t) => {
  const app = express();
  app.get('/datei', (_req, res) => liefereDatei(res, DATEI));
  app.get('/punktdatei', (_req, res) => liefereDatei(res, path.join(ORDNER, '.geheim')));
  const srv = app.listen(0);
  t.after(() => srv.close());
  const basis = `http://127.0.0.1:${srv.address().port}`;

  await t.test('eine Datei unter einem Punkt-Ordner kommt an', async () => {
    const r = await fetch(basis + '/datei');
    assert.equal(r.status, 200);
    assert.equal(await r.text(), '%PDF-1.4 probe');
  });

  await t.test('eine Datei, die selbst mit Punkt beginnt, bleibt verborgen', async () => {
    assert.equal((await fetch(basis + '/punktdatei')).status, 404);
  });
});
