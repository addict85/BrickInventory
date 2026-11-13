/**
 * Idempotency-Key: Die Wiederholung einer schreibenden Anfrage bekommt die
 * gespeicherte Antwort und wirkt kein zweites Mal. Geprüft am echten Server
 * (Anmeldung, Middleware-Reihenfolge, Route) und am Dienst (laufend,
 * Serverfehler, Aufräumen).
 *
 * Gegenproben (31.10.2026 gemessen):
 *   A  app.use('/api/v1', idempotenz) in server.ts gestrichen → rot:
 *      „Wiederholung wirkt nicht zweimal" (Menge 4 statt 3), kein Replay-Kopf
 *   B  in beginne() den Vergleich des Fingerabdrucks entfernt → rot:
 *      „anderer Inhalt unter demselben Schlüssel" (200 statt 422)
 *   C  beende() merkt auch 5xx → rot: „ein Serverfehler gibt den Schlüssel frei"
 *   D  raeumeIdempotenzAuf ohne Frist (alles löschen) → rot: der frische Eintrag fehlt
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATABASE_URL = URL_DB;
const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const db = testDaten();
const { warte } = require('./helpers/zeit');
const freierPort = () =>
  new Promise(r => {
    const s = net.createServer().listen(0, () => {
      const p = s.address().port;
      s.close(() => r(p));
    });
  });

test('Idempotency-Key', { concurrency: 1, timeout: 180_000 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;
  const konto = async name => {
    await db.run('DELETE FROM users WHERE username = $1', [name]);
    const id = (
      await db.get(
        `INSERT INTO users (username, password_hash, is_active, email_verified)
                              VALUES ($1, 'x', true, true) RETURNING id`,
        [name],
      )
    ).id;
    await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, '3001id', 5, 'manual')`, [id]);
    await db.run(
      `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity) VALUES ($1, '3001id', 5, 2)`,
      [id],
    );
    return { id, token: await _req('src/konto/geraeteToken.js').createToken(id, 'Idempotenz-Probe') };
  };
  const a = await konto(`idem_a_${process.pid}`),
    b = await konto(`idem_b_${process.pid}`);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[a.id, b.id]]);
    await db.pool.end().catch(() => {});
  });

  const port = await freierPort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DATABASE_URL: URL_DB,
      SESSION_SECRET: 'idempotenz-test-geheimnis-lang-genug-1234',
      PORT: String(port),
      TRUST_PROXY: 'false',
    },
  });
  let log = '';
  srv.stdout.on('data', d => {
    log += d;
  });
  srv.stderr.on('data', d => {
    log += d;
  });
  t.after(async () => {
    srv.kill('SIGTERM');
    for (let i = 0; i < 40 && srv.exitCode === null && srv.signalCode === null; i++) await warte(100);
    if (srv.exitCode === null && srv.signalCode === null) srv.kill('SIGKILL');
  });
  for (let i = 0; i < 240 && (await fetch(`http://127.0.0.1:${port}/api/v1/health`).catch(() => null)) === null; i++)
    await warte(250);

  const put = async (wer, schluessel, body) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/v1/parts/3001id/5`, {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${wer.token}`,
        'content-type': 'application/json',
        ...(schluessel ? { 'idempotency-key': schluessel } : {}),
      },
    });
    return { status: r.status, replay: r.headers.get('idempotent-replay'), body: await r.json() };
  };
  const menge = async wer =>
    Number(
      (
        await db.get(
          "SELECT COALESCE(SUM(quantity),0)::int q FROM part_acquisitions WHERE user_id=$1 AND part_number='3001id'",
          [wer.id],
        )
      ).q,
    );

  await t.test('Wiederholung wirkt nicht zweimal und liefert dieselbe Antwort', async () => {
    const erst = await put(a, 'k-1', { quantity_delta: 1 });
    assert.deepEqual(erst, { status: 200, replay: null, body: { success: true, quantity: 3 } }, log.slice(-2000));
    const nochmal = await put(a, 'k-1', { quantity_delta: 1 });
    assert.deepEqual(nochmal, { status: 200, replay: 'true', body: { success: true, quantity: 3 } });
    assert.equal(await menge(a), 3);
  });

  await t.test('der Schlüssel gilt je Konto', async () => {
    assert.deepEqual((await put(b, 'k-1', { quantity_delta: 1 })).body, { success: true, quantity: 3 });
    assert.equal(await menge(b), 3);
  });

  await t.test('anderer Inhalt unter demselben Schlüssel wird abgewiesen', async () => {
    const r = await put(a, 'k-1', { quantity_delta: 5 });
    assert.equal(r.status, 422);
    assert.equal(r.body.code, 'idempotenz_schluessel_anders');
    assert.equal(await menge(a), 3);
  });

  await t.test('ein ungültiger Schlüssel wird abgewiesen, ohne Schlüssel wirkt jede Anfrage', async () => {
    assert.equal((await put(a, 'mit leerzeichen', { quantity_delta: 1 })).status, 400);
    await put(a, null, { quantity_delta: 1 });
    await put(a, null, { quantity_delta: 1 });
    assert.equal(await menge(a), 5);
  });

  const dienst = _req('src/idempotenz/dienst.js');
  const abdruck = dienst.fingerabdruck('PUT', '/x', { y: 1 });

  await t.test('eine laufende erste Anfrage: die Wiederholung wartet', async () => {
    assert.deepEqual(await dienst.beginne(a.id, 'k-lauf', abdruck), { art: 'neu' });
    assert.deepEqual(await dienst.beginne(a.id, 'k-lauf', abdruck), { art: 'laeuft' });
  });

  await t.test('ein Serverfehler gibt den Schlüssel frei, ein 4xx wird gemerkt', async () => {
    await dienst.beende(a.id, 'k-lauf', 500, '{"success":false}');
    assert.deepEqual(await dienst.beginne(a.id, 'k-lauf', abdruck), { art: 'neu' });
    await dienst.beende(a.id, 'k-lauf', 404, '{"success":false}');
    assert.deepEqual(await dienst.beginne(a.id, 'k-lauf', abdruck), {
      art: 'wiederholung',
      status: 404,
      antwort: '{"success":false}',
    });
  });

  await t.test('das Aufräumen nimmt nur, was älter als die Frist ist', async () => {
    await db.run(
      `UPDATE idempotenz SET angelegt = NOW() - make_interval(hours => $2)
                   WHERE user_id = $1 AND schluessel = 'k-1'`,
      [a.id, dienst.FRIST_STUNDEN + 1],
    );
    assert.ok((await dienst.raeumeIdempotenzAuf()) >= 1);
    const uebrig = (await db.all('SELECT schluessel FROM idempotenz WHERE user_id = $1 ORDER BY 1', [a.id])).map(
      r => r.schluessel,
    );
    assert.deepEqual(uebrig, ['k-lauf']);
  });
});
