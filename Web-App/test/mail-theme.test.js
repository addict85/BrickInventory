/**
 * E-Mails im Design der Webapp.
 * Ausführlich: docs/begruendungen/test/mail-theme.test.js.md#kopf
 *
 * Gegenproben (08.11.2026 gemessen, je einzeln):
 *   A  brick.primary in src/mail/vorlage.ts auf '#2563eb' → rot: „je Design
 *      eine Palette …“ (passt nicht zu --b600 in tokens.css)
 *   B  in emailTemplate wieder `#2563eb` statt `${theme.primary}` → rot:
 *      „Vorlage, Knopf und Infobox zeichnen im übergebenen Design“
 *   C  emailBtn ohne Vorgabe für theme (`theme: MailTheme`) → rot: dieselbe
 *      Prüfung (ohne Design scheitert der Knopf)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// Palette und Gerüst stehen in vorlage.ts, die Mailtexte in mailer.ts.
const SRC = fs.readFileSync(path.join(ROOT, 'src/mail/vorlage.ts'), 'utf8') + '\n'
  + fs.readFileSync(path.join(ROOT, 'src/mail/mailer.ts'), 'utf8');

test('das Design wird beim Versand geladen, nicht fest verdrahtet', () => {
  assert.match(SRC, /async function getMailTheme\(\)/, 'Loader fehlt');
  // Früher stand hier die SQL-Anweisung selbst. Seit alle Zugriffe auf
  // global_settings über src/einstellungen/settings.ts laufen, prüft der Test den Weg
  // dorthin — die Aussage ist dieselbe: Das Design ist eine GLOBALE
  // Einstellung und darf nicht aus dem Prozess oder aus einer Konstanten
  // kommen.
  assert.match(SRC, /await getGlobalSetting\('app_theme'\)/,
    'Das Design ist eine globale Einstellung und muss von dort kommen');
  // `'./settings'` ODER `'../src/einstellungen/settings'`: Der Mailer ist mit einer früheren Runde
  // von routes/ nach utils/ gezogen (er hatte nie eine Route), und damit
  // aenderte sich der RELATIVE Pfad auf dieselbe Datei. Geprueft ist die
  // Aussage — zentrale Fassung statt eigener Abfrage —, nicht die Anzahl der
  // Punkte davor.
  assert.match(SRC, /import \{[^}]*getGlobalSetting[^}]*\} from '(?:\.\.\/)*(?:einstellungen\/)?settings'/,
    'und zwar über die zentrale Fassung, nicht über eine eigene Abfrage');
  // Bei jedem Zweifel classic — eine E-Mail darf nie am Design scheitern
  assert.match(SRC, /catch \(_\) \{\s*return MAIL_THEMES\.classic;\s*\}/,
    'Ohne Rückfall bliebe eine E-Mail bei einem Datenbankfehler aus');

  // Beide Versandfunktionen müssen es laden
  for (const fn of ['sendVerificationMail', 'sendPasswordResetMail']) {
    const body = SRC.slice(SRC.indexOf(`async function ${fn}(`), SRC.indexOf(`async function ${fn}(`) + 1500);
    assert.match(body, /const theme = await getMailTheme\(\);/, `${fn} lädt das Design nicht`);
  }
});

const _req = require('./helpers/sources').buildAndRequire();

test('je Design eine Palette mit der Primärfarbe der Webapp', () => {
  const { MAIL_THEMES } = _req('src/mail/vorlage.js');
  assert.deepEqual(Object.keys(MAIL_THEMES).sort(), ['brick', 'classic']);
  // --b600 je Design aus tokens.css: Die Mail soll aussehen wie die Webapp.
  const tokens = fs.readFileSync(path.join(ROOT, 'public', 'tokens.css'), 'utf8');
  const b600 = (block) => tokens.slice(tokens.indexOf(block)).match(/--b600:\s*(#[0-9a-f]{6})/i)[1];
  assert.equal(MAIL_THEMES.classic.primary, b600(':root'));
  assert.equal(MAIL_THEMES.brick.primary, b600('[data-theme="brick"]'));
});

test('Vorlage, Knopf und Infobox zeichnen im übergebenen Design', () => {
  const { MAIL_THEMES, emailTemplate, emailBtn, infoBox } = _req('src/mail/vorlage.js');
  const { classic, brick } = MAIL_THEMES;
  for (const [name, bau] of [
    ['emailTemplate', (th) => emailTemplate('Titel', 'Vorschau', '<p>x</p>', th)],
    ['emailBtn', (th) => emailBtn('https://lego.example.org/', 'Los', th)],
    ['infoBox', (th) => infoBox('Hinweis', th)],
  ]) {
    const mitBrick = bau(brick);
    assert.ok(mitBrick.includes(brick.primary) || mitBrick.includes(brick.bg), `${name}: das Design kommt nicht an`);
    assert.ok(!mitBrick.includes(classic.primary) && !mitBrick.includes(classic.bg), `${name}: feste Farbe von classic`);
    // Ohne Angabe gilt classic: Eine Mail soll nie am Design scheitern.
    assert.equal(bau(undefined), bau(classic), `${name}: Vorgabe ist nicht classic`);
  }
});
