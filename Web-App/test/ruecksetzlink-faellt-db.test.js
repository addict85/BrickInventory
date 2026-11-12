/**
 * Ein offener Rücksetzlink (1 h) fällt, sobald das Passwort auf anderem Weg
 * neu gesetzt oder eine neue E-Mail-Adresse bestätigt wird. Sonst blieb ein Link an
 * eine aufgegebene Adresse oder aus der Zeit vor einem Verwalter-Reset gültig.
 *
 * Gegenprobe (01.11.2026 gemessen): OHNE_RUECKSETZLINK in
 * src/konto/repository/konten.ts auf einen leeren Zusatz gesetzt
 * (`reset_token = reset_token`) → rot: alle drei Wege (200 statt 400).
 * Gegenprobe (11.11.2026 gemessen): der Stand cded051 (Token in der Route
 * gelesen, Passwort danach per `WHERE id = …` geschrieben) → rot: „zwei
 * gleichzeitige …“ (beide 200).
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const K = { ..._req('src/konto/konten.js'), ..._req('src/konto/prozess.js').kontoBereich().konten };
const { hashToken } = _req('src/konto/geraeteToken.js');

test('Rücksetzlinks fallen mit Passwort- und Adresswechsel', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;
  const namen = [];
  t.after(async () => {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
    await db.pool.end().catch(() => {});
  });
  const { base } = testServer(_req, { routen: { '/api/v1/auth': 'routes/auth.js' }, t });
  /** Ein Konto mit offenem Link; der Wechsel läuft, dann wird der Link eingelöst. */
  const nachWechsel = async (name, wechsel) => {
    namen.push(name);
    await db.run('DELETE FROM users WHERE username = $1', [name]);
    const uid = (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_active, email_verified)
      VALUES ($1, $2, 'x', true, true) RETURNING id`,
        [name, `${name}@example.org`],
      )
    ).id;
    const token = crypto.randomBytes(32).toString('hex');
    assert.ok(await K.setzeRuecksetzTokenWennFrei(uid, hashToken(token), 60, 15));
    await wechsel(uid);
    await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'reset-password|%'");
    const r = await fetch(`${base}/api/v1/auth/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, password: 'Neu-Sicher-2026x' }),
    });
    return [r.status, (await r.json()).code ?? null];
  };
  const p = process.pid;

  await t.test('ohne Wechsel gilt der Link (Vorbedingung)', async () => {
    assert.deepEqual(await nachWechsel(`link_ohne_${p}`, async () => {}), [200, null]);
  });

  await t.test('eigenes Passwort, Verwalter-Reset, neue Adresse: der Link fällt', async () => {
    assert.deepEqual(
      [
        await nachWechsel(`link_eigen_${p}`, uid => K.aendereEigenesPasswort(uid, 'Eigenes-Neu-2026')),
        await nachWechsel(`link_fremd_${p}`, uid => K.setzeFremdesPasswort(uid, 'Verwalter-Neu-2026')),
        await nachWechsel(`link_mail_${p}`, async uid => {
          await K.merkeEmailNeu(uid, `neu_${p}@example.org`, hashToken(`mail${p}`), new Date(Date.now() + 60_000));
          assert.equal(
            (
              await _req('src/konto/prozess.js')
                .kontoBereich()
                .konten.uebernimmEmailNeu(hashToken(`mail${p}`))
            )?.ok,
            true,
          );
        }),
      ],
      [
        [400, 'token_ungueltig'],
        [400, 'token_ungueltig'],
        [400, 'token_ungueltig'],
      ],
    );
  });

  await t.test('zwei gleichzeitige Anfragen mit demselben Link: nur eine setzt ihr Passwort', async () => {
    const name = `link_doppelt_${p}`;
    namen.push(name);
    await db.run('DELETE FROM users WHERE username = $1', [name]);
    const uid = (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_active, email_verified)
      VALUES ($1, $2, 'x', true, true) RETURNING id`,
        [name, `${name}@example.org`],
      )
    ).id;
    const token = crypto.randomBytes(32).toString('hex');
    assert.ok(await K.setzeRuecksetzTokenWennFrei(uid, hashToken(token), 60, 15));
    await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'reset-password|%'");
    const setze = password =>
      fetch(`${base}/api/v1/auth/reset-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
      }).then(async r => [r.status, (await r.json()).code ?? null, password]);
    const antworten = await Promise.all([setze('Erstes-Neu-2026x'), setze('Zweites-Neu-2026x')]);
    assert.deepEqual(antworten.map(a => a[0]).sort(), [200, 400], JSON.stringify(antworten));
    const sieger = antworten.find(a => a[0] === 200)[2];
    const bcrypt = require('bcryptjs');
    const { password_hash } = await db.get('SELECT password_hash FROM users WHERE id = $1', [uid]);
    assert.ok(bcrypt.compareSync(sieger, password_hash), 'es gilt das Passwort der Anfrage, die 200 bekam');
  });
});
