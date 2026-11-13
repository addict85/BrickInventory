/**
 * Widerruf von App-Zugängen: nur die ganze Kennung aus der Geräteliste, ein
 * fremder Zugang nur mit Passwort, der eigene ohne. „Alle anderen“ geht in
 * einer bestätigten Anfrage und lässt den eigenen Zugang stehen. Der Inhaber
 * bekommt einen Hinweis.
 *
 * Gegenproben (09.11.2026 gemessen, je einzeln):
 *   A  in PFAD (src/vertrag/grund.ts) tokenId wieder /^[A-Za-z0-9_-]{1,64}$/
 *      → rot: „ein Präfix der Kennung wird abgewiesen“ (200 statt 400)
 *   B  in DELETE /settings/tokens/:tokenId die Bestätigung gestrichen → rot:
 *      „ein fremder Zugang braucht das Passwort“ (200, Zugang weg)
 *   C  hinweisNebenher() beim Widerruf gestrichen → rot: „… der Inhaber
 *      bekommt einen Hinweis“
 *   D  in andere-beenden `null` statt des eigenen Hashes an
 *      andereZugaengeLoeschen → rot: „alle anderen: … der eigene bleibt“
 *   E  zugangLoeschen ohne `user_id = $1` → rot: „ein fremdes Konto
 *      widerruft nichts“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const ROOT = path.join(__dirname, '..');
const S = require('./helpers/sources');
const _req = S.buildAndRequire();

const gesendet = [];
const echterMailer = _req('src/mail/mailer.js');
require.cache[require.resolve(path.join(S.DIST, 'src/mail/mailer.js'))].exports = Object.assign({}, echterMailer, {
  mailEingerichtet: async () => true,
  sendKontoHinweisMail: async (an, _name, art, o) => {
    gesendet.push({ an, art, name: o.passkey });
    return { success: true };
  },
});

const db = S.testDaten();
const auth = _req('src/konto/geraeteToken.js');
const tokenCache = _req('src/konto/tokenCache.js');
const { testServer } = require('./helpers/server');
const { datenOderSkip } = require('./helpers/db');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const PASS = 'Widerruf-Passwort-1';
const NAMEN = [`widerruf_a_${process.pid}`, `widerruf_b_${process.pid}`];

test('Widerruf von App-Zugängen', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]);
  const ids = [];
  for (const n of NAMEN)
    ids.push(
      (
        await db.get(
          `INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`,
          [n, `${n}@example.org`, await bcrypt.hash(PASS, 4)],
        )
      ).id,
    );
  const [uidA, uidB] = ids;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]).catch(() => {});
    await db
      .run('DELETE FROM rate_limit_attempts WHERE key LIKE $1 OR key LIKE $2', [`%|${uidA}|%`, `%|${uidB}|%`])
      .catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const { base } = testServer(_req, { sitzung: {}, t });
  const ruf = async (methode, weg, token, body) => {
    const r = await fetch(base + '/api/v1' + weg, {
      method: methode,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const kennung = token => auth.hashToken(token).slice(0, 16);
  const gilt = async token => {
    tokenCache.leereTokenCache();
    return (await ruf('GET', '/settings/tokens', token)).status === 200;
  };
  const hinweise = async (art, anzahl) => {
    for (let i = 0; i < 60 && gesendet.filter(m => m.art === art).length < anzahl; i++)
      await new Promise(r => setTimeout(r, 25));
    return gesendet.filter(m => m.art === art);
  };

  const eigen = await auth.createToken(uidA, 'Telefon', true);
  const fremd = await auth.createToken(uidA, 'Tablet', true);

  await t.test('ein Präfix der Kennung wird abgewiesen', async () => {
    for (const teil of ['0', kennung(fremd).slice(0, 1), kennung(fremd).slice(0, 15), kennung(fremd).toUpperCase()]) {
      const r = await ruf('DELETE', `/settings/tokens/${teil}`, eigen, { password: PASS });
      assert.equal(r.status, 400, `${teil}: ${JSON.stringify(r.body)}`);
    }
    assert.equal(await gilt(fremd), true, 'ein Präfix hat den Zugang widerrufen');
  });

  await t.test('ein fremder Zugang braucht das Passwort', async () => {
    const ohne = await ruf('DELETE', `/settings/tokens/${kennung(fremd)}`, eigen);
    assert.ok(ohne.status >= 400 && ohne.status < 500, JSON.stringify(ohne.body));
    const falsch = await ruf('DELETE', `/settings/tokens/${kennung(fremd)}`, eigen, { password: 'falsch-falsch-1' });
    assert.ok(falsch.status >= 400 && falsch.status < 500, JSON.stringify(falsch.body));
    assert.equal(await gilt(fremd), true, 'ohne richtiges Passwort widerrufen');
  });

  await t.test('ein fremdes Konto widerruft nichts', async () => {
    const tokB = await auth.createToken(uidB, 'Fremd', true);
    const r = await ruf('DELETE', `/settings/tokens/${kennung(fremd)}`, tokB, { password: PASS });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.deleted, 0);
    assert.equal(await gilt(fremd), true, 'ein anderes Konto hat den Zugang widerrufen');
  });

  await t.test('mit Passwort geht er, und der Inhaber bekommt einen Hinweis', async () => {
    const r = await ruf('DELETE', `/settings/tokens/${kennung(fremd)}`, eigen, { password: PASS });
    assert.deepEqual([r.status, r.body.deleted], [200, 1], JSON.stringify(r.body));
    assert.equal(await gilt(fremd), false);
    assert.equal(await gilt(eigen), true, 'der eigene ist mitgegangen');
    assert.deepEqual(await hinweise('zugang_beendet', 1), [
      { an: `${NAMEN[0]}@example.org`, art: 'zugang_beendet', name: 'Tablet' },
    ]);
  });

  await t.test('den eigenen Zugang beendet das Gerät ohne Passwort', async () => {
    const kurz = await auth.createToken(uidA, 'Abmelden', true);
    const r = await ruf('DELETE', `/settings/tokens/${kennung(kurz)}`, kurz);
    assert.deepEqual([r.status, r.body.deleted], [200, 1], JSON.stringify(r.body));
    assert.equal(await gilt(kurz), false);
    assert.equal(
      (await hinweise('zugang_beendet', 2)).length,
      1,
      'das eigene Abmelden meldet sich als fremder Widerruf',
    );
  });

  await t.test('alle anderen: ein bestätigter Aufruf, der eigene bleibt', async () => {
    const x = await auth.createToken(uidA, 'X', true),
      y = await auth.createToken(uidA, 'Y', true);
    const ohne = await ruf('POST', '/settings/sessions/andere-beenden', eigen, { zugaenge: true });
    assert.ok(ohne.status >= 400 && ohne.status < 500, JSON.stringify(ohne.body));
    assert.equal(await gilt(x), true, 'ohne Passwort beendet');
    const r = await ruf('POST', '/settings/sessions/andere-beenden', eigen, { password: PASS, zugaenge: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.zugaenge, 2);
    assert.deepEqual([await gilt(x), await gilt(y), await gilt(eigen)], [false, false, true]);
    assert.equal((await hinweise('zugaenge_beendet', 1)).length, 1);
  });
});
