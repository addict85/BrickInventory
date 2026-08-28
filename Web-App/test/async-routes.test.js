/**
 * Absicherung von async-Route-Handlern.
 *
 * Express 4 kennt keine Promises: Wirft ein `async (req, res) => …`-Handler,
 * landet die Rejection nirgends. Die Antwort bleibt aus, die Verbindung offen —
 * ein Reverse-Proxy davor liefert nach seinem Timeout **502 Bad Gateway**.
 * Genau so verhielt sich /api/sets/import/csv/status, während alle anderen
 * Routen normal antworteten.
 *
 * Ausführen: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const http = require('node:http');

const ROOT = path.join(__dirname, '..');

test('server.ts sichert async-Handler zentral ab', () => {
  // serverOnly() und NICHT startQuelle(): Die Aussage unten betrifft die
  // REIHENFOLGE innerhalb von server.ts — die Router-Requires stehen dort, die
  // Erweiterung auch. Mit den angehängten startup/-Dateien misst man eine
  // Reihenfolge über Dateigrenzen hinweg, die es gar nicht gibt (Nachtrag 139).
  const s = require('./helpers/sources').serverOnly();
  assert.match(s, /function _wrapAsync/, 'Der Wrapper fehlt');
  assert.match(s, /out\.catch\(next\)/, 'Rejections müssen an next\\(\\) gehen');
  assert.match(s, /fn\.length >= 4/,
    'Fehler-Middleware hat vier Parameter und darf nicht umschlossen werden');

  // Muss VOR den Router-Requires stehen, sonst sind die Router schon gebaut.
  // Kommentare entfernen: Der Erklärtext oberhalb nennt require('./routes/…')
  // selbst und würde die Suche sonst dorthin führen.
  //
  // ohneKommentare() statt zweier Regex-Ersetzungen (Nachtrag 139): Die
  // Zeilen-Variante schneidet an einem `//` INNERHALB eines Blockkommentars —
  // etwa in einer URL — dessen `*/` mit weg. Der folgende /* */-Ausdruck lief
  // dann über zwanzigtausend Zeichen und frass alle Router-Requires; die
  // Prüfung meldete „Erweiterung steht nicht vor dem ersten require".
  const code = require('./helpers/sources').ohneKommentare(s);
  const patchAt = code.indexOf('(express as any).Router = function');
  const firstRequire = code.indexOf("require('./routes/");
  assert.ok(patchAt > 0 && patchAt < firstRequire,
    'Die Erweiterung muss vor dem ersten require(./routes/…) stehen');
});

test('mit Absicherung wird aus dem Hänger eine saubere 500', async () => {
  const wrap = (fn) => {
    if (typeof fn !== 'function' || fn.length >= 4) return fn;
    const w = function (req, res, next) {
      let o; try { o = fn.call(this, req, res, next); } catch (e) { return next(e); }
      if (o && typeof o.then === 'function') o.catch(next);
      return o;
    };
    Object.defineProperty(w, 'length', { value: fn.length });
    return w;
  };

  const build = (patched) => {
    const app = express();
    const r = express.Router();
    const get = patched ? (p, h) => r.get(p, wrap(h)) : (p, h) => r.get(p, h);
    get('/boom', async () => { throw new Error('kaputt'); });
    app.use('/api', r);
    app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
    return app;
  };

  const probe = (app) => new Promise(resolve => {
    const srv = app.listen(0, () => {
      const req = http.get({ port: srv.address().port, path: '/api/boom', timeout: 800 }, res => {
        res.resume();
        res.on('end', () => { srv.close(); resolve(res.statusCode); });
      });
      req.on('timeout', () => { req.destroy(); srv.close(); resolve('hängt'); });
      req.on('error', () => { srv.close(); resolve('hängt'); });
    });
  });

  // Nur der abgesicherte Fall wird zur Laufzeit geprüft: Der ungesicherte
  // erzeugt eine echte unhandled rejection, die der Test-Runner zu Recht als
  // Fehlschlag wertet — genau das ist ja das Problem, das behoben wurde.
  assert.equal(await probe(build(true)), 500,
    'Mit Wrapper muss das Fehler-Sicherheitsnetz greifen statt die Verbindung offen zu lassen');
});

test('der betroffene Endpunkt ist weiterhin vorhanden', () => {
  // /api/sets/import/csv/status hat als einziger 502 geliefert — die Route
  // selbst war nie das Problem, nur ihr fehlendes try/catch.
  const sets = require('./helpers/sources').setKernQuelle();
  assert.match(sets, /router\.get\('\/import\/csv\/status'/, 'Route fehlt');
});
