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
      // Ein lokaler Workflow (./.github/workflows/…) läuft immer im Commit des Aufrufers.
      if (m && !m[1].startsWith('./.github/workflows/') && !/@[0-9a-f]{40}$/.test(m[1])) lose.push(`${f}:${i + 1} ${m[1]}`);
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
  // Caddy baut compose.yaml selbst (Dockerfile.caddy), auch für caddy-rechte; pgweb gibt es nicht mehr.
  assert.deepEqual(images.map(i => i.split(':')[0]).sort(), ['postgres']);
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

// Gegenproben (05.11.2026 gemessen, je einzeln): im Publish-Bau `no-cache:
// true` durch `cache-from: type=gha,…` ersetzt → rot „der signierte Bau liest
// keinen Cache“; im Trivy-Schritt vor der Signatur eine andere Action → rot
// „Trivy prüft den Digest, bevor er signiert wird“; `npm audit signatures` aus
// web-ci gestrichen → rot „… nach npm ci“; im Job trivy-eigenbau
// `trivyignores:` ergänzt → rot „Caddy wird ohne Ausnahmen geprüft“.
test('der signierte Bau ohne Cache, Trivy vor der Signatur, Paketsignaturen in der CI', () => {
  const ohneKommentar = (t) => t.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
  const pub = ohneKommentar(fs.readFileSync(path.join(ECHTER_ORT, 'docker-publish.yml'), 'utf8'));
  assert.doesNotMatch(pub, /cache-(from|to)|type=gha/, 'der signierte Bau liest keinen Cache');
  const bau = pub.split(/\n  build:\n/)[1].split(/\n  merge:\n/)[0];
  assert.match(bau, /^\s+no-cache: true\s*$/m, 'der signierte Bau liest keinen Cache');
  const merge = pub.split(/\n  merge:\n/)[1];
  const trivy = merge.indexOf('uses: aquasecurity/trivy-action@'), signieren = merge.indexOf('cosign sign ');
  assert.ok(trivy > 0 && signieren > trivy, 'Trivy prüft den Digest, bevor er signiert wird');
  const schritt = merge.slice(trivy, merge.indexOf('\n      - ', trivy));
  assert.match(schritt, /image-ref: \$\{\{ env\.IMAGE \}\}@\$\{\{ steps\.manifest\.outputs\.digest \}\}/);
  assert.match(schritt, /exit-code: '1'/);
  assert.match(schritt, /severity: HIGH,CRITICAL/);

  const ci = ohneKommentar(fs.readFileSync(path.join(ECHTER_ORT, 'web-ci.yml'), 'utf8'));
  const ci0 = ci.indexOf('npm ci --ignore-scripts'), sig = ci.indexOf('run: npm audit signatures');
  assert.ok(ci0 > 0 && sig > ci0, 'npm audit signatures läuft nach npm ci');

  const sich = ohneKommentar(fs.readFileSync(path.join(ECHTER_ORT, 'sicherheit.yml'), 'utf8'));
  const eigen = sich.slice(sich.indexOf('\n  trivy-eigenbau:'), sich.indexOf('\n  zap:'));
  assert.match(eigen, /docker build -f Web-App\/Dockerfile\.caddy /);
  assert.match(eigen, /exit-code: '1'/);
  assert.doesNotMatch(eigen, /trivyignores/, 'Caddy wird ohne Ausnahmen geprüft');
  const ausnahmen = fs.readFileSync(path.join(WURZEL, '.github', 'trivy-betrieb.ignore'), 'utf8');
  assert.doesNotMatch(ausnahmen.split('\n').filter(l => !l.startsWith('#   ')).join('\n'), /^# (caddy|pgweb)/m,
    'Caddy oder pgweb mit hingenommenen Lücken');
});

// ── Android-Release (sec17) ──────────────────────────────────────────────────

/** Der run-Block eines Schritts, gesucht über seinen Namen. */
function schrittNach(yml, name) {
  const z = yml.split('\n');
  const i = z.findIndex(l => l.trim() === `- name: ${name}`);
  assert.ok(i >= 0, `Schritt „${name}“ nicht gefunden`);
  const r = z.findIndex((l, j) => j > i && /^\s+run: \|\s*$/.test(l));
  const tief = z[r + 1]?.match(/^\s*/)?.[0].length ?? 0;
  const ende = z.findIndex((l, j) => j > r && l.trim() && (l.match(/^\s*/)?.[0].length ?? 0) < tief);
  return z.slice(r + 1, ende < 0 ? undefined : ende).map(l => l.slice(tief)).join('\n');
}

/** Ein Job ohne Kommentarzeilen, von seiner Kopfzeile bis zum nächsten Job. */
function jobVon(yml, name) {
  const ohne = yml.split('\n').filter(z => !z.trimStart().startsWith('#')).join('\n');
  const teil = ohne.split(new RegExp(`\\n  ${name}:\\n`))[1];
  assert.ok(teil, `Job ${name} fehlt`);
  return teil.split(/\n  [\w-]+:\n/)[0];
}

/** Führt [skript] in bash aus, mit einem `gh`-Ersatz, der je Aufruf [antworten] befragt. */
function mitGh(t, skript, antworten, env = {}) {
  const ort = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'gh-ersatz-'));
  t.after(() => fs.rmSync(ort, { recursive: true, force: true }));
  const regeln = Object.entries(antworten).map(([muster, aus]) =>
    `  *'${muster}'*) printf '%s' '${aus.replace(/'/g, `'\\''`)}' ;;`).join('\n');
  fs.writeFileSync(path.join(ort, 'gh'), `#!/bin/bash\ncase "$*" in\n${regeln}\n  *) echo "unbekannt: $*" >&2; exit 9 ;;\nesac\n`, { mode: 0o755 });
  return spawnSync('bash', ['-e', '-c', skript], { cwd: ort, encoding: 'utf8',
    env: { ...process.env, PATH: `${ort}:${process.env.PATH}`, GITHUB_REPOSITORY: 'o/r', GITHUB_SHA: 'a'.repeat(40), ...env } });
}

// Gegenproben (05.11.2026 gemessen, je einzeln): im Baujob `cache-disabled` gestrichen →
// rot „Etiketten bauen ohne Cache“; im Gegenproben-Job `cache-read-only` gestrichen → rot
// „… schreibt den Gradle-Cache“.
test('Etiketten bauen ohne Gradle-Cache, und nur der Baujob schreibt ihn (sec17 M1)', () => {
  const android = fs.readFileSync(path.join(ECHTER_ORT, 'android.yml'), 'utf8');
  const bau = jobVon(android, 'build');
  assert.match(bau, /setup-gradle@[0-9a-f]{40}[^\n]*\n\s+with:\n\s+cache-disabled: \$\{\{ startsWith\(github\.ref, 'refs\/tags\/android-v'\) \}\}/,
    'Etiketten bauen ohne Cache');
  assert.match(bau, /if: startsWith\(github\.ref, 'refs\/tags\/android-v'\)\n\s+run: echo "GRADLE_USER_HOME=\$RUNNER_TEMP\/[\w-]+" >> "\$GITHUB_ENV"/,
    'Etiketten bauen mit leerem Gradle-Benutzerverzeichnis');
  for (const datei of ['android.yml', 'sicherheit.yml']) {
    const yml = fs.readFileSync(path.join(ECHTER_ORT, datei), 'utf8');
    const jobs = [...yml.matchAll(/\n {2}([\w-]+):\n/g)].map(m => m[1]).filter(j => j !== 'build');
    for (const job of jobs.filter(j => /setup-gradle@/.test(jobVon(yml, j))))
      assert.match(jobVon(yml, job), /setup-gradle@[0-9a-f]{40}[^\n]*\n(?:\s+if: [^\n]+\n)?\s+with:\n\s+cache-read-only: true/,
        `${datei}:${job} schreibt den Gradle-Cache`);
  }
});

// Gegenproben (05.11.2026 gemessen): `exit-code: '1'` der Android-Prüfung auf '0' → rot
// „… sperrt nicht“; den Schritt „Abhängigkeiten ohne bekannte Lücke“ im Signierjob gestrichen
// → rot „… ohne grüne Lückenprüfung“; im gh-Ersatz ein roter Job → rot „ein roter …“.
test('die Lückenprüfung der App sperrt, und ohne sie wird kein Etikett signiert (sec17 M2)', (t) => {
  const sicherheit = fs.readFileSync(path.join(ECHTER_ORT, 'sicherheit.yml'), 'utf8');
  const job = jobVon(sicherheit, 'android-abhaengigkeiten');
  assert.doesNotMatch(job.split('\n    steps:')[0], /continue-on-error/, 'der ganze Job darf nicht rot werden dürfen');
  const pruefung = job.split('- name: Bekannte Lücken')[1].split('- name: ')[0];
  assert.match(pruefung, /exit-code: '1'/, 'die Lückenprüfung der App sperrt nicht');
  assert.match(pruefung, /severity: HIGH,CRITICAL/);
  assert.match(pruefung, /ignore-unfixed: true/);
  assert.match(job, /log4j-core:2\.14\.1/, 'die Gegenprobe mit einer bekannt verwundbaren Fassung fehlt');
  assert.match(job, /steps\.gegenprobe\.outcome/);
  const liste = pruefung.match(/trivyignores: (\S+)/)?.[1];
  assert.ok(liste && fs.existsSync(path.join(WURZEL, liste)), `Ausnahmeliste fehlt: ${liste}`);
  const zeilen = fs.readFileSync(path.join(WURZEL, liste), 'utf8').split('\n');
  zeilen.forEach((z, i) => {
    if (!z.trim() || z.startsWith('#')) return;
    assert.match(z, /^CVE-\d{4}-\d+ exp:\d{4}-\d{2}-\d{2}$/, `Ausnahme ohne Ablaufdatum: ${z}`);
    assert.match(zeilen[i - 1] ?? '', /^# \S.{10,}/, `Ausnahme ohne Grund darüber: ${z}`);
  });
  const name = sicherheit.match(/\n  android-abhaengigkeiten:\n    name: ([^\n]+)/)[1];
  const android = fs.readFileSync(path.join(ECHTER_ORT, 'android.yml'), 'utf8');
  const skript = schrittNach(android, 'Abhängigkeiten ohne bekannte Lücke');
  assert.match(skript, /workflows\/sicherheit\.yml\/runs\?head_sha=\$GITHUB_SHA/, 'Etikett ohne grüne Lückenprüfung');
  assert.ok(name.startsWith('Trivy (Android-Abhängigkeiten'), `Jobname „${name}“ passt nicht zur Abfrage`);
  const lauf = (fazit) => mitGh(t, skript, {
    'workflows/sicherheit.yml/runs': '17',
    'actions/runs/17/jobs': fazit,
  });
  assert.equal(lauf('success').status, 0, 'ein grüner Lauf gibt frei');
  assert.notEqual(lauf('failure').status, 0, 'ein roter Lauf sperrt');
  assert.notEqual(lauf('fehlt').status, 0, 'ohne den Job sperrt es');
});

// Gegenproben (05.11.2026 gemessen): im Schritt „main ist geschützt“ die Schleife gestrichen →
// rot „ohne PR-Pflicht …“; die Prüfung von can_admins_bypass gestrichen → rot „… umgehen …“.
test('signiert wird nur bei geschütztem main und ohne Umgehung durch Administratoren (sec17 B1, B3)', (t) => {
  const android = fs.readFileSync(path.join(ECHTER_ORT, 'android.yml'), 'utf8');
  const main = schrittNach(android, 'main ist geschützt');
  const regeln = (arten) => mitGh(t, main, { 'rules/branches/main': arten }).status;
  assert.equal(regeln('non_fast_forward,pull_request,required_status_checks'), 0);
  assert.notEqual(regeln('non_fast_forward,required_status_checks'), 0, 'ohne PR-Pflicht wird nicht signiert');
  assert.notEqual(regeln('pull_request'), 0, 'ohne Pflicht-Checks wird nicht signiert');
  const umgebung = schrittNach(android, 'Environment release ist geschützt');
  const env = (bypass) => mitGh(t, umgebung, {
    'environments/release/deployment-branch-policies': 'tag:android-v*',
    'environments/release': JSON.stringify({ can_admins_bypass: bypass,
      deployment_branch_policy: { custom_branch_policies: true },
      protection_rules: [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [{}] }] }),
  }).status;
  assert.equal(env(false), 0);
  assert.notEqual(env(true), 0, 'Administratoren dürfen die Freigabe nicht umgehen');
});

// Gegenproben (05.11.2026 gemessen): im Release-Job den Prüfsummen-Schritt gestrichen → rot
// „vor dem Veröffentlichen …“; in android-bescheinigung.yml `sha256sum -c -` durch
// `cat > /dev/null` ersetzt → rot „ein verändertes Byte …“.
test('veröffentlicht und bescheinigt wird nur, was der Signierjob ausgab (sec17 B-N1, B-N7)', (t) => {
  const android = fs.readFileSync(path.join(ECHTER_ORT, 'android.yml'), 'utf8');
  const bescheinigung = fs.readFileSync(path.join(ECHTER_ORT, 'android-bescheinigung.yml'), 'utf8');
  const release = jobVon(android, 'release');
  assert.match(release, /- name: Artefakt gegen die Prüfsummen des Signierjobs/, 'vor dem Veröffentlichen fehlt der Vergleich');
  assert.doesNotMatch(release, /attest-build-provenance|id-token: write/, 'der Release-Job bescheinigt nicht selbst');
  assert.match(release, /needs: \[signieren, apk-pruefen, bescheinigen\]/);
  assert.match(jobVon(android, 'bescheinigen'), /uses: \.\/\.github\/workflows\/android-bescheinigung\.yml/);
  assert.match(bescheinigung, /\non:\n {2}workflow_call:\n/);
  assert.doesNotMatch(bescheinigung, /\n {2}(push|pull_request|workflow_dispatch):/, 'nur als wiederverwendbarer Workflow');
  for (const datei of ['apk/release/BrickInventory.apk', 'version-signiert.json', 'bundle/release/app-release.aab'])
    assert.match(bescheinigung.split('subject-path:')[1], new RegExp(datei.replace(/[./]/g, '\\$&')), `${datei} wird nicht bescheinigt`);

  const ort = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'signiert-'));
  t.after(() => fs.rmSync(ort, { recursive: true, force: true }));
  const inhalt = { 'apk/release/BrickInventory.apk': 'apk', 'version-signiert.json': '{}', 'bundle/release/app-release.aab': 'aab' };
  const summe = (s) => require('node:crypto').createHash('sha256').update(s).digest('hex');
  for (const [d, s] of Object.entries(inhalt)) {
    fs.mkdirSync(path.join(ort, 'signiert', path.dirname(d)), { recursive: true });
    fs.writeFileSync(path.join(ort, 'signiert', d), s);
  }
  const env = { RUNNER_TEMP: ort, APK_SOLL: summe('apk'), BESCHREIBUNG_SOLL: summe('{}'), AAB_SOLL: summe('aab') };
  const skript = schrittNach(bescheinigung, 'Gegen die Prüfsummen des Signierjobs');
  const lauf = () => spawnSync('bash', ['-e', '-c', skript], { cwd: ort, encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(lauf().status, 0, lauf().stdout + lauf().stderr);
  fs.writeFileSync(path.join(ort, 'signiert', 'version-signiert.json'), '{ }');
  assert.notEqual(lauf().status, 0, 'ein verändertes Byte wird bescheinigt');
});

// Gegenproben (05.11.2026 gemessen): in der README eine Ziffer des Zertifikats geändert → rot
// „… nennt nicht das hinterlegte Zertifikat“; pull_request ohne android.yml → rot „… Workflow-Pfad“;
// im Signierjob `| sha256sum -c -` der Werkzeuge durch `| cat` ersetzt → rot „… feste Prüfsummen“.
test('Release-Weg: festes Werkzeug, Zertifikat für Neuinstallationen, Fork-Läufe ohne installierbares APK', () => {
  const android = fs.readFileSync(path.join(ECHTER_ORT, 'android.yml'), 'utf8');
  // sec17 B-N6: festes Image und festgelegte Werkzeuge mit Prüfsumme.
  for (const job of ['build', 'signieren', 'apk-pruefen', 'release'])
    assert.match(jobVon(android, job), /runs-on: ubuntu-24\.04/, `${job} läuft auf einem wechselnden Image`);
  assert.doesNotMatch(android, /build-tools\/\*\//, 'Werkzeuge „das neueste des Images“');
  const signieren = schrittNach(android, 'Signieren');
  assert.match(signieren, /WERKZEUGE="\$ANDROID_HOME\/build-tools\/\d+\.\d+\.\d+"/);
  assert.match(signieren, /[0-9a-f]{64} "\$WERKZEUGE\/zipalign"[\s\\]+[0-9a-f]{64} "\$WERKZEUGE\/lib\/apksigner\.jar"[\s\\]+\| sha256sum -c -/,
    'die Signierwerkzeuge werden nicht gegen feste Prüfsummen geprüft');
  // sec17 B-N9: Zertifikat im Release-Text und in der README, gleich dem hinterlegten.
  const soll = fs.readFileSync(path.join(WURZEL, 'Android-App', 'tools', 'release-zertifikat.sha256'), 'utf8')
    .split('\n').map(z => z.split('#')[0].trim()).find(z => /^[0-9a-f]{64}$/.test(z));
  const readme = fs.readFileSync(path.join(WURZEL, 'Android-App', 'README.md'), 'utf8');
  assert.ok(soll && readme.includes(`SHA-256 ${soll}`), 'Die README nennt nicht das hinterlegte Zertifikat');
  const veroeffentlichen = schrittNach(android, 'BrickInventory.apk als Release bereitstellen');
  assert.match(veroeffentlichen, /tools\/release-zertifikat\.sha256/);
  assert.match(veroeffentlichen, /Signierzertifikat SHA-256: \\`\$ZERT\\`/);
  assert.match(veroeffentlichen, /apksigner verify --print-certs/);
  // sec17 B-N14: auch ein PR, der nur den Workflow ändert, bekommt einen Lauf.
  const pr = android.split('\n  pull_request:\n')[1].split('\n  workflow_dispatch:')[0];
  assert.match(pr, /- '\.github\/workflows\/android\.yml'/, 'pull_request ohne Workflow-Pfad');
  // sec17 B-N15: ausserhalb eines Etiketts kein installierbares APK im Artefakt.
  assert.match(signieren, /if \[ "\$ECHT" != "true" \]; then\n\s+mv "\$APK_AUS" "\$AUS\/apk\/release\/BrickInventory\.apk\.probe-nicht-installieren"/);
  assert.match(schrittNach(android, 'Probe-APK für die Prüfung benennen'), /BrickInventory\.apk\.probe-nicht-installieren/);
  // sec17 B-N2: die Zusammenfassung der Prüfsummen entsteht ohne Gradle.
  assert.doesNotMatch(jobVon(android, 'pruefsummen'), /pruefsummen-vergleich/);
  const zusammen = jobVon(android, 'pruefsummen-zusammenfassen');
  assert.match(zusammen, /pruefsummen-vergleich\.py/);
  assert.doesNotMatch(zusammen, /gradlew|setup-gradle/, 'die Zusammenfassung entsteht ohne Gradle');
});
