/**
 * Die Mindestlaenge eines Passworts — an allen Stellen dieselbe. Dass jeder
 * Weg, der ein Passwort setzt, sie prüft, zeigt passwort-regel-db.test.js
 * („zu kurze Passwörter werden auf allen fünf Wegen abgewiesen“).
 *
 * Gegenprobe (11.11.2026 gemessen): `passwort_zu_kurz` in src/infra/fehlerTexte.ts
 * auf „mindestens 8 Zeichen“ → rot „die Fehlermeldung nennt dieselbe Zahl …“.
 */
// Abgleich Web↔App: läuft in web-ci auch bei Änderungen unter Android-App/ (paths-Filter).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const { buildAndRequire, ohneKommentare } = require('./helpers/sources');
const _req = buildAndRequire();
const { PASSWORT_MIN_ZEICHEN, passwortZuKurz } = _req('src/konto/anmeldepruefung.js');

// Ausgeschrieben statt ueber eine Schleifenvariable zusammengesetzt — siehe
// test/abgleich-baumbruecken.test.js, das diese Bruecken statisch aufloest.

test('die Regel selbst haelt auch das, was kein String ist', () => {
  // Seit dem 04.11.2026 zwölf statt acht.
  assert.equal(passwortZuKurz('12345678901'), true);
  assert.equal(passwortZuKurz('123456789012'), false);
  assert.equal(passwortZuKurz(''), true);
  assert.equal(passwortZuKurz(null), true);
  assert.equal(passwortZuKurz(undefined), true);
  // ── Der Fall, den zwei der vier alten Pruefungen durchliessen ─────────────
  // Der Rumpf einer Anfrage kann alles enthalten. `(123456789).length` ist
  // `undefined`, und `undefined < 8` ist FALSCH — ein Passwort als JSON-Zahl
  // kam an `password.length < 8` also vorbei. Nur die zwei Stellen mit
  // `String(password).length` fingen es ab.
  assert.equal(passwortZuKurz(123), true, 'Eine Zahl hat kein .length — sie darf nicht durchrutschen');
  // Die Gegenrichtung, damit die Zeile darueber nicht bloss „alles ist zu
  // kurz" beweist: Aus der Zahl wird ihre Ziffernfolge, und die ist lang
  // genug. (Hier stand zuerst `true` — ein Irrtum beim Schreiben dieses
  // Tests, nicht im Code: `String(123456789)` hat neun Zeichen.)
  assert.equal(passwortZuKurz(123456789012), false);
});

test('Server, Webapp und App nennen dieselbe Zahl', () => {
  const web = ohneKommentare(read('public/js/formular.js'));
  const webZahl = /export const PASSWORT_MIN_ZEICHEN = (\d+)/.exec(web);
  assert.ok(webZahl, 'Die Webapp fuehrt keine Konstante mehr — dann steht die Zahl wieder verstreut');
  assert.equal(Number(webZahl[1]), PASSWORT_MIN_ZEICHEN, 'Webapp und Server verlangen verschiedene Laengen');

  const kotlinDatei = path.join(
    __dirname,
    '..',
    '..',
    'Android-App',
    'core-model',
    'src',
    'main',
    'java',
    'ch',
    'brickinventoryapp',
    'model',
    'util',
    'Passwort.kt',
  );
  assert.ok(fs.existsSync(kotlinDatei), 'model/util/Passwort.kt fehlt — Pfad im Test veraltet?');
  // `const val`, nicht bloss der Name: Der erste Entwurf dieser Datei schrieb
  // `const PASSWORT_MIN_ZEICHEN = 8` — ohne `val`, und das ist kein gueltiges
  // Kotlin. Dieser Regex traf die Zeichenkette trotzdem, der Test blieb gruen,
  // und der Fehler fiel erst im Android-Lauf auf (Lauf 140, nach 83 Sekunden …
  const appZahl = /const val PASSWORT_MIN_ZEICHEN = (\d+)\b/.exec(fs.readFileSync(kotlinDatei, 'utf8'));
  assert.ok(
    appZahl,
    'Die App fuehrt keine Konstante mehr — oder nicht als `const val` (ohne `val` ' +
      'uebersetzt Kotlin die Datei nicht)',
  );
  assert.equal(Number(appZahl[1]), PASSWORT_MIN_ZEICHEN, 'App und Server verlangen verschiedene Laengen');
});

test('die Fehlermeldung nennt dieselbe Zahl wie die Regel', () => {
  // Die Texte können der Konstante nicht folgen; ein Text, der weniger
  // verspricht, als der Server verlangt, führt den Nutzer in eine Absage.
  const { fehlerText } = _req('src/infra/fehlerTexte.js');
  for (const sprache of ['de', 'en'])
    assert.match(fehlerText('passwort_zu_kurz', sprache), new RegExp(`\\b${PASSWORT_MIN_ZEICHEN}\\b`), sprache);
  // Die Webapp füllt die Zahl zur Laufzeit ein: dort ein Platzhalter, keine Zahl.
  const texte = require('./helpers/sources').loadTranslations();
  for (const sprache of ['de', 'en']) {
    const text = texte[sprache]['settings.password.too_short'];
    assert.ok(text, `settings.password.too_short fehlt in ${sprache}.js`);
    assert.ok(text.includes('{n}'), `${sprache}.js schreibt die Zahl aus statt {n} zu benutzen`);
  }
});

test('beide Oberflaechen pruefen vor dem Absenden', () => {
  // Ohne diese Haelfte waere die Webapp weiterhin die unbequemere von beiden:
  // Sie schickte ab und zeigte den Serverfehler, waehrend die App den Knopf
  // gar nicht erst freigibt.
  const core = ohneKommentare(read('public/js/formular.js'));
  const settings = ohneKommentare(require('./helpers/sources').ansichtQuelle('einstellungen'));
  // Anmelden, Registrieren und Zurücksetzen stehen seit dem Umbau in sitzung.js.
  const sitzung = ohneKommentare(read('public/js/sitzung.js'));
  const webAufrufe =
    (core.match(/passwortRegelText\(/g) || []).length +
    (settings.match(/passwortRegelText\(/g) || []).length +
    (sitzung.match(/passwortRegelText\(/g) || []).length;
  // Fuenf Stellen setzen in der Webapp ein Passwort: Registrieren,
  // Zuruecksetzen, Aendern, Konto anlegen, Konto-Passwort zuruecksetzen.
  // Dazu die Definition selbst in formular.js.
  assert.ok(webAufrufe >= 6, `Nur ${webAufrufe} Vorkommen — nicht alle fuenf Formulare pruefen vor dem Absenden`);

  // Gezaehlt, nicht bloss gesucht
  //
  // Hier stand `assert.match(quelle, /passwortZuKurz\(/)` — also „kommt in der
  // Datei vor". SettingsScreen benutzt die Regel an DREI Stellen derselben
  // Ansicht (Hinweistext, Fehlermarkierung, Knopf-Freigabe). Die Gegenprobe
  // schaltete eine davon ab, und der Test blieb gruen: Er traf die Datei statt
  // der Stelle — dieselbe Fehlerart wie beim Bruecken-Test, wo der Basisordner
  // statt der Kotlin-Datei geprueft wurde.
  for (const [voll, anzahl, name] of [
    // Seit dem 16.10. steht die Kontokarte auf ihrer eigenen Seite: Der
    // Einstellungsbildschirm traegt nur noch die Liste dorthin.
    [
      path.join(
        __dirname,
        '..',
        '..',
        'Android-App',
        'feature-konto',
        'src',
        'main',
        'java',
        'ch',
        'brickinventoryapp',
        'konto',
        'ui',
        'screens',
        'EinstellungenKonto.kt',
      ),
      2,
      'Passwort aendern',
    ],
    // Hinweis und Fehlermarkierung teilen sich seit dem PasswortFeld einen Wert.
    [
      path.join(
        __dirname,
        '..',
        '..',
        'Android-App',
        'feature-konto',
        'src',
        'main',
        'java',
        'ch',
        'brickinventoryapp',
        'konto',
        'ui',
        'screens',
        'StartpasswortMaske.kt',
      ),
      1,
      'Startpasswort',
    ],
    [
      path.join(
        __dirname,
        '..',
        '..',
        'Android-App',
        'feature-anmeldung',
        'src',
        'main',
        'java',
        'ch',
        'brickinventoryapp',
        'anmeldung',
        'ui',
        'screens',
        'LoginRegistrieren.kt',
      ),
      1,
      'Registrieren',
    ],
  ]) {
    const kurz = path.basename(voll);
    assert.ok(fs.existsSync(voll), `${kurz} steht nicht mehr dort — Pfad im Test veraltet`);
    const treffer = (fs.readFileSync(voll, 'utf8').match(/passwortZuKurz\(/g) || []).length;
    assert.equal(
      treffer,
      anzahl,
      `${kurz}: ${treffer} statt ${anzahl} Pruefungen. Die App prueft bei „${name}" ` +
        'nicht mehr ueberall ueber die gemeinsame Regel.',
    );
  }
});
