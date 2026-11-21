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
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// Palette and skeleton stand in template.ts, the mail texts in mailer.ts.
const SRC =
  fs.readFileSync(path.join(ROOT, 'src/mail/template.ts'), 'utf8') +
  '\n' +
  fs.readFileSync(path.join(ROOT, 'src/mail/mailer.ts'), 'utf8');

test('the theme is loaded when sending, not hard-wired', () => {
  assert.match(SRC, /async function mailTheme\(k: MailContext\)/, 'Loader fehlt');
  // Formerly the SQL statement itself stood here. Since all accesses to
  // global_settings run via src/settings/settings.ts, the test checks the path
  // there — the statement is the same: the theme is a GLOBAL
  // setting and must not come from the process or from a
  // constant.
  assert.match(
    SRC,
    /await k\.einstellungen\.globalValue\('app_theme'\)/,
    'Das Design ist eine globale Einstellung und muss von dort kommen',
  );
  // `'./settings'` OR `'../src/settings/settings'`: the mailer moved with an earlier round
  // from routes/ to utils/ (it never had a route), and with that
  // the RELATIVE path to the same file changed. What is checked is the
  // statement — central version instead of an own query —, not the number of
  // dots in front.
  assert.match(
    SRC,
    /import type \{ MailContext \} from '\.\/context'/,
    'und zwar über die zentrale Fassung, nicht über eine eigene Abfrage',
  );
  // In any doubt classic — an email must never fail because of the theme
  assert.match(
    SRC,
    /catch \(_\) \{\s*return MAIL_THEMES\.classic;\s*\}/,
    'Ohne Rückfall bliebe eine E-Mail bei einem Datenbankfehler aus',
  );

  // Both sending functions must load it
  for (const fn of ['sendVerificationMail', 'sendPasswordResetMail']) {
    const body = SRC.slice(SRC.indexOf(`async function ${fn}(`), SRC.indexOf(`async function ${fn}(`) + 1500);
    assert.match(body, /const theme = await mailTheme\(k\);/, `${fn} lädt das Design nicht`);
  }
});

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
    assert.ok(withBrick.includes(brick.primary) || withBrick.includes(brick.bg), `${name}: das Design kommt nicht an`);
    assert.ok(
      !withBrick.includes(classic.primary) && !withBrick.includes(classic.bg),
      `${name}: feste Farbe von classic`,
    );
    // Without a setting classic applies: a mail should never fail because of the theme.
    assert.equal(bau(undefined), bau(classic), `${name}: Vorgabe ist nicht classic`);
  }
});
