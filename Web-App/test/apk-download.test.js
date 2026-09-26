/**
 * Der Download-Knopf zeigt dorthin, wo der Workflow das APK wirklich ablegt.
 *
 * ── Marcos Auftrag vom 26.09. ───────────────────────────────────────────────
 *
 *   „Kannst du in der Webapp unter Einstellungen wo man den QR-Code erstellen
 *    kann einen Download-Android-App-Button einfügen […] der die aktuellste
 *    Android App Version von GitHub herunterlädt?"
 *
 * ── Warum das eine Regel braucht ────────────────────────────────────────────
 *
 * Dieselbe Adresse steht jetzt an DREI Stellen, in drei Sprachen:
 *
 *   1. android.yml         — legt das APK dort ab (Etikett und Dateiname)
 *   2. AppUpdate.kt        — die App holt sich von dort ihre Aktualisierung
 *   3. index.html          — der Knopf, um den es hier geht
 *
 * Eine Adresse in drei Sprachen lässt sich nicht zusammenlegen; ein Konstante
 * in Kotlin ist im Markup nicht lesbar. Was geht, ist sie zu VERGLEICHEN.
 *
 * Und das ist kein Formalismus: Ein Download-Knopf ist die eine Art von
 * Fehler, die niemand bemerkt. Wer die Webapp benutzt, hat die App schon; wer
 * sie noch nicht hat, klickt einmal, bekommt die 404-Seite von GitHub und
 * fragt nicht nach. Änderte jemand das Etikett `apk-neuste` im Workflow, liefe
 * die App weiter (sie trägt die Adresse in sich) und nur der Knopf zeigte ins
 * Leere — genau die Kombination, die lange unentdeckt bleibt.
 *
 * ── Gegenproben (durchgeführt, Ergebnis im Commit) ──────────────────────────
 *   a) Etikett im Knopf auf `apk-alt` geändert  → Schritt 2 rot
 *   b) Dateiname im Knopf auf `App.apk`         → Schritt 2 rot
 *   c) Knopf aus index.html entfernt            → Schritt 1 rot
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

/** Die Adresse, die im Knopf steht. */
function adresseImKnopf() {
  const m = html.match(/<a class="apk-btn" href="([^"]+)"/);
  return m ? m[1] : null;
}

test('1. der Knopf steht in den Einstellungen, vor dem QR-Code', () => {
  const adresse = adresseImKnopf();
  assert.ok(adresse, 'Es gibt keinen Download-Knopf für die Android-App.');
  assert.match(adresse, /^https:\/\/github\.com\//,
    'Der Knopf zeigt nicht auf GitHub — dort liegt das APK.');

  // Reihenfolge: erst die App holen, dann das Gerät verknüpfen. Andersherum
  // steht der QR-Code vor einem Gerät, auf dem es noch nichts zu scannen gibt.
  assert.ok(html.indexOf('class="apk-btn"') < html.indexOf('id="qr-container"'),
    'Der Knopf steht hinter dem QR-Code — die Reihenfolge ist verkehrt herum.');
});

test('2. dieselbe Adresse wie im Workflow und in der App', () => {
  const adresse = adresseImKnopf();

  // ── Aus dem Workflow: Etikett und Dateiname ──────────────────────────────
  const yml = fs.readFileSync(
    path.join(ROOT, '..', '.github', 'workflows', 'android.yml'), 'utf8');
  const etikett = yml.match(/^\s*ETIKETT=(\S+)/m)?.[1];
  assert.ok(etikett, 'Im Workflow ist kein ETIKETT mehr zu finden — Muster veraltet?');
  const apkName = yml.match(/^\s*APK=.*\/([^/\s]+\.apk)/m)?.[1];
  assert.ok(apkName, 'Im Workflow ist kein APK-Dateiname mehr zu finden — Muster veraltet?');

  assert.ok(adresse.endsWith(`/${etikett}/${apkName}`),
    `Der Knopf zeigt auf "${adresse}", der Workflow legt das APK aber unter ` +
    `"${etikett}/${apkName}" ab. Ein Klick endete auf der 404-Seite von GitHub.`);

  // ── Aus der App: dieselbe Ablage, aus der sie sich selbst aktualisiert ────
  const kt = fs.readFileSync(path.join(ROOT, '..', 'Android-App', 'app', 'src', 'main',
    'java', 'ch', 'brickinventoryapp', 'util', 'AppUpdate.kt'), 'utf8');
  const basis = kt.match(/UPDATE_RELEASE_BASIS\s*=\s*\n?\s*"([^"]+)"/)?.[1];
  assert.ok(basis, 'UPDATE_RELEASE_BASIS ist in AppUpdate.kt nicht mehr zu finden.');
  assert.equal(adresse, `${basis}/${apkName}`,
    'Knopf und Selbst-Aktualisierung der App zeigen auf verschiedene Ablagen. ' +
    'Eine von beiden holt dann etwas anderes als die andere.');
});

test('3. der Knopf trägt kein fremdes Markenzeichen', () => {
  // Googles Android-Roboter ist markenrechtlich gebunden. Das Symbol im Knopf
  // ist bewusst ein eigenes; diese Regel hält fest, dass niemand es später
  // „schöner" durch das Original ersetzt, ohne die Frage zu stellen.
  const knopf = html.slice(html.indexOf('class="apk-btn"'),
                           html.indexOf('</a>', html.indexOf('class="apk-btn"')));
  assert.ok(!/androidicons|google.*android.*logo|gstatic|play\.google\.com\/intl/i.test(knopf),
    'Im Knopf steht fremdes Markenmaterial.');
  assert.match(knopf, /<svg /, 'Das Symbol kommt nicht als eigenes SVG mit.');
});
