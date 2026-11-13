/**
 * Über 24 h zählen alle falschen Codes eines Kontos in der Datenbank; ab dem
 * 20. gilt kein Einmalcode mehr, nur Wiederherstellungscode oder Passkey, und
 * der Inhaber bekommt sofort eine Mail. Die übrigen Sperren räumt der Test vor
 * jedem Versuch weg, damit allein die Tagesschranke wirkt.
 *
 * Gegenproben (13.11.2026 gemessen, je einzeln):
 *   A  faktorCodeGesperrt() liefert immer false → rot: „über der Schranke
 *      gilt auch ein richtiger Einmalcode nicht“
 *   B  in pruefeAnmeldedaten() den Aufruf hinweisNebenher(…,
 *      'zweiter_faktor_gesperrt') gestrichen → rot: „der Inhaber erfährt es
 *      sofort, einmal“
 *   C  pruefeCode() prüft bei mitEinmalcode=false gar nichts mehr (return
 *      null vor den Wiederherstellungscodes) → rot: „ein Wiederherstellungscode
 *      gilt weiter“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const mails = [];
const echterMailer = _req('src/mail/mailer.js');
require.cache[require.resolve(path.join(S.DIST, 'src/mail/mailer.js'))].exports = Object.assign({}, echterMailer, {
  mailEingerichtet: async () => true,
  sendKontoHinweisMail: async (an, _name, art) => {
    mails.push({ an, art });
    return { success: true };
  },
});
const { zugangOderSkip } = require('./helpers/db');
const { bis } = require('./helpers/zeit');
const zf = _req('src/konto/zweiterFaktor.js');
const lim = _req('src/konto/loginLimiter.js');
const { pruefeAnmeldedaten } = _req('src/konto/anmeldepruefung.js');
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));
const PASS = 'Tagesschranke-Passwort-1';
const IP = '198.51.100.44';

test('Tagesschranke für Codes des zweiten Faktors bei der Anmeldung', { concurrency: 1, timeout: 120_000 }, async t => {
  const db = await zugangOderSkip(t, _req);
  if (!db) return;
  const NAME = `zfschranke_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`,
      [NAME, `${NAME}@example.org`, bcrypt.hashSync(PASS, 4)],
    )
  ).id;
  const leereSperren = () =>
    db.run(`DELETE FROM rate_limit_attempts WHERE (key LIKE 'login%' AND key LIKE $1) OR key LIKE $2`, [
      `%konto:${uid}`,
      `%${IP}%`,
    ]);
  t.after(async () => {
    await leereSperren();
    await db.run('DELETE FROM rate_limit_attempts WHERE key = $1', [`faktor-anmeldung-konto|${uid}`]);
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });

  const geheimnis = await zf.beginneEinrichtung(uid);
  const schluessel = zf.ausBase32(geheimnis);
  const codes = await zf.bestaetigeEinrichtung(uid, zf.hotp(schluessel, zf.zeitschritt() - 1));
  assert.equal(codes?.length, 10, 'Einrichtung');
  const s = zf.zeitschritt();
  const gueltig = [-1, 0, 1].map(v => zf.hotp(schluessel, s + v));
  const FALSCH = ['000000', '111111', '222222', '333333'].find(c => !gueltig.includes(c));

  const anmelden = async code => {
    await leereSperren();
    return pruefeAnmeldedaten({ ip: IP }, NAME, PASS, code);
  };

  await t.test('bis zur Schranke: falscher Code', async () => {
    for (let i = 1; i < lim.MAX_FAKTOR_ANMELDUNG_JE_KONTO; i++) {
      const r = await anmelden(FALSCH);
      assert.equal(r.absage?.code, 'zweiter_faktor_falsch', `Versuch ${i}`);
    }
    const r = await anmelden(FALSCH);
    assert.equal(r.absage?.code, 'zweiter_faktor_gesperrt', 'der 20. falsche Code erreicht die Schranke');
    assert.equal(r.absage?.zweiterFaktor, true, 'das Codefeld bleibt offen');
    const zeile = await db.get('SELECT count FROM rate_limit_attempts WHERE key = $1', [
      `faktor-anmeldung-konto|${uid}`,
    ]);
    assert.equal(Number(zeile?.count), lim.MAX_FAKTOR_ANMELDUNG_JE_KONTO, 'gezählt in der Datenbank');
  });

  await t.test('der Inhaber erfährt es sofort, einmal', async () => {
    // hinweisNebenher schickt ohne await; erst ein zweiter Blick zeigt, dass es bei einer Mail bleibt.
    await bis(() => mails.some(m => m.art === 'zweiter_faktor_gesperrt'));
    await anmelden(FALSCH);
    assert.deepEqual(
      mails.filter(m => m.art === 'zweiter_faktor_gesperrt'),
      [{ an: `${NAME}@example.org`, art: 'zweiter_faktor_gesperrt' }],
    );
  });

  await t.test('über der Schranke gilt auch ein richtiger Einmalcode nicht', async () => {
    const r = await anmelden(zf.hotp(schluessel, zf.zeitschritt()));
    assert.equal(r.ok, false, 'richtiger Einmalcode über der Schranke angenommen');
    assert.equal(r.absage?.code, 'zweiter_faktor_gesperrt');
  });

  await t.test('ein Wiederherstellungscode gilt weiter', async () => {
    const r = await anmelden(codes[0]);
    assert.equal(r.ok, true, JSON.stringify(r.absage));
  });
});
