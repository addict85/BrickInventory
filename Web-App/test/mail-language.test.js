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
 * Counter-checks (22.11.2026): the English branch of sendVerificationMail, sendPasswordResetMail
 * or buildAlertMail never taken → step 3 (verification, reset) or step 4 (alert) red; the former
 * source check of both branches is replaced by them.
 */
const test = require('node:test');
const { environment } = require('./helpers/sources');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, withoutComments } = require('./helpers/sources');

const read = rel => withoutComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const MAILER = read('src/mail/mailer.ts');

test('1. every mail function accepts the language', () => {
  // Found via the NAME, not via a list: a fourth mail
  // should be covered by this rule without anybody entering it here.
  const names = [...MAILER.matchAll(/async function (send\w*Mail|build\w*Mail)\s*\(/g)]
    .map(m => m[1])
    .filter(n => n !== 'sendMail'); // the sending itself phrases nothing
  assert.ok(names.length >= 3, `Only ${names.length} mail functions found (there were 3 when measured) — renamed?`);

  for (const n of names) {
    const head = MAILER.slice(MAILER.indexOf(`async function ${n}(`));
    const list = head.slice(0, head.indexOf(')') + 1);
    // Two permitted forms, and both occur: `lang = 'de'` directly in the
    // list (the two send* functions) or a named type that carries the
    // field (buildAlertMail takes a data object, because there are nine values).
    // Checking only for the string „lang" in the list would have wrongly
    // reported the second form — which it did on the first run, too.
    const kind = (list.match(/:\s*(\w+)\s*,?\s*\)/) || [])[1];
    const carriesLang =
      /lang/.test(list) ||
      (kind &&
        /lang\s*:/.test(
          MAILER.slice(MAILER.indexOf(`interface ${kind} {`)).slice(
            0,
            MAILER.slice(MAILER.indexOf(`interface ${kind} {`)).indexOf('}'),
          ),
        ));
    assert.ok(carriesLang, `${n}() does not know the recipient's language — it would always go out in the default.`);
  }
});

test("3. and every caller passes it along — the mail is in the account's language", { timeout: 60_000 }, async t => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
  environment({ APP_BASE_URL: 'http://localhost' });
  const { mailFake, enterMailServer } = require('./helpers/mail-fake');
  const sent = mailFake();
  const _req = require('./helpers/sources').buildAndRequire();
  const db = await require('./helpers/db').dataOrSkip(t, _req);
  if (!db) return;
  const { until } = require('./helpers/time');
  const NAME = `mailsprache_${process.pid}`;
  await db.run('DELETE FROM users WHERE username LIKE $1', [`${NAME}%`]);
  await db.run(
    "DELETE FROM rate_limit_attempts WHERE key LIKE '%mailsprache%' OR key LIKE 'forgot-password|%' OR key LIKE 'bestaetigung-erneut|%'",
  );
  const accounts = {};
  for (const [language, confirmed] of [
    ['en', true],
    ['de', true],
    ['en', false],
  ]) {
    const n = `${NAME}_${language}_${confirmed ? 'ok' : 'neu'}`;
    // An open account of the registration carries the address only as new_email.
    const id = confirmed
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
    await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'language', $2)`, [id, language]);
    accounts[n] = `${n}@example.org`;
  }
  const back = await enterMailServer(db);
  t.after(async () => {
    await back();
    await db.run('DELETE FROM users WHERE username LIKE $1', [`${NAME}%`]);
  });
  const { base } = require('./helpers/server').testServer(_req, { t });
  const post = (path, email) =>
    fetch(`${base}/api/v2/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept-language': 'de' },
      body: JSON.stringify({ email }),
    });
  const mailTo = async address => {
    assert.ok(await until(() => sent.some(m => m.to === address), 15_000), `no mail to ${address}`);
    return sent.find(m => m.to === address);
  };
  // The request comes in German; what counts is the language of the recipient.
  for (const [n, address] of Object.entries(accounts).filter(([n]) => n.endsWith('_ok'))) {
    assert.equal((await post('/forgot-password', address)).status, 200);
    const mail = await mailTo(address);
    assert.match(
      mail.subject + mail.text,
      n.includes('_en_') ? /Reset|password/i : /Passwort/,
      `${n}: ${mail.subject}`,
    );
    if (n.includes('_en_')) assert.doesNotMatch(mail.subject, /Passwort|zurücksetzen/, mail.subject);
  }
  const fresh = Object.entries(accounts).find(([n]) => n.endsWith('_neu'))[1];
  assert.equal((await post('/resend-confirmation', fresh)).status, 200);
  const confirmation = await mailTo(fresh);
  assert.doesNotMatch(confirmation.subject, /bestätig|Bestätig/, confirmation.subject);
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
    direction: 'below',
    price: 600,
    threshold: 650,
    currency: 'EUR',
  });
  // Plain text for programs that only show that, and HTML from the shared template.
  assert.match(mail.text, /^Hi anna,/);
  assert.match(mail.subject, /^Price alert: 10294-1 is below EUR 650\.00/);
  assert.notEqual(mail.html, mail.text);
  const shell = emailTemplate('x', 'y', 'z').slice(0, 60);
  assert.ok(mail.html.startsWith(shell), 'The alert mail does not go through emailTemplate()');
});

test.after(() =>
  require('./helpers/sources')
    .testData()
    .pool.end()
    .catch(() => {}),
);
