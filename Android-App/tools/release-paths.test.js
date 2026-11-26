/**
 * The app's release paths (.github/workflows/android*.yml): signing and publishing happen
 * only from main, in separate jobs without project code; checksums and screenshots come as
 * pull requests; the version release carries all attachments. The steps run in bash against
 * a simulated store. Runs in the Android run (android.yml, job vertrag).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const WURZEL = path.join(__dirname, '..', '..');

const WF = path.join(WURZEL, '.github', 'workflows');
const ohneKommentar = t =>
  t
    .split('\n')
    .filter(z => !z.trimStart().startsWith('#'))
    .join('\n');
const lies = datei => fs.readFileSync(path.join(WF, datei), 'utf8');
/** A job without comment lines, from its header line to the next job. */
const jobIn = (datei, name) => {
  const teil = ohneKommentar(lies(datei)).split(new RegExp(`\\n  ${name}:\\n`))[1];
  assert.ok(teil, `Job ${name} fehlt in ${datei}`);
  return '\n' + teil.split(/\n {2}[\w-]+:\n/)[0] + '\n';
};
/** A step (name up to the next step) of a job. */
const schrittIn = (job, name) => {
  const i = job.indexOf(`- name: ${name}\n`);
  assert.ok(i >= 0, `Schritt „${name}“ nicht gefunden`);
  const rest = job.slice(i + 1);
  const ende = rest.search(/\n {6}- (name|uses): /);
  return ende < 0 ? rest : rest.slice(0, ende);
};

// A signed APK in the newest release is an update for every installed app. Signing
// happens only from android-release.yml in the version of main; the tag supplies data.
// Counter-checks (measured 11.11.2026, each individually): in android-release.yml a `push:` trigger
// → red „signiert wird nur aus main“; „Etikett liegt auf main“ checks `ahead` instead of `behind`
// → red „signiert wird nur ein Commit, der auf main liegt“; `environment:` of the job signatur fixed
// to `release` → red „Schlüssel nur im echten Lauf“; `KEY_PASS: ${{ secrets.KEY_PASSWORT }}`
// into the step „Signieren“ → red „Secrets ausserhalb …“; in android.yml `echt: true` → red
// „der Baulauf signiert nur zur Probe“; in android-release.yml `KONTO: ${{ secrets… }}` back into
// the step „In Google Play einliefern“ (23.11.2026) → red „Secrets ausserhalb …“.
test('signing and publishing only from main, and Gradle never sees the key', () => {
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
  assert.match(schluessel, /\n {8}if: inputs\.echt(?: && [^\n]+)?\n/, 'Secrets nur im echten Lauf');
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
  // Only these steps name secrets; no other step of an Android workflow. The ruleset check
  // reads with its own read-only token, nothing else.
  const regeln = schrittIn(apk, 'Rulesets ohne Umgehung');
  assert.deepEqual(regeln.match(/secrets\.\w+/g), ['secrets.REGELN_LESETOKEN']);
  const andere = ['android.yml', 'android-signieren.yml', 'android-release.yml', 'android-bescheinigung.yml'].flatMap(
    d =>
      lies(d)
        .split(/\n {6}- name: /)
        .filter(t => !/^((Release-Schlüssel|Beschreibungsschlüssel|Play-Schlüssel) bereitstellen|Rulesets ohne Umgehung)\n/.test(t))
        .join('\n')
        .split('\n')
        .filter(z => !z.trimStart().startsWith('#') && /secrets\./.test(z))
        .map(z => `${d}: ${z.trim()}`),
  );
  assert.deepEqual(andere, [], 'Secrets ausserhalb der Schritte, die Schlüssel bereitstellen');
});

// Counter-checks (measured 11.11.2026, each individually): a `- uses: actions/checkout@…` in the
// job signatur → red „… führt keinen Projektcode aus“; at the release job `needs: [etikett, signieren]`
// → red „veröffentlicht nur das geprüfte, signierte APK“; `environment: release` at the
// release job removed → red „… erst nach Freigabe …“; `uses:` of the job bescheinigen
// removed → red „die Herkunft des APK wird bescheinigt“. Counter-check 12.11.2026: deadline again
// `30 * 86400` → red „die Beschreibung gilt sieben Tage“.
test('signing in separate jobs without project code, checked and published afterwards', () => {
  for (const name of ['signatur', 'beschreibung']) {
    const job = jobIn('android-signieren.yml', name);
    for (const verboten of [/actions\/checkout/, /gradlew/, /tools\/[\w-]+\.py/, /python/, /setup-gradle/])
      assert.doesNotMatch(job, verboten, `der Signierjob ${name} führt keinen Projektcode aus (${verboten})`);
  }
  const apk = jobIn('android-signieren.yml', 'signatur');
  assert.match(apk, /name: apk-unsigniert/);
  assert.match(apk, /run-id: \$\{\{ inputs\.lauf \|\| github\.run_id \}\}/, 'das Artefakt kommt aus dem Baulauf');
  assert.match(jobIn('android-signieren.yml', 'beschreibung'), /name: apk-signiert\n/);
  // The APK key now only signs APK and bundle, the description is valid for seven days.
  assert.doesNotMatch(
    ohneKommentar(apk),
    /openssl pkcs12|-exportcert|version\.sig/,
    'kein PEM-Export des APK-Schlüssels',
  );
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
    /python3 tools\/apk-check\.py\s*\\?\s*\n?\s*app\/build\/outputs\/apk\/release\/BrickInventory\.apk/,
  );
  assert.match(
    pruefen,
    /python3 tools\/apk-alignment\.py\s*\\?\s*\n?\s*app\/build\/outputs\/apk\/release\/BrickInventory\.apk/,
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

// New checksums decide which bytes the build accepts: they come as a
// pull request with a summary, never as a push onto an existing branch.
// Counter-checks (measured 02.11.2026): in the job `pruefsummen-vorschlagen` again
// `git push origin "HEAD:$GITHUB_REF_NAME"` → red (push target not the own
// branch); `pull-requests: write` additionally in the job `pruefsummen` → red „… nur
// der vorschlagende Job …“; in the job `screenshots-commit` the PNG check
// removed → red „eingecheckt wird nur PNG“.
test('checksums come as a pull request, screenshots only as PNG', () => {
  const yml = fs
    .readFileSync(path.join(WF, 'android.yml'), 'utf8')
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
  // Without write permission AND without Gradle, in a separate job.
  assert.match(
    job('pruefsummen-zusammenfassen'),
    /tools\/checksum-compare\.py/,
    'die Zusammenfassung entsteht ohne Schreibrecht',
  );
  assert.match(job('pruefsummen-zusammenfassen'), /\n {4}permissions:\n {6}contents: read\n/);
  for (const name of [
    'build',
    'uebergabe',
    'signieren',
    'counter-checks',
    'pruefsummen',
    'pruefsummen-zusammenfassen',
    'screenshots',
    'screenshots-commit',
  ])
    assert.doesNotMatch(job(name), /pull-requests: write/, `${name}: nur der vorschlagende Job legt Pull-Requests an`);
  const bilder = job('screenshots-commit');
  assert.match(bilder, /89504e470d0a1a0a/, 'eingecheckt wird nur PNG');
  assert.match(bilder, /git add Android-App\/app\/src\/test\/screenshots\/\*\.png/);
});

/** The run block of a step, without the YAML indentation. */
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
 * A `gh` stand-in with releases as folders (draussen/<etikett>/<anhang>): `release create`
 * creates, `--latest` sets LATEST; KAPPEN truncates an attachment like an aborted upload.
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
  schreibe('arbeit/tools/release-certificate.sha256', 'f'.repeat(64) + '\n');
  schreibe('arbeit/app/build/outputs/apk/release/BrickInventory.apk', 'neues-apk');
  schreibe(
    'arbeit/app/build/outputs/apk/release/output-metadata.json',
    JSON.stringify({ elements: [{ versionCode: 6, versionName: '1.6' }] }),
  );
  schreibe('arbeit/app/build/outputs/version-signiert.json', beschreibung(6, 'c'.repeat(40)));
  fs.writeFileSync(path.join(ort, 'LATEST'), 'android-v1\n');
  /** The options for spawnSync: working folder, `gh` stand-in first in PATH, the job's environment. */
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

// Releases are immutable; the fixed link is /releases/latest/download/.
// Counter-checks (measured 12.11.2026, each individually): `--latest` → `--latest=false` → red „die neue
// Fassung wird Latest“; the fallback to apk-neuste deleted → red „Übergang: …“; the
// size re-check deleted → red „ein halber Anhang …“; `cmp -s` replaced by `true`
// → red „ein Wiederlauf mit anderem APK …“.
test('the version release carries all attachments, becomes Latest and follows the published version', t => {
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
  assert.ok(
    neu.lies('zusammenfassung.md').includes('https://github.com/o/r/releases/latest/download/BrickInventory.apk'),
    'die Zusammenfassung nennt den Latest-Link',
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

// Counter-checks (measured 12.11.2026, each individually): `releases/latest` replaced by apk-neuste
// → red „verglichen wird mit Latest“; the fallback to apk-neuste deleted → red „Übergang: …“.
test('the signing path compares the versionCode with the Latest release, transitionally with apk-neuste', t => {
  const skript = runVon(lies('android-signieren.yml'), 'versionCode über dem veröffentlichten');
  const werkzeug = fs.readFileSync(path.join(__dirname, 'release-check.py'), 'utf8');
  const ort = (latest, neuste) => {
    const o = releaseOrt(t);
    o.schreibe('arbeit/tools/release-check.py', werkzeug);
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

// Only an admin sets a tag, and none is moved or deleted: the tag ruleset ensures
// that, and the release run reads it via the API like the rules of main.
// Counter-checks (measured 16.11.2026, each individually): `deletion` deleted from the loop of required rules
// → red „ohne Löschschutz …“; the filter `.enforcement == "active"` deleted → red
// „ein nur beobachtendes Ruleset …“; `TRIFFT=ja` without pattern match → red „ein Ruleset für
// andere Etiketten …“; the loop over `exclude` deleted → red „ein ausgenommenes Etikett …“.
test('signing only if an active tag ruleset protects the tag', t => {
  const skript = runVon(lies('android-release.yml'), 'Etiketten sind geschützt');
  const ort = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'regeln-'));
  t.after(() => fs.rmSync(ort, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(ort, 'gh'),
    `#!/bin/bash
D="$GH_ERSATZ"
case "$2" in
  "repos/o/r/rulesets?targets=tag&includes_parents=true&per_page=100") cat "$D/liste.json" ;;
  "repos/o/r/rulesets/"*"?includes_parents=true") I=\${2#repos/o/r/rulesets/}; cat "$D/r\${I%%\\?*}.json" ;;
  *) echo "unbekannt: $*" >&2; exit 9 ;;
esac
`,
    { mode: 0o755 },
  );
  const ruleset = (id, include, regeln, { aktiv = true, exclude = [] } = {}) => ({
    id,
    target: 'tag',
    enforcement: aktiv ? 'active' : 'evaluate',
    conditions: { ref_name: { include, exclude } },
    rules: regeln.map(type => ({ type })),
  });
  const alle = ['creation', 'update', 'deletion'];
  const lauf = (sets, etikett = 'android-v2026.11.16') => {
    for (const f of fs.readdirSync(ort)) if (f.endsWith('.json')) fs.rmSync(path.join(ort, f));
    if (sets) {
      const kurz = sets.map(({ id, target, enforcement }) => ({ id, target, enforcement }));
      const liste = [{ id: 99, target: 'branch', enforcement: 'active' }, ...kurz];
      fs.writeFileSync(path.join(ort, 'liste.json'), JSON.stringify(liste));
      for (const s of sets) fs.writeFileSync(path.join(ort, `r${s.id}.json`), JSON.stringify(s));
    }
    return spawnSync('bash', ['-c', skript], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${ort}:${process.env.PATH}`, GH_ERSATZ: ort, GITHUB_REPOSITORY: 'o/r', ETIKETT: etikett },
    });
  };
  const gut = lauf([ruleset(1, ['refs/tags/android-v*', 'refs/tags/apk-neuste'], alle)]);
  assert.equal(gut.status, 0, gut.stdout + gut.stderr);
  const geteilt = lauf([ruleset(1, ['refs/tags/android-v*'], ['creation', 'update']), ruleset(2, ['~ALL'], ['deletion'])]);
  assert.equal(geteilt.status, 0, 'zwei Rulesets zusammen ' + geteilt.stdout + geteilt.stderr);

  assert.notEqual(lauf(null).status, 0, 'unlesbare Rulesets gelten als fehlend');
  assert.notEqual(lauf([]).status, 0, 'ohne Tag-Ruleset wird signiert');
  const ohneLoeschen = lauf([ruleset(1, ['refs/tags/android-v*'], ['creation', 'update'])]);
  assert.notEqual(ohneLoeschen.status, 0, 'ohne Löschschutz wird signiert');
  assert.match(ohneLoeschen.stdout, /Regel deletion/);
  assert.notEqual(
    lauf([ruleset(1, ['refs/tags/android-v*'], alle, { aktiv: false })]).status,
    0,
    'ein nur beobachtendes Ruleset schützt nicht',
  );
  assert.notEqual(lauf([ruleset(1, ['refs/tags/apk-neuste'], alle)]).status, 0, 'ein Ruleset für andere Etiketten zählt');
  assert.notEqual(
    lauf([ruleset(1, ['~ALL'], alle, { exclude: ['refs/tags/android-v*'] })]).status,
    0,
    'ein ausgenommenes Etikett gilt als geschützt',
  );
});

/** A `gh api` stand-in: the answer for a path lies in <path with _ for /?&=>.json; --jq like gh. */
function apiOrt(t) {
  const ort = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'api-'));
  t.after(() => fs.rmSync(ort, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(ort, 'gh'),
    `#!/bin/bash
shift; P=$1; shift; JQ=
while [ $# -gt 0 ]; do case $1 in --jq) JQ=$2; shift 2 ;; *) shift ;; esac; done
F="$GH_ERSATZ/$(printf '%s' "$P" | tr '/?&=' '____').json"
[ -f "$F" ] || exit 1
if [ -n "$JQ" ]; then jq -r "$JQ" "$F"; else cat "$F"; fi
`,
    { mode: 0o755 },
  );
  const antwort = (pfad, wert) =>
    fs.writeFileSync(path.join(ort, pfad.replace(/[/?&=]/g, '_') + '.json'), JSON.stringify(wert));
  const lauf = (skript, env = {}) =>
    spawnSync('bash', ['-e', '-c', skript], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${ort}:${process.env.PATH}`, GH_ERSATZ: ort, GITHUB_REPOSITORY: 'o/r', ...env },
    });
  return { antwort, lauf };
}

// The owner publishes alone: self-review only warns, in both environments; the approval stays.
// Counter-checks (local, node --test): in the job signatur the `::warning` back to `::error` with
// `exit 1` → red „release: self-review is refused“; the same in the job beschreibung → red
// „release-beschreibung: self-review is refused“.
test('both environments only warn about self-review', t => {
  for (const [job, umgebung] of [
    ['signatur', 'release'],
    ['beschreibung', 'release-beschreibung'],
  ]) {
    const skript = runVon(jobIn('android-signieren.yml', job), 'Environment ist geschützt');
    const api = apiOrt(t);
    const umgebungMit = selbst =>
      api.antwort(`repos/o/r/environments/${umgebung}`, {
        can_admins_bypass: false,
        deployment_branch_policy: { custom_branch_policies: true },
        protection_rules: [{ type: 'required_reviewers', prevent_self_review: selbst, reviewers: [{ type: 'User' }] }],
      });
    api.antwort(`repos/o/r/environments/${umgebung}/deployment-branch-policies`, {
      branch_policies: [{ type: 'branch', name: 'main' }],
    });
    umgebungMit(true);
    const gut = api.lauf(skript, { UMGEBUNG: umgebung });
    assert.equal(gut.status, 0, gut.stdout + gut.stderr);
    umgebungMit(false);
    const selbst = api.lauf(skript, { UMGEBUNG: umgebung });
    assert.equal(selbst.status, 0, `${umgebung}: self-review is refused`);
    assert.match(selbst.stdout, /::warning title=Selbstfreigabe::/);
  }
});

// No bypass for main, for tags only the admin role (it alone creates tags, step 3).
// Counter-checks (local, node --test): FREMD for branch rulesets fixed to 0 → red „ein
// Umgehungsrecht auf main“; the `has("bypass_actors")` check removed → red „eine nicht
// lesbare Bypass-Liste …“; the tag filter counting every actor → red „Admin-Rolle …“.
test('signing only without bypass actors in the rulesets', t => {
  const skript = runVon(lies('android-signieren.yml'), 'Rulesets ohne Umgehung');
  const api = apiOrt(t);
  const admin = { actor_type: 'RepositoryRole', actor_id: 5, bypass_mode: 'always' };
  const app = { actor_type: 'Integration', actor_id: 77, bypass_mode: 'always' };
  const stand = (main, tag) => {
    api.antwort('repos/o/r/rules/branches/main', [{ type: 'pull_request', ruleset_id: 1 }]);
    api.antwort('repos/o/r/rulesets?targets=tag&includes_parents=true&per_page=100', [
      { id: 2, target: 'tag', enforcement: 'active' },
    ]);
    api.antwort('repos/o/r/rulesets/1?includes_parents=true', { name: 'main', target: 'branch', ...main });
    api.antwort('repos/o/r/rulesets/2?includes_parents=true', { name: 'Etiketten', target: 'tag', ...tag });
    return api.lauf(skript, { STANDARD: 'x' });
  };
  const gut = stand({ bypass_actors: [] }, { bypass_actors: [admin] });
  assert.equal(gut.status, 0, 'Admin-Rolle bei den Etiketten ' + gut.stdout + gut.stderr);
  assert.notEqual(stand({ bypass_actors: [admin] }, { bypass_actors: [] }).status, 0, 'ein Umgehungsrecht auf main');
  const blind = stand({}, { bypass_actors: [] });
  assert.notEqual(blind.status, 0, 'eine nicht lesbare Bypass-Liste gilt als leer');
  assert.match(blind.stdout, /REGELN_LESETOKEN/);
  assert.notEqual(stand({ bypass_actors: [] }, { bypass_actors: [app] }).status, 0, 'eine App in der Bypass-Liste der Etiketten');
});
