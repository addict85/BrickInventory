/**
 * Die Bremse für Passwortbestätigungen gilt je Zugang UND über alle Zugänge
 * eines Kontos; erreicht ein Zugang oder das Konto sie, erfährt es der Inhaber
 * (höchstens einmal am Tag), und das Protokoll hält es fest. Ein Zugang ohne
 * eigene Fehlversuche bestätigt weiter.
 *
 * Gegenproben (05.11.2026 gemessen, je einzeln):
 *   A  in confirmationLocked() die Kontogrenze gestrichen → rot: „über
 *      viele Zugänge höchstens 20 …“ (der 21. Versuch wird geprüft, 400) und
 *      „Mail und Protokoll …“
 *   B  Bedingung `s.count > 0` gestrichen → rot: „der saubere Zugang des
 *      Inhabers …“ (429 statt 200)
 *   C  in gebremst() hintInBackground() entfernt → rot: „Mail und
 *      Protokoll …“ (keine Mail)
 *   D  accountThrottled() vor der Mail entfernt → rot: „Mail und Protokoll …“
 *      (zwei Mails)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const mails = [];
require('./helpers/sources').replaceServices('mail', {
  mailConfigured: async () => true,
  mailAccountNotice: async (an, _name, art) => {
    mails.push({ an, art });
    return { success: true };
  },
});
const db = S.testData();
const { dataOrSkip } = require('./helpers/db');
const protokoll = _req('src/infra/log.js');
const { checkConfirmation } = _req('src/account/passwordConfirmation.js');
const { STATUS_THE_KIND } = _req('src/http/errorKind.js');
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));
const PASS = 'Konto-Bremse-Passwort-1',
  FALSCH = 'Falsch-geraten-0815';

test('brake for confirmations per account', { concurrency: 1, timeout: 120_000 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const NAME = `kbremse_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`,
      [NAME, `${NAME}@example.org`, bcrypt.hashSync(PASS, 4)],
    )
  ).id;
  const leere = () =>
    db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE $1 OR key LIKE $2 OR key = $3`, [
      `%-bestaetigen|${uid}|%`,
      `%-bestaetigen-konto|${uid}`,
      `bestaetigung-hinweis|konto:${uid}`,
    ]);
  await leere();
  const zeilen = [];
  const zurueck = protokoll.installLog({ out: () => {}, err: z => zeilen.push(z), jetzt: () => Date.now() });
  t.after(async () => {
    zurueck();
    await leere();
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  const versuch = async (zugang, pw = FALSCH) =>
    STATUS_THE_KIND[(await checkConfirmation(uid, zugang, pw, {}))?.art] ?? 200;

  await t.test('across many accesses at most 20 failed attempts per day', async () => {
    const ist = [];
    // Fünf Zugänge à vier Versuche: keiner erreicht seine eigene Grenze (5).
    for (let z = 0; z < 5; z++) for (let i = 0; i < 4; i++) ist.push(await versuch(`t:${z}`));
    assert.deepEqual([...new Set(ist)], [400]);
    assert.equal(await versuch('t:0'), 429, 'der 21. Versuch aus einem ratenden Zugang');
    assert.equal(await versuch('t:4', PASS), 429, 'auch mit dem richtigen Passwort, ohne Prüfung');
  });

  await t.test("the owner's clean access keeps confirming", async () => {
    assert.equal(await versuch('s:inhaber', PASS), 200);
  });

  await t.test('mail and log on reaching the brake, the mail once a day', async () => {
    for (let i = 0; i < 40 && mails.length < 1; i++) await new Promise(r => setTimeout(r, 25));
    await new Promise(r => setTimeout(r, 200));
    assert.deepEqual(mails, [{ an: `${NAME}@example.org`, art: 'bestaetigung_gebremst' }]);
    const gebremst = zeilen.map(z => JSON.parse(z)).filter(z => z.kontext?.ereignis === 'bestaetigung_gebremst');
    assert.deepEqual(
      gebremst.map(z => [z.kontext.konto, z.kontext.art]),
      [[uid, 'passwort']],
    );
    // Ein Zugang erreicht danach seine eigene Grenze: Protokoll ja, zweite Mail nein.
    await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE $1 OR key LIKE $2`, [
      `%-bestaetigen|${uid}|%`,
      `%-bestaetigen-konto|${uid}`,
    ]);
    for (let i = 0; i < 5; i++) await versuch('t:neu');
    await new Promise(r => setTimeout(r, 200));
    assert.equal(mails.length, 1, JSON.stringify(mails));
    assert.equal(zeilen.map(z => JSON.parse(z)).filter(z => z.kontext?.ereignis === 'bestaetigung_gebremst').length, 2);
  });
});
