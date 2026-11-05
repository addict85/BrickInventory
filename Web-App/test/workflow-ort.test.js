/**
 * Ein Workflow, der nicht im Wurzelverzeichnis liegt, läuft NIE.
 * Ausführlich: docs/begruendungen/test/workflow-ort.test.js.md#kopf
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { androidDateien } = require('./helpers/android');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const WURZEL = path.join(__dirname, '..', '..');
const ECHTER_ORT = path.join(WURZEL, '.github', 'workflows');

/** Alle `.github/workflows`-Ordner im Baum, ohne node_modules und .git. */
function workflowOrdner(start) {
  const gefunden = [];
  // .claude: lokale Arbeitskopien (git worktree) der Werkzeuge, kein Teil des Repositorys.
  const uebersprungen = new Set(['node_modules', '.git', 'dist', 'build', '.gradle', '.claude']);
  (function lauf(dir) {
    let eintraege;
    try { eintraege = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of eintraege) {
      if (!e.isDirectory() || uebersprungen.has(e.name)) continue;
      const voll = path.join(dir, e.name);
      if (e.name === 'workflows' && path.basename(dir) === '.github') gefunden.push(voll);
      else lauf(voll);
    }
  })(start);
  return gefunden;
}

test('jeder Workflow liegt dort, wo GitHub ihn liest', () => {
  const ordner = workflowOrdner(WURZEL);

  // Selbstbeweis 1: Der Durchlauf hat wirklich gesucht und den echten Ort
  // gefunden. Ohne das könnte ein kaputtes Muster alles durchwinken.
  assert.ok(ordner.includes(ECHTER_ORT),
    `Der Durchlauf hat ${ECHTER_ORT} nicht gefunden — dann prüft er nichts. ` +
    `Gefunden: ${JSON.stringify(ordner)}`);

  const daneben = ordner.filter(o => o !== ECHTER_ORT);
  assert.deepEqual(daneben, [],
    'Diese Workflow-Ordner liegen NICHT im Wurzelverzeichnis und werden von ' +
    'GitHub nie gelesen:\n  ' + daneben.join('\n  ') +
    '\nGenau so lag ci.yml monatelang in Web-App/.github/workflows und ist ' +
    'kein einziges Mal gelaufen.');
});

test('im Wurzelverzeichnis stehen die Workflows, die es geben soll', () => {
  const dateien = fs.readdirSync(ECHTER_ORT).filter(f => /\.ya?ml$/.test(f)).sort();

  // Selbstbeweis 2: Eine Mindestzahl statt einer Aufzählung. Verschwände der
  // Ordner oder griffe das Muster nicht, wäre die Liste leer — und die
  // Prüfung darunter hätte nichts zu sagen.
  // Ausführlich: docs/begruendungen/test/workflow-ort.test.js.md#stelle
  assert.ok(dateien.length >= 3,
    `Nur ${dateien.length} Workflows im Wurzelverzeichnis: ${dateien.join(', ')}`);

  // Der Web-Lauf muss dabei sein. Er ist der einzige, der die Testsuite
  // ausführt — ohne ihn prüft KEIN Lauf die Web-App.
  assert.ok(dateien.includes('web-ci.yml'),
    `Der Web-CI-Lauf fehlt. Vorhanden: ${dateien.join(', ')}`);
});

test('ein Workflow benutzt jede Action überall in derselben Fassung', () => {
  // Warum
  // Ausführlich: docs/begruendungen/test/workflow-ort.test.js.md#fassungen
  const fassungen = new Map();   // Action -> Map(Fassung -> [Dateien])
  for (const f of fs.readdirSync(ECHTER_ORT).filter(f => /\.ya?ml$/.test(f))) {
    const yml = fs.readFileSync(path.join(ECHTER_ORT, f), 'utf8')
      .split('\n').filter(z => !z.trimStart().startsWith('#')).join('\n');
    for (const m of yml.matchAll(/uses:\s*([\w.-]+\/[\w.\-/]+)@([\w.-]+)/g)) {
      const [, action, fassung] = m;
      if (!fassungen.has(action)) fassungen.set(action, new Map());
      const je = fassungen.get(action);
      if (!je.has(fassung)) je.set(fassung, []);
      if (!je.get(fassung).includes(f)) je.get(fassung).push(f);
    }
  }

  // Selbstbeweis 3: Ohne gefundene Actions ist die Schleife darunter leer.
  assert.ok(fassungen.size >= 8,
    `Nur ${fassungen.size} Actions gefunden — Muster veraltet?`);
  const mehrfach = [...fassungen].filter(([, je]) =>
    [...je.values()].reduce((n, d) => n + d.length, 0) > 1);
  // Von 3 auf 2 gesenkt, als android-playstore.yml entfernt wurde: Mit einem
  // Workflow weniger gibt es weniger Ueberlappung. GEMESSEN sind es jetzt
  // actions/checkout@v7 (in allen drei Laeufen) und actions/upload-artifact@v7
  // (in zwei) — beide einheitlich, die Pruefung unten greift also weiter auf
  // genau die Faelle, um die es geht.
  assert.ok(mehrfach.length >= 2,
    `Nur ${mehrfach.length} Actions stehen an mehr als einer Stelle — dann ` +
    'kann diese Prüfung nichts finden.');

  const uneinig = [...fassungen]
    .filter(([, je]) => je.size > 1)
    .map(([action, je]) => `${action}: ` +
      [...je].map(([v, d]) => `${v} (${d.join(', ')})`).join(' vs. '));
  assert.deepEqual(uneinig, [],
    'Dieselbe Action steht in zwei Fassungen:\n  ' + uneinig.join('\n  '));
});

test('ein Lauf, der Tests ausführt, läuft auf JEDEM Zweig', () => {
  // Warum
  // Ausführlich: docs/begruendungen/test/workflow-ort.test.js.md#testbefehle
  const TESTBEFEHLE = [/npm\s+test/, /testDebugUnitTest/];

  const pruefend = [];
  for (const f of fs.readdirSync(ECHTER_ORT).filter(f => /\.ya?ml$/.test(f))) {
    const roh = fs.readFileSync(path.join(ECHTER_ORT, f), 'utf8');
    // Kommentarzeilen raus: In den Erklärblöcken dieser Dateien stehen die
    // Testbefehle als Fliesstext, und ein Workflow wäre sonst allein deswegen
    // "prüfend", weil er über das Prüfen SCHREIBT.
    const yml = roh.split('\n').filter(z => !z.trimStart().startsWith('#')).join('\n');
    if (TESTBEFEHLE.some(r => r.test(yml))) pruefend.push([f, yml]);
  }

  // Selbstbeweis: Es gibt mindestens die zwei — Web und Android. Fände das
  // Muster keinen, wäre die Schleife darunter leer und die Prüfung still grün.
  assert.ok(pruefend.length >= 2,
    `Nur ${pruefend.length} testausführende Workflows gefunden — Muster veraltet? ` +
    'Ohne Fund prüft der Rest dieses Tests nichts.');

  const eng = [];
  for (const [f, yml] of pruefend) {
    // Der `branches:`-Eintrag UNTER `push:` — nicht der unter `pull_request:`
    // und nicht irgendeiner weiter unten im Text.
    const push = yml.match(/\n\s*push:\s*\n((?:\s{4,}.*\n|\s*\n)*)/);
    if (!push) continue;   // reiner Veröffentlichungslauf — siehe oben
    const zweige = push[1].match(/branches(?:-ignore)?:\s*(.+)/);
    // Kein branches-Eintrag heisst bei GitHub: alle Zweige. Das ist erlaubt.
    if (!zweige) continue;
    if (!zweige[1].includes('**')) eng.push(`${f}: push nur auf ${zweige[1].trim()}`);
  }

  assert.deepEqual(eng, [],
    'Diese Workflows führen Tests aus, laufen aber nicht auf jedem Zweig-Push:\n  ' +
    eng.join('\n  ') +
    '\nDamit kommt ihr Befund erst nach dem Zusammenführen — genau so blieben ' +
    'drei rote Android-Läufe unbemerkt im Zweig stehen.');
});

// Gegenproben (am 28.10.2026 gemessen): die Zeile mit `head_repository` aus
// dem `if:` des Prüfjobs gestrichen → rot „… fremdes Repository …“; eine
// Action wieder als `@v7` statt per SHA → rot „… per Commit-SHA …“.
test('das Docker-Image entsteht nur aus einem Push auf main dieses Repositorys', () => {
  const yml = fs.readFileSync(path.join(ECHTER_ORT, 'docker-publish.yml'), 'utf8');
  const job = yml.split(/\n  pruefen:\n/)[1]?.split(/\n    steps:\n/)[0] ?? '';
  assert.match(job, /\n    if: /, 'der Prüfjob hat kein if:');
  assert.match(job, /workflow_run\.event == 'push'/, 'ein PR-Lauf der CI darf kein Image auslösen');
  assert.match(job, /workflow_run\.head_branch == 'main'/);
  assert.match(job, /workflow_run\.head_repository\.full_name == github\.repository/,
    'ein fremdes Repository (Fork) darf kein Image auslösen');
});

// Gegenprobe (01.11.2026 gemessen): `--no-build-cache` aus „Release bauen“
// gestrichen → rot „… ohne Build-Cache …“.
test('das Release-APK wird ohne Build-Cache gebaut', () => {
  const yml = fs.readFileSync(path.join(ECHTER_ORT, 'android.yml'), 'utf8');
  const schritt = yml.split(/\n      - name: Release bauen\n/)[1]?.split(/\n      - name: /)[0] ?? '';
  const aufrufe = schritt.split('\n').filter(z => !z.trimStart().startsWith('#') && /gradlew/.test(z));
  assert.ok(aufrufe.length > 0, 'Schritt „Release bauen“ mit gradlew nicht gefunden');
  for (const z of aufrufe)
    assert.match(z, /--no-build-cache/, `Release ohne Build-Cache bauen: ${z.trim()}`);
});

test('jede Action ist per Commit-SHA festgelegt', () => {
  const lose = [];
  for (const f of fs.readdirSync(ECHTER_ORT).filter(n => n.endsWith('.yml'))) {
    const zeilen = fs.readFileSync(path.join(ECHTER_ORT, f), 'utf8').split('\n');
    zeilen.forEach((z, i) => {
      const m = z.match(/^\s*-?\s*uses:\s*([^\s#]+)/);
      if (m && !/@[0-9a-f]{40}$/.test(m[1])) lose.push(`${f}:${i + 1} ${m[1]}`);
    });
  }
  assert.deepEqual(lose, [], 'Ein Tag lässt sich umhängen; nur ein SHA ist fest. Nicht per Commit-SHA festgelegt:');
});

// Gegenproben (am 30.10.2026 gemessen): `security-events: write` auf die
// oberste Ebene gezogen → rot „security-events: write darf nur der CodeQL-Job
// haben“; die Kotlin-Zeile der
// Matrix entfernt → rot „CodeQL prüft java-kotlin nicht“.
test('der Sicherheitslauf prüft Code, Abhängigkeiten, Image und den laufenden Server', () => {
  const roh = fs.readFileSync(path.join(ECHTER_ORT, 'sicherheit.yml'), 'utf8');
  const yml = roh.split('\n').filter(z => !z.trimStart().startsWith('#')).join('\n');
  const oben = yml.slice(0, yml.indexOf('\njobs:'));
  assert.match(oben, /\npermissions:\n  contents: read\n/, 'oben nur contents: read');
  const schreibend = [...yml.matchAll(/security-events:\s*write/g)].length;
  assert.equal(schreibend, 1, 'security-events: write darf nur der CodeQL-Job haben');
  const codeql = yml.slice(yml.indexOf('\n  codeql:'), yml.indexOf('\n  trivy:'));
  assert.match(codeql, /security-events:\s*write/, 'nur der CodeQL-Job darf Befunde hochladen');
  for (const sprache of ['javascript-typescript', 'java-kotlin'])
    assert.match(codeql, new RegExp(`sprache: ${sprache}\\b`), `CodeQL prüft ${sprache} nicht`);
  const trivy = yml.slice(yml.indexOf('\n  trivy:'), yml.indexOf('\n  zap:'));
  assert.match(trivy, /scan-type: fs/);
  assert.match(trivy, /scan-type: image/);
  const zap = yml.slice(yml.indexOf('\n  zap:'));
  assert.match(zap, /action-baseline@[0-9a-f]{40}/);
  assert.match(zap, /NODE_ENV: production/, 'ZAP prüft nicht den Server, wie er im Betrieb läuft');
  assert.match(zap, /docker_name: \S+@sha256:[0-9a-f]{64}/, 'das ZAP-Image ist nicht per Digest festgelegt');
  assert.ok(fs.existsSync(path.join(WURZEL, '.github', 'zap-regeln.tsv')), 'die ZAP-Regeln fehlen');
});

// Gegenproben (31.10.2026 gemessen): `continue-on-error: true` an den Schritt
// „Gegenproben messen“ → rot; im Kopf von ablauf-anzahl-fest.patch `Modul: app`
// → `Modul: core-ui` → rot „… liegt nicht in core-ui“.
test('der Gegenproben-Job misst jede Patch-Gegenprobe gegen eine echte Testklasse', () => {
  const yml = fs.readFileSync(path.join(ECHTER_ORT, 'android.yml'), 'utf8')
    .split('\n').filter(z => !z.trimStart().startsWith('#')).join('\n');
  const job = yml.split(/\n  gegenproben:\n/)[1]?.split(/\n  [\w-]+:\n/)[0] ?? '';
  assert.match(job, /python3 tools\/gegenproben\.py gegenproben/, 'der Job ruft das Werkzeug nicht');
  assert.doesNotMatch(job, /continue-on-error/, 'eine grüne Gegenprobe muss den Lauf rot machen');
  // Diese Klassen müssen mindestens eine Gegenprobe haben; weitere sind willkommen.
  const PFLICHT = ['AblaufTest', 'BestandMigrationTest'];
  const ordner = path.join(WURZEL, 'Android-App', 'gegenproben');
  const klassen = new Set();
  for (const n of fs.readdirSync(ordner).filter(d => d.endsWith('.patch'))) {
    const kopf = fs.readFileSync(path.join(ordner, n), 'utf8').split(/\ndiff --git /)[0];
    const feld = (f) => (kopf.match(new RegExp(`^${f}: (.+)$`, 'm')) || [])[1];
    assert.ok(feld('Gegenprobe') && feld('Rot'), `${n}: Kopf ohne Gegenprobe oder Rot`);
    const voll = feld('Test') ?? '';
    const endung = ['', feld('Modul'), 'src', 'test', 'java', ...voll.split('.')].join(path.sep) + '.kt';
    assert.equal(androidDateien(f => f.endsWith(endung), 'test').length, 1, `${n}: ${voll} liegt nicht in ${feld('Modul')}`);
    klassen.add(voll.split('.').pop());
  }
  for (const k of PFLICHT) assert.ok(klassen.has(k), `${k} braucht eine Gegenprobe`);
});

// Renovate liest nur die renovate.json im Wurzelverzeichnis; Web-App/renovate.json
// stand dort lange ohne Wirkung. Gegenproben (02.11.2026 gemessen): `npm` aus
// enabledManagers gestrichen → rot; eine leere Web-App/renovate.json angelegt → rot;
// minimumReleaseAge gestrichen → rot (npm und gradle ohne Wartezeit).
test('Renovate pflegt npm der Web-App aus der Wurzel-Konfiguration', () => {
  const konf = JSON.parse(fs.readFileSync(path.join(WURZEL, 'renovate.json'), 'utf8'));
  assert.ok(konf.enabledManagers.includes('npm'), 'Die npm-Pakete der Web-App hält niemand aktuell');
  assert.ok(konf.packageRules.some(r => r.matchManagers?.includes('npm') && r.matchPackageNames?.includes('pdfjs-dist')),
    'Die Regel für die eingecheckte PDF.js-Kopie fehlt');
  for (const m of ['npm', 'gradle']) {
    assert.ok(konf.packageRules.some(r => r.matchManagers?.includes(m) && !r.matchPackageNames && /^[1-9]\d* days?$/.test(r.minimumReleaseAge ?? '')),
      `${m}: neue Fassungen ohne Wartezeit`);
  }
  const daneben = [];
  (function lauf(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', '.claude', 'build', '.gradle', 'dist'].includes(e.name)) continue;
      const voll = path.join(dir, e.name);
      if (e.isDirectory()) lauf(voll);
      else if (/^renovate\.json5?$|^\.renovaterc/.test(e.name) && dir !== WURZEL) daneben.push(path.relative(WURZEL, voll));
    }
  })(WURZEL);
  assert.deepEqual(daneben, [], 'Diese Renovate-Dateien liest niemand');
});

/** Der `run:`-Block des Schritts mit `id: <id>`, ohne Einrückung. */
function schrittSkript(yml, id) {
  const z = yml.split('\n');
  const i = z.findIndex(l => l.trim() === `id: ${id}`);
  const r = z.findIndex((l, j) => j > i && /^\s+run: \|\s*$/.test(l));
  const tief = z[r + 1]?.match(/^\s*/)?.[0].length ?? 0;
  const ende = z.findIndex((l, j) => j > r && l.trim() && (l.match(/^\s*/)?.[0].length ?? 0) < tief);
  return z.slice(r + 1, ende < 0 ? undefined : ende).map(l => l.slice(tief)).join('\n');
}

// Gegenproben (02.11.2026 gemessen): im sed-Muster `@sha256` durch `@sha512`
// ersetzt → rot (Exit 1, „Kein Image per Digest gefunden“); (03.11.2026) `docker-compose` aus enabledManagers in renovate.json gestrichen → rot
// „docker-compose: … ohne Update-Pfad“; dependabot.yml wieder angelegt → rot „… doppelt“;
// `matrix.image` im Trivy-Job durch ein festes Image ersetzt → rot.
test('die Images aus compose.yaml haben einen Update-Pfad und gehen durch Trivy', () => {
  const yml = fs.readFileSync(path.join(ECHTER_ORT, 'sicherheit.yml'), 'utf8');
  const ort = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'compose-images-'));
  fs.mkdirSync(path.join(ort, 'Web-App'));
  fs.copyFileSync(path.join(WURZEL, 'Web-App', 'compose.yaml'), path.join(ort, 'Web-App', 'compose.yaml'));
  const ausgabe = path.join(ort, 'ausgabe');
  const r = spawnSync('bash', ['-e', '-c', schrittSkript(yml, 'lesen')],
    { cwd: ort, env: { ...process.env, GITHUB_OUTPUT: ausgabe }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const images = JSON.parse(fs.readFileSync(ausgabe, 'utf8').match(/^images=(.*)$/m)?.[1] ?? '[]');
  fs.rmSync(ort, { recursive: true, force: true });
  assert.deepEqual(images.map(i => i.split(':')[0]).sort(), ['caddy', 'postgres', 'sosedoff/pgweb']);
  assert.ok(images.every(i => /@sha256:[0-9a-f]{64}$/.test(i)), images.join(', '));

  const trivy = yml.slice(yml.indexOf('\n  trivy-compose:'), yml.indexOf('\n  zap:'));
  assert.match(trivy, /matrix:\s*\n\s*image: \$\{\{ fromJSON\(needs\.compose-images\.outputs\.images\) \}\}/);
  assert.match(trivy, /image-ref: \$\{\{ matrix\.image \}\}/);
  const renovate = JSON.parse(fs.readFileSync(path.join(WURZEL, 'renovate.json'), 'utf8'));
  for (const m of ['docker-compose', 'dockerfile', 'github-actions']) {
    assert.ok(renovate.enabledManagers.includes(m), `${m}: Digests und Action-SHAs stehen ohne Update-Pfad fest`);
    assert.ok(renovate.packageRules.some(r => r.matchManagers?.includes(m) && r.pinDigests === true), `${m}: ohne pinDigests`);
  }
  assert.ok(!fs.existsSync(path.join(WURZEL, '.github', 'dependabot.yml')), 'Dependabot und Renovate schlügen dieselben Updates doppelt vor');
  // Gegenprobe (03.11.2026 gemessen): wieder exit-code '0' → rot „nicht scharf".
  assert.match(trivy, /exit-code: '1'/, 'Trivy für die Betriebs-Images ist nicht scharf');
  const liste = trivy.match(/trivyignores: (\S+)/)?.[1];
  assert.ok(liste && fs.existsSync(path.join(WURZEL, liste)), `Ausnahmeliste fehlt: ${liste}`);
});

// Gegenprobe (03.11.2026 gemessen): persist-credentials im Checkout von
// web-ci.yml gestrichen → rot, die Liste nennt „web-ci.yml:test".
test('Checkouts behalten keine Zugangsdaten, ausser wo der Job schreibt', () => {
  const ohne = [];
  for (const datei of fs.readdirSync(ECHTER_ORT).filter(n => n.endsWith('.yml'))) {
    const z = fs.readFileSync(path.join(ECHTER_ORT, datei), 'utf8').split('\n');
    let job = '';
    z.forEach((l, i) => {
      job = l.match(/^ {2}([\w-]+):\s*$/)?.[1] ?? job;
      if (/uses: actions\/checkout@/.test(l) && !/persist-credentials: false/.test(z.slice(i + 1, i + 6).join('\n')))
        ohne.push(`${datei}:${job}`);
    });
  }
  assert.deepEqual(ohne.sort(), ['android.yml:bildschirmfotos-einchecken', 'android.yml:pruefsummen-vorschlagen']);
});

// Gegenproben (03.11.2026 gemessen, je einzeln): `provenance: mode=max`
// gestrichen → rot „… Herkunft beim Bau“; den Schritt „Herkunft bescheinigen“
// gestrichen → rot „… attest-build-provenance“; `attestations: write` gestrichen
// → rot „… darf Nachweise ablegen“.
test('das Image trägt Herkunft und Stückliste, bescheinigt am signierten Digest', () => {
  const yml = fs.readFileSync(path.join(ECHTER_ORT, 'docker-publish.yml'), 'utf8')
    .split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
  const bau = yml.split(/\n  build:\n/)[1].split(/\n  merge:\n/)[0];
  assert.match(bau, /^\s+provenance: mode=max\s*$/m, 'keine Herkunft beim Bau');
  assert.match(bau, /^\s+sbom: generator=docker\/buildkit-syft-scanner:[\d.]+@sha256:[0-9a-f]{64}\s*$/m,
    'keine Stückliste beim Bau oder ihr Scanner nicht per Digest');
  const merge = yml.split(/\n  merge:\n/)[1];
  assert.match(merge, /permissions:\s*\n\s+contents: read\s*\n\s+id-token: write\s*\n\s+attestations: write/,
    'der Merge-Job darf Nachweise ablegen');
  assert.match(merge, /uses: actions\/attest-build-provenance@[0-9a-f]{40}/, 'attest-build-provenance fehlt');
  assert.match(merge, /uses: actions\/attest-sbom@[0-9a-f]{40}/, 'attest-sbom fehlt');
  assert.match(merge, /npm sbom --omit=dev --package-lock-only --sbom-format=cyclonedx/);
  // Bescheinigt wird genau der Digest, den cosign signiert hat.
  assert.equal([...merge.matchAll(/subject-digest: \$\{\{ steps\.signatur\.outputs\.digest \}\}/g)].length, 2);
  assert.match(merge, /- name: Image signieren\s*\n\s+id: signatur/);
});
