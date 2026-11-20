/**
 * Eine Webapp-Sitzung endet nach der Höchstdauer, auch wenn sie benutzt wird.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  `app.use(sessionMaxDuration())` in startup/app.ts entfernt → rot in
 *      sitzung-app-db.test.js „nach der Höchstdauer ist niemand mehr angemeldet“
 *   B  in sessionMaxDuration `s.destroy(...)` durch `next()` ersetzt → rot:
 *      „trotz Betrieb endet die Sitzung nach der Höchstdauer"
 *   C  `angemeldetAm` in establishSession nicht gesetzt → rot: „die Anmeldung
 *      setzt den Zeitpunkt" (die Frist begänne erst beim nächsten Aufruf)
 *   Verwalter (14.11.2026 gemessen, je einzeln):
 *   D  in sessionMaxDuration die Leerlaufprüfung für Verwalter gestrichen → rot:
 *      „eine Verwaltersitzung endet nach kurzem Leerlauf …“ (nach dem Leerlauf noch angemeldet)
 *   E  das Nachführen von lastlyAt gestrichen → rot: dieselbe Prüfung („solange sie
 *      arbeitet“: trotz Anfragen abgemeldet)
 *   F  adminMaxMs durch maxMs ersetzt → rot: „… und nach ihrer kürzeren Höchstdauer“
 *   G  in sitzungsfristen() das Math.min für den Leerlauf gestrichen → rot: „Verwalter nie länger …“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const { sessionMaxDuration } = _req('src/account/sessionDeadline.js');
const establishSession = (...a) =>
  _req('src/account/http/login.js').establishSession(require('./helpers/sources').testServices().account, ...a);

const { warte } = require('./helpers/zeit');

const LANG = 3_600_000;

function testApp(maxMs, verwalter = {}) {
  const app = express();
  app.use(session({ secret: 'test-geheimnis', resave: false, saveUninitialized: false }));
  app.use(
    sessionMaxDuration({
      maxMs,
      adminMaxMs: verwalter.maxMs ?? maxMs,
      adminIdleMs: verwalter.idleMs ?? LANG,
    }),
  );
  app.post('/anmelden', async (req, res) => {
    const admin = req.query.verwalter === '1';
    await establishSession(req, { userId: admin ? 8 : 7, username: 'x', isAdmin: admin });
    res.json({ am: req.session.angemeldetAm });
  });
  app.get('/wer', (req, res) => res.json({ userId: req.session?.userId ?? null }));
  const srv = app.listen(0);
  return { srv, base: `http://localhost:${srv.address().port}` };
}

test('Höchstdauer der Webapp-Sitzung', async t => {
  // Grosszügige Frist und Wartezeiten ab dem gemessenen Anmeldezeitpunkt: Unter
  // Last dauert ein Aufruf hunderte Millisekunden, feste Schritte kippten dann.
  const FRIST = 3_000;
  const { srv, base } = testApp(FRIST);
  t.after(() => new Promise(r => srv.close(r)));
  const r = await fetch(base + '/anmelden', { method: 'POST' });
  const anmeldung = await r.json(); // die Sitzung steht erst nach dem letzten Byte im Speicher
  const keks = r.headers.get('set-cookie').split(';')[0];
  const wer = async () => (await (await fetch(base + '/wer', { headers: { cookie: keks } })).json()).userId;

  await t.test('die Anmeldung setzt den Zeitpunkt', async () => {
    const { am } = anmeldung;
    assert.ok(typeof am === 'number' && Math.abs(Date.now() - am) < 5_000);
  });

  await t.test('trotz Betrieb endet die Sitzung nach der Höchstdauer', async () => {
    const bis = ms => warte(Math.max(0, anmeldung.am + ms - Date.now()));
    assert.equal(await wer(), 7);
    await bis(FRIST / 3);
    assert.equal(await wer(), 7, 'innerhalb der Frist gilt sie');
    await bis(FRIST + 200);
    assert.equal(await wer(), null, 'nach der Frist ist niemand mehr angemeldet');
    assert.equal(await wer(), null, 'und die Sitzung ist gelöscht, nicht nur übersprungen');
  });
});

/** Anmelden und einen Abrufer für „wer ist angemeldet“ zurückgeben. */
async function anmelden(base, verwalter) {
  const r = await fetch(`${base}/anmelden${verwalter ? '?verwalter=1' : ''}`, { method: 'POST' });
  const { am } = await r.json();
  const keks = r.headers.get('set-cookie').split(';')[0];
  return { am, wer: async () => (await (await fetch(base + '/wer', { headers: { cookie: keks } })).json()).userId };
}

test('Verwaltersitzungen haben kürzere Fristen', async t => {
  await t.test('eine Verwaltersitzung endet nach kurzem Leerlauf, solange sie arbeitet aber nicht', async () => {
    const LEER = 3_000;
    const { srv, base } = testApp(LANG, { idleMs: LEER });
    t.after(() => new Promise(r => srv.close(r)));
    const chef = await anmelden(base, true);
    const nutzer = await anmelden(base, false);
    // Arbeiten über länger als den Leerlauf: Jede Anfrage schiebt die Frist.
    const bis = Date.now() + LEER * 1.5;
    while (Date.now() < bis) {
      assert.equal(await chef.wer(), 8, 'trotz Anfragen abgemeldet');
      await warte(400);
    }
    await warte(LEER + 800);
    assert.equal(await chef.wer(), null, 'nach dem Leerlauf noch angemeldet');
    assert.equal(await nutzer.wer(), 7, 'die allgemeine Frist gilt für andere weiter');
  });

  await t.test('… und nach ihrer kürzeren Höchstdauer', async () => {
    const MAX = 2_000;
    const { srv, base } = testApp(LANG, { maxMs: MAX });
    t.after(() => new Promise(r => srv.close(r)));
    const chef = await anmelden(base, true);
    const nutzer = await anmelden(base, false);
    assert.equal(await chef.wer(), 8);
    await warte(Math.max(0, chef.am + MAX + 300 - Date.now()));
    assert.equal(await chef.wer(), null);
    assert.equal(await nutzer.wer(), 7);
  });

  await t.test('Verwalter nie länger als alle anderen', () => {
    const { sitzungsfristen } = _req('src/account/sessionDeadline.js');
    const f = sitzungsfristen({
      sitzungHoechstStd: 2,
      sitzungLeerlaufMin: 10,
      sitzungVerwalterHoechstStd: 12,
      sitzungVerwalterLeerlaufMin: 30,
    });
    assert.deepEqual(f, {
      maxMs: 2 * 3_600_000,
      adminMaxMs: 2 * 3_600_000,
      adminIdleMs: 10 * 60_000,
    });
    const vorgabe = sitzungsfristen(_req('src/infra/config.js').ladeKonfig({}));
    assert.equal(vorgabe.adminIdleMs, 30 * 60_000, 'Vorgabe 30 Minuten');
    assert.equal(vorgabe.adminMaxMs, 12 * 3_600_000, 'Vorgabe 12 Stunden');
  });
});
