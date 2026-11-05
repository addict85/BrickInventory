/**
 * Der Download-Knopf zeigt dorthin, wo der Workflow das APK wirklich ablegt.
 * Ausführlich: docs/begruendungen/test/apk-download.test.js.md#kopf
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
  const kt = fs.readFileSync(path.join(__dirname, '..', '..', 'Android-App', 'core-data', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'util', 'AppUpdate.kt'), 'utf8');
  // Die Basis darf auf die Wurzel verweisen; Kotlin setzt $NAME beim Übersetzen ein.
  const wurzel = kt.match(/UPDATE_RELEASE_WURZEL\s*=\s*\n?\s*"([^"]+)"/)?.[1];
  const basis = kt.match(/UPDATE_RELEASE_BASIS\s*=\s*\n?\s*"([^"]+)"/)?.[1]
    ?.replace('$UPDATE_RELEASE_WURZEL', wurzel ?? '$UPDATE_RELEASE_WURZEL');
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

test('signiert und veröffentlicht wird nur aus einem Etikett auf main, und Gradle sieht den Schlüssel nie', () => {
  // Ein signiertes APK im Kanal apk-neuste ist ein Update für jede installierte
  // App. Von einem Zweig aus wäre das ungeprüfter Code an Review und Merge vorbei;
  // seit pruef6 (N4) auch nicht mehr jeder Push auf main, sondern nur ein
  // Etikett android-v…, dessen Commit auf main liegt.
  // Gegenproben (28.10.2026): die main-Bedingung am Release-Schritt entfernt → rot;
  // BRICK_KEYSTORE_PASSWORT wieder im Schritt „Release bauen“ → rot;
  // (02.11.2026) am Schritt „Release-Schlüssel bereitstellen“ die `if:`-Zeile
  // entfernt → rot „… nur in der Environment release“; `KEY_PASS: ${{
  // secrets.KEY_PASSWORT }}` in den Schritt „Signieren“ → rot „Secrets
  // ausserhalb …“; im Fehlertext „Repository-Secrets gleichen Namens löschen“
  // entfernt → rot „… sagt, dass Repository-Secrets wegmüssen“.
  // (03.11.2026) Der Schritt „Etikett liegt auf main“ prüft `ahead` statt
  // `behind` → rot „… nur ein Commit, der auf main liegt“; das Etikett-Muster
  // unter `push:` entfernt → rot „… Etiketten lösen den Lauf aus“.
  const yml = fs.readFileSync(path.join(ROOT, '..', '.github', 'workflows', 'android.yml'), 'utf8');
  const schritt = (name) => {
    const i = yml.indexOf(`- name: ${name}`);
    assert.ok(i >= 0, `Schritt „${name}“ nicht gefunden`);
    const rest = yml.slice(i + 1);
    const ende = rest.search(/\n      - name: /);
    return ende < 0 ? rest : rest.slice(0, ende);
  };
  // Die Secrets stehen in genau einem Schritt, und der läuft nur unter derselben
  // Bedingung, unter der der Job in der Environment release steht.
  const bedingung = "github.event_name == 'push' && startsWith(github.ref, 'refs/tags/android-v')";
  assert.ok(schritt('BrickInventory.apk als Release bereitstellen').includes(`if: success() && ${bedingung}\n`),
    'Release läuft auch ohne Etikett');
  assert.match(yml, /\n  push:\n    branches: \['\*\*'\]\n(?:    #.*\n)*    tags: \['android-v\*'\]\n/, 'Etiketten lösen den Lauf aus');
  const aufMain = schritt('Etikett liegt auf main');
  assert.ok(aufMain.includes(`\n        if: ${bedingung}\n`));
  assert.match(aufMain, /compare\/main\.\.\.\$GITHUB_SHA/);
  assert.match(aufMain, /identical\|behind\) echo/, 'signiert wird nur ein Commit, der auf main liegt');
  assert.ok(yml.indexOf('- name: Etikett liegt auf main') < yml.indexOf('- name: Release-Schlüssel bereitstellen'),
    'die Prüfung kommt vor dem Schlüssel');
  const schluessel = schritt('Release-Schlüssel bereitstellen');
  assert.ok(schluessel.includes(`\n        if: ${bedingung}\n`), 'Secrets nur in der Environment release');
  for (const geheim of ['KEYSTORE_BASE64', 'KEYSTORE_PASSWORT', 'KEY_ALIAS', 'KEY_PASSWORT'])
    assert.match(schluessel, new RegExp(`: \\$\\{\\{ secrets\\.${geheim} \\}\\}`), `${geheim} fehlt`);
  assert.match(schluessel, /Repository-Secrets gleichen Namens löschen/, 'der Fehlertext sagt, dass Repository-Secrets wegmüssen');
  assert.ok(yml.includes(`environment: \${{ ${bedingung} && 'release' || '' }}`));
  assert.ok(schritt('Signieren').includes(`ECHT: \${{ ${bedingung} }}`));
  // Nur dieser Schritt nennt Secrets; der Bau mit allen Gradle-Plugins nicht.
  const andere = yml.split(/\n      - name: /).filter(t => !t.startsWith('Release-Schlüssel bereitstellen'))
    .join('\n').split('\n').filter(z => !z.trimStart().startsWith('#') && /secrets\./.test(z));
  assert.deepEqual(andere, [], 'Secrets ausserhalb des Schritts „Release-Schlüssel bereitstellen“');
});

// Gegenproben (01.11.2026 gemessen): ein `- uses: actions/checkout@…` in den
// Job `signieren` → rot „… führt keinen Projektcode aus“; die Zeile
// `environment:` entfernt → rot „… Environment release“; `needs: [signieren,
// apk-pruefen]` am Release-Job → `needs: build` → rot „… veröffentlicht nur
// das geprüfte, signierte APK“.
// Gegenproben (01.11.2026, zweite Runde): `environment: release` am Release-Job
// entfernt → rot „… erst nach Freigabe“; die Fehlermeldung wieder mit „oder
// als Repository-Secret“ → rot „… nur aus der Environment“.
// Gegenprobe (03.11.2026): den Schritt „Herkunft des APK bescheinigen“ entfernt
// → rot „… die Herkunft des APK wird bescheinigt“.
test('signiert wird in einem eigenen Job ohne Projektcode, geprüft und veröffentlicht danach', () => {
  const yml = fs.readFileSync(path.join(ROOT, '..', '.github', 'workflows', 'android.yml'), 'utf8')
    .split('\n').filter(z => !z.trimStart().startsWith('#')).join('\n');
  const job = (name) => {
    const teil = yml.split(new RegExp(`\\n  ${name}:\\n`))[1];
    assert.ok(teil, `Job ${name} fehlt`);
    return '\n' + teil.split(/\n  [\w-]+:\n/)[0] + '\n';
  };
  const signieren = job('signieren');
  assert.match(signieren, /\n    needs: build\n/);
  assert.ok(signieren.includes("\n    environment: ${{ github.event_name == 'push' && startsWith(github.ref, 'refs/tags/android-v') && 'release' || '' }}\n"),
    'die Secrets nur für ein Etikett und nur über die Environment release');
  for (const verboten of [/actions\/checkout/, /gradlew/, /tools\/[\w-]+\.py/, /python/, /setup-gradle/])
    assert.doesNotMatch(signieren, verboten, `der Signierjob führt keinen Projektcode aus (${verboten})`);
  assert.match(signieren, /name: apk-unsigniert/);
  assert.match(signieren, /name: apk-signiert/);
  assert.doesNotMatch(job('build'), /secrets\./, 'der Bau-Job sieht kein Secret');

  const pruefen = job('apk-pruefen');
  assert.match(pruefen, /\n    needs: signieren\n/);
  assert.match(pruefen, /name: apk-signiert/);
  assert.match(pruefen, /python3 tools\/apk-pruefen\.py\s*\\?\s*\n?\s*app\/build\/outputs\/apk\/release\/BrickInventory\.apk/);
  assert.match(pruefen, /python3 tools\/apk-ausrichtung\.py\s*\\?\s*\n?\s*app\/build\/outputs\/apk\/release\/BrickInventory\.apk/);
  assert.doesNotMatch(pruefen, /secrets\./);

  const release = job('release');
  assert.match(release, /\n    needs: \[signieren, apk-pruefen\]\n/, 'veröffentlicht nur das geprüfte, signierte APK');
  assert.match(release, /name: apk-signiert/);
  assert.match(release, /\n    environment: release\n/, 'das Release mit Schreibrecht läuft erst nach Freigabe in der Environment release');
  assert.match(release, /\n    permissions:\n      contents: write\n      id-token: write\n      attestations: write\n/);
  assert.match(release, /uses: actions\/attest-build-provenance@[0-9a-f]{40}/, 'die Herkunft des APK wird bescheinigt');
  assert.match(release, /subject-path: Android-App\/app\/build\/outputs\/apk\/release\/BrickInventory\.apk/);
  assert.doesNotMatch(signieren, /oder als Repository-Secret/, 'die Signier-Secrets kommen nur aus der Environment');
});

// Neue Prüfsummen entscheiden, welche Bytes der Bau annimmt: Sie kommen als
// Pull-Request mit Zusammenfassung, nie als Push auf einen bestehenden Zweig.
// Gegenproben (02.11.2026 gemessen): im Job `pruefsummen-vorschlagen` wieder
// `git push origin "HEAD:$GITHUB_REF_NAME"` → rot (Push-Ziel nicht der eigene
// Zweig); `pull-requests: write` zusätzlich im Job `pruefsummen` → rot „… nur
// der vorschlagende Job …“; im Job `bildschirmfotos-einchecken` die PNG-Prüfung
// entfernt → rot „eingecheckt wird nur PNG“.
test('Prüfsummen kommen als Pull-Request, Bildschirmfotos nur als PNG', () => {
  const yml = fs.readFileSync(path.join(ROOT, '..', '.github', 'workflows', 'android.yml'), 'utf8')
    .split('\n').filter(z => !z.trimStart().startsWith('#')).join('\n');
  const job = (name) => {
    const teil = yml.split(new RegExp(`\\n  ${name}:\\n`))[1];
    assert.ok(teil, `Job ${name} fehlt`);
    return '\n' + teil.split(/\n  [\w-]+:\n/)[0] + '\n';
  };
  const vorschlag = job('pruefsummen-vorschlagen');
  assert.match(vorschlag, /\n    permissions:\n      contents: write\n      pull-requests: write\n/);
  assert.match(vorschlag, /ZWEIG="pruefsummen\/\$GITHUB_RUN_ID"/);
  assert.match(vorschlag, /git push origin "HEAD:refs\/heads\/\$ZWEIG"/);
  assert.match(vorschlag, /gh pr create --base "\$GITHUB_REF_NAME" --head "\$ZWEIG"/);
  assert.doesNotMatch(vorschlag, /HEAD:\$GITHUB_REF_NAME/, 'nie auf den Zweig des Laufs');
  assert.doesNotMatch(vorschlag, /python|gradlew/, 'mit Schreibrecht läuft kein Werkzeug aus dem Repository');
  assert.match(job('pruefsummen'), /tools\/pruefsummen-vergleich\.py/, 'die Zusammenfassung entsteht ohne Schreibrecht');
  for (const name of ['build', 'signieren', 'apk-pruefen', 'release', 'gegenproben', 'pruefsummen',
    'bildschirmfotos', 'bildschirmfotos-einchecken'])
    assert.doesNotMatch(job(name), /pull-requests: write/, `${name}: nur der vorschlagende Job legt Pull-Requests an`);
  const bilder = job('bildschirmfotos-einchecken');
  assert.match(bilder, /89504e470d0a1a0a/, 'eingecheckt wird nur PNG');
  assert.match(bilder, /git add Android-App\/app\/src\/test\/bildschirmfotos\/\*\.png/);
});
