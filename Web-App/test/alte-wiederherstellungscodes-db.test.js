/**
 * Wiederherstellungscodes alter Art (vor dem 01.11.2026: 10 Zeichen, ungesalzenes SHA-256)
 * gelten nur bis `alt_gilt_bis` (Migration 0122, src/faktoren/zweiterFaktor.ts). Wer sich mit
 * einem anmeldet, bekommt eine Mail mit der Frist; die Profilseite nennt sie. Ein Code neuer
 * Art hebt die Frist für seinen Satz auf. Über die echte Anmeldung.
 *
 * Gegenproben (16.11.2026 gemessen, je einzeln):
 *   A  in verbraucheCode die Bedingung `alt_gilt_bis > NOW()` gestrichen → rot: „ein abgelaufener
 *      Code alter Art gilt nicht mehr“ (200 statt 401)
 *   B  in anmeldepruefung.ts die Mail für 'wiederherstellung_alt' gestrichen → rot: „ein Code
 *      alter Art gilt bis zur Frist, mit Mail …“
 *   C  pruefeCode ohne codesSindNeu() → rot: „ein Code neuer Art hebt die Frist …“
 *   D  in 0122 die Prüfung auf die schon vorhandene Spalte gestrichen → rot: „die Migration
 *      ist wiederholbar …“ (column already exists)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.APP_BASE_URL = 'http://localhost';
const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { bis } = require('./helpers/zeit');

const gesendet = [];
S.ersetzeDienste('mail', {
  mailEingerichtet: async () => true,
  mailKontoHinweis: async (_an, _name, type, o) => {
    gesendet.push({ type, bis: o.bis });
    return { success: true };
  },
});
const db = S.testDaten();
const { hashePasswort } = _req('src/konto/passwortHash.js');
const { suchwert } = _req('src/infra/geheimnis.js');

test('Wiederherstellungscodes alter Art laufen ab', { concurrency: 1, timeout: 120_000 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;
  const NAME = `altcode_${process.pid}`,
    PASS = 'Alte-Codes-Pruefung-1';
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified)
       VALUES ($1, $1 || '@beispiel.de', $2, true, true) RETURNING id`,
      [NAME, await hashePasswort(PASS)],
    )
  ).id;
  await db.run(`INSERT INTO second_factor (user_id, secret, active) VALUES ($1, 'x', true)`, [uid]);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM rate_limit_attempts').catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const alt = code => crypto.createHash('sha256').update(code.replace(/-/g, '')).digest('hex');
  const code = async (hash, frist) =>
    db.run('INSERT INTO second_factor_codes (user_id, code_hash, alt_gilt_bis) VALUES ($1, $2, $3)', [
      uid,
      hash,
      frist,
    ]);
  const { base } = testServer(_req, { sitzung: {}, t });
  const anmelden = async c => {
    await db.run('DELETE FROM rate_limit_attempts');
    const r = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: NAME, password: PASS, code: c, ohne_token: false, label: 'Probe' }),
    });
    return r.status;
  };
  const wartenAufMail = () => bis(() => gesendet.length > 0, 1000);

  await t.test('ein Code alter Art gilt bis zur Frist, mit Mail und Hinweis im Profil', async () => {
    const bis = new Date(Date.now() + 3 * 86_400_000);
    await code(alt('abcde12345'), bis);
    await code(alt('fghij67890'), bis);
    gesendet.length = 0;
    assert.equal(await anmelden('abcde-12345'), 200);
    await wartenAufMail();
    assert.deepEqual(
      gesendet.map(g => [g.type, Date.parse(g.bis)]),
      [['alte_codes_ablauf', bis.getTime()]],
    );
    const stand = await S.alsKonto(uid, () => _req('src/faktoren/zweiterFaktor.js').stand(uid));
    assert.equal(Date.parse(stand.alte_codes_bis), bis.getTime());
  });

  await t.test('ein abgelaufener Code alter Art gilt nicht mehr', async () => {
    await code(alt('klmno13579'), new Date(Date.now() - 60_000));
    assert.equal(await anmelden('klmno-13579'), 401);
  });

  await t.test('ein Code neuer Art hebt die Frist für seinen Satz auf', async () => {
    await db.run('DELETE FROM second_factor_codes WHERE user_id = $1', [uid]);
    const neu = 'abcd-efgh-ijkl-mnop';
    const frist = new Date(Date.now() + 86_400_000);
    await code(suchwert('zweiter-faktor-code', `${uid}:${neu.replace(/-/g, '')}`), frist);
    await code('anderer-code-desselben-satzes', frist);
    assert.equal(await anmelden(neu), 200);
    const stand = await S.alsKonto(uid, () => _req('src/faktoren/zweiterFaktor.js').stand(uid));
    assert.deepEqual([stand.codes_uebrig, stand.alte_codes_bis], [1, null]);
  });

  await t.test('die Migration ist wiederholbar und lässt neue Codes ohne Frist', async () => {
    const sql = fs.readFileSync(
      path.join(__dirname, '..', 'db', 'migrations', '0122-alte-wiederherstellungscodes-befristet.sql'),
      'utf8',
    );
    await db.run('DELETE FROM second_factor_codes WHERE user_id = $1', [uid]);
    await code('neu-ohne-frist', null);
    await db.run(sql);
    const z = await db.get('SELECT alt_gilt_bis FROM second_factor_codes WHERE user_id = $1', [uid]);
    assert.equal(z.alt_gilt_bis, null);
  });
});
