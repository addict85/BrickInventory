/**
 * Failed logins, locks and wrong codes each leave a
 * warning line (JSON on stderr and in app_logs), without password, code or the
 * entered name. If an account reaches the lock, the owner gets
 * a mail at most once a day.
 *
 * Counter-checks (measured 04.11.2026, each on its own):
 *   A  reportLoginEvent() removed in fehlversuch() → red: “an unknown
 *      name …”, “wrong password …”, “a wrong code …”
 *   B  the line at loginAllowed() removed → red: “the lock is in the log”
 *   C  reportLoginEvent() removed in gebremst() (passwordConfirmation) →
 *      red: “a wrong confirmation …”, “the line ends up in app_logs”
 *   D  the mail removed in fehlversuch() → red: “wrong password …” (no
 *      mail), “the mail at most once a day”
 *   E  accountThrottled() before the mail removed → red: “the mail at most once a day”
 *   F  `name` passed along in reportLoginEvent() → red: “an unknown name …”
 * Counter-checks round 17 (measured 05.11.2026, each on its own):
 *   G  accountKey() again returns the plaintext for unknown names →
 *      red: “an unknown name is only stored as an HMAC …” (part 1)
 *   H  reportLogin() removed in checkCredentials() → red: “a
 *      successful login …”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');

const mails = [];
require('./helpers/sources').replaceServices('mail', {
  mailConfigured: async () => true,
  mailAccountNotice: async (an, _name, kind) => {
    mails.push({ an, kind });
    return { success: true };
  },
});

const db = S.testData();
const zf = _req('src/factors/secondFactor.js');
const protokoll = _req('src/infra/log.js');
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));
const P = process.pid,
  PASS = 'Protokoll-Passwort-1',
  FALSCH = 'Geheim-Falsch-987';

test('login events in the log', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const NAME = `prot_${P}`,
    FACTOR = `prot_zf_${P}`;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, FACTOR]]);
  const konto = async n =>
    (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`,
        [n, `${n}@example.org`, await bcrypt.hash(PASS, 4)],
      )
    ).id;
  const uid = await konto(NAME),
    zfId = await konto(FACTOR);
  const g = await zf.beginSetup(zfId);
  assert.ok(await zf.confirmSetup(zfId, zf.hotp(zf.fromBase32(g), zf.timeStep())), 'Vorbedingung: Faktor aktiv');
  const emptyCounter = () =>
    db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'login%' OR key LIKE 'sperr-hinweis%' OR key LIKE $1`, [
      `%-bestaetigen|${uid}|%`,
    ]);
  await emptyCounter();

  const zeilen = [],
    infos = [];
  const zurueck = protokoll.installLog({
    out: z => infos.push(z),
    err: z => zeilen.push(z),
    now: () => Date.now(),
  });
  protokoll.logToDatabase(db.pool);
  t.after(async () => {
    zurueck();
    await emptyCounter();
    await db
      .run(`DELETE FROM app_logs WHERE message LIKE $1 OR (message LIKE '%[anmeldung]%' AND message ~ $2)`, [
        `%prot-test-${P}%`,
        `"konto":(${uid}|${zfId})\\M`,
      ])
      .catch(() => {});
    await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, FACTOR]]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const { base } = testServer(_req, { sitzung: { userId: uid, username: NAME }, t });
  const ruf = (weg, body) =>
    fetch(`${base}/api/v2/auth${weg}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.status);
  const anmelden = (username, password, code) =>
    ruf('/login', { username, password, without_token: true, ...(code ? { code } : {}) });
  /** The warning lines of an event as parsed JSON. */
  const ereignisse = kind => zeilen.map(z => JSON.parse(z)).filter(z => z.kontext?.ereignis === kind);
  const waitOnMails = async n => {
    for (let i = 0; i < 60 && mails.length < n; i++) await new Promise(r => setTimeout(r, 25));
  };

  await t.test('an unknown name: line without name and password', async () => {
    assert.equal(await anmelden(`niemand_${P}`, FALSCH), 401);
    const [z] = ereignisse('anmeldung_fehlgeschlagen');
    assert.equal(z?.stufe, 'warn', 'keine Warnzeile');
    // Depending on the machine, localhost is 127.0.0.1 or ::1 (shortened to the /64).
    assert.match(z.kontext.address, /^(127\.0\.0\.1|0:0:0:0::\/64)$/);
    assert.equal(z.kontext.konto, 'unbekannt');
    assert.ok(
      !zeilen.join('\n').includes(`niemand_${P}`) && !zeilen.join('\n').includes(FALSCH),
      'Name oder Passwort im Protokoll',
    );
  });

  await t.test('an unknown name is only stored as an HMAC in rate_limit_attempts', async () => {
    const X = `Vertippt-Geheim-${P}-Passwort`;
    await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'login%'`);
    assert.equal(await anmelden(X, FALSCH), 401);
    assert.equal(await anmelden(X, FALSCH), 401);
    const klar = await db.get(
      `SELECT count(*)::int n FROM rate_limit_attempts WHERE key ILIKE '%' || lower($1) || '%'`,
      [X],
    );
    assert.equal(klar.n, 0, 'der eingegebene Name steht im Klartext in der Tabelle');
    const je = await db.get(`SELECT count FROM rate_limit_attempts WHERE key LIKE 'login-name|name:%'`);
    assert.equal(Number(je?.count), 2, 'zwei Versuche mit demselben Namen zählen auf denselben Schlüssel');
    await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'login%'`);
  });

  await t.test('a successful login: exactly one info line with account and address', async () => {
    infos.length = 0;
    assert.equal(await anmelden(NAME, PASS), 200);
    const erfolg = infos.map(z => JSON.parse(z)).filter(z => /^\[anmeldung\] anmeldung_erfolgreich/.test(z.message));
    assert.equal(erfolg.length, 1, infos.join('\n'));
    assert.equal(erfolg[0].kontext.konto, uid);
    assert.match(erfolg[0].kontext.address, /^(127\.0\.0\.1|0:0:0:0::\/64)$/);
    assert.equal(erfolg[0].kontext.zugang, 'passwort');
    assert.ok(
      ![...infos, ...zeilen].join('\n').includes(NAME) && !infos.join('\n').includes(PASS),
      'Name oder Passwort im Protokoll',
    );
    await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'login%'`);
  });

  await t.test('wrong password: line with account, a mail when the lock is reached', async () => {
    zeilen.length = 0;
    for (let i = 0; i < 5; i++) assert.equal(await anmelden(NAME, FALSCH), 401);
    assert.deepEqual(
      ereignisse('anmeldung_fehlgeschlagen').map(z => z.kontext.konto),
      [uid, uid, uid, uid, uid],
    );
    await waitOnMails(1);
    assert.deepEqual(mails, [{ an: `${NAME}@example.org`, kind: 'login_throttled' }]);
  });

  await t.test('the lock is in the log', async () => {
    zeilen.length = 0;
    assert.equal(await anmelden(NAME, PASS), 429);
    assert.deepEqual(
      ereignisse('anmeldung_gesperrt').map(z => z.kontext.konto),
      [uid],
    );
  });

  await t.test('the mail at most once a day', async () => {
    await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'login%'`);
    for (let i = 0; i < 5; i++) await anmelden(NAME, FALSCH);
    await waitOnMails(2); // a second mail would arrive here
    assert.equal(mails.length, 1, JSON.stringify(mails));
  });

  await t.test('a wrong code', async () => {
    await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'login%'`);
    zeilen.length = 0;
    const richtig = zf.hotp(zf.fromBase32(g), zf.timeStep());
    assert.equal(await anmelden(FACTOR, PASS, richtig === '000000' ? '000001' : '000000'), 401);
    assert.deepEqual(
      ereignisse('second_factor_wrong').map(z => z.kontext.konto),
      [zfId],
    );
  });

  await t.test('a wrong confirmation', async () => {
    zeilen.length = 0;
    assert.equal(await ruf('/change-password', { current: FALSCH, newPassword: 'Neues-Passwort-77' }), 400);
    const [z] = ereignisse('bestaetigung_fehlgeschlagen');
    assert.deepEqual([z?.kontext.konto, z?.kontext.kind], [uid, 'passwort']);
    assert.ok(!zeilen.join('\n').includes(FALSCH));
  });

  await t.test('the line ends up in app_logs', async () => {
    console.warn(`prot-test-${P}`);
    await protokoll.emptyLog();
    const r = await db.all(
      `SELECT level, message FROM app_logs WHERE message LIKE '%bestaetigung_fehlgeschlagen%' AND message LIKE $1`,
      [`%"konto":${uid}%`],
    );
    assert.ok(r.length >= 1 && r[0].level === 'warn', JSON.stringify(r));
  });
});
