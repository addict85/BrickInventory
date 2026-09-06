/**
 * Die Mindestlaenge eines Passworts — an allen Stellen dieselbe, und nirgends
 * vergessen.
 *
 * ── Woher das kommt ─────────────────────────────────────────────────────────
 * Sechs Routen in routes/auth.ts setzen ein Passwort. VIER prueften die
 * Laenge, und zwar in zwei Schreibweisen (`password.length < 8` und
 * `String(password).length < 8`), jede von Hand hingeschrieben. Zwei prueften
 * gar nicht:
 *
 *     PUT  /profile           (Passwort-Zweig)
 *     POST /change-password
 *
 * Das waren ausgerechnet die zwei Wege, die einem BEREITS ANGEMELDETEN Konto
 * offenstehen — und damit war die Regel wirkungslos: Man registriert sich mit
 * acht Zeichen und aendert danach auf eines. Ein per Sitzungsuebernahme
 * gekapertes Konto liess sich so dauerhaft schwach machen.
 *
 * Der Grund fuer die Luecke war die fehlende Konstante: Wo eine Regel an jeder
 * Stelle neu getippt wird, gibt es keine Stelle, die man vergessen KOENNTE.
 *
 * ── Und die zweite Haelfte: die beiden Oberflaechen ─────────────────────────
 * Die Android-App prueft die Laenge in ihrer Oberflaeche (SettingsScreen,
 * LoginScreen). Die Webapp prueft an KEINER ihrer fuenf Stellen. Wer im
 * Browser ein zu kurzes Passwort eingab, lief in einen Serverfehler, wo die
 * App den Knopf gar nicht erst freigibt.
 *
 * ── Warum die Zahl trotzdem dreimal existiert ───────────────────────────────
 * Server, Webapp und App teilen keinen Code — drei Laufzeiten, drei Fassungen.
 * Das ist unvermeidbar; das AUSEINANDERLAUFEN ist es nicht. Genau dafuer gibt
 * es diesen Test.
 *
 * Ausfuehren: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const { buildAndRequire, ohneKommentare } = require('./helpers/sources');
const _req = buildAndRequire();
const { PASSWORT_MIN_ZEICHEN, passwortZuKurz } = _req('utils/auth.js');

// Ausgeschrieben statt ueber eine Schleifenvariable zusammengesetzt — siehe
// test/baumbruecken.test.js, das diese Bruecken statisch aufloest.
const KOTLIN = path.join(ROOT, '..', 'Android-App', 'app', 'src', 'main',
                         'java', 'ch', 'brickinventoryapp');

test('die Regel selbst haelt auch das, was kein String ist', () => {
  assert.equal(passwortZuKurz('1234567'), true);
  assert.equal(passwortZuKurz('12345678'), false);
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
  assert.equal(passwortZuKurz(123456789), false);
});

test('alle sechs Routen, die ein Passwort setzen, pruefen die Laenge', () => {
  const quelle = ohneKommentare(read('routes/auth.ts'));

  // Gezaehlt wird ueber das HASHEN, nicht ueber die Routennamen: Jede Stelle,
  // die ein Passwort in die Datenbank schreibt, muss durch bcrypt.hash — eine
  // neue Route kann diesem Test also nicht entgehen, indem sie anders heisst.
  const hashes = (quelle.match(/bcrypt\.hash\(/g) || []).length;
  const pruefungen = (quelle.match(/passwortZuKurz\(/g) || []).length;
  assert.equal(hashes, 6,
    `${hashes} Stellen hashen ein Passwort — die Zahl hat sich geaendert, der Test muss mit`);
  assert.equal(pruefungen, hashes,
    `Nur ${pruefungen} von ${hashes} Stellen pruefen die Laenge. Genau so entstand die ` +
    'Luecke: PUT /profile und POST /change-password prueften nicht, und damit war ' +
    'die Regel wirkungslos.');

  // Und keine handgetippte Fassung mehr — die war die Ursache.
  assert.doesNotMatch(quelle, /length < 8/,
    'Eine Laengenpruefung von Hand ist zurueck; sie gehoert in passwortZuKurz()');
});

test('Server, Webapp und App nennen dieselbe Zahl', () => {
  const web = ohneKommentare(read('public/js/01-core.js'));
  const webZahl = /export const PASSWORT_MIN_ZEICHEN = (\d+)/.exec(web);
  assert.ok(webZahl, 'Die Webapp fuehrt keine Konstante mehr — dann steht die Zahl wieder verstreut');
  assert.equal(Number(webZahl[1]), PASSWORT_MIN_ZEICHEN,
    'Webapp und Server verlangen verschiedene Laengen');

  const kotlinDatei = path.join(KOTLIN, 'util', 'Passwort.kt');
  assert.ok(fs.existsSync(kotlinDatei), 'util/Passwort.kt fehlt — Pfad im Test veraltet?');
  // `const val`, nicht bloss der Name: Der erste Entwurf dieser Datei schrieb
  // `const PASSWORT_MIN_ZEICHEN = 8` — ohne `val`, und das ist kein gueltiges
  // Kotlin. Dieser Regex traf die Zeichenkette trotzdem, der Test blieb gruen,
  // und der Fehler fiel erst im Android-Lauf auf (Lauf 140, nach 83 Sekunden
  // Abbruch). Eine Pruefung, die eine Zeichenkette sucht statt die Sache,
  // findet auch eine kaputte Sache.
  //
  // Der Android-Compiler laeuft in dieser Umgebung nicht (dl.google.com
  // antwortet mit 403); der Lauf in CI ist der einzige Uebersetzer. Umso mehr
  // muss das, was hier ohne ihn pruefbar ist, genau pruefen.
  const appZahl = /const val PASSWORT_MIN_ZEICHEN = (\d+)\b/.exec(fs.readFileSync(kotlinDatei, 'utf8'));
  assert.ok(appZahl,
    'Die App fuehrt keine Konstante mehr — oder nicht als `const val` (ohne `val` ' +
    'uebersetzt Kotlin die Datei nicht)');
  assert.equal(Number(appZahl[1]), PASSWORT_MIN_ZEICHEN,
    'App und Server verlangen verschiedene Laengen');
});

test('die Fehlermeldung nennt dieselbe Zahl wie die Regel', () => {
  // Der Text steht in drei Sprachdateien und kann der Konstante nicht folgen —
  // also wird er hier an sie gebunden. Ein Text, der acht verspricht, waehrend
  // der Server zwoelf verlangt, ist eine eigene Art von Fehler: Der Nutzer
  // probiert, was dort steht, und bekommt trotzdem eine Absage.
  const serverText = read('utils/fehlerTexte.ts');
  const eintrag = serverText.slice(serverText.indexOf('passwort_zu_kurz:'),
                                  serverText.indexOf('aktuelles_passwort_erforderlich'));
  assert.ok(eintrag.includes(String(PASSWORT_MIN_ZEICHEN)),
    `Der Fehlertext nennt nicht ${PASSWORT_MIN_ZEICHEN} Zeichen`);

  // Die Webapp fuellt die Zahl zur Laufzeit ein — dort muss der Platzhalter
  // stehen, keine ausgeschriebene Zahl.
  for (const sprache of ['de', 'en']) {
    const zeile = read(`public/locales/${sprache}.js`)
      .split('\n').find(z => z.includes('settings.password.too_short'));
    assert.ok(zeile, `settings.password.too_short fehlt in ${sprache}.js`);
    assert.ok(zeile.includes('{n}'),
      `${sprache}.js schreibt die Zahl aus statt {n} zu benutzen — dann laeuft sie auseinander`);
  }
});

test('beide Oberflaechen pruefen vor dem Absenden', () => {
  // Ohne diese Haelfte waere die Webapp weiterhin die unbequemere von beiden:
  // Sie schickte ab und zeigte den Serverfehler, waehrend die App den Knopf
  // gar nicht erst freigibt.
  const core = ohneKommentare(read('public/js/01-core.js'));
  const settings = ohneKommentare(read('public/js/05-settings.js'));
  const webAufrufe = (core.match(/passwortZuKurz\(/g) || []).length
                   + (settings.match(/passwortZuKurz\(/g) || []).length;
  // Fuenf Stellen setzen in der Webapp ein Passwort: Registrieren,
  // Zuruecksetzen, Aendern, Konto anlegen, Konto-Passwort zuruecksetzen.
  // Dazu die Definition selbst in 01-core.js.
  assert.ok(webAufrufe >= 6,
    `Nur ${webAufrufe} Vorkommen — nicht alle fuenf Formulare pruefen vor dem Absenden`);

  // ── Gezaehlt, nicht bloss gesucht ────────────────────────────────────────
  //
  // Hier stand `assert.match(quelle, /passwortZuKurz\(/)` — also „kommt in der
  // Datei vor". SettingsScreen benutzt die Regel an DREI Stellen derselben
  // Ansicht (Hinweistext, Fehlermarkierung, Knopf-Freigabe). Die Gegenprobe
  // schaltete eine davon ab, und der Test blieb gruen: Er traf die Datei statt
  // der Stelle — dieselbe Fehlerart wie beim Bruecken-Test, wo der Basisordner
  // statt der Kotlin-Datei geprueft wurde.
  //
  // Die Zahlen sind GEMESSEN, nicht gesetzt. Wer eine Stelle hinzufuegt, muss
  // hier mitziehen — das ist der Preis dafuer, dass das Wegfallen einer Stelle
  // auffaellt.
  // Jedes path.join() mit AUSGESCHRIEBENEN Segmenten: test/baumbruecken.test.js
  // loest die Bruecken in den Android-Baum statisch auf und kann ein variables
  // Segment nicht sehen. Der erste Entwurf hatte den Dateinamen als
  // Schleifenvariable — und wurde von jener Pruefung prompt gemeldet, zum
  // zweiten Mal in dieser Sitzung.
  for (const [voll, anzahl, name] of [
    [path.join(KOTLIN, 'ui', 'screens', 'SettingsScreen.kt'), 3, 'Passwort aendern'],
    [path.join(KOTLIN, 'ui', 'screens', 'LoginScreen.kt'),    1, 'Registrieren'],
  ]) {
    const kurz = path.basename(voll);
    assert.ok(fs.existsSync(voll), `${kurz} steht nicht mehr dort — Pfad im Test veraltet`);
    const treffer = (fs.readFileSync(voll, 'utf8').match(/passwortZuKurz\(/g) || []).length;
    assert.equal(treffer, anzahl,
      `${kurz}: ${treffer} statt ${anzahl} Pruefungen. Die App prueft bei „${name}" ` +
      'nicht mehr ueberall ueber die gemeinsame Regel.');
  }
});
