/**
 * Der Download-Knopf zeigt dorthin, wo der Workflow das APK wirklich ablegt.
 *
 * Knopf in jsdom (echtes Bündel), Workflow und App als Struktur.
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln, zurückgenommen):
 *   b) Knopf aus index.html entfernt             → rot: Schritt 1 und 2
 *   c) Knopf hinter den QR-Code verschoben       → rot: Schritt 1 („hinter dem QR-Code“)
 * Gegenproben (12.11.2026 gemessen, je einzeln, zurückgenommen):
 *   d) Knopf wieder auf `releases/download/apk-neuste/…`        → rot: Schritt 2
 *   e) `"$APK"` aus `gh release create` in android-release.yml  → rot: Schritt 2
 *   f) LINK in android-release.yml wieder auf apk-neuste        → rot: Schritt 2
 */
// Abgleich Web↔App: läuft in web-ci auch bei Änderungen unter Android-App/ (paths-Filter).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const { oeffneOberflaeche, sicht } = require('./helpers/oberflaeche');

/** Der Knopf, wie ihn die geöffnete Sicht „App“ zeigt. */
async function knopf() {
  const o = await oeffneOberflaeche({ '/v1/settings/tokens': { success: true, tokens: [] } });
  try {
    await sicht(o.w, 'app');
    const a = o.d.querySelector('a.apk-btn');
    const qr = o.d.getElementById('qr-container');
    assert.ok(a && qr, 'Download-Knopf oder QR-Code fehlt in der Sicht „App“');
    const sichtbar = el => {
      for (let e = el; e; e = e.parentElement) if (e.style?.display === 'none' || e.hidden) return false;
      return true;
    };
    return {
      href: a.getAttribute('href'),
      sichtbar: sichtbar(a),
      vorQr: !!(a.compareDocumentPosition(qr) & o.w.Node.DOCUMENT_POSITION_FOLLOWING),
      svg: !!a.querySelector('svg'),
      markup: a.outerHTML,
    };
  } finally {
    o.w.close();
  }
}

test('1. der Knopf steht in der Sicht „App“, vor dem QR-Code, ohne fremdes Markenzeichen', async () => {
  const k = await knopf();
  assert.match(k.href, /^https:\/\/github\.com\//, 'Der Knopf zeigt nicht auf GitHub — dort liegt das APK.');
  assert.ok(k.sichtbar, 'Der Knopf ist in der geöffneten Sicht nicht zu sehen');
  // Erst die App holen, dann das Gerät verknüpfen; andersherum gibt es noch nichts zu scannen.
  assert.ok(k.vorQr, 'Der Knopf steht hinter dem QR-Code');
  // Googles Android-Roboter ist markenrechtlich gebunden; das Symbol ist bewusst ein eigenes.
  assert.ok(k.svg, 'Das Symbol kommt nicht als eigenes SVG mit.');
  assert.doesNotMatch(k.markup, /androidicons|google.*android.*logo|gstatic|play\.google\.com\/intl/i);
});

test('2. dieselbe Adresse wie im Workflow und in der App', async () => {
  const adresse = (await knopf()).href;
  // ── Aus dem Workflow: fester Link und der Name, unter dem das APK angelegt wird ──
  const yml = fs.readFileSync(path.join(ROOT, '..', '.github', 'workflows', 'android-release.yml'), 'utf8');
  const link = yml.match(/^\s*LINK="https:\/\/github\.com\/\$GITHUB_REPOSITORY\/(\S+)"/m)?.[1];
  assert.ok(link, 'Im Workflow ist kein LINK mehr zu finden — Muster veraltet?');
  const apkName = yml.match(/^\s*APK=.*\/([^/\s]+\.apk)/m)?.[1];
  assert.ok(apkName, 'Im Workflow ist kein APK-Dateiname mehr zu finden — Muster veraltet?');
  assert.match(yml, /gh release create "\$QUELLE" [^\n]*"\$APK"/, 'Die Release wird ohne $APK angelegt.');

  assert.equal(
    adresse,
    `https://github.com/addict85/BrickInventory/${link}`,
    'Knopf und fester Link des Workflows zeigen auf verschiedene Orte.',
  );
  assert.ok(
    adresse.endsWith(`/releases/latest/download/${apkName}`),
    `Der Knopf zeigt auf "${adresse}", die Release trägt das APK aber als "${apkName}". ` +
      'Ein Klick endete auf der 404-Seite von GitHub.',
  );

  // ── Aus der App: dieselbe Ablage, aus der sie sich selbst aktualisiert ────
  const kt = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      '..',
      'Android-App',
      'core-update',
      'src',
      'main',
      'java',
      'ch',
      'brickinventoryapp',
      'update',
      'util',
      'AppUpdate.kt',
    ),
    'utf8',
  );
  // Die Basis darf auf die Wurzel verweisen; Kotlin setzt $NAME beim Übersetzen ein.
  const wurzel = kt.match(/UPDATE_RELEASE_WURZEL\s*=\s*\n?\s*"([^"]+)"/)?.[1];
  const basis = kt
    .match(/UPDATE_RELEASE_BASIS\s*=\s*\n?\s*"([^"]+)"/)?.[1]
    ?.replace('$UPDATE_RELEASE_WURZEL', wurzel ?? '$UPDATE_RELEASE_WURZEL');
  assert.ok(basis, 'UPDATE_RELEASE_BASIS ist in AppUpdate.kt nicht mehr zu finden.');
  assert.equal(
    adresse,
    `${basis}/${apkName}`,
    'Knopf und Selbst-Aktualisierung der App zeigen auf verschiedene Ablagen. ' +
      'Eine von beiden holt dann etwas anderes als die andere.',
  );
});

const WF = path.join(ROOT, '..', '.github', 'workflows');
const ohneKommentar = t =>
  t
    .split('\n')
    .filter(z => !z.trimStart().startsWith('#'))
    .join('\n');
const lies = datei => fs.readFileSync(path.join(WF, datei), 'utf8');
/** Ein Job ohne Kommentarzeilen, von seiner Kopfzeile bis zum nächsten Job. */
const jobIn = (datei, name) => {
  const teil = ohneKommentar(lies(datei)).split(new RegExp(`\\n  ${name}:\\n`))[1];
  assert.ok(teil, `Job ${name} fehlt in ${datei}`);
  return '\n' + teil.split(/\n {2}[\w-]+:\n/)[0] + '\n';
};
/** Ein Schritt (Name bis zum nächsten Schritt) eines Jobs. */
const schrittIn = (job, name) => {
  const i = job.indexOf(`- name: ${name}\n`);
  assert.ok(i >= 0, `Schritt „${name}“ nicht gefunden`);
  const rest = job.slice(i + 1);
  const ende = rest.search(/\n {6}- (name|uses): /);
  return ende < 0 ? rest : rest.slice(0, ende);
};

// Ein signiertes APK in der neusten Release ist ein Update für jede installierte App. Signiert
// wird nur aus android-release.yml in der Fassung von main; das Etikett liefert Daten.
// Gegenproben (11.11.2026 gemessen, je einzeln): in android-release.yml ein `push:`-Auslöser
// → rot „signiert wird nur aus main“; „Etikett liegt auf main“ prüft `ahead` statt `behind`
// → rot „signiert wird nur ein Commit, der auf main liegt“; `environment:` des Jobs signatur fest
// auf `release` → rot „Schlüssel nur im echten Lauf“; `KEY_PASS: ${{ secrets.KEY_PASSWORT }}`
// in den Schritt „Signieren“ → rot „Secrets ausserhalb …“; in android.yml `echt: true` → rot
// „der Baulauf signiert nur zur Probe“.
test('signiert und veröffentlicht wird nur aus main, und Gradle sieht den Schlüssel nie', () => {
  const android = lies('android.yml');
  assert.match(
    android,
    /\n {2}push:\n {4}branches: \['\*\*'\]\n(?: {4}#.*\n)* {4}tags: \['android-v\*'\]\n/,
    'Etiketten lösen den Baulauf aus',
  );
  const probe = jobIn('android.yml', 'signieren');
  assert.match(probe, /uses: \.\/\.github\/workflows\/android-signieren\.yml/);
  assert.match(probe, /\n {6}echt: false\n/, 'der Baulauf signiert nur zur Probe');
  assert.doesNotMatch(
    ohneKommentar(android),
    /secrets\.|environment:/,
    'der Baulauf aus dem Etikett sieht weder Secret noch Environment',
  );

  const release = ohneKommentar(lies('android-release.yml'));
  const an = release.slice(release.indexOf('\non:\n'), release.indexOf('\npermissions:'));
  assert.doesNotMatch(an, /\n {2}(push|pull_request|pull_request_target):/, 'signiert wird nur aus main');
  assert.match(an, /workflow_run:\n {4}workflows: \[Android-App\]\n {4}types: \[completed\]/);
  const etikett = jobIn('android-release.yml', 'etikett');
  for (const b of [
    "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'",
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.event == 'push'",
    'github.event.workflow_run.head_repository.full_name == github.repository',
  ])
    assert.ok(etikett.includes(b), `Bedingung fehlt: ${b}`);
  const aufMain = schrittIn(etikett, 'Etikett liegt auf main');
  assert.match(aufMain, /compare\/main\.\.\.\$COMMIT/);
  assert.match(aufMain, /identical\|behind\) echo/, 'signiert wird nur ein Commit, der auf main liegt');
  const signieren = jobIn('android-release.yml', 'signieren');
  assert.match(signieren, /\n {4}needs: etikett\n/, 'erst das Etikett prüfen, dann signieren');
  assert.match(signieren, /\n {6}echt: true\n/);

  const sig = lies('android-signieren.yml');
  assert.match(sig, /\non:\n {2}workflow_call:\n/);
  assert.doesNotMatch(
    ohneKommentar(sig),
    /\n {2}(push|pull_request|workflow_dispatch|workflow_run):/,
    'nur als wiederverwendbarer Workflow',
  );
  const apk = jobIn('android-signieren.yml', 'signatur');
  const beschreibung = jobIn('android-signieren.yml', 'beschreibung');
  assert.match(
    apk,
    /\n {4}environment: \$\{\{ inputs\.echt && 'release' \|\| '' \}\}\n/,
    'Schlüssel nur im echten Lauf',
  );
  assert.match(
    beschreibung,
    /\n {4}environment: \$\{\{ inputs\.echt && 'release-beschreibung' \|\| '' \}\}\n/,
    'der Beschreibungsschlüssel in eigener Environment',
  );
  const schluessel = schrittIn(apk, 'Release-Schlüssel bereitstellen');
  assert.ok(schluessel.includes('\n        if: inputs.echt\n'), 'Secrets nur im echten Lauf');
  for (const geheim of ['KEYSTORE_BASE64', 'KEYSTORE_PASSWORT', 'KEY_ALIAS', 'KEY_PASSWORT'])
    assert.match(schluessel, new RegExp(`: \\$\\{\\{ secrets\\.${geheim} \\}\\}`), `${geheim} fehlt`);
  assert.match(
    schluessel,
    /Repository-Secrets gleichen Namens löschen/,
    'der Fehlertext sagt, dass Repository-Secrets wegmüssen',
  );
  const bschluessel = schrittIn(beschreibung, 'Beschreibungsschlüssel bereitstellen');
  assert.ok(bschluessel.includes('\n        if: inputs.echt\n'));
  for (const geheim of ['BESCHREIBUNG_SCHLUESSEL', 'BESCHREIBUNG_PASS'])
    assert.match(bschluessel, new RegExp(`: \\$\\{\\{ secrets\\.${geheim} \\}\\}`), `${geheim} fehlt`);
  assert.match(schrittIn(apk, 'Signieren'), /ECHT: \$\{\{ inputs\.echt \}\}/);
  // Nur diese beiden Schritte nennen Secrets; kein anderer Schritt eines Android-Workflows.
  const andere = ['android.yml', 'android-signieren.yml', 'android-release.yml', 'android-bescheinigung.yml'].flatMap(
    d =>
      lies(d)
        .split(/\n {6}- name: /)
        .filter(t => !/^(Release-Schlüssel|Beschreibungsschlüssel) bereitstellen\n/.test(t))
        .join('\n')
        .split('\n')
        .filter(z => !z.trimStart().startsWith('#') && /secrets\./.test(z))
        .map(z => `${d}: ${z.trim()}`),
  );
  assert.deepEqual(andere, [], 'Secrets ausserhalb der Schritte, die Schlüssel bereitstellen');
});

// Gegenproben (11.11.2026 gemessen, je einzeln): ein `- uses: actions/checkout@…` in den
// Job signatur → rot „… führt keinen Projektcode aus“; am Release-Job `needs: [etikett, signieren]`
// → rot „veröffentlicht nur das geprüfte, signierte APK“; `environment: release` am
// Release-Job entfernt → rot „… erst nach Freigabe …“; `uses:` des Jobs bescheinigen
// entfernt → rot „die Herkunft des APK wird bescheinigt“. Gegenprobe 12.11.2026: Frist wieder
// `30 * 86400` → rot „die Beschreibung gilt sieben Tage“.
test('signiert wird in eigenen Jobs ohne Projektcode, geprüft und veröffentlicht danach', () => {
  for (const name of ['signatur', 'beschreibung']) {
    const job = jobIn('android-signieren.yml', name);
    for (const verboten of [/actions\/checkout/, /gradlew/, /tools\/[\w-]+\.py/, /python/, /setup-gradle/])
      assert.doesNotMatch(job, verboten, `der Signierjob ${name} führt keinen Projektcode aus (${verboten})`);
  }
  const apk = jobIn('android-signieren.yml', 'signatur');
  assert.match(apk, /name: apk-unsigniert/);
  assert.match(apk, /run-id: \$\{\{ inputs\.lauf \|\| github\.run_id \}\}/, 'das Artefakt kommt aus dem Baulauf');
  assert.match(jobIn('android-signieren.yml', 'beschreibung'), /name: apk-signiert\n/);
  // Der APK-Schlüssel signiert nur noch APK und Bundle, die Beschreibung gilt sieben Tage.
  assert.doesNotMatch(ohneKommentar(apk), /openssl pkcs12|-exportcert|version\.sig/, 'kein PEM-Export des APK-Schlüssels');
  assert.match(schrittIn(apk, 'Signieren'), /\$\(\(AUSGESTELLT \+ 7 \* 86400\)\)/, 'die Beschreibung gilt sieben Tage');
  assert.doesNotMatch(
    ohneKommentar(jobIn('android-signieren.yml', 'beschreibung')),
    /--arg signatur/,
    'die Beschreibung trägt keine Signatur des APK-Schlüssels',
  );
  assert.doesNotMatch(jobIn('android.yml', 'build'), /secrets\./, 'der Bau-Job sieht kein Secret');

  const pruefen = jobIn('android-signieren.yml', 'apk-pruefen');
  assert.match(pruefen, /\n {4}needs: beschreibung\n/);
  assert.match(pruefen, /ref: \$\{\{ inputs\.commit \}\}/, 'geprüft wird mit den Werkzeugen des gebauten Commits');
  assert.match(
    pruefen,
    /python3 tools\/apk-pruefen\.py\s*\\?\s*\n?\s*app\/build\/outputs\/apk\/release\/BrickInventory\.apk/,
  );
  assert.match(
    pruefen,
    /python3 tools\/apk-ausrichtung\.py\s*\\?\s*\n?\s*app\/build\/outputs\/apk\/release\/BrickInventory\.apk/,
  );
  assert.doesNotMatch(pruefen, /secrets\./);

  const release = jobIn('android-release.yml', 'release');
  assert.match(
    release,
    /\n {4}needs: \[etikett, signieren, bescheinigen\]\n/,
    'veröffentlicht nur das geprüfte, signierte APK',
  );
  assert.match(release, /name: apk-signiert/);
  assert.match(
    release,
    /\n {4}environment: release\n/,
    'das Release mit Schreibrecht läuft erst nach Freigabe in der Environment release',
  );
  assert.match(
    release,
    /\n {4}permissions:\n {6}contents: write\n {4}defaults:/,
    'der Release-Job schreibt nur, er bescheinigt nicht',
  );
  const bescheinigen = jobIn('android-release.yml', 'bescheinigen');
  assert.match(bescheinigen, /\n {4}needs: signieren\n/);
  assert.match(
    bescheinigen,
    /uses: \.\/\.github\/workflows\/android-bescheinigung\.yml/,
    'die Herkunft des APK wird bescheinigt',
  );
  const aussteller = lies('android-bescheinigung.yml');
  assert.match(
    aussteller,
    /uses: actions\/attest-build-provenance@[0-9a-f]{40}/,
    'die Herkunft des APK wird bescheinigt',
  );
  assert.match(
    aussteller,
    /subject-path: \|\n\s+\$\{\{ runner\.temp \}\}\/signiert\/apk\/release\/BrickInventory\.apk/,
  );
  assert.doesNotMatch(apk, /oder als Repository-Secret/, 'die Signier-Secrets kommen nur aus der Environment');
});

// Neue Prüfsummen entscheiden, welche Bytes der Bau annimmt: Sie kommen als
// Pull-Request mit Zusammenfassung, nie als Push auf einen bestehenden Zweig.
// Gegenproben (02.11.2026 gemessen): im Job `pruefsummen-vorschlagen` wieder
// `git push origin "HEAD:$GITHUB_REF_NAME"` → rot (Push-Ziel nicht der eigene
// Zweig); `pull-requests: write` zusätzlich im Job `pruefsummen` → rot „… nur
// der vorschlagende Job …“; im Job `bildschirmfotos-einchecken` die PNG-Prüfung
// entfernt → rot „eingecheckt wird nur PNG“.
test('Prüfsummen kommen als Pull-Request, Bildschirmfotos nur als PNG', () => {
  const yml = fs
    .readFileSync(path.join(ROOT, '..', '.github', 'workflows', 'android.yml'), 'utf8')
    .split('\n')
    .filter(z => !z.trimStart().startsWith('#'))
    .join('\n');
  const job = name => {
    const teil = yml.split(new RegExp(`\\n  ${name}:\\n`))[1];
    assert.ok(teil, `Job ${name} fehlt`);
    return '\n' + teil.split(/\n {2}[\w-]+:\n/)[0] + '\n';
  };
  const vorschlag = job('pruefsummen-vorschlagen');
  assert.match(vorschlag, /\n {4}permissions:\n {6}contents: write\n {6}pull-requests: write\n/);
  assert.match(vorschlag, /ZWEIG="pruefsummen\/\$GITHUB_RUN_ID"/);
  assert.match(vorschlag, /git push origin "HEAD:refs\/heads\/\$ZWEIG"/);
  assert.match(vorschlag, /gh pr create --base "\$GITHUB_REF_NAME" --head "\$ZWEIG"/);
  assert.doesNotMatch(vorschlag, /HEAD:\$GITHUB_REF_NAME/, 'nie auf den Zweig des Laufs');
  assert.doesNotMatch(vorschlag, /python|gradlew/, 'mit Schreibrecht läuft kein Werkzeug aus dem Repository');
  // Seit sec17 B-N2 ohne Schreibrecht UND ohne Gradle, in einem eigenen Job.
  assert.match(
    job('pruefsummen-zusammenfassen'),
    /tools\/pruefsummen-vergleich\.py/,
    'die Zusammenfassung entsteht ohne Schreibrecht',
  );
  assert.match(job('pruefsummen-zusammenfassen'), /\n {4}permissions:\n {6}contents: read\n/);
  for (const name of [
    'build',
    'uebergabe',
    'signieren',
    'gegenproben',
    'pruefsummen',
    'pruefsummen-zusammenfassen',
    'bildschirmfotos',
    'bildschirmfotos-einchecken',
  ])
    assert.doesNotMatch(job(name), /pull-requests: write/, `${name}: nur der vorschlagende Job legt Pull-Requests an`);
  const bilder = job('bildschirmfotos-einchecken');
  assert.match(bilder, /89504e470d0a1a0a/, 'eingecheckt wird nur PNG');
  assert.match(bilder, /git add Android-App\/app\/src\/test\/bildschirmfotos\/\*\.png/);
});

/** Der run-Block eines Schritts, ohne den Einzug des YAML. */
function runVon(yml, name) {
  const z = yml.split('\n');
  const i = z.findIndex(l => l.trim() === `- name: ${name}`);
  assert.ok(i >= 0, `Schritt „${name}“ nicht gefunden`);
  const r = z.findIndex((l, j) => j > i && /^\s+run: \|\s*$/.test(l));
  const tief = z[r + 1]?.match(/^\s*/)?.[0].length ?? 0;
  const ende = z.findIndex((l, j) => j > r && l.trim() && (l.match(/^\s*/)?.[0].length ?? 0) < tief);
  return z
    .slice(r + 1, ende < 0 ? undefined : ende)
    .map(l => l.slice(tief))
    .join('\n');
}

/**
 * Ein `gh`-Ersatz mit Releases als Ordnern (draussen/<etikett>/<anhang>): `release create`
 * legt an, `--latest` setzt LATEST; KAPPEN kürzt einen Anhang wie ein abgebrochener Upload.
 */
function releaseOrt(t) {
  const ort = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'release-'));
  t.after(() => fs.rmSync(ort, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(ort, 'gh'),
    `#!/bin/bash
D="$GH_ERSATZ"; echo "$*" >> "$D/gh.log"
case "$1 $2" in
  "api repos/o/r/releases/latest") [ -s "$D/LATEST" ] && cat "$D/LATEST" || exit 1 ;;
  "release view")
    [ -d "$D/draussen/$3" ] || exit 1
    N=$(printf '%s' "$*" | sed -n 's/.*select(.name=="\\([^"]*\\)").*/\\1/p')
    if [ -n "$N" ] && [ -f "$D/draussen/$3/$N" ]; then stat -c%s "$D/draussen/$3/$N"; fi ;;
  "release download")
    E=$3; shift 3
    while [ $# -gt 0 ]; do case $1 in -p) P=$2; shift 2 ;; -O) O=$2; shift 2 ;; --repo) shift 2 ;; *) shift ;; esac; done
    [ -f "$D/draussen/$E/$P" ] && cp "$D/draussen/$E/$P" "$O" ;;
  "release create")
    E=$3; shift 3; mkdir -p "$D/draussen/$E"
    while [ $# -gt 0 ]; do case $1 in --title|--notes) shift 2 ;; --*) echo "$1" >> "$D/flaggen"; shift ;; *) cp "$1" "$D/draussen/$E/"; shift ;; esac; done
    if [ -n "$KAPPEN" ]; then truncate -s 3 "$D/draussen/$E/$KAPPEN"; fi
    if grep -qx -- --latest "$D/flaggen"; then echo "$E" > "$D/LATEST"; fi ;;
  *) echo "unbekannt: $*" >&2; exit 9 ;;
esac
`,
    { mode: 0o755 },
  );
  const schreibe = (rel, inhalt) => {
    fs.mkdirSync(path.dirname(path.join(ort, rel)), { recursive: true });
    fs.writeFileSync(path.join(ort, rel), inhalt);
  };
  const beschreibung = (code, commit) =>
    JSON.stringify({ daten: Buffer.from(JSON.stringify({ versionCode: code, commit })).toString('base64') });
  schreibe('arbeit/tools/release-zertifikat.sha256', 'f'.repeat(64) + '\n');
  schreibe('arbeit/app/build/outputs/apk/release/BrickInventory.apk', 'neues-apk');
  schreibe(
    'arbeit/app/build/outputs/apk/release/output-metadata.json',
    JSON.stringify({ elements: [{ versionCode: 6, versionName: '1.6' }] }),
  );
  schreibe('arbeit/app/build/outputs/version-signiert.json', beschreibung(6, 'c'.repeat(40)));
  fs.writeFileSync(path.join(ort, 'LATEST'), 'android-v1\n');
  /** Die Optionen für spawnSync: Arbeitsordner, `gh`-Ersatz zuerst im PATH, die Umgebung des Jobs. */
  const optionen = (env = {}) => ({
    cwd: path.join(ort, 'arbeit'),
    encoding: /** @type {const} */ ('utf8'),
    env: {
      ...process.env,
      PATH: `${ort}:${process.env.PATH}`,
      GH_ERSATZ: ort,
      GITHUB_REPOSITORY: 'o/r',
      RUNNER_TEMP: fs.mkdtempSync(path.join(ort, 'tmp-')),
      GITHUB_STEP_SUMMARY: path.join(ort, 'zusammenfassung.md'),
      QUELLE: 'android-v2',
      COMMIT: 'c'.repeat(40),
      ...env,
    },
  });
  const lies = rel => (fs.existsSync(path.join(ort, rel)) ? fs.readFileSync(path.join(ort, rel), 'utf8') : '');
  return { ort, schreibe, beschreibung, optionen, lies };
}

// Releases sind unveränderlich; der feste Link ist /releases/latest/download/.
// Gegenproben (12.11.2026 gemessen, je einzeln): `--latest` → `--latest=false` → rot „die neue
// Fassung wird Latest“; den Rückfall auf apk-neuste gestrichen → rot „Übergang: …“; die
// Rückfrage der Grösse gestrichen → rot „ein halber Anhang …“; `cmp -s` durch `true` ersetzt
// → rot „ein Wiederlauf mit anderem APK …“.
test('die Fassungs-Release trägt alle Anhänge, wird Latest und folgt auf die veröffentlichte Fassung', t => {
  const skript = runVon(lies('android-release.yml'), 'BrickInventory.apk als Release bereitstellen');
  const lauf = (o, env) => spawnSync('bash', ['-e', '-c', skript], o.optionen(env));
  const neu = releaseOrt(t);
  neu.schreibe('draussen/android-v1/version-signiert.json', neu.beschreibung(5, 'b'.repeat(40)));
  const r = lauf(neu);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(fs.readdirSync(path.join(neu.ort, 'draussen', 'android-v2')).sort(), [
    'BrickInventory-6.apk',
    'BrickInventory.apk',
    'version-signiert.json',
  ]);
  assert.equal(neu.lies('draussen/android-v2/BrickInventory.apk'), 'neues-apk');
  assert.equal(neu.lies('LATEST').trim(), 'android-v2', 'die neue Fassung wird Latest');
  assert.doesNotMatch(neu.lies('gh.log'), /release (upload|edit|delete)|create apk-neuste/);
  assert.match(
    neu.lies('zusammenfassung.md'),
    /https:\/\/github\.com\/o\/r\/releases\/latest\/download\/BrickInventory\.apk/,
  );

  const zurueck = releaseOrt(t);
  zurueck.schreibe('draussen/android-v1/version-signiert.json', zurueck.beschreibung(7, 'b'.repeat(40)));
  assert.notEqual(lauf(zurueck).status, 0, 'ein älterer Stand wird veröffentlicht');
  assert.doesNotMatch(zurueck.lies('gh.log'), /release create/);

  const uebergang = releaseOrt(t);
  uebergang.schreibe('draussen/android-v1/BrickInventory-5.apk', 'alt');
  uebergang.schreibe('draussen/apk-neuste/version.json', JSON.stringify({ versionCode: 7, commit: 'b' }));
  assert.notEqual(lauf(uebergang).status, 0, 'Übergang: ohne Beschreibung in Latest gilt apk-neuste');

  const halb = releaseOrt(t);
  halb.schreibe('draussen/android-v1/version-signiert.json', halb.beschreibung(5, 'b'.repeat(40)));
  assert.notEqual(lauf(halb, { KAPPEN: 'BrickInventory.apk' }).status, 0, 'ein halber Anhang gilt');

  const wieder = releaseOrt(t);
  fs.writeFileSync(path.join(wieder.ort, 'LATEST'), 'android-v2\n');
  wieder.schreibe('draussen/android-v2/BrickInventory-6.apk', 'neues-apk');
  wieder.schreibe('draussen/android-v2/BrickInventory.apk', 'neues-apk');
  wieder.schreibe('draussen/android-v2/version-signiert.json', wieder.beschreibung(6, 'c'.repeat(40)));
  const w = lauf(wieder);
  assert.equal(w.status, 0, 'ein Wiederlauf auf demselben Stand ' + w.stdout + w.stderr);
  assert.doesNotMatch(wieder.lies('gh.log'), /release create/);
  wieder.schreibe('draussen/android-v2/BrickInventory.apk', 'neues-xyz');
  assert.notEqual(lauf(wieder).status, 0, 'ein Wiederlauf mit anderem APK geht durch');
});

// Gegenproben (12.11.2026 gemessen, je einzeln): `releases/latest` durch apk-neuste ersetzt
// → rot „verglichen wird mit Latest“; den Rückfall auf apk-neuste gestrichen → rot „Übergang: …“.
test('der Signierweg vergleicht den versionCode mit der Latest-Release, übergangsweise mit apk-neuste', t => {
  const skript = runVon(lies('android-signieren.yml'), 'versionCode über dem veröffentlichten');
  const werkzeug = fs.readFileSync(path.join(ROOT, '..', 'Android-App', 'tools', 'release-pruefen.py'), 'utf8');
  const ort = (latest, neuste) => {
    const o = releaseOrt(t);
    o.schreibe('arbeit/tools/release-pruefen.py', werkzeug);
    if (latest) o.schreibe('draussen/android-v1/version-signiert.json', o.beschreibung(latest, 'b'.repeat(40)));
    else o.schreibe('draussen/android-v1/BrickInventory-5.apk', 'alt');
    o.schreibe('draussen/apk-neuste/version.json', JSON.stringify({ versionCode: neuste, commit: 'b' }));
    return spawnSync('bash', ['-e', '-c', skript], o.optionen()).status;
  };
  assert.equal(ort(5, 9), 0, 'verglichen wird mit Latest, nicht mit apk-neuste');
  assert.notEqual(ort(7, 1), 0, 'verglichen wird mit Latest');
  assert.notEqual(ort(null, 7), 0, 'Übergang: ohne Beschreibung in Latest gilt apk-neuste');
  assert.equal(ort(null, 5), 0, 'Übergang: eine neuere Fassung als apk-neuste geht durch');
});
