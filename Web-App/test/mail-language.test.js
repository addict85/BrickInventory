/**
 * Every mail goes out in the language of its RECIPIENT — and looks like
 * the others.
 *
 * ── Counter-checks (carried out, result in the commit) ──────────────────────────
 *   a) `lang` removed from sendPasswordResetMail()        → step 1 red.
 *   b) the English branch removed from it                 → step 2 red.
 *   c) the argument at the call of the email change gone  → step 3 red.
 *   d) emailTemplate removed from the alert mail          → step 4 red.
 * Counter-checks (measured 08.11.2026, steps 3 and 4 now executed):
 *   e) in /forgot-password `String(lang ?? 'de')` → `'de'` → step 3 red
 *      (the mail to the English account is German); likewise in
 *      /bestaetigung-erneut
 *   f) buildAlertMail without emailTemplate (html = text) → step 4 red
 */
const test = require('node:test');
const { environment } = require('./helpers/sources');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, ohneKommentare } = require('./helpers/sources');

const lies = rel => ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const MAILER = lies('src/mail/mailer.ts');

/** The body of a function — from its head up to the next one at the start of a column. */
function rumpf(quelle, kopf) {
  const i = quelle.indexOf(kopf);
  assert.ok(i >= 0, `${kopf} nicht gefunden — umbenannt?`);
  const rest = quelle.slice(i + kopf.length);
  const m = rest.search(/\n(?:export )?(?:async )?function |\nexport \{/);
  return m >= 0 ? rest.slice(0, m) : rest;
}

test('1. every mail function accepts the language', () => {
  // Found via the NAME, not via a list: a fourth mail
  // should be covered by this rule without anybody entering it here.
  const namen = [...MAILER.matchAll(/async function (send\w*Mail|build\w*Mail)\s*\(/g)]
    .map(m => m[1])
    .filter(n => n !== 'sendMail'); // the sending itself phrases nothing
  assert.ok(namen.length >= 3, `Nur ${namen.length} Mail-Funktionen gefunden (gemessen waren es 3) — umbenannt?`);

  for (const n of namen) {
    const kopf = MAILER.slice(MAILER.indexOf(`async function ${n}(`));
    const liste = kopf.slice(0, kopf.indexOf(')') + 1);
    // Two permitted forms, and both occur: `lang = 'de'` directly in the
    // list (the two send* functions) or a named type that carries the
    // field (buildAlertMail takes a data object, because there are nine values).
    // Checking only for the string „lang" in the list would have wrongly
    // reported the second form — which it did on the first run, too.
    const typ = (liste.match(/:\s*(\w+)\s*,?\s*\)/) || [])[1];
    const carriesLang =
      /lang/.test(liste) ||
      (typ &&
        /lang\s*:/.test(
          MAILER.slice(MAILER.indexOf(`interface ${typ} {`)).slice(
            0,
            MAILER.slice(MAILER.indexOf(`interface ${typ} {`)).indexOf('}'),
          ),
        ));
    assert.ok(carriesLang, `${n}() kennt die Sprache des Empfängers nicht — sie ginge immer in der Vorgabe hinaus.`);
  }
});

test('2. and really masters both languages', () => {
  // A `lang` parameter that is read nowhere is worse than none:
  // it looks like multilingualism.
  for (const [n, kopf] of [
    ['sendVerificationMail', 'async function sendVerificationMail('],
    ['sendPasswordResetMail', 'async function sendPasswordResetMail('],
    ['buildAlertMail', 'async function buildAlertMail('],
  ]) {
    const body = rumpf(MAILER, kopf);
    assert.match(body, /lang (?:!==|===) 'en'/, `${n}() verzweigt nicht nach der Sprache.`);
    // An English sentence that is not merely a keyword.
    assert.ok(
      /Hello |Hi |Reset |Confirm |Price alert/.test(body),
      `${n}() hat keinen englischen Text — der Parameter wäre Dekoration.`,
    );
  }
});

test("3. and every caller passes it along — the mail is in the account's language", { timeout: 60_000 }, async t => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
  environment({ APP_BASE_URL: 'http://localhost' });
  const { mailAttrappe, enterMailServer } = require('./helpers/mail-fake');
  const gesendet = mailAttrappe();
  const _req = require('./helpers/sources').buildAndRequire();
  const db = await require('./helpers/db').dataOrSkip(t, _req);
  if (!db) return;
  const { bis } = require('./helpers/time');
  const NAME = `mailsprache_${process.pid}`;
  await db.run('DELETE FROM users WHERE username LIKE $1', [`${NAME}%`]);
  await db.run(
    "DELETE FROM rate_limit_attempts WHERE key LIKE '%mailsprache%' OR key LIKE 'forgot-password|%' OR key LIKE 'bestaetigung-erneut|%'",
  );
  const konten = {};
  for (const [sprache, bestaetigt] of [
    ['en', true],
    ['de', true],
    ['en', false],
  ]) {
    const n = `${NAME}_${sprache}_${bestaetigt ? 'ok' : 'neu'}`;
    // An open account of the registration carries the address only as new_email.
    const id = bestaetigt
      ? (
          await db.get(
            `INSERT INTO users (username, email, password_hash, is_active, email_verified)
          VALUES ($1, $2, 'x', true, true) RETURNING id`,
            [n, `${n}@example.org`],
          )
        ).id
      : (
          await db.get(
            `INSERT INTO users (username, new_email, password_hash, is_active, email_verified, registration_pending)
          VALUES ($1, $2, 'x', true, false, true) RETURNING id`,
            [n, `${n}@example.org`],
          )
        ).id;
    await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'language', $2)`, [id, sprache]);
    konten[n] = `${n}@example.org`;
  }
  const zurueck = await enterMailServer(db);
  t.after(async () => {
    await zurueck();
    await db.run('DELETE FROM users WHERE username LIKE $1', [`${NAME}%`]);
  });
  const { base } = require('./helpers/server').testServer(_req, { t });
  const post = (pfad, email) =>
    fetch(`${base}/api/v1/auth${pfad}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept-language': 'de' },
      body: JSON.stringify({ email }),
    });
  const mailAn = async adresse => {
    assert.ok(await bis(() => gesendet.some(m => m.to === adresse), 15_000), `keine Mail an ${adresse}`);
    return gesendet.find(m => m.to === adresse);
  };
  // The request comes in German; what counts is the language of the recipient.
  for (const [n, adresse] of Object.entries(konten).filter(([n]) => n.endsWith('_ok'))) {
    assert.equal((await post('/forgot-password', adresse)).status, 200);
    const mail = await mailAn(adresse);
    assert.match(
      mail.subject + mail.text,
      n.includes('_en_') ? /Reset|password/i : /Passwort/,
      `${n}: ${mail.subject}`,
    );
    if (n.includes('_en_')) assert.doesNotMatch(mail.subject, /Passwort|zurücksetzen/, mail.subject);
  }
  const neu = Object.entries(konten).find(([n]) => n.endsWith('_neu'))[1];
  assert.equal((await post('/bestaetigung-erneut', neu)).status, 200);
  const bestaetigung = await mailAn(neu);
  assert.doesNotMatch(bestaetigung.subject, /bestätig|Bestätig/, bestaetigung.subject);
});

test('4. the alert mail carries the same envelope as the others', async t => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
  const _req = require('./helpers/sources').buildAndRequire();
  const db = await require('./helpers/db').dataOrSkip(t, _req);
  if (!db) return;
  const { buildAlertMail, emailTemplate } = _req('src/mail/mailer.js');
  const mail = await buildAlertMail({
    lang: 'en',
    username: 'anna',
    setNumber: '10294-1',
    setName: 'Titanic',
    condition: 'N',
    direction: 'unter',
    price: 600,
    threshold: 650,
    currency: 'EUR',
  });
  // Plain text for programs that only show that, and HTML from the shared template.
  assert.match(mail.text, /^Hi anna,/);
  assert.match(mail.subject, /^Price alert: 10294-1 is below EUR 650\.00/);
  assert.notEqual(mail.html, mail.text);
  const huelle = emailTemplate('x', 'y', 'z').slice(0, 60);
  assert.ok(mail.html.startsWith(huelle), 'Die Alarmmail läuft nicht durch emailTemplate()');
});

test.after(() =>
  require('./helpers/sources')
    .testData()
    .pool.end()
    .catch(() => {}),
);
