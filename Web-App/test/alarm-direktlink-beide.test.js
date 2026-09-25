/**
 * Eine Meldung führt zum SET — angetippt auf dem Telefon, angeklickt in der
 * Mail.
 *
 * ── Marcos Wunsch vom 25.09. ────────────────────────────────────────────────
 *
 *   „Kannst du noch umsetzen, dass ich in der Android App die notification
 *    anklicken kann und dann die App sowie das Set im Detaildialog geöffnet
 *    wird. Bei den Mails wäre es schön wenn es ebenfalls einen direkt link auf
 *    die Webapp mit dem entsprechenden Set geben würde."
 *
 * ── Warum das eine Regel über BEIDE ist ─────────────────────────────────────
 *
 * Es sind zwei Wege zum selben Ziel, und jeder besteht aus zwei Hälften, die
 * unabhängig voneinander kaputtgehen können:
 *
 *     Meldung trägt ein Ziel   +   die App löst es ein
 *     Mail trägt einen Link    +   die Webapp löst ihn ein
 *
 * Genau daran ist es schon einmal gescheitert, und zwar an MIR: Ich habe am
 * 25.09. den Knopf in die Mail gebaut, der auf `/?set=<nummer>` zeigt — ohne
 * nachzusehen, ob die Webapp diesen Parameter überhaupt liest. Sie las ihn
 * nicht. Der Knopf öffnete die Startseite, und das sah aus wie ein Link, der
 * funktioniert.
 *
 * Eine halbe Brücke ist schlimmer als keine: Sie verspricht etwas.
 *
 * ── Gegenproben (durchgeführt, Ergebnis im Commit) ──────────────────────────
 *   a) setContentIntent aus der Benachrichtigung entfernt → Schritt 1 rot.
 *   b) Das Auslesen in AppNavigation entfernt             → Schritt 2 rot.
 *   c) Den Knopf aus der Mail entfernt                    → Schritt 3 rot.
 *   d) Das Auslesen von ?set= in showApp() entfernt       → Schritt 4 rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, ohneKommentare } = require('./helpers/sources');

const APP = path.join(ROOT, '../Android-App/app/src/main/java/ch/brickinventoryapp');
const app = (rel) => ohneKommentare(fs.readFileSync(path.join(APP, rel), 'utf8'));
const web = (rel) => ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

test('1. die Benachrichtigung trägt ein Ziel', () => {
  const w = app('alarm/PreisalarmWorker.kt');
  assert.match(w, /\.setContentIntent\(/,
    'Ohne setContentIntent tut ein Antippen NICHTS — die Meldung bleibt stehen.');
  assert.match(w, /putExtra\(EXTRA_SET, a\.setNumber\)/,
    'Die Meldung sagt nicht, WELCHES Set sie meint.');

  // Die Klasse direkt, nicht ihr Name als Zeichenkette: Ein Name ist für R8
  // kein Aufruf. Genau daran ist am 25.09. WorkDatabase_Impl gescheitert.
  assert.match(w, /Intent\(context, ch\.brickinventoryapp\.MainActivity::class\.java\)/,
    'Das Ziel wird über einen Namen aufgelöst — R8 sieht darin keinen Aufruf.');
  assert.ok(!/Class\.forName/.test(w),
    'Class.forName() im Worker — dieselbe Falle wie bei WorkDatabase_Impl.');

  // Verschiedene Sets brauchen verschiedene PendingIntents, sonst öffnet die
  // ältere Meldung das Set der jüngeren.
  assert.match(w, /\(a\.setNumber \+ a\.condition\)\.hashCode\(\)/,
    'Alle Meldungen teilen sich einen PendingIntent — dann öffnet die falsche das falsche Set.');
  assert.match(w, /FLAG_IMMUTABLE/, 'Ab Android 12 ist das Pflicht.');

  // Eine laufende App soll den Intent bekommen, nicht ein zweites Mal starten.
  const manifest = fs.readFileSync(
    path.join(ROOT, '../Android-App/app/src/main/AndroidManifest.xml'), 'utf8');
  assert.match(manifest, /android:launchMode="singleTop"/,
    'Ohne singleTop stapeln sich die Instanzen im Zurück-Weg.');
});

test('2. und die App löst es ein', () => {
  // Die Activity nimmt entgegen — beim Start UND im Betrieb.
  const act = app('MainActivity.kt');
  assert.match(act, /override fun onNewIntent\(/,
    'Eine angetippte Meldung bei laufender App landet nirgends.');
  assert.match(act, /setIntent\(intent\)/,
    'Ohne setIntent() liefert getIntent() weiter den alten — die zweite Meldung öffnet das erste Set.');
  assert.match(act, /setAusMeldungAnfordern\(/, 'Das Ziel wird nicht weitergereicht.');

  // Und der NavHost navigiert.
  const nav = app('AppNavigation.kt');
  assert.match(nav, /Screen\.SetDetail\.createRoute\(/,
    'Die App springt nicht ins Set-Detail.');
  assert.match(nav, /setAusMeldungQuittieren\(\)/,
    'Ohne Quittieren springt die App bei jeder Rekomposition erneut.');
  // Nicht im abgemeldeten Zustand: Das Detail kann dann nichts laden.
  assert.match(nav, /startDest == Screen\.Gallery\.route/,
    'Der Sprung prüft nicht, ob überhaupt jemand angemeldet ist.');
});

test('3. die Mail trägt einen Link', () => {
  const m = web('utils/mailer.ts');
  const i = m.indexOf('async function baueAlarmMail(');
  assert.ok(i > 0, 'baueAlarmMail() nicht gefunden');
  const body = m.slice(i, m.indexOf('\n// ──', i) < 0 ? undefined : m.indexOf('\n// ──', i));
  assert.match(body, /\/\?set=\$\{encodeURIComponent\(d\.setNumber\)\}/,
    'Die Mail verlinkt das Set nicht.');
  assert.match(body, /emailBtn\(url/, 'Der Link steht nicht als Knopf in der Mail.');
  // Ohne APP_BASE_URL kein Knopf: Ein geratener Host wäre schlimmer als keiner.
  assert.match(body, /url \? emailBtn/,
    'Der Knopf erscheint auch ohne bekannte Adresse — dann zeigt er ins Leere.');
});

test('4. und die Webapp löst ihn ein', () => {
  // DER Schritt, der am 25.09. gefehlt hat.
  const core = web('public/js/01-core.js');
  const i = core.indexOf('function showApp()');
  assert.ok(i > 0, 'showApp() nicht gefunden');
  const block = core.slice(i, i + 3000);
  assert.match(block, /new URLSearchParams\(location\.search\)\.get\('set'\)/,
    'Die Webapp liest ?set= nicht — der Knopf in der Mail öffnet nur die Startseite.');
  assert.match(block, /openModal\?\.\(/, 'Die Webapp öffnet das Set-Detail nicht.');
  assert.match(block, /history\.replaceState/,
    'Die Adresse wird nicht bereinigt — ein F5 reisst das Detail erneut auf.');
});
