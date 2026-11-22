/**
 * A workflow that is not in the root directory NEVER runs.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const WURZEL = path.join(__dirname, '..', '..');
const REAL_LOCATION = path.join(WURZEL, '.github', 'workflows');

/** All `.github/workflows` folders in the tree, without node_modules and .git. */
function workflowFolder(start) {
  const gefunden = [];
  // .claude: local working copies (git worktree) of the tools, not part of the repository.
  const uebersprungen = new Set(['node_modules', '.git', 'dist', 'build', '.gradle', '.claude']);
  (function lauf(dir) {
    let eintraege;
    try {
      eintraege = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of eintraege) {
      if (!e.isDirectory() || uebersprungen.has(e.name)) continue;
      const voll = path.join(dir, e.name);
      if (e.name === 'workflows' && path.basename(dir) === '.github') gefunden.push(voll);
      else lauf(voll);
    }
  })(start);
  return gefunden;
}

test('every workflow is where GitHub reads it', () => {
  const ordner = workflowFolder(WURZEL);

  // Self-proof 1: the walk really searched and found the real
  // place. Without that a broken pattern could wave everything through.
  assert.ok(
    ordner.includes(REAL_LOCATION),
    `Der Durchlauf hat ${REAL_LOCATION} nicht gefunden — dann prüft er nichts. ` +
      `Gefunden: ${JSON.stringify(ordner)}`,
  );

  const daneben = ordner.filter(o => o !== REAL_LOCATION);
  assert.deepEqual(
    daneben,
    [],
    'Diese Workflow-Ordner liegen NICHT im Wurzelverzeichnis und werden von ' +
      'GitHub nie gelesen:\n  ' +
      daneben.join('\n  ') +
      '\nGenau so lag ci.yml monatelang in Web-App/.github/workflows und ist ' +
      'kein einziges Mal gelaufen.',
  );
});

test('the root directory contains the workflows that should exist', () => {
  const dateien = fs
    .readdirSync(REAL_LOCATION)
    .filter(f => /\.ya?ml$/.test(f))
    .sort();

  // Self-proof 2: a minimum count instead of an enumeration. If the folder
  // vanished or the pattern did not match, the list would be empty — and the
  // check below would have nothing to say.
  assert.ok(dateien.length >= 3, `Nur ${dateien.length} Workflows im Wurzelverzeichnis: ${dateien.join(', ')}`);

  // The web run must be included. It is the only one that runs the test
  // suite — without it NO run checks the web app.
  assert.ok(dateien.includes('web-ci.yml'), `Der Web-CI-Lauf fehlt. Vorhanden: ${dateien.join(', ')}`);
});

test('a workflow uses every action in the same version everywhere', () => {
  // Why
  const versions = new Map(); // Action -> Map(version -> [files])
  for (const f of fs.readdirSync(REAL_LOCATION).filter(f => /\.ya?ml$/.test(f))) {
    const yml = fs
      .readFileSync(path.join(REAL_LOCATION, f), 'utf8')
      .split('\n')
      .filter(z => !z.trimStart().startsWith('#'))
      .join('\n');
    for (const m of yml.matchAll(/uses:\s*([\w.-]+\/[\w.\-/]+)@([\w.-]+)/g)) {
      const [, action, fassung] = m;
      if (!versions.has(action)) versions.set(action, new Map());
      const je = versions.get(action);
      if (!je.has(fassung)) je.set(fassung, []);
      if (!je.get(fassung).includes(f)) je.get(fassung).push(f);
    }
  }

  // Self-proof 3: without found actions the loop below is empty.
  assert.ok(versions.size >= 8, `Nur ${versions.size} Actions gefunden — Muster veraltet?`);
  const mehrfach = [...versions].filter(([, je]) => [...je.values()].reduce((n, d) => n + d.length, 0) > 1);
  // Lowered from 3 to 2 when android-playstore.yml was removed: with one
  // workflow fewer there is less overlap. MEASURED, there are now
  // actions/checkout@v7 (in all three runs) and actions/upload-artifact@v7
  // (in two) — both uniform, so the check below still applies to
  // exactly the cases that matter.
  assert.ok(
    mehrfach.length >= 2,
    `Nur ${mehrfach.length} Actions stehen an mehr als einer Stelle — dann ` + 'kann diese Prüfung nichts finden.',
  );

  const disagreeing = [...versions]
    .filter(([, je]) => je.size > 1)
    .map(([action, je]) => `${action}: ` + [...je].map(([v, d]) => `${v} (${d.join(', ')})`).join(' vs. '));
  assert.deepEqual(disagreeing, [], 'Dieselbe Action steht in zwei Fassungen:\n  ' + disagreeing.join('\n  '));
});

test('a run that executes tests runs on EVERY branch', () => {
  // Why
  const TESTBEFEHLE = [/npm\s+test/, /testDebugUnitTest/];

  const checking = [];
  for (const f of fs.readdirSync(REAL_LOCATION).filter(f => /\.ya?ml$/.test(f))) {
    const roh = fs.readFileSync(path.join(REAL_LOCATION, f), 'utf8');
    // Comment lines out: the explanation blocks of these files contain the
    // test commands as prose, and a workflow would otherwise count as
    // "checking" merely because it WRITES about checking.
    const yml = roh
      .split('\n')
      .filter(z => !z.trimStart().startsWith('#'))
      .join('\n');
    if (TESTBEFEHLE.some(r => r.test(yml))) checking.push([f, yml]);
  }

  // Self-proof: there are at least the two — web and Android. If the pattern
  // found none, the loop below would be empty and the check silently green.
  assert.ok(
    checking.length >= 2,
    `Nur ${checking.length} testausführende Workflows gefunden — Muster veraltet? ` +
      'Ohne Fund prüft der Rest dieses Tests nichts.',
  );

  const eng = [];
  for (const [f, yml] of checking) {
    // The `branches:` entry UNDER `push:` — not the one under `pull_request:`
    // and not any one further down in the text.
    const push = yml.match(/\n\s*push:\s*\n((?:\s{4,}.*\n|\s*\n)*)/);
    if (!push) continue; // pure publishing run — see above
    const zweige = push[1].match(/branches(?:-ignore)?:\s*(.+)/);
    // No branches entry means on GitHub: all branches. That is allowed.
    if (!zweige) continue;
    if (!zweige[1].includes('**')) eng.push(`${f}: push nur auf ${zweige[1].trim()}`);
  }

  assert.deepEqual(
    eng,
    [],
    'Diese Workflows führen Tests aus, laufen aber nicht auf jedem Zweig-Push:\n  ' +
      eng.join('\n  ') +
      '\nDamit kommt ihr Befund erst nach dem Zusammenführen — genau so blieben ' +
      'drei rote Android-Läufe unbemerkt im Zweig stehen.',
  );
});

// Counter-checks (measured 28.10.2026): the line with `head_repository` deleted
// from the `if:` of the check job → red „… fremdes Repository …“; an
// action again as `@v7` instead of by SHA → red „… per Commit-SHA …“.
test('the Docker image only results from a push to main of this repository', () => {
  const yml = fs.readFileSync(path.join(REAL_LOCATION, 'docker-publish.yml'), 'utf8');
  const job = yml.split(/\n {2}pruefen:\n/)[1]?.split(/\n {4}steps:\n/)[0] ?? '';
  assert.match(job, /\n {4}if: /, 'der Prüfjob hat kein if:');
  assert.match(job, /workflow_run\.event == 'push'/, 'ein PR-Lauf der CI darf kein Image auslösen');
  assert.match(job, /workflow_run\.head_branch == 'main'/);
  assert.match(
    job,
    /workflow_run\.head_repository\.full_name == github\.repository/,
    'ein fremdes Repository (Fork) darf kein Image auslösen',
  );
});

// Counter-check (measured 01.11.2026): `--no-build-cache` deleted from „Release bauen“
// → red „… ohne Build-Cache …“.
test('the release APK is built without a build cache', () => {
  const yml = fs.readFileSync(path.join(REAL_LOCATION, 'android.yml'), 'utf8');
  const schritt = yml.split(/\n {6}- name: Release bauen\n/)[1]?.split(/\n {6}- name: /)[0] ?? '';
  const aufrufe = schritt.split('\n').filter(z => !z.trimStart().startsWith('#') && /gradlew/.test(z));
  assert.ok(aufrufe.length > 0, 'Schritt „Release bauen“ mit gradlew nicht gefunden');
  for (const z of aufrufe) assert.match(z, /--no-build-cache/, `Release ohne Build-Cache bauen: ${z.trim()}`);
});

test('every action is pinned by commit SHA', () => {
  const lose = [];
  for (const f of fs.readdirSync(REAL_LOCATION).filter(n => n.endsWith('.yml'))) {
    const zeilen = fs.readFileSync(path.join(REAL_LOCATION, f), 'utf8').split('\n');
    zeilen.forEach((z, i) => {
      const m = z.match(/^\s*-?\s*uses:\s*([^\s#]+)/);
      // A local workflow (./.github/workflows/…) always runs in the caller's commit.
      if (m && !m[1].startsWith('./.github/workflows/') && !/@[0-9a-f]{40}$/.test(m[1]))
        lose.push(`${f}:${i + 1} ${m[1]}`);
    });
  }
  assert.deepEqual(lose, [], 'Ein Tag lässt sich umhängen; nur ein SHA ist fest. Nicht per Commit-SHA festgelegt:');
});

// Counter-checks (measured 30.10.2026): `security-events: write` moved to the
// top level → red „security-events: write darf nur der CodeQL-Job
// haben“; the Kotlin line of the
// matrix removed → red „CodeQL prüft java-kotlin nicht“.
test('the security run checks code, dependencies, image and the running server', () => {
  const roh = fs.readFileSync(path.join(REAL_LOCATION, 'sicherheit.yml'), 'utf8');
  const yml = roh
    .split('\n')
    .filter(z => !z.trimStart().startsWith('#'))
    .join('\n');
  const oben = yml.slice(0, yml.indexOf('\njobs:'));
  assert.match(oben, /\npermissions:\n {2}contents: read\n/, 'oben nur contents: read');
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

/** The entries of .github/dependabot.yml, one block per `- package-ecosystem:`. */
function dependabot() {
  const text = fs.readFileSync(path.join(WURZEL, '.github', 'dependabot.yml'), 'utf8');
  return text
    .split(/\n {2}- (?=package-ecosystem:)/)
    .slice(1)
    .map(b => ({
      ecosystem: b.match(/^package-ecosystem: (\S+)/)?.[1],
      ordner: b.match(/\n {4}directory: (\S+)/)?.[1],
      text: b,
    }));
}

// Dependabot only reads .github/dependabot.yml; Renovate never ran (no app, no PR since
// 2 November) and besides it opened every update twice.
// Counter-checks (measured 14.11.2026, each individually): npm entry deleted → red „npm …
// hält niemand aktuell“; `cooldown` deleted for the npm entry → red „ohne Wartezeit“;
// renovate.json created again → red „nur ein Werkzeug“; the postgres exception deleted →
// red „Hauptversion“.
test('Dependabot maintains npm, Gradle, images and actions from the root configuration', () => {
  const eintraege = dependabot();
  const finde = (oe, ordner) => eintraege.find(e => e.ecosystem === oe && e.ordner === ordner);
  for (const [oe, ordner] of [
    ['npm', '/Web-App'],
    // The name assembled: abgleich-baumbruecken reads every mention as a path into the tree.
    ['gradle', `/${'Android'}-App`],
    ['docker', '/Web-App'],
    ['docker-compose', '/Web-App'],
    ['github-actions', '/'],
  ]) {
    const e = finde(oe, ordner);
    assert.ok(e, `${oe} in ${ordner}: hält niemand aktuell`);
    assert.match(e.text, /interval: weekly/, `${oe}: wöchentlich`);
    assert.match(e.text, /open-pull-requests-limit: [1-5]\b/, `${oe}: offene PRs begrenzt`);
  }
  for (const oe of ['npm', 'gradle'])
    assert.match(
      eintraege.find(e => e.ecosystem === oe).text,
      /\n {4}cooldown:\s*\n\s*default-days: [1-9]/,
      `${oe}: neue Fassungen ohne Wartezeit`,
    );
  assert.match(
    finde('docker-compose', '/Web-App').text,
    /dependency-name: postgres\s*\n\s*update-types: \[version-update:semver-major\]/,
    'eine PostgreSQL-Hauptversion braucht einen Umzug der Daten, kein stilles Update',
  );
  const renovate = [];
  (function lauf(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', '.claude', 'build', '.gradle', 'dist'].includes(e.name)) continue;
      const voll = path.join(dir, e.name);
      if (e.isDirectory()) lauf(voll);
      else if (/^renovate\.json5?$|^\.renovaterc/.test(e.name)) renovate.push(path.relative(WURZEL, voll));
    }
  })(WURZEL);
  assert.deepEqual(renovate, [], 'nur ein Werkzeug: Renovate neben Dependabot öffnete jede Aktualisierung doppelt');
});

/** The `run:` block of the step with `id: <id>`, without indentation. */
function stepScript(yml, id) {
  const z = yml.split('\n');
  const i = z.findIndex(l => l.trim() === `id: ${id}`);
  const r = z.findIndex((l, j) => j > i && /^\s+run: \|\s*$/.test(l));
  const tief = z[r + 1]?.match(/^\s*/)?.[0].length ?? 0;
  const ende = z.findIndex((l, j) => j > r && l.trim() && (l.match(/^\s*/)?.[0].length ?? 0) < tief);
  return z
    .slice(r + 1, ende < 0 ? undefined : ende)
    .map(l => l.slice(tief))
    .join('\n');
}

// Counter-checks (measured 02.11.2026): in the sed pattern `@sha256` replaced
// by `@sha512` → red (exit 1, „Kein Image per Digest gefunden“); (14.11.2026) the entry
// `docker-compose` deleted in dependabot.yml → red „docker-compose: … ohne Update-Pfad“;
// `matrix.image` in the Trivy job replaced by a fixed image → red.
test('the images from compose.yaml have an update path and go through Trivy', () => {
  const yml = fs.readFileSync(path.join(REAL_LOCATION, 'sicherheit.yml'), 'utf8');
  const ort = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'compose-images-'));
  fs.mkdirSync(path.join(ort, 'Web-App'));
  fs.copyFileSync(path.join(WURZEL, 'Web-App', 'compose.yaml'), path.join(ort, 'Web-App', 'compose.yaml'));
  const output = path.join(ort, 'ausgabe');
  const r = spawnSync('bash', ['-e', '-c', stepScript(yml, 'lesen')], {
    cwd: ort,
    env: { ...process.env, GITHUB_OUTPUT: output },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const images = JSON.parse(fs.readFileSync(output, 'utf8').match(/^images=(.*)$/m)?.[1] ?? '[]');
  fs.rmSync(ort, { recursive: true, force: true });
  // Caddy builds compose.yaml itself (Dockerfile.caddy), also for caddy-rechte; pgweb no longer exists.
  assert.deepEqual(images.map(i => i.split(':')[0]).sort(), ['postgres']);
  assert.ok(
    images.every(i => /@sha256:[0-9a-f]{64}$/.test(i)),
    images.join(', '),
  );

  const trivy = yml.slice(yml.indexOf('\n  trivy-compose:'), yml.indexOf('\n  zap:'));
  assert.match(trivy, /matrix:\s*\n\s*image: \$\{\{ fromJSON\(needs\.compose-images\.outputs\.images\) \}\}/);
  assert.match(trivy, /image-ref: \$\{\{ matrix\.image \}\}/);
  // Digests in compose.yaml and Dockerfile, SHAs of the actions: Dependabot updates them.
  for (const oe of ['docker-compose', 'docker', 'github-actions'])
    assert.ok(
      dependabot().some(e => e.ecosystem === oe),
      `${oe}: Digests und Action-SHAs stehen ohne Update-Pfad fest`,
    );
  // Counter-check (measured 03.11.2026): exit-code '0' again → red „nicht scharf".
  assert.match(trivy, /exit-code: '1'/, 'Trivy für die Betriebs-Images ist nicht scharf');
  const liste = trivy.match(/trivyignores: (\S+)/)?.[1];
  assert.ok(liste && fs.existsSync(path.join(WURZEL, liste)), `Ausnahmeliste fehlt: ${liste}`);
});

// Counter-check (measured 03.11.2026): persist-credentials deleted in the checkout of
// web-ci.yml → red, the list names „web-ci.yml:test".
test('checkouts keep no credentials, except where the job writes', () => {
  const ohne = [];
  for (const datei of fs.readdirSync(REAL_LOCATION).filter(n => n.endsWith('.yml'))) {
    const z = fs.readFileSync(path.join(REAL_LOCATION, datei), 'utf8').split('\n');
    let job = '';
    z.forEach((l, i) => {
      job = l.match(/^ {2}([\w-]+):\s*$/)?.[1] ?? job;
      if (/uses: actions\/checkout@/.test(l) && !/persist-credentials: false/.test(z.slice(i + 1, i + 6).join('\n')))
        ohne.push(`${datei}:${job}`);
    });
  }
  assert.deepEqual(ohne.sort(), ['android.yml:bildschirmfotos-einchecken', 'android.yml:pruefsummen-vorschlagen']);
});

// Counter-checks (measured 03.11.2026, each individually): `provenance: mode=max`
// deleted → red „… Herkunft beim Bau“; the step „Herkunft bescheinigen“
// deleted → red „… attest-build-provenance“; `attestations: write` deleted
// → red „… darf Nachweise ablegen“.
test('the image carries provenance and bill of materials, attested on the signed digest', () => {
  const yml = fs
    .readFileSync(path.join(REAL_LOCATION, 'docker-publish.yml'), 'utf8')
    .split('\n')
    .filter(l => !/^\s*#/.test(l))
    .join('\n');
  const bau = yml.split(/\n {2}build:\n/)[1].split(/\n {2}merge:\n/)[0];
  assert.match(bau, /^\s+provenance: mode=max\s*$/m, 'keine Herkunft beim Bau');
  assert.match(
    bau,
    /^\s+sbom: generator=docker\/buildkit-syft-scanner:[\d.]+@sha256:[0-9a-f]{64}\s*$/m,
    'keine Stückliste beim Bau oder ihr Scanner nicht per Digest',
  );
  const merge = yml.split(/\n {2}merge:\n/)[1];
  assert.match(
    merge,
    /permissions:\s*\n\s+contents: read\s*\n\s+id-token: write\s*\n\s+attestations: write/,
    'der Merge-Job darf Nachweise ablegen',
  );
  assert.match(merge, /uses: actions\/attest-build-provenance@[0-9a-f]{40}/, 'attest-build-provenance fehlt');
  assert.match(merge, /uses: actions\/attest-sbom@[0-9a-f]{40}/, 'attest-sbom fehlt');
  assert.match(merge, /npm sbom --omit=dev --package-lock-only --sbom-format=cyclonedx/);
  // Exactly the digest that cosign signed is attested.
  assert.equal([...merge.matchAll(/subject-digest: \$\{\{ steps\.signatur\.outputs\.digest \}\}/g)].length, 2);
  assert.match(merge, /- name: Image signieren\s*\n\s+id: signatur/);
});

// Counter-checks (measured 05.11.2026, each individually): in the publish build `no-cache:
// true` replaced by `cache-from: type=gha,…` → red „der signierte Bau liest
// keinen Cache“; in the Trivy step before the signature a different action → red
// „Trivy prüft den Digest, bevor er signiert wird“; `npm audit signatures` deleted
// from web-ci → red „… nach npm ci“; in the job trivy-eigenbau
// `trivyignores:` added → red „Caddy wird ohne Ausnahmen geprüft“.
test('the signed build without cache, Trivy before the signature, package signatures in CI', () => {
  const withoutComment = t =>
    t
      .split('\n')
      .filter(l => !/^\s*#/.test(l))
      .join('\n');
  const pub = withoutComment(fs.readFileSync(path.join(REAL_LOCATION, 'docker-publish.yml'), 'utf8'));
  assert.doesNotMatch(pub, /cache-(from|to)|type=gha/, 'der signierte Bau liest keinen Cache');
  const bau = pub.split(/\n {2}build:\n/)[1].split(/\n {2}merge:\n/)[0];
  assert.match(bau, /^\s+no-cache: true\s*$/m, 'der signierte Bau liest keinen Cache');
  const merge = pub.split(/\n {2}merge:\n/)[1];
  const trivy = merge.indexOf('uses: aquasecurity/trivy-action@'),
    signieren = merge.indexOf('cosign sign ');
  assert.ok(trivy > 0 && signieren > trivy, 'Trivy prüft den Digest, bevor er signiert wird');
  const schritt = merge.slice(trivy, merge.indexOf('\n      - ', trivy));
  assert.match(schritt, /image-ref: \$\{\{ env\.IMAGE \}\}@\$\{\{ steps\.manifest\.outputs\.digest \}\}/);
  assert.match(schritt, /exit-code: '1'/);
  assert.match(schritt, /severity: HIGH,CRITICAL/);

  const ci = withoutComment(fs.readFileSync(path.join(REAL_LOCATION, 'web-ci.yml'), 'utf8'));
  const ci0 = ci.indexOf('npm ci --ignore-scripts'),
    sig = ci.indexOf('run: npm audit signatures');
  assert.ok(ci0 > 0 && sig > ci0, 'npm audit signatures läuft nach npm ci');

  const sich = withoutComment(fs.readFileSync(path.join(REAL_LOCATION, 'sicherheit.yml'), 'utf8'));
  const eigen = sich.slice(sich.indexOf('\n  trivy-eigenbau:'), sich.indexOf('\n  zap:'));
  assert.match(eigen, /docker build -f Web-App\/Dockerfile\.caddy /);
  assert.match(eigen, /exit-code: '1'/);
  assert.doesNotMatch(eigen, /trivyignores/, 'Caddy wird ohne Ausnahmen geprüft');
  const exceptions = fs.readFileSync(path.join(WURZEL, '.github', 'trivy-betrieb.yaml'), 'utf8');
  assert.doesNotMatch(exceptions, /^\s*# (caddy|pgweb)/m, 'Caddy oder pgweb mit hingenommenen Lücken');
});

/** The entries of .github/trivy-betrieb.yaml (only the form the file uses). */
function trivyExceptions(roh) {
  assert.match(roh, /^vulnerabilities:\s*$/m, 'kein Abschnitt vulnerabilities');
  return roh
    .split(/\n {2}- id: /)
    .slice(1)
    .map(block => {
      const zeilen = block.split('\n').filter(z => !/^\s*#/.test(z));
      const e = { id: zeilen[0].trim(), paths: [], purls: [], expired_at: null, statement: null };
      let liste = null;
      for (const z of zeilen.slice(1)) {
        const k = z.match(/^ {4}(\w+):\s*(.*)$/);
        if (k) {
          liste = k[2] === '' ? k[1] : null;
          if (k[2] !== '') e[k[1]] = k[2].replace(/^"(.*)"$/, '$1');
          continue;
        }
        const w = z.match(/^ {6}- "([^"]+)"$/);
        if (w && liste) e[liste].push(w[1]);
      }
      return e;
    });
}

// Counter-checks (measured 11.11.2026, each individually): for CVE-2026-9947 `purls:` with
// entries deleted → red „… an keine Datei und kein Paket gebunden“; in
// sicherheit.yml again `trivyignores: .github/trivy-operation.ignore` → red
// „trivy-compose liest die YAML-Ausnahmen“; for CVE-2025-61726 `expired_at`
// deleted → red „… ohne Ablaufdatum“.
test('Trivy exceptions of the operations images: bound to file or package, with deadline and reason', () => {
  const roh = fs.readFileSync(path.join(WURZEL, '.github', 'trivy-betrieb.yaml'), 'utf8');
  const liste = trivyExceptions(roh);
  assert.ok(liste.length >= 40, `nur ${liste.length} Ausnahmen gelesen — greift der Leser noch?`);
  const ids = liste.map(e => e.id);
  assert.deepEqual(
    ids.filter((x, i) => ids.indexOf(x) !== i),
    [],
    'doppelte Ausnahme',
  );
  for (const e of liste) {
    assert.match(e.id, /^CVE-\d{4}-\d+$/);
    assert.match(e.expired_at ?? '', /^\d{4}-\d{2}-\d{2}$/, `${e.id} ohne Ablaufdatum`);
    assert.ok((e.statement ?? '').length > 20, `${e.id} ohne Grund`);
    assert.ok(e.paths.length + e.purls.length > 0, `${e.id} ist an keine Datei und kein Paket gebunden`);
    for (const p of e.purls)
      assert.match(p, /^pkg:apk\/alpine\/[a-z0-9.+-]+$/, `${e.id}: ${p} ist kein Alpine-Paket ohne Fassung`);
    for (const p of e.paths) assert.doesNotMatch(p, /^\/|\*/, `${e.id}: ${p} ist kein fester Pfad im Image`);
  }
  // gosu is the only Go program in the Postgres image; its exceptions apply only there.
  assert.ok(
    liste.some(e => e.paths.includes('usr/local/bin/gosu')),
    'keine Ausnahme für gosu',
  );

  // trivy-action passes exactly ONE .yaml file through as TRIVY_IGNOREFILE; several or mixed abort.
  const sich = fs.readFileSync(path.join(REAL_LOCATION, 'sicherheit.yml'), 'utf8');
  assert.match(
    jobOf(sich, 'trivy-compose'),
    /^\s+trivyignores: \.github\/trivy-betrieb\.yaml\s*$/m,
    'trivy-compose liest die YAML-Ausnahmen',
  );
  assert.ok(
    !fs.existsSync(path.join(WURZEL, '.github', 'trivy-betrieb.ignore')),
    'die alte Liste ohne Paketbindung liegt noch da',
  );
});

// ── Android-Release (sec17) ──────────────────────────────────────────────────

/** The run block of a step, looked up by its name. */
function stepAfter(yml, name) {
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

/** A job without comment lines, from its header line to the next job. */
function jobOf(yml, name) {
  const ohne = yml
    .split('\n')
    .filter(z => !z.trimStart().startsWith('#'))
    .join('\n');
  const teil = ohne.split(new RegExp(`\\n  ${name}:\\n`))[1];
  assert.ok(teil, `Job ${name} fehlt`);
  return teil.split(/\n {2}[\w-]+:\n/)[0];
}

/** Runs [skript] in bash, with a `gh` stand-in that asks [antworten] per call. */
function withGh(t, script, antworten, env = {}) {
  const ort = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'gh-ersatz-'));
  t.after(() => fs.rmSync(ort, { recursive: true, force: true }));
  const regeln = Object.entries(antworten)
    .map(([muster, aus]) => `  *'${muster}'*) printf '%s' '${aus.replace(/'/g, `'\\''`)}' ;;`)
    .join('\n');
  fs.writeFileSync(
    path.join(ort, 'gh'),
    `#!/bin/bash\ncase "$*" in\n${regeln}\n  *) echo "unbekannt: $*" >&2; exit 9 ;;\nesac\n`,
    { mode: 0o755 },
  );
  return spawnSync('bash', ['-e', '-c', script], {
    cwd: ort,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${ort}:${process.env.PATH}`,
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_SHA: 'a'.repeat(40),
      ...env,
    },
  });
}

// Counter-checks (measured 05.11.2026, each individually): in the build job `cache-disabled` deleted →
// red „Etiketten bauen ohne Cache“; in the counter-check job `cache-read-only` deleted → red
// „… schreibt den Gradle-Cache“.
test('tags build without Gradle cache, and only the build job writes it (sec17 M1)', () => {
  const android = fs.readFileSync(path.join(REAL_LOCATION, 'android.yml'), 'utf8');
  const bau = jobOf(android, 'build');
  assert.match(
    bau,
    /setup-gradle@[0-9a-f]{40}[^\n]*\n\s+with:\n\s+cache-disabled: \$\{\{ startsWith\(github\.ref, 'refs\/tags\/android-v'\) \}\}/,
    'Etiketten bauen ohne Cache',
  );
  assert.match(
    bau,
    /if: startsWith\(github\.ref, 'refs\/tags\/android-v'\)\n\s+run: echo "GRADLE_USER_HOME=\$RUNNER_TEMP\/[\w-]+" >> "\$GITHUB_ENV"/,
    'Etiketten bauen mit leerem Gradle-Benutzerverzeichnis',
  );
  for (const datei of ['android.yml', 'sicherheit.yml']) {
    const yml = fs.readFileSync(path.join(REAL_LOCATION, datei), 'utf8');
    const jobs = [...yml.matchAll(/\n {2}([\w-]+):\n/g)].map(m => m[1]).filter(j => j !== 'build');
    for (const job of jobs.filter(j => /setup-gradle@/.test(jobOf(yml, j))))
      assert.match(
        jobOf(yml, job),
        /setup-gradle@[0-9a-f]{40}[^\n]*\n(?:\s+if: [^\n]+\n)?\s+with:\n\s+cache-read-only: true/,
        `${datei}:${job} schreibt den Gradle-Cache`,
      );
  }
});

// Counter-checks (measured 05.11.2026): `exit-code: '1'` of the Android check to '0' → red
// „… sperrt nicht“; the step „Abhängigkeiten ohne bekannte Lücke“ deleted → red
// „… ohne grüne Lückenprüfung“; a red job in the gh stand-in → red „ein roter …“.
test("the app's vulnerability check blocks, and without it no tag is signed (sec17 M2)", t => {
  const sicherheit = fs.readFileSync(path.join(REAL_LOCATION, 'sicherheit.yml'), 'utf8');
  const job = jobOf(sicherheit, 'android-abhaengigkeiten');
  assert.doesNotMatch(job.split('\n    steps:')[0], /continue-on-error/, 'der ganze Job darf nicht rot werden dürfen');
  const check = job.split('- name: Bekannte Lücken')[1].split('- name: ')[0];
  assert.match(check, /exit-code: '1'/, 'die Lückenprüfung der App sperrt nicht');
  assert.match(check, /severity: HIGH,CRITICAL/);
  assert.match(check, /ignore-unfixed: true/);
  assert.match(job, /log4j-core:2\.14\.1/, 'die Gegenprobe mit einer bekannt verwundbaren Fassung fehlt');
  assert.match(job, /steps\.gegenprobe\.outcome/);
  const liste = check.match(/trivyignores: (\S+)/)?.[1];
  assert.ok(liste && fs.existsSync(path.join(WURZEL, liste)), `Ausnahmeliste fehlt: ${liste}`);
  const zeilen = fs.readFileSync(path.join(WURZEL, liste), 'utf8').split('\n');
  zeilen.forEach((z, i) => {
    if (!z.trim() || z.startsWith('#')) return;
    assert.match(z, /^CVE-\d{4}-\d+ exp:\d{4}-\d{2}-\d{2}$/, `Ausnahme ohne Ablaufdatum: ${z}`);
    assert.match(zeilen[i - 1] ?? '', /^# \S.{10,}/, `Ausnahme ohne Grund darüber: ${z}`);
  });
  const name = sicherheit.match(/\n {2}android-abhaengigkeiten:\n {4}name: ([^\n]+)/)[1];
  const release = fs.readFileSync(path.join(REAL_LOCATION, 'android-release.yml'), 'utf8');
  const script = stepAfter(release, 'Abhängigkeiten ohne bekannte Lücke');
  assert.match(script, /workflows\/sicherheit\.yml\/runs\?head_sha=\$COMMIT/, 'Etikett ohne grüne Lückenprüfung');
  assert.ok(name.startsWith('Trivy (Android-Abhängigkeiten'), `Jobname „${name}“ passt nicht zur Abfrage`);
  const lauf = conclusion =>
    withGh(
      t,
      script,
      {
        'workflows/sicherheit.yml/runs': '17',
        'actions/runs/17/jobs': conclusion,
      },
      { COMMIT: 'a'.repeat(40) },
    );
  assert.equal(lauf('success').status, 0, 'ein grüner Lauf gibt frei');
  assert.notEqual(lauf('failure').status, 0, 'ein roter Lauf sperrt');
  assert.notEqual(lauf('fehlt').status, 0, 'ohne den Job sperrt es');
});

// Counter-checks (measured 11.11.2026, each individually): in the step „main ist geschützt“ the loop
// deleted → red „ohne PR-Pflicht …“; the check of can_admins_bypass deleted → red
// „… umgehen …“; `tag:android-v*` as allowed rule again → red „… nur der Zweig main“; the
// comparison `$COMMIT != $LAUF_COMMIT` deleted → red „ein Etikett auf einem anderen Commit …“;
// the name check `^android-v…$` deleted → red „ein Name mit Sonderzeichen …“; in
// „Prüfsummen aus der Übergabe“ the selection of the handover job replaced by `true` → red „die
// Anmerkung eines anderen Jobs …“. The gh stand-in evaluates no --jq: the count of
// annotations (`if length == 1`) is not checked by this test.
test('signing happens only with protected main, from main, for a real tag and without bypass by administrators (sec17 B1, B3)', t => {
  const release = fs.readFileSync(path.join(REAL_LOCATION, 'android-release.yml'), 'utf8');
  const main = stepAfter(release, 'main ist geschützt');
  const regeln = arten => withGh(t, main, { 'rules/branches/main': arten }).status;
  assert.equal(regeln('non_fast_forward,pull_request,required_status_checks'), 0);
  assert.notEqual(regeln('non_fast_forward,required_status_checks'), 0, 'ohne PR-Pflicht wird nicht signiert');
  assert.notEqual(regeln('pull_request'), 0, 'ohne Pflicht-Checks wird nicht signiert');
  const signieren = fs.readFileSync(path.join(REAL_LOCATION, 'android-signieren.yml'), 'utf8');
  const environment = stepAfter(signieren, 'Environment ist geschützt');
  const env = (bypass, regel = 'branch:main') =>
    withGh(
      t,
      environment,
      {
        'environments/release/deployment-branch-policies': regel,
        'environments/release': JSON.stringify({
          can_admins_bypass: bypass,
          deployment_branch_policy: { custom_branch_policies: true },
          protection_rules: [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [{}] }],
        }),
      },
      { UMGEBUNG: 'release' },
    ).status;
  assert.equal(env(false), 0);
  assert.notEqual(env(true), 0, 'Administratoren dürfen die Freigabe nicht umgehen');
  assert.notEqual(
    env(false, 'tag:android-v*'),
    0,
    'ein Etikett mit eigenem Workflow käme an die Schlüssel: nur der Zweig main',
  );
  assert.notEqual(env(false, 'branch:main,tag:android-v*'), 0, 'nur der Zweig main');

  const etikett = stepAfter(release, 'Etikett zeigt auf den gebauten Commit');
  const c = 'c'.repeat(40);
  const output = t2 => {
    const f = path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'aus-')), 'o');
    fs.writeFileSync(f, '');
    t2.after(() => fs.rmSync(path.dirname(f), { recursive: true, force: true }));
    return f;
  };
  const pruefe = (name, ziel, extra = {}) => {
    const o = output(t);
    const r = withGh(
      t,
      etikett,
      { [`git/ref/tags/${name}`]: `commit ${ziel}` },
      { GITHUB_OUTPUT: o, EINGABE: '', AUS_LAUF: name, LAUF_COMMIT: c, LAUF_ID: '99', ...extra },
    );
    return { status: r.status, aus: fs.readFileSync(o, 'utf8') };
  };
  const gut = pruefe('android-v2026.11.12', c);
  assert.equal(gut.status, 0, 'ein Etikett auf dem gebauten Commit gilt');
  assert.match(gut.aus, new RegExp(`^commit=${c}$`, 'm'));
  assert.match(gut.aus, /^lauf=99$/m);
  assert.notEqual(
    pruefe('android-v2026.11.12', 'd'.repeat(40)).status,
    0,
    'ein Etikett auf einem anderen Commit gilt nicht',
  );
  assert.notEqual(pruefe('android-v1;x', c).status, 0, 'ein Name mit Sonderzeichen gilt nicht');
  assert.notEqual(
    withGh(
      t,
      etikett,
      {},
      { GITHUB_OUTPUT: output(t), EINGABE: '', AUS_LAUF: 'android-v9', LAUF_COMMIT: c, LAUF_ID: '99' },
    ).status,
    0,
    'ohne Etikett (etwa nur ein Zweig des Namens) gilt nichts',
  );

  const sums = stepAfter(release, 'Prüfsummen aus der Übergabe');
  assert.match(
    sums,
    /select\(\.name == "Übergabe an das Signieren" and \.conclusion == "success"\)/,
    'die Anmerkung eines anderen Jobs zählt nicht',
  );
  const android = fs.readFileSync(path.join(REAL_LOCATION, 'android.yml'), 'utf8');
  assert.match(
    jobOf(android, 'uebergabe'),
    /^ {4}name: Übergabe an das Signieren$/m,
    'der Name des Übergabejobs passt nicht zur Abfrage',
  );
  assert.match(
    stepAfter(android, 'Prüfsummen des Baujobs bezeugen'),
    /::notice title=Prüfsummen zum Signieren::apk=\$APK_SOLL aab=\$AAB_SOLL/,
  );
  const a = 'a'.repeat(64),
    b = 'b'.repeat(64);
  const lies = (jobs, notiz) => {
    const o = output(t);
    const r = withGh(
      t,
      sums,
      { 'actions/runs/99/jobs': jobs, 'check-runs/55/annotations': notiz },
      { GITHUB_OUTPUT: o, LAUF: '99' },
    );
    return { status: r.status, aus: fs.readFileSync(o, 'utf8') };
  };
  const ok = lies('55', `apk=${a} aab=${b}`);
  assert.equal(ok.status, 0);
  assert.match(ok.aus, new RegExp(`^sha256_apk=${a}\\nsha256_aab=${b}$`, 'm'));
  assert.notEqual(lies('55 56', `apk=${a} aab=${b}`).status, 0, 'zwei Übergaben gelten nicht');
  assert.notEqual(lies('55', '').status, 0, 'ohne Anmerkung gilt nichts');
  assert.notEqual(lies('55', `apk=${a} aab=${b}; rm`).status, 0, 'eine verunstaltete Anmerkung gilt nicht');
});

// Counter-checks (measured 05.11.2026): the checksum step deleted in the release job → red
// „vor dem Veröffentlichen …“; in android-bescheinigung.yml `sha256sum -c -` replaced by
// `cat > /dev/null` → red „ein verändertes Byte …“.
test('only what the signing job output is published and attested (sec17 B-N1, B-N7)', t => {
  const android = fs.readFileSync(path.join(REAL_LOCATION, 'android-release.yml'), 'utf8');
  const bescheinigung = fs.readFileSync(path.join(REAL_LOCATION, 'android-bescheinigung.yml'), 'utf8');
  const release = jobOf(android, 'release');
  assert.match(
    release,
    /- name: Artefakt gegen die Prüfsummen des Signierjobs/,
    'vor dem Veröffentlichen fehlt der Vergleich',
  );
  assert.doesNotMatch(release, /attest-build-provenance|id-token: write/, 'der Release-Job bescheinigt nicht selbst');
  assert.match(release, /needs: \[etikett, signieren, bescheinigen\]/);
  assert.match(jobOf(android, 'bescheinigen'), /uses: \.\/\.github\/workflows\/android-bescheinigung\.yml/);
  assert.match(bescheinigung, /\non:\n {2}workflow_call:\n/);
  assert.doesNotMatch(
    bescheinigung,
    /\n {2}(push|pull_request|workflow_dispatch):/,
    'nur als wiederverwendbarer Workflow',
  );
  for (const datei of ['apk/release/BrickInventory.apk', 'version-signiert.json', 'bundle/release/app-release.aab'])
    assert.match(
      bescheinigung.split('subject-path:')[1],
      new RegExp(datei.replace(/[./]/g, '\\$&')),
      `${datei} wird nicht bescheinigt`,
    );

  const ort = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'signiert-'));
  t.after(() => fs.rmSync(ort, { recursive: true, force: true }));
  const inhalt = {
    'apk/release/BrickInventory.apk': 'apk',
    'version-signiert.json': '{}',
    'bundle/release/app-release.aab': 'aab',
  };
  const summe = s => require('node:crypto').createHash('sha256').update(s).digest('hex');
  for (const [d, s] of Object.entries(inhalt)) {
    fs.mkdirSync(path.join(ort, 'signiert', path.dirname(d)), { recursive: true });
    fs.writeFileSync(path.join(ort, 'signiert', d), s);
  }
  const env = { RUNNER_TEMP: ort, APK_SOLL: summe('apk'), BESCHREIBUNG_SOLL: summe('{}'), AAB_SOLL: summe('aab') };
  const script = stepAfter(bescheinigung, 'Gegen die Prüfsummen des Signierjobs');
  const lauf = () =>
    spawnSync('bash', ['-e', '-c', script], { cwd: ort, encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(lauf().status, 0, lauf().stdout + lauf().stderr);
  fs.writeFileSync(path.join(ort, 'signiert', 'version-signiert.json'), '{ }');
  assert.notEqual(lauf().status, 0, 'ein verändertes Byte wird bescheinigt');
});
