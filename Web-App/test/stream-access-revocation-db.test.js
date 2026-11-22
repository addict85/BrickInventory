/**
 * An open stream ends as soon as its access ends: logging out the token or
 * the session, new session version (all sessions ended). Checked on the
 * CSV progress stream of the real app (baueApp); the tick without an event (revocation
 * in another process) on watchViaAccess() with a short tick.
 *
 * Counter-checks (measured 12.11.2026, each on its own):
 *   A  the call watchViaAccess() deleted in routes/api/sets.ts → red:
 *      “token logged out: the stream ends”, „Sitzung abgemeldet …“, „alle Sitzungen …“
 *   B  in watchViaAccess() not listening to atAccessChange() → red: the
 *      first three cases (only the tick after 15 s would have ended the streams)
 *   E  in increaseSessionVersion() without reportAccessChange() → red: „alle
 *      Sitzungen beendet …“ (on token revocation the logout route and NOTIFY report
 *      twice; deleted there individually it stayed green)
 *   C  the check sessionAlive() deleted in accessAppliesStill() → red: “session
 *      logged out: the stream ends”
 *   D  setInterval deleted in watchViaAccess() → red: „ohne Ereignis endet
 *      der Strom im Takt“
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { accessOrSkip } = require('./helpers/db');
const { bis } = require('./helpers/time');
const bcrypt = require('bcryptjs');

const NAME = `stromzugang_${process.pid}`,
  PASS = 'Strom-Zugang-Probe-1';

test('streams end with their access', { concurrency: 1 }, async t => {
  const db = await accessOrSkip(t, _req);
  if (!db) return;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified) VALUES ($1, $2, true, true) RETURNING id`,
      [NAME, bcrypt.hashSync(PASS, 4)],
    )
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    // The stream has opened LISTEN; the connection would keep the process open.
    await db.notification.close();
    await db.pool.end().catch(() => {});
  });

  const app = _req('startup/app.js').buildApp({
    pool: db.systemPool,
    config: _req('src/infra/config.js').config(),
    sitzungsGeheimnis: 's'.repeat(48),
    dienste: require('./helpers/sources').testServices(),
  });
  const srv = app.listen(0);
  t.after(() => {
    srv.closeAllConnections();
    return new Promise(r => srv.close(r));
  });
  const basis = `http://localhost:${srv.address().port}`;
  const post = (weg, kopf, rumpf) =>
    fetch(basis + weg, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: basis, ...kopf },
      body: JSON.stringify(rumpf ?? {}),
    });
  const sitzung = async () => {
    const r = await post('/api/v2/auth/login', {}, { username: NAME, password: PASS, without_token: true });
    assert.equal(r.status, 200, await r.clone().text());
    return { cookie: (r.headers.get('set-cookie') ?? '').split(';')[0] };
  };
  const token = async () => {
    const r = await post('/api/v2/auth/login', {}, { username: NAME, password: PASS });
    const j = await r.json();
    assert.ok(j.token, JSON.stringify(j));
    return { authorization: `Bearer ${j.token}` };
  };

  /** Opens the stream and reads along until it ends. */
  const openIt = async kopf => {
    const abbruch = new AbortController();
    t.after(() => abbruch.abort());
    const r = await fetch(`${basis}/api/v2/sets/import/csv/stream`, { headers: kopf, signal: abbruch.signal });
    if (r.status !== 200) assert.fail(`stream: ${r.status} ${await r.text()}`);
    const s = { text: '', zu: false };
    (async () => {
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
        if (done) break;
        s.text += Buffer.from(value).toString('utf8');
      }
      s.zu = true;
    })();
    await bis(() => s.text.includes('data:'), 5000);
    return s;
  };
  const ending = async (s, wie) => {
    await bis(() => s.zu, 3000).catch(() => {});
    assert.ok(s.zu, `${wie}: the stream ends`);
    assert.match(s.text, /event: access_ended/, wie);
  };

  await t.test('token logged out: the stream ends', async () => {
    const kopf = await token();
    const s = await openIt(kopf);
    const andere = await openIt(await token());
    assert.equal((await post('/api/v2/auth/logout', kopf)).status, 200);
    await ending(s, 'Token abgemeldet');
    assert.equal(await bis(() => andere.zu, 300), false, 'the stream of another, valid token stays open');
  });

  await t.test('session logged out: the stream ends', async () => {
    const kopf = await sitzung();
    const s = await openIt(kopf);
    assert.equal((await post('/api/v2/auth/logout', kopf)).status, 200);
    await ending(s, 'Sitzung abgemeldet');
  });

  await t.test('all sessions ended (new session version): the stream ends', async () => {
    const s = await openIt(await sitzung());
    await _req('src/account/accessEnd.js').endAllSessions(uid);
    await ending(s, 'alle Sitzungen beendet');
  });

  await t.test('without an event the stream ends on the tick', async () => {
    const kopf = await token();
    const watchViaAccess = (...a) =>
      _req('src/account/http/accessWatch.js').watchViaAccess(require('./helpers/sources').testServices().account, ...a);
    let beendet = 0;
    const signOut = watchViaAccess({ session: {}, headers: kopf }, () => beendet++, 50);
    t.after(signOut);
    assert.equal(await bis(() => beendet > 0, 200), false, 'a valid token ends nothing');
    // Revocation as from another process: only the row, no event here.
    await db.run('DELETE FROM api_tokens WHERE user_id = $1', [uid]);
    await bis(() => beendet > 0, 2000).catch(() => {});
    assert.equal(beendet, 1, 'without an event the stream ends on the beat');
  });
});
