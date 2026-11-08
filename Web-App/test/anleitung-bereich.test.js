/**
 * Ein Bereich hinter dem Dateiende ist kein „Datei nicht gefunden".
 * Ausführlich: docs/begruendungen/test/anleitung-bereich.test.js.md#kopf
 *
 * Gegenprobe (durchgefuehrt): in antwortAufDateiFehler() wieder bedingungslos
 * `res.status(404)` gesetzt → Schritt „416" wird rot, die anderen bleiben gruen.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const express = require('express');

const { liefereDatei } = require('./helpers/sources').buildAndRequire()('src/http/dateiAusliefern.js');

const DATEI = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anleitung-')), 'BI-3004.pdf');
fs.writeFileSync(DATEI, Buffer.alloc(5000, 7));
const GROESSE = fs.statSync(DATEI).size;

/** Server mit GENAU dem Rumpf, den die Anleitungs-Route in server.ts hat. */
function starte() {
  const app = express();
  app.get('/data/instructions/*pfad', (_req, res) => liefereDatei(res, DATEI));
  app.get('/fehlt', (_req, res) => liefereDatei(res, DATEI + '.gibtesnicht'));
  const srv = app.listen(0);
  const basis = `http://127.0.0.1:${srv.address().port}`;
  return { srv, basis };
}

test('Bereichsanfragen an eine Anleitung', async (t) => {
  const { srv, basis } = starte();
  t.after(() => srv.close());

  const hol = async (pfad, range) => (await fetch(basis + pfad,
    range ? { headers: { Range: range } } : undefined));

  await t.test('ohne Bereich kommt die ganze Datei', async () => {
    const r = await hol('/data/instructions/BI-3004.pdf');
    assert.equal(r.status, 200);
    assert.equal((await r.arrayBuffer()).byteLength, GROESSE);
  });

  await t.test('ein Bereich mittendrin wird fortgesetzt', async () => {
    // Das ist der NORMALE Fall nach einem Abbruch: Die App hat die Haelfte und
    // holt den Rest. Faellt dieser Schritt, ist der Fortsetz-Weg selbst kaputt.
    const r = await hol('/data/instructions/BI-3004.pdf', 'bytes=2500-');
    assert.equal(r.status, 206);
    assert.equal(r.headers.get('content-range'), `bytes 2500-${GROESSE - 1}/${GROESSE}`);
  });

  await t.test('ein Bereich HINTER dem Dateiende ist 416, nicht 404', async () => {
    const r = await hol('/data/instructions/BI-3004.pdf', `bytes=${GROESSE}-`);
    assert.equal(r.status, 416,
      'Genau Marcos Befund: Die Datei ist da, der Bereich ist es nicht. 404 ' +
      'behauptet das Gegenteil und schickt jede Fehlersuche in die Irre.');
    // Die Laengenangabe ist die Auskunft, mit der ein Client sich selbst
    // korrigieren kann — sie muss die 416 begleiten.
    assert.equal(r.headers.get('content-range'), `bytes */${GROESSE}`);
  });

  await t.test('eine fehlende Datei bleibt 404', async () => {
    // Die Gegenrichtung, damit die Regel nicht dadurch gruen wird, dass gar
    // nichts mehr 404 antwortet.
    const r = await hol('/fehlt');
    assert.equal(r.status, 404);
  });
});
