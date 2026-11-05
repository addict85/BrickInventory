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
 *   e) (01.11.2026) MeldungsEinstieg exported="true"      → Schritte 5, 6 rot.
 *   f) (01.11.2026) MainActivity liest wieder
 *      getStringExtra(EXTRA_SET)                          → Schritte 2, 5 rot.
 *   g) (01.11.2026) taskAffinity an MainActivity entfernt → Schritt 6 rot.
 *   h) (01.11.2026) BIND_APPWIDGET am Widget entfernt     → Schritt 6 rot.
 *   i) (01.11.2026) CsvImportService exported="true"      → Schritt 6 rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, ohneKommentare } = require('./helpers/sources');
const { androidDatei } = require('./helpers/android');

const app = (rel) => ohneKommentare(fs.readFileSync(androidDatei(rel), 'utf8'));
const web = (rel) => ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

test('1. die Benachrichtigung trägt ein Ziel', () => {
  const w = app('alarm/PreisalarmWorker.kt');
  assert.match(w, /\.setContentIntent\(/,
    'Ohne setContentIntent tut ein Antippen NICHTS — die Meldung bleibt stehen.');
  assert.match(w, /putExtra\(EXTRA_SET, a\.setNumber\)/,
    'Die Meldung sagt nicht, WELCHES Set sie meint.');

  // Die Klasse direkt, nicht ihr Name als Zeichenkette: Ein Name ist für R8
  // kein Aufruf. Genau daran ist am 25.09. WorkDatabase_Impl gescheitert. Der
  // Worker liegt in der Datenschicht; die App reicht ihre Activity als Klasse
  // herein (Startziel in di/AppModule.kt).
  assert.match(w, /Intent\(context, startziel\.aktivitaet\)/,
    'Die Meldung öffnet nicht das Startziel der App.');
  // Ziel ist der nicht exportierte Einstieg; die exportierte MainActivity nimmt
  // kein Ziel aus einem Intent an (Schritt 5).
  assert.match(app('di/AppModule.kt'), /Startziel\(MeldungsEinstieg::class\.java\)/,
    'Das Ziel wird über einen Namen aufgelöst oder ist nicht der MeldungsEinstieg.');
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
  assert.match(act, /setAusMeldungAnfordern\(meldungseingang\.abholen\(\)\)/,
    'Das abgelegte Ziel wird nicht weitergereicht.');
  assert.match(app('MeldungsEinstieg.kt'), /eingang\.ablegen\(ankunft\?\.getStringExtra\(PreisalarmWorker\.EXTRA_SET\)\)/,
    'Der Einstieg legt das Ziel der Meldung nicht ab.');

  // Und der NavHost navigiert.
  const nav = app('AppNavigation.kt');
  assert.match(nav, /Screen\.SetDetail\(/,
    'Die App springt nicht ins Set-Detail.');
  assert.match(nav, /setAusMeldungQuittieren\(\)/,
    'Ohne Quittieren springt die App bei jeder Rekomposition erneut.');
  // Nicht im abgemeldeten Zustand: Das Detail kann dann nichts laden.
  assert.match(nav, /startDest == Screen\.Gallery\b/,
    'Der Sprung prüft nicht, ob überhaupt jemand angemeldet ist.');
});

test('3. die Mail trägt einen Link', () => {
  const m = web('src/infra/mailer.ts');
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
  const core = web('public/js/26-sitzung.js');
  const i = core.indexOf('function showApp()');
  assert.ok(i > 0, 'showApp() nicht gefunden');
  const block = core.slice(i, i + 3000);
  assert.match(block, /new URLSearchParams\(location\.search\)\.get\('set'\)/,
    'Die Webapp liest ?set= nicht — der Knopf in der Mail öffnet nur die Startseite.');
  assert.match(block, /openModal\(setAusLink\)/, 'Die Webapp öffnet das Set-Detail nicht.');
  assert.match(block, /history\.replaceState/,
    'Die Adresse wird nicht bereinigt — ein F5 reisst das Detail erneut auf.');
});

// ── Fremde Apps ──────────────────────────────────────────────────────────────
// MainActivity ist für den Launcher exportiert; jede App kann sie mit beliebigen
// Extras starten. Ein Ziel nimmt darum nur der nicht exportierte Einstieg an.

const MANIFEST = () => fs.readFileSync(
  path.join(ROOT, '../Android-App/app/src/main/AndroidManifest.xml'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const element = (xml, art, name) => {
  const m = xml.match(new RegExp(`<${art}\\b[^>]*android:name="${name.replace(/\./g, '\\.')}"[^>]*>`));
  assert.ok(m, `<${art} ${name}> fehlt im Manifest`);
  return m[0];
};

test('5. nur der eigene, nicht exportierte Einstieg öffnet ein Set', () => {
  const xml = MANIFEST();
  assert.match(element(xml, 'activity', '.MeldungsEinstieg'), /android:exported="false"/,
    'Der MeldungsEinstieg ist exportiert — dann kann jede App ein Ziel setzen.');
  const act = app('MainActivity.kt');
  assert.ok(!/getStringExtra|getExtras|\.extras\b|intent\??\.data\b|getData\(\)/.test(act),
    'MainActivity liest den Intent aus — sie ist exportiert, jede App könnte ihn füllen.');
});

test('6. keine Task-Übernahme, kein fremder Anstoss des Widgets', () => {
  const xml = MANIFEST();
  for (const a of xml.match(/<activity\b[^>]*>/g) ?? []) {
    assert.match(a, /android:taskAffinity=""/,
      `${a.match(/android:name="([^"]+)"/)?.[1]}: ohne taskAffinity="" kann eine fremde Activity in die Task rutschen.`);
  }
  assert.ok((xml.match(/<activity\b/g) ?? []).length >= 2, 'Keine Activity im Manifest gefunden — greift die Suche?');
  assert.match(element(xml, 'receiver', '.widget.SammlungsWidgetEmpfaenger'),
    /android:permission="android\.permission\.BIND_APPWIDGET"/,
    'Das Widget nimmt Broadcasts jeder App an (onEnabled/onDisabled, Aktualisierung).');
  assert.ok(!/<(activity|service|receiver|provider)\b[^>]*android:exported="true"[^>]*>/g.test(
    xml.replace(element(xml, 'activity', '.MainActivity'), '').replace(element(xml, 'receiver', '.widget.SammlungsWidgetEmpfaenger'), '')),
    'Eine weitere Komponente ist exportiert.');
});
