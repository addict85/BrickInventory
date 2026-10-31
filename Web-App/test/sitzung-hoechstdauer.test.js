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
const { establishSession } = _req('src/konto/auth.js');

const warte = (ms) => new Promise(r => setTimeout(r, ms));

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
  const { srv, base } = testApp(600);
  t.after(() => new Promise(r => srv.close(r)));
  const r = await fetch(base + '/anmelden', { method: 'POST' });
  const keks = r.headers.get('set-cookie').split(';')[0];
  const wer = async () => (await (await fetch(base + '/wer', { headers: { cookie: keks } })).json()).userId;

  await t.test('die Anmeldung setzt den Zeitpunkt', async () => {
    const { am } = await r.json();
    assert.ok(typeof am === 'number' && Math.abs(Date.now() - am) < 5_000);
  });

  await t.test('trotz Betrieb endet die Sitzung nach der Höchstdauer', async () => {
    assert.equal(await wer(), 7);
    await warte(350);
    assert.equal(await wer(), 7, 'innerhalb der Frist gilt sie');
    await warte(350);
    assert.equal(await wer(), null, 'nach der Frist ist niemand mehr angemeldet');
    assert.equal(await wer(), null, 'und die Sitzung ist gelöscht, nicht nur übersprungen');
  });
});

test('server.ts hängt die Höchstdauer hinter die Sitzung', () => {
  const quelle = fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8');
  const sitzung = quelle.indexOf('app.use(session(');
  const frist = quelle.indexOf('app.use(sitzungsHoechstdauer())');
  assert.ok(sitzung > 0 && frist > sitzung, 'die Middleware fehlt oder steht vor der Sitzung');
});
