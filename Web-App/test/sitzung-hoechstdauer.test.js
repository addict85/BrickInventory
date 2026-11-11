/**
 * Eine Webapp-Sitzung endet nach der Höchstdauer, auch wenn sie benutzt wird.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  `app.use(sitzungsHoechstdauer())` in server.ts entfernt → rot:
 *      „server.ts hängt die Höchstdauer hinter die Sitzung"
 *   B  in sitzungsHoechstdauer `s.destroy(...)` durch `next()` ersetzt → rot:
 *      „trotz Betrieb endet die Sitzung nach der Höchstdauer"
 *   C  `angemeldetAm` in establishSession nicht gesetzt → rot: „die Anmeldung
 *      setzt den Zeitpunkt" (die Frist begänne erst beim nächsten Aufruf)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const { sitzungsHoechstdauer } = _req('src/konto/sitzungsFrist.js');
const { establishSession } = _req('src/konto/http/anmeldung.js');

const { warte } = require('./helpers/zeit');

function testApp(hoechstMs) {
  const app = express();
  app.use(session({ secret: 'test-geheimnis', resave: false, saveUninitialized: false }));
  app.use(sitzungsHoechstdauer(hoechstMs));
  app.post('/anmelden', async (req, res) => {
    await establishSession(req, { userId: 7, username: 'x', isAdmin: false });
    res.json({ am: req.session.angemeldetAm });
  });
  app.get('/wer', (req, res) => res.json({ userId: req.session?.userId ?? null }));
  const srv = app.listen(0);
  return { srv, base: `http://localhost:${srv.address().port}` };
}

test('Höchstdauer der Webapp-Sitzung', async (t) => {
  // Grosszügige Frist und Wartezeiten ab dem gemessenen Anmeldezeitpunkt: Unter
  // Last dauert ein Aufruf hunderte Millisekunden, feste Schritte kippten dann.
  const FRIST = 3_000;
  const { srv, base } = testApp(FRIST);
  t.after(() => new Promise(r => srv.close(r)));
  const r = await fetch(base + '/anmelden', { method: 'POST' });
  const anmeldung = await r.json();   // die Sitzung steht erst nach dem letzten Byte im Speicher
  const keks = r.headers.get('set-cookie').split(';')[0];
  const wer = async () => (await (await fetch(base + '/wer', { headers: { cookie: keks } })).json()).userId;

  await t.test('die Anmeldung setzt den Zeitpunkt', async () => {
    const { am } = anmeldung;
    assert.ok(typeof am === 'number' && Math.abs(Date.now() - am) < 5_000);
  });

  await t.test('trotz Betrieb endet die Sitzung nach der Höchstdauer', async () => {
    const bis = (ms) => warte(Math.max(0, anmeldung.am + ms - Date.now()));
    assert.equal(await wer(), 7);
    await bis(FRIST / 3);
    assert.equal(await wer(), 7, 'innerhalb der Frist gilt sie');
    await bis(FRIST + 200);
    assert.equal(await wer(), null, 'nach der Frist ist niemand mehr angemeldet');
    assert.equal(await wer(), null, 'und die Sitzung ist gelöscht, nicht nur übersprungen');
  });
});

test('die App hängt die Höchstdauer hinter die Sitzung', () => {
  const quelle = fs.readFileSync(path.join(ROOT, 'startup/app.ts'), 'utf8');
  const sitzung = quelle.search(/app\.use\(\s*session\(/);
  const frist = quelle.indexOf('app.use(sitzungsHoechstdauer())');
  assert.ok(sitzung > 0 && frist > sitzung, 'die Middleware fehlt oder steht vor der Sitzung');
});
