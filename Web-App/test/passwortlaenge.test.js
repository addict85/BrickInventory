/**
 * Die Mindestlaenge eines Passworts — an allen Stellen dieselbe. Dass jeder
 * Weg, der ein Passwort setzt, sie prüft, zeigt passwort-regel-db.test.js
 * („zu kurze Passwörter werden auf allen fünf Wegen abgewiesen“).
 *
 * Gegenprobe (11.11.2026 gemessen): `passwort_zu_kurz` in src/infra/fehlerTexte.ts
 * auf „mindestens 8 Zeichen“ → rot „die Fehlermeldung nennt dieselbe Zahl …“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const { buildAndRequire, ohneKommentare } = require('./helpers/sources');
const _req = buildAndRequire();
const { PASSWORD_MIN_CHARS, passwordToShort } = _req('src/account/loginCheck.js');

test('die Regel selbst haelt auch das, was kein String ist', () => {
  // Seit dem 04.11.2026 zwölf statt acht.
  assert.equal(passwordToShort('12345678901'), true);
  assert.equal(passwordToShort('123456789012'), false);
  assert.equal(passwordToShort(''), true);
  assert.equal(passwordToShort(null), true);
  assert.equal(passwordToShort(undefined), true);
  // ── Der Fall, den zwei der vier alten Pruefungen durchliessen ─────────────
  // Der Rumpf einer Anfrage kann alles enthalten. `(123456789).length` ist
  // `undefined`, und `undefined < 8` ist FALSCH — ein Passwort als JSON-Zahl
  // kam an `password.length < 8` also vorbei. Nur die zwei Stellen mit
  // `String(password).length` fingen es ab.
  assert.equal(passwordToShort(123), true, 'Eine Zahl hat kein .length — sie darf nicht durchrutschen');
  // Die Gegenrichtung, damit die Zeile darueber nicht bloss „alles ist zu
  // kurz" beweist: Aus der Zahl wird ihre Ziffernfolge, und die ist lang
  // genug (`String(123456789012)` hat zwölf Zeichen).
  assert.equal(passwordToShort(123456789012), false);
});

test('Server und Webapp nennen dieselbe Zahl', () => {
  const web = ohneKommentare(read('public/js/formular.js'));
  const webNumber = /export const PASSWORD_MIN_CHARS = (\d+)/.exec(web);
  assert.ok(webNumber, 'Die Webapp fuehrt keine Konstante mehr — dann steht die Zahl wieder verstreut');
  assert.equal(Number(webNumber[1]), PASSWORD_MIN_CHARS, 'Webapp und Server verlangen verschiedene Laengen');
});

test('die Fehlermeldung nennt dieselbe Zahl wie die Regel', () => {
  // Die Texte können der Konstante nicht folgen; ein Text, der weniger
  // verspricht, als der Server verlangt, führt den Nutzer in eine Absage.
  const { errorText } = _req('src/infra/fehlerTexte.js');
  for (const sprache of ['de', 'en'])
    assert.match(errorText('passwort_zu_kurz', sprache), new RegExp(`\\b${PASSWORD_MIN_CHARS}\\b`), sprache);
  // Die Webapp füllt die Zahl zur Laufzeit ein: dort ein Platzhalter, keine Zahl.
  const texte = require('./helpers/sources').loadTranslations();
  for (const sprache of ['de', 'en']) {
    const text = texte[sprache]['settings.password.too_short'];
    assert.ok(text, `settings.password.too_short fehlt in ${sprache}.js`);
    assert.ok(text.includes('{n}'), `${sprache}.js schreibt die Zahl aus statt {n} zu benutzen`);
  }
});

test('die Webapp prueft vor dem Absenden', () => {
  // Sonst schickte sie ab und zeigte erst den Serverfehler.
  const core = ohneKommentare(read('public/js/formular.js'));
  const settings = ohneKommentare(require('./helpers/sources').ansichtQuelle('einstellungen'));
  // Anmelden, Registrieren und Zurücksetzen stehen seit dem Umbau in sitzung.js.
  const sitzung = ohneKommentare(read('public/js/sitzung.js'));
  const webCalls =
    (core.match(/passwordRuleText\(/g) || []).length +
    (settings.match(/passwordRuleText\(/g) || []).length +
    (sitzung.match(/passwordRuleText\(/g) || []).length;
  // Fuenf Stellen setzen in der Webapp ein Passwort: Registrieren,
  // Zuruecksetzen, Aendern, Konto anlegen, Konto-Passwort zuruecksetzen.
  // Dazu die Definition selbst in formular.js.
  assert.ok(webCalls >= 6, `Nur ${webCalls} Vorkommen — nicht alle fuenf Formulare pruefen vor dem Absenden`);
});
