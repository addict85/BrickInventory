/**
 * Ein Bereich hinter dem Dateiende ist kein „Datei nicht gefunden".
 *
 * ── Marcos Meldung ──────────────────────────────────────────────────────────
 *
 * „Nach ein paar Mal die Anleitung abrufen aus der App erscheint folgende
 * Meldung" — „Fehler beim Laden: HTTP 404". Die Anleitung lag die ganze Zeit
 * auf dem Server.
 *
 * ── Was tatsaechlich passierte ──────────────────────────────────────────────
 *
 * Der PDF-Viewer der App laedt fortsetzbar. Nach einem VOLLSTAENDIGEN
 * Download schickte er `Range: bytes=<dateigroesse>-` — ein Bereich, der hinter
 * dem letzten Byte beginnt. `send` beantwortet das mit 416. Die Route bildete
 * aber JEDEN Fehler aus res.sendFile() auf 404 ab, und aus „dein Bereich ist
 * zu gross" wurde „die Datei gibt es nicht".
 *
 * Die Ursache der fehlgeschlagenen Anzeige liegt in der App und ist dort
 * behoben (util/PdfCache.kt: ein fertiger Download wird nicht fortgesetzt).
 * Diese Regel haelt die ZWEITE Haelfte fest: Der Server muss die Wahrheit
 * sagen. Eine 404 fuer eine vorhandene Datei hat die Suche in die falsche
 * Richtung geschickt, und der naechste Client, der Bereiche anfragt, faende
 * dieselbe Falle vor.
 *
 * ── Warum die echte Funktion und kein Nachbau ───────────────────────────────
 *
 * Geprueft wird `liefereDatei()` aus utils/dateiAusliefern.ts — genau die
 * Funktion, die server.ts fuer die Anleitungen und die Uploads benutzt. Ein
 * nachgebauter Callback im Test wuerde beweisen, dass der NACHBAU stimmt.
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

const { liefereDatei } = require('./helpers/sources').buildAndRequire()('utils/dateiAusliefern.js');

const DATEI = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anleitung-')), 'BI-3004.pdf');
fs.writeFileSync(DATEI, Buffer.alloc(5000, 7));
const GROESSE = fs.statSync(DATEI).size;

/** Server mit GENAU dem Rumpf, den die Anleitungs-Route in server.ts hat. */
function starte() {
  const app = express();
  app.get('/data/instructions/*', (_req, res) => liefereDatei(res, DATEI));
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
