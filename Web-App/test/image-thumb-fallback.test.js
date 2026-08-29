/**
 * Fehlt die Vorschau, kommt sofort das grosse Bild.
 *
 * ── Woher dieser Test kommt (Marcos Anforderung, Nachtrag 40) ───────────────
 * Wörtlich: „Der Client soll das Bild jeweils direkt erhalten und nicht warten,
 * bis noch das Thumbs-Image generiert wurde. Ist kein Thumb vorhanden, soll das
 * grosse Bild zurückgeliefert werden."
 *
 * Der Bild-Proxy hielt es für CDN-Bilder längst so (routes/imgProxy.ts:
 * Original sofort, Verkleinerung in die Warteschlange). Die LOKALE Route
 * /images/* tat es nicht: Bei fehlender _thumb-Datei sprang sie gleich zum
 * CDN-Umweg oder endete in 404 — obwohl das grosse Bild einen Ordner weiter
 * lag. Getroffen hat das genau das Zeitfenster nach dem Erfassen: Die Vorschau
 * entsteht im Hintergrund (setImmediate → generateThumb), und wer in diesen
 * Sekunden die Galerie öffnete, bekam nichts.
 *
 * Bewusst wird die Vorschau NICHT im Anfragepfad erzeugt: Das kostete rund
 * 150 ms Jimp je Anfrage und summierte sich bei einer Kachelwand zu Sekunden.
 * Bis der Hintergrundlauf fertig ist, ist das Original das bessere Bild als
 * gar keines.
 *
 * Geprüft wird das VERHALTEN der Route, nicht ihr Wortlaut: echte Dateien,
 * echte HTTP-Anfragen. Die Auslieferung selbst übernimmt express (sendFile),
 * deshalb genügt hier ein Nachbau der Routenlogik ohne Anmeldung — die prüft
 * test/media-auth.test.js.
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
  app.get('/images/*', (req, res) => {
    const segments = req.params[0].split('/').filter(Boolean);
    res.sendFile(pfadFuer(segments), err => {
      if (!err || res.headersSent) return;
      const treffer = /_thumb(\.[^.]+)$/.exec(req.params[0]);
      if (treffer) {
        const origSegs = req.params[0].replace(/_thumb(\.[^.]+)$/, '$1').split('/').filter(Boolean);
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
  // ohneKommentare() VOR dem indexOf (Nachtrag 155): Ein Blockkommentar in
  // server.ts trug "app.get('/images/*', …)" als Beispiel, und indexOf() fand
  // das Beispiel statt der Route — das Fenster lag dann im Dateikopf. Der
  // Filter weiter unten entfernte nur //-Zeilen, nicht Blockkommentare.
  //
  // Genau diese Falle steht in der JSDoc von ohneKommentare() bereits
  // beschrieben, samt demselben Beispiel. Der Helfer war da; er wurde hier nur
  // nicht benutzt.
  const src = require('./helpers/sources')
    .ohneKommentare(fs.readFileSync(path.join(__dirname, '..', 'server.ts'), 'utf8'));
  const start = src.indexOf("app.get('/images/*'");
  // Erst Kommentare weg, DANN schneiden (Nachtrag 48): Vorher wurde das
  // 4000-Zeichen-Fenster aus dem rohen Quelltext genommen — ein gewachsener
  // Erklärtext schob die geprüfte Zeile hinaus, und der Test wurde rot, obwohl
  // die Regel galt. Dieselbe Falle wie schon bei data-layout und den beiden
  // Kotlin-Tests; sie tritt zuverlässig auf, sobald jemand einen Kommentar
  // ergänzt.
  const ohneKommentare = src.slice(start).slice(0, 4000);
  const rueckfall = ohneKommentare.indexOf('_thumb');
  const cdn = ohneKommentare.indexOf('lookupCdnForMissingImage');
  assert.ok(rueckfall > 0, 'der Rückfall auf das Original fehlt');
  assert.ok(cdn > 0, 'die CDN-Heilung fehlt');
  assert.ok(rueckfall < cdn, 'der Original-Rückfall muss VOR dem CDN-Umweg stehen');
});
