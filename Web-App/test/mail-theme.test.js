/**
 * E-Mails im Design der Webapp.
 *
 * E-Mails kennen keine CSS-Variablen und kein externes Stylesheet — jeder Wert
 * muss direkt im Markup stehen. Die Paletten in routes/mailer.ts spiegeln
 * deshalb styles.css bzw. themes/brick.css. Ändert sich dort eine Farbe, muss
 * sie hier nachgezogen werden; dieser Test hält wenigstens fest, dass es
 * überhaupt zwei unterscheidbare Paletten gibt und sie angewendet werden.
 *
 * Ausführen: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'routes', 'mailer.ts'), 'utf8');

test('es gibt eine Palette je Design', () => {
  assert.match(SRC, /const MAIL_THEMES = \{/, 'Paletten fehlen');
  for (const name of ['classic:', 'brick:']) {
    assert.ok(SRC.includes(name), `Design ${name} fehlt`);
  }
  // Die Stein-Palette muss sich von der klassischen unterscheiden, sonst wäre
  // die ganze Übung wirkungslos.
  assert.match(SRC, /primary:\s*'#2563eb'/, 'classic: Primärfarbe der Webapp');
  assert.match(SRC, /primary:\s*'#3d5a80'/, 'brick: --b600 aus themes/brick.css');
});

test('das Design wird beim Versand geladen, nicht fest verdrahtet', () => {
  assert.match(SRC, /async function getMailTheme\(\)/, 'Loader fehlt');
  assert.match(SRC, /SELECT value FROM global_settings WHERE key='app_theme'/,
    'Das Design ist eine globale Einstellung und muss von dort kommen');
  // Bei jedem Zweifel classic — eine E-Mail darf nie am Design scheitern
  assert.match(SRC, /catch \(_\) \{ return MAIL_THEMES\.classic; \}/,
    'Ohne Rückfall bliebe eine E-Mail bei einem Datenbankfehler aus');

  // Beide Versandfunktionen müssen es laden
  for (const fn of ['sendVerificationMail', 'sendPasswordResetMail']) {
    const body = SRC.slice(SRC.indexOf(`async function ${fn}(`), SRC.indexOf(`async function ${fn}(`) + 1500);
    assert.match(body, /const theme = await getMailTheme\(\);/, `${fn} lädt das Design nicht`);
  }
});

test('Vorlage, Knopf und Infobox nehmen das Design entgegen', () => {
  for (const sig of [
    /function emailTemplate\(title, preheader, content, theme = MAIL_THEMES\.classic\)/,
    /function emailBtn\(url, text, theme = MAIL_THEMES\.classic\)/,
    /function infoBox\(text, theme = MAIL_THEMES\.classic\)/,
  ]) {
    assert.match(SRC, sig, `Signatur ohne Design-Parameter: ${sig}`);
  }
  // Und im Rumpf der Vorlage dürfen die Chrome-Farben nicht mehr fest stehen
  const tpl = SRC.slice(SRC.indexOf('function emailTemplate('), SRC.indexOf('function emailBtn('));
  for (const hard of ['#2563eb', '#f1f5f9', '#1d4ed8']) {
    assert.ok(!tpl.includes(hard), `Vorlage enthält noch die feste Farbe ${hard}`);
  }
  assert.match(tpl, /\$\{theme\.primary\}/, 'Die Vorlage benutzt die Palette nicht');
});
