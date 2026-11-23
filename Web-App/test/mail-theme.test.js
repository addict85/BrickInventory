/**
 * Emails in the theme of the web app.
 *
 * Counter-checks (measured 08.11.2026, each on its own):
 *   A  brick.primary in src/mail/template.ts set to '#2563eb' → red: “one palette
 *      per theme …” (does not match --b600 in tokens.css)
 *   B  in emailTemplate again `#2563eb` instead of `${theme.primary}` → red:
 *      “template, button and info box draw in the passed theme”
 *   C  emailBtn without a default for theme (`theme: MailTheme`) → red: the same
 *      check (without a theme the button fails)
 * Counter-checks (22.11.2026, each alone):
 *   D  sendPasswordResetMail with `theme = undefined` instead of mailTheme(k) → red “the theme is loaded …”
 *   E  the catch in mailTheme() removed → red the same test (the mail fails instead of classic)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const _req = require('./helpers/sources').buildAndRequire();

test("one palette per theme with the web app's primary color", () => {
  const { MAIL_THEMES } = _req('src/mail/template.js');
  assert.deepEqual(Object.keys(MAIL_THEMES).sort(), ['brick', 'classic']);
  // --b600 per theme from tokens.css: the mail should look like the web app.
  const tokens = fs.readFileSync(path.join(ROOT, 'public', 'tokens.css'), 'utf8');
  const b600 = block => tokens.slice(tokens.indexOf(block)).match(/--b600:\s*(#[0-9a-f]{6})/i)[1];
  assert.equal(MAIL_THEMES.classic.primary, b600(':root'));
  assert.equal(MAIL_THEMES.brick.primary, b600('[data-theme="brick"]'));
});

test('template, button and info box draw in the passed theme', () => {
  const { MAIL_THEMES, emailTemplate, emailBtn, infoBox } = _req('src/mail/template.js');
  const { classic, brick } = MAIL_THEMES;
  for (const [name, bau] of /** @type {[string, (theme: string | undefined) => string][]} */ ([
    ['emailTemplate', th => emailTemplate('Titel', 'Vorschau', '<p>x</p>', th)],
    ['emailBtn', th => emailBtn('https://lego.example.org/', 'Los', th)],
    ['infoBox', th => infoBox('Hinweis', th)],
  ])) {
    const withBrick = bau(brick);
    assert.ok(withBrick.includes(brick.primary) || withBrick.includes(brick.bg), `${name}: the design does not arrive`);
    assert.ok(
      !withBrick.includes(classic.primary) && !withBrick.includes(classic.bg),
      `${name}: fixed colour of classic`,
    );
    // Without a setting classic applies: a mail should never fail because of the theme.
    assert.equal(bau(undefined), bau(classic), `${name}: the default is not classic`);
  }
});

test('the theme is loaded when sending, not hard-wired', async t => {
  // Real mail functions with the setting replaced at the mail context: the theme set in the
  // administration reaches every mail; an unreadable setting falls back to classic.
  const { mailFake } = require('./helpers/mail-fake');
  const sent = mailFake();
  const { MAIL_THEMES } = _req('src/mail/template.js');
  const mailer = _req('src/mail/mailer.js');
  const settings = require('./helpers/sources').testContext('mail').settings;
  let theme = 'brick';
  const values = () => ({
    app_theme: theme,
    smtp_host: '192.0.2.25',
    smtp_user: 'versand',
    smtp_from: 'bim@example.org',
  });
  t.mock.method(settings, 'globalValue', async (key, fallback) => {
    if (key === 'app_theme' && theme === null) throw new Error('db down');
    return values()[key] ?? fallback ?? null;
  });
  const html = async () => {
    sent.length = 0;
    await mailer.sendVerificationMail('anna@example.org', 'tok', 'http://localhost', 'de');
    await mailer.sendPasswordResetMail('anna@example.org', 'tok', 'http://localhost', 'de');
    const alert = await mailer.buildAlertMail({
      lang: 'de',
      username: 'anna',
      setNumber: '10294-1',
      setName: 'Titanic',
      condition: 'N',
      direction: 'below',
      price: 600,
      threshold: 650,
      currency: 'EUR',
    });
    return [...sent.map(m => m.html), alert.html];
  };
  const brick = await html();
  assert.equal(brick.length, 3, 'not every mail was built');
  for (const h of brick) assert.ok(h.includes(MAIL_THEMES.brick.primary), 'a mail ignores the set theme');
  theme = null;
  for (const h of await html()) assert.ok(h.includes(MAIL_THEMES.classic.primary), 'no fallback to classic');
});
