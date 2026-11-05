/**
 * Fehlt die Vorschau, kommt sofort das grosse Bild.
 * Ausführlich: docs/begruendungen/test/image-thumb-fallback.test.js.md#kopf
 *
 * Gegenprobe (durchgeführt): den _thumb-Zweig entfernt → der erste
 * Teilschritt endet in 404.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require(path.join(__dirname, '..', 'node_modules', 'express'));

// Denselben Zweig nachbauen, den server.ts im sendFile-Fehlerfall nimmt.
function baueApp(wurzel) {
  const app = express();
  const pfadFuer = segs => path.join(wurzel, 'images', ...segs);
  app.get('/images/*pfad', (req, res) => {
    const segments = req.params.pfad.filter(Boolean);
    const rohPfad = segments.join('/');
    res.sendFile(pfadFuer(segments), err => {
      if (!err || res.headersSent) return;
      const treffer = /_thumb(\.[^.]+)$/.exec(rohPfad);
      if (treffer) {
        const origSegs = rohPfad.replace(/_thumb(\.[^.]+)$/, '$1').split('/').filter(Boolean);
        const orig = pfadFuer(origSegs);
        if (fs.existsSync(orig)) {
          return res.sendFile(orig, e2 => { if (e2 && !res.headersSent) res.status(404).end(); });
        }
      }
      if (!res.headersSent) res.status(404).end();
    });
  });
  return app;
}

test('fehlt die Vorschau, liefert die Bildroute sofort das Original', async () => {
  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'imgroute-'));
  const ordner = path.join(wurzel, 'images', 'sets');
  fs.mkdirSync(ordner, { recursive: true });

  const original = path.join(ordner, '60445-1.jpg');
  const vorschau = path.join(ordner, '60445-1_thumb.jpg');
  fs.writeFileSync(original, Buffer.alloc(9000, 7));   // grosses Bild liegt da
  // vorschau existiert bewusst NICHT — der Zustand direkt nach dem Erfassen

  const srv = baueApp(wurzel).listen(0);
  const port = srv.address().port;
  const hole = p => new Promise(r => {
    let n = 0;
    http.get({ port, path: p }, res => {
      res.on('data', c => { n += c.length; });
      res.on('end', () => r({ status: res.statusCode, bytes: n }));
    });
  });

  try {
    // 1. Der eigentliche Fund: Vorschau fehlt → grosses Bild, nicht 404.
    let a = await hole('/images/sets/60445-1_thumb.jpg');
    assert.equal(a.status, 200, 'die fehlende Vorschau darf nicht in 404 enden');
    assert.equal(a.bytes, 9000, 'ausgeliefert werden muss das ORIGINAL');

    // 2. Sobald der Hintergrundlauf sie erzeugt hat, gilt wieder die Vorschau.
    fs.writeFileSync(vorschau, Buffer.alloc(1200, 3));
    a = await hole('/images/sets/60445-1_thumb.jpg');
    assert.equal(a.status, 200);
    assert.equal(a.bytes, 1200, 'jetzt muss die Vorschau ausgeliefert werden');

    // 3. Gibt es auch kein Original, bleibt es beim bisherigen Verhalten.
    a = await hole('/images/sets/gibtsnicht_thumb.jpg');
    assert.equal(a.status, 404, 'ohne Original bleibt es bei 404');
  } finally {
    await new Promise(r => srv.close(r));
    fs.rmSync(wurzel, { recursive: true, force: true });
  }
});

test('server.ts nimmt den Original-Rückfall vor dem CDN-Umweg', () => {
  // Reihenfolge zählt: Ein lokal vorhandenes Original ist immer besser als ein
  // Umweg über das CDN — schneller, ohne fremden Dienst, ohne Kontingent.
  // ohneKommentare() VOR dem indexOf: Ein Blockkommentar in
  // server.ts trug "app.get('/images/*', …)" als Beispiel, und indexOf() fand …
  // Ausführlich: docs/begruendungen/test/image-thumb-fallback.test.js.md#src-stelle
  const src = require('./helpers/sources')
    .ohneKommentare(fs.readFileSync(path.join(__dirname, '..', 'server.ts'), 'utf8'));
  const start = src.indexOf("app.get('/images/*pfad'");
  // Erst Kommentare weg, DANN schneiden: Vorher wurde das
  // 4000-Zeichen-Fenster aus dem rohen Quelltext genommen — ein gewachsener
  // Erklärtext schob die geprüfte Zeile hinaus, und der Test wurde rot, obwohl
  // die Regel galt. Dieselbe Falle wie schon bei data-layout und den beiden …
  // Ausführlich: docs/begruendungen/test/image-thumb-fallback.test.js.md#ohnekommentare
  const ohneKommentare = src.slice(start).slice(0, 4000);
  const rueckfall = ohneKommentare.indexOf('_thumb');
  const cdn = ohneKommentare.indexOf('cdnFuerFehlendesBild');
  assert.ok(rueckfall > 0, 'der Rückfall auf das Original fehlt');
  assert.ok(cdn > 0, 'die CDN-Heilung fehlt');
  assert.ok(rueckfall < cdn, 'der Original-Rückfall muss VOR dem CDN-Umweg stehen');
});
