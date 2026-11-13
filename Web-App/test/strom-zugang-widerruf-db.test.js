/**
 * Ein offener Strom endet, sobald sein Zugang endet: Abmelden des Tokens oder
 * der Sitzung, neue Sitzungsversion (alle Sitzungen beendet). Geprüft am
 * CSV-Fortschrittsstrom der echten App (baueApp); der Takt ohne Ereignis (Widerruf
 * in einem anderen Prozess) an wacheUeberZugang() mit kurzem Takt.
 *
 * Gegenproben (12.11.2026 gemessen, je einzeln):
 *   A  in routes/api_v1/sets.ts den Aufruf wacheUeberZugang() gestrichen → rot:
 *      „Token abgemeldet: der Strom endet“, „Sitzung abgemeldet …“, „alle Sitzungen …“
 *   B  in wacheUeberZugang() nicht auf beiZugangsAenderung() hören → rot: die
 *      ersten drei Fälle (erst der Takt nach 15 s hätte die Ströme beendet)
 *   E  in erhoeheSitzungsVersion() ohne meldeZugangsAenderung() → rot: „alle
 *      Sitzungen beendet …“ (beim Token-Widerruf melden Abmelderoute und NOTIFY
 *      doppelt; dort einzeln gestrichen blieb es grün)
 *   C  in zugangGiltNoch() die Prüfung sitzungLebt() gestrichen → rot: „Sitzung
 *      abgemeldet: der Strom endet“
 *   D  setInterval in wacheUeberZugang() gestrichen → rot: „ohne Ereignis endet
 *      der Strom im Takt“
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { zugangOderSkip } = require('./helpers/db');
const { bis } = require('./helpers/zeit');
const bcrypt = require('bcryptjs');

const NAME = `stromzugang_${process.pid}`,
  PASS = 'Strom-Zugang-Probe-1';

test('Ströme enden mit ihrem Zugang', { concurrency: 1 }, async t => {
  const db = await zugangOderSkip(t, _req);
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
    // Der Strom hat LISTEN geöffnet; die Verbindung hielte den Prozess offen.
    await db.benachrichtigung.close();
    await db.pool.end().catch(() => {});
  });

  const app = _req('startup/app.js').baueApp({
    pool: db.pool,
    konfig: _req('src/infra/konfig.js').konfig(),
    sitzungsGeheimnis: 's'.repeat(48),
    dienste: _req('src/infra/bereich.js').prozessDienste(),
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
    const r = await post('/api/v1/auth/login', {}, { username: NAME, password: PASS, ohne_token: true });
    assert.equal(r.status, 200, await r.clone().text());
    return { cookie: (r.headers.get('set-cookie') ?? '').split(';')[0] };
  };
  const token = async () => {
    const r = await post('/api/v1/auth/login', {}, { username: NAME, password: PASS });
    const j = await r.json();
    assert.ok(j.token, JSON.stringify(j));
    return { authorization: `Bearer ${j.token}` };
  };

  /** Öffnet den Strom und liest mit, bis er endet. */
  const oeffne = async kopf => {
    const abbruch = new AbortController();
    t.after(() => abbruch.abort());
    const r = await fetch(`${basis}/api/v1/sets/import/csv/stream`, { headers: kopf, signal: abbruch.signal });
    if (r.status !== 200) assert.fail(`Strom: ${r.status} ${await r.text()}`);
    const s = { text: '', zu: false };
    (async () => {
      const leser = r.body.getReader();
      for (;;) {
        const { done, value } = await leser.read().catch(() => ({ done: true, value: undefined }));
        if (done) break;
        s.text += Buffer.from(value).toString('utf8');
      }
      s.zu = true;
    })();
    await bis(() => s.text.includes('data:'), 5000);
    return s;
  };
  const endet = async (s, wie) => {
    await bis(() => s.zu, 3000).catch(() => {});
    assert.ok(s.zu, `${wie}: der Strom endet`);
    assert.match(s.text, /event: zugang_beendet/, wie);
  };

  await t.test('Token abgemeldet: der Strom endet', async () => {
    const kopf = await token();
    const s = await oeffne(kopf);
    const andere = await oeffne(await token());
    assert.equal((await post('/api/v1/auth/logout', kopf)).status, 200);
    await endet(s, 'Token abgemeldet');
    assert.equal(await bis(() => andere.zu, 300), false, 'der Strom eines anderen, gültigen Tokens bleibt offen');
  });

  await t.test('Sitzung abgemeldet: der Strom endet', async () => {
    const kopf = await sitzung();
    const s = await oeffne(kopf);
    assert.equal((await post('/api/v1/auth/logout', kopf)).status, 200);
    await endet(s, 'Sitzung abgemeldet');
  });

  await t.test('alle Sitzungen beendet (neue Sitzungsversion): der Strom endet', async () => {
    const s = await oeffne(await sitzung());
    await _req('src/konto/zugangsende.js').revokeAllSessions(uid);
    await endet(s, 'alle Sitzungen beendet');
  });

  await t.test('ohne Ereignis endet der Strom im Takt', async () => {
    const kopf = await token();
    const { wacheUeberZugang } = _req('src/konto/http/zugangsWache.js');
    let beendet = 0;
    const abmelden = wacheUeberZugang({ session: {}, headers: kopf }, () => beendet++, 50);
    t.after(abmelden);
    assert.equal(await bis(() => beendet > 0, 200), false, 'ein gültiger Token beendet nichts');
    // Widerruf wie aus einem anderen Prozess: nur die Zeile, kein Ereignis hier.
    await db.run('DELETE FROM api_tokens WHERE user_id = $1', [uid]);
    await bis(() => beendet > 0, 2000).catch(() => {});
    assert.equal(beendet, 1, 'ohne Ereignis endet der Strom im Takt');
  });
});
