/**
 * A workflow that is not in the root directory NEVER runs.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT_CERT = path.join(__dirname, '..', '..');
const REAL_LOCATION = path.join(ROOT_CERT, '.github', 'workflows');

/** All `.github/workflows` folders in the tree, without node_modules and .git. */
function workflowFolder(start) {
  const found = [];
  // .claude: local working copies (git worktree) of the tools, not part of the repository.
  const skipped = new Set(['node_modules', '.git', 'dist', 'build', '.gradle', '.claude']);
  (function run(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || skipped.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.name === 'workflows' && path.basename(dir) === '.github') found.push(full);
      else run(full);
    }
  })(start);
  return found;
}

test('every workflow is where GitHub reads it', () => {
  const folder = workflowFolder(ROOT_CERT);

  // Self-proof 1: the walk really searched and found the real
  // place. Without that a broken pattern could wave everything through.
  assert.ok(
    folder.includes(REAL_LOCATION),
    `The pass did not find ${REAL_LOCATION} — then it checks nothing. ` + `Found: ${JSON.stringify(folder)}`,
  );

  const beside = folder.filter(o => o !== REAL_LOCATION);
  assert.deepEqual(
    beside,
    [],
    'These workflow folders are NOT in the root directory and are never read by ' +
      'GitHub:\n  ' +
      beside.join('\n  ') +
      '\nThat is exactly how ci.yml sat in Web-App/.github/workflows for months and ' +
      'never ran a single time.',
  );
});

test('the root directory contains the workflows that should exist', () => {
  const files = fs
    .readdirSync(REAL_LOCATION)
    .filter(f => /\.ya?ml$/.test(f))
    .sort();

  // Self-proof 2: a minimum count instead of an enumeration. If the folder
  // vanished or the pattern did not match, the list would be empty — and the
  // check below would have nothing to say.
  assert.ok(files.length >= 3, `Only ${files.length} workflows in the root directory: ${files.join(', ')}`);

  // The web run must be included. It is the only one that runs the test
  // suite — without it NO run checks the web app.
  assert.ok(files.includes('web-ci.yml'), `The web CI run is missing. Present: ${files.join(', ')}`);
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
      const [, action, variant] = m;
      if (!versions.has(action)) versions.set(action, new Map());
      const per = versions.get(action);
      if (!per.has(variant)) per.set(variant, []);
      if (!per.get(variant).includes(f)) per.get(variant).push(f);
    }
  }

  // Self-proof 3: without found actions the loop below is empty.
  assert.ok(versions.size >= 8, `Only ${versions.size} actions found — pattern outdated?`);
  const multiple = [...versions].filter(([, per]) => [...per.values()].reduce((n, d) => n + d.length, 0) > 1);
  // Lowered from 3 to 2 when android-playstore.yml was removed: with one
  // workflow fewer there is less overlap. MEASURED, there are now
  // actions/checkout@v7 (in all three runs) and actions/upload-artifact@v7
  // (in two) — both uniform, so the check below still applies to
  // exactly the cases that matter.
  assert.ok(
    multiple.length >= 2,
    `Only ${multiple.length} actions appear in more than one place — then ` + 'this check cannot find anything.',
  );

  const disagreeing = [...versions]
    .filter(([, per]) => per.size > 1)
    .map(([action, per]) => `${action}: ` + [...per].map(([v, d]) => `${v} (${d.join(', ')})`).join(' vs. '));
  assert.deepEqual(disagreeing, [], 'The same action appears in two versions:\n  ' + disagreeing.join('\n  '));
});

test('a run that executes tests runs on EVERY branch', () => {
  // Why
  const TEST_COMMANDS = [/npm\s+test/, /testDebugUnitTest/];

  const checking = [];
  for (const f of fs.readdirSync(REAL_LOCATION).filter(f => /\.ya?ml$/.test(f))) {
    const raw = fs.readFileSync(path.join(REAL_LOCATION, f), 'utf8');
    // Comment lines out: the explanation blocks of these files contain the
    // test commands as prose, and a workflow would otherwise count as
    // "checking" merely because it WRITES about checking.
    const yml = raw
      .split('\n')
      .filter(z => !z.trimStart().startsWith('#'))
      .join('\n');
    if (TEST_COMMANDS.some(r => r.test(yml))) checking.push([f, yml]);
  }

  // Self-proof: there are at least the two — web and Android. If the pattern
  // found none, the loop below would be empty and the check silently green.
  assert.ok(
    checking.length >= 2,
    `Only ${checking.length} test-running workflows found — pattern outdated? ` +
      'Without a hit the rest of this test checks nothing.',
  );

  const eng = [];
  for (const [f, yml] of checking) {
    // The `branches:` entry UNDER `push:` — not the one under `pull_request:`
    // and not any one further down in the text.
    const push = yml.match(/\n\s*push:\s*\n((?:\s{4,}.*\n|\s*\n)*)/);
    if (!push) continue; // pure publishing run — see above
    const branches = push[1].match(/branches(?:-ignore)?:\s*(.+)/);
    // No branches entry means on GitHub: all branches. That is allowed.
    if (!branches) continue;
    if (!branches[1].includes('**')) eng.push(`${f}: push nur auf ${branches[1].trim()}`);
  }

  assert.deepEqual(
    eng,
    [],
    'These workflows run tests but do not run on every branch push:\n  ' +
      eng.join('\n  ') +
      '\nSo their finding only comes after merging — that is exactly how ' +
      'three red Android runs stayed unnoticed on the branch.',
  );
});

// Counter-checks (measured 28.10.2026): the line with `head_repository` deleted
// from the `if:` of the check job → red „… fremdes Repository …“; an
// action again as `@v7` instead of by SHA → red „… per Commit-SHA …“.
test('the Docker image only results from a push to main of this repository', () => {
  const yml = fs.readFileSync(path.join(REAL_LOCATION, 'docker-publish.yml'), 'utf8');
  const job = yml.split(/\n {2}pruefen:\n/)[1]?.split(/\n {4}steps:\n/)[0] ?? '';
  assert.match(job, /\n {4}if: /, 'the check job has no if:');
  assert.match(job, /workflow_run\.event == 'push'/, 'a PR run of the CI must not trigger an image');
  assert.match(job, /workflow_run\.head_branch == 'main'/);
  assert.match(
    job,
    /workflow_run\.head_repository\.full_name == github\.repository/,
    'a foreign repository (fork) must not trigger an image',
  );
});

// Counter-check (measured 01.11.2026): `--no-build-cache` deleted from „Release bauen“
// → red „… ohne Build-Cache …“.
test('the release APK is built without a build cache', () => {
  const yml = fs.readFileSync(path.join(REAL_LOCATION, 'android.yml'), 'utf8');
  const step = yml.split(/\n {6}- name: Release bauen\n/)[1]?.split(/\n {6}- name: /)[0] ?? '';
  const calls = step.split('\n').filter(z => !z.trimStart().startsWith('#') && /gradlew/.test(z));
  assert.ok(calls.length > 0, 'step „Release bauen“ with gradlew not found');
  for (const z of calls) assert.match(z, /--no-build-cache/, `build the release without build cache: ${z.trim()}`);
});

test('every action is pinned by commit SHA', () => {
  const loose = [];
  for (const f of fs.readdirSync(REAL_LOCATION).filter(n => n.endsWith('.yml'))) {
    const lines = fs.readFileSync(path.join(REAL_LOCATION, f), 'utf8').split('\n');
    lines.forEach((z, i) => {
      const m = z.match(/^\s*-?\s*uses:\s*([^\s#]+)/);
      // A local workflow (./.github/workflows/…) always runs in the caller's commit.
      if (m && !m[1].startsWith('./.github/workflows/') && !/@[0-9a-f]{40}$/.test(m[1]))
        loose.push(`${f}:${i + 1} ${m[1]}`);
    });
  }
  assert.deepEqual(loose, [], 'A tag can be moved; only a SHA is fixed. Not pinned by commit SHA:');
});

// Counter-checks (measured 30.10.2026): `security-events: write` moved to the
// top level → red „security-events: write darf nur der CodeQL-Job
// haben“; the Kotlin line of the
// matrix removed → red „CodeQL prüft java-kotlin nicht“.
test('the security run checks code, dependencies, image and the running server', () => {
  const raw = fs.readFileSync(path.join(REAL_LOCATION, 'sicherheit.yml'), 'utf8');
  const yml = raw
    .split('\n')
    .filter(z => !z.trimStart().startsWith('#'))
    .join('\n');
  const upper = yml.slice(0, yml.indexOf('\njobs:'));
  assert.match(upper, /\npermissions:\n {2}contents: read\n/, 'only contents: read at the top');
  const writing = [...yml.matchAll(/security-events:\s*write/g)].length;
  assert.equal(writing, 1, 'only the CodeQL job may have security-events: write');
  const codeql = yml.slice(yml.indexOf('\n  codeql:'), yml.indexOf('\n  trivy:'));
  assert.match(codeql, /security-events:\s*write/, 'only the CodeQL job may upload findings');
  for (const language of ['javascript-typescript', 'java-kotlin'])
    assert.match(codeql, new RegExp(`sprache: ${language}\\b`), `CodeQL does not check ${language}`);
  const trivy = yml.slice(yml.indexOf('\n  trivy:'), yml.indexOf('\n  zap:'));
  assert.match(trivy, /scan-type: fs/);
  assert.match(trivy, /scan-type: image/);
  const zap = yml.slice(yml.indexOf('\n  zap:'));
  assert.match(zap, /action-baseline@[0-9a-f]{40}/);
  assert.match(zap, /NODE_ENV: production/, 'ZAP does not check the server as it runs in production');
  assert.match(zap, /docker_name: \S+@sha256:[0-9a-f]{64}/, 'the ZAP image is not pinned by digest');
  assert.ok(fs.existsSync(path.join(ROOT_CERT, '.github', 'zap-regeln.tsv')), 'the ZAP rules are missing');
});

/** The entries of .github/dependabot.yml, one block per `- package-ecosystem:`. */
function dependabot() {
  const text = fs.readFileSync(path.join(ROOT_CERT, '.github', 'dependabot.yml'), 'utf8');
  return text
    .split(/\n {2}- (?=package-ecosystem:)/)
    .slice(1)
    .map(b => ({
      ecosystem: b.match(/^package-ecosystem: (\S+)/)?.[1],
      folder: b.match(/\n {4}directory: (\S+)/)?.[1],
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
  const entries = dependabot();
  const findIt = (oe, folder) => entries.find(e => e.ecosystem === oe && e.folder === folder);
  for (const [oe, folder] of [
    ['npm', '/Web-App'],
    // The name assembled: abgleich-baumbruecken reads every mention as a path into the tree.
    ['gradle', `/${'Android'}-App`],
    ['docker', '/Web-App'],
    ['docker-compose', '/Web-App'],
    ['github-actions', '/'],
  ]) {
    const e = findIt(oe, folder);
    assert.ok(e, `${oe} in ${folder}: nobody keeps it up to date`);
    assert.match(e.text, /interval: weekly/, `${oe}: weekly`);
    assert.match(e.text, /open-pull-requests-limit: [1-5]\b/, `${oe}: open PRs limited`);
  }
  for (const oe of ['npm', 'gradle'])
    assert.match(
      entries.find(e => e.ecosystem === oe).text,
      /\n {4}cooldown:\s*\n\s*default-days: [1-9]/,
      `${oe}: new versions without a waiting period`,
    );
  assert.match(
    findIt('docker-compose', '/Web-App').text,
    /dependency-name: postgres\s*\n\s*update-types: \[version-update:semver-major\]/,
    'a PostgreSQL major version needs a data migration, not a silent update',
  );
  const renovate = [];
  (function run(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', '.claude', 'build', '.gradle', 'dist'].includes(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) run(full);
      else if (/^renovate\.json5?$|^\.renovaterc/.test(e.name)) renovate.push(path.relative(ROOT_CERT, full));
    }
  })(ROOT_CERT);
  assert.deepEqual(renovate, [], 'only one tool: Renovate next to Dependabot opened every update twice');
});

/** The `run:` block of the step with `id: <id>`, without indentation. */
function stepScript(yml, id) {
  const z = yml.split('\n');
  const i = z.findIndex(l => l.trim() === `id: ${id}`);
  const r = z.findIndex((l, j) => j > i && /^\s+run: \|\s*$/.test(l));
  const deep = z[r + 1]?.match(/^\s*/)?.[0].length ?? 0;
  const end = z.findIndex((l, j) => j > r && l.trim() && (l.match(/^\s*/)?.[0].length ?? 0) < deep);
  return z
    .slice(r + 1, end < 0 ? undefined : end)
    .map(l => l.slice(deep))
    .join('\n');
}

// Counter-checks (measured 02.11.2026): in the sed pattern `@sha256` replaced
// by `@sha512` → red (exit 1, „Kein Image per Digest gefunden“); (14.11.2026) the entry
// `docker-compose` deleted in dependabot.yml → red „docker-compose: … ohne Update-Pfad“;
// `matrix.image` in the Trivy job replaced by a fixed image → red.
test('the images from compose.yaml have an update path and go through Trivy', () => {
  const yml = fs.readFileSync(path.join(REAL_LOCATION, 'sicherheit.yml'), 'utf8');
  const location = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'compose-images-'));
  fs.mkdirSync(path.join(location, 'Web-App'));
  fs.copyFileSync(path.join(ROOT_CERT, 'Web-App', 'compose.yaml'), path.join(location, 'Web-App', 'compose.yaml'));
  const output = path.join(location, 'ausgabe');
  const r = spawnSync('bash', ['-e', '-c', stepScript(yml, 'lesen')], {
    cwd: location,
    env: { ...process.env, GITHUB_OUTPUT: output },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const images = JSON.parse(fs.readFileSync(output, 'utf8').match(/^images=(.*)$/m)?.[1] ?? '[]');
  fs.rmSync(location, { recursive: true, force: true });
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
      `${oe}: digests and action SHAs are fixed without an update path`,
    );
  // Counter-check (measured 03.11.2026): exit-code '0' again → red „nicht scharf".
  assert.match(trivy, /exit-code: '1'/, 'Trivy for the production images is not enforcing');
  const list = trivy.match(/trivyignores: (\S+)/)?.[1];
  assert.ok(list && fs.existsSync(path.join(ROOT_CERT, list)), `exception list is missing: ${list}`);
});

// Counter-check (measured 03.11.2026): persist-credentials deleted in the checkout of
// web-ci.yml → red, the list names „web-ci.yml:test".
test('checkouts keep no credentials, except where the job writes', () => {
  const without = [];
  for (const file of fs.readdirSync(REAL_LOCATION).filter(n => n.endsWith('.yml'))) {
    const z = fs.readFileSync(path.join(REAL_LOCATION, file), 'utf8').split('\n');
    let job = '';
    z.forEach((l, i) => {
      job = l.match(/^ {2}([\w-]+):\s*$/)?.[1] ?? job;
      if (/uses: actions\/checkout@/.test(l) && !/persist-credentials: false/.test(z.slice(i + 1, i + 6).join('\n')))
        without.push(`${file}:${job}`);
    });
  }
  assert.deepEqual(without.sort(), ['android.yml:pruefsummen-vorschlagen', 'android.yml:screenshots-commit']);
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
  const build = yml.split(/\n {2}build:\n/)[1].split(/\n {2}merge:\n/)[0];
  assert.match(build, /^\s+provenance: mode=max\s*$/m, 'no provenance during the build');
  assert.match(
    build,
    /^\s+sbom: generator=docker\/buildkit-syft-scanner:[\d.]+@sha256:[0-9a-f]{64}\s*$/m,
    'no bill of materials during the build, or its scanner not pinned by digest',
  );
  const merge = yml.split(/\n {2}merge:\n/)[1];
  assert.match(
    merge,
    /permissions:\s*\n\s+contents: read\s*\n\s+id-token: write\s*\n\s+attestations: write/,
    'the merge job may store attestations',
  );
  assert.match(merge, /uses: actions\/attest-build-provenance@[0-9a-f]{40}/, 'attest-build-provenance is missing');
  assert.match(merge, /uses: actions\/attest-sbom@[0-9a-f]{40}/, 'attest-sbom is missing');
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
  assert.doesNotMatch(pub, /cache-(from|to)|type=gha/, 'the signed build reads no cache');
  const build = pub.split(/\n {2}build:\n/)[1].split(/\n {2}merge:\n/)[0];
  assert.match(build, /^\s+no-cache: true\s*$/m, 'the signed build reads no cache');
  const merge = pub.split(/\n {2}merge:\n/)[1];
  const trivy = merge.indexOf('uses: aquasecurity/trivy-action@'),
    sign = merge.indexOf('cosign sign ');
  assert.ok(trivy > 0 && sign > trivy, 'Trivy checks the digest before it is signed');
  const step = merge.slice(trivy, merge.indexOf('\n      - ', trivy));
  assert.match(step, /image-ref: \$\{\{ env\.IMAGE \}\}@\$\{\{ steps\.manifest\.outputs\.digest \}\}/);
  assert.match(step, /exit-code: '1'/);
  assert.match(step, /severity: HIGH,CRITICAL/);

  const ci = withoutComment(fs.readFileSync(path.join(REAL_LOCATION, 'web-ci.yml'), 'utf8'));
  const ci0 = ci.indexOf('npm ci --ignore-scripts'),
    sig = ci.indexOf('run: npm audit signatures');
  assert.ok(ci0 > 0 && sig > ci0, 'npm audit signatures runs after npm ci');

  const sich = withoutComment(fs.readFileSync(path.join(REAL_LOCATION, 'sicherheit.yml'), 'utf8'));
  const own = sich.slice(sich.indexOf('\n  trivy-eigenbau:'), sich.indexOf('\n  zap:'));
  assert.match(own, /docker build -f Web-App\/Dockerfile\.caddy /);
  assert.match(own, /exit-code: '1'/);
  assert.doesNotMatch(own, /trivyignores/, 'Caddy is checked without exceptions');
  const exceptions = fs.readFileSync(path.join(ROOT_CERT, '.github', 'trivy-betrieb.yaml'), 'utf8');
  assert.doesNotMatch(exceptions, /^\s*# (caddy|pgweb)/m, 'Caddy or pgweb with accepted vulnerabilities');
});

/** The entries of .github/trivy-betrieb.yaml (only the form the file uses). */
function trivyExceptions(raw) {
  assert.match(raw, /^vulnerabilities:\s*$/m, 'no vulnerabilities section');
  return raw
    .split(/\n {2}- id: /)
    .slice(1)
    .map(block => {
      const lines = block.split('\n').filter(z => !/^\s*#/.test(z));
      const e = { id: lines[0].trim(), paths: [], purls: [], expired_at: null, statement: null };
      let list = null;
      for (const z of lines.slice(1)) {
        const k = z.match(/^ {4}(\w+):\s*(.*)$/);
        if (k) {
          list = k[2] === '' ? k[1] : null;
          if (k[2] !== '') e[k[1]] = k[2].replace(/^"(.*)"$/, '$1');
          continue;
        }
        const w = z.match(/^ {6}- "([^"]+)"$/);
        if (w && list) e[list].push(w[1]);
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
  const raw = fs.readFileSync(path.join(ROOT_CERT, '.github', 'trivy-betrieb.yaml'), 'utf8');
  const list = trivyExceptions(raw);
  assert.ok(list.length >= 40, `only ${list.length} exceptions read — does the reader still work?`);
  const ids = list.map(e => e.id);
  assert.deepEqual(
    ids.filter((x, i) => ids.indexOf(x) !== i),
    [],
    'doppelte Ausnahme',
  );
  for (const e of list) {
    assert.match(e.id, /^CVE-\d{4}-\d+$/);
    assert.match(e.expired_at ?? '', /^\d{4}-\d{2}-\d{2}$/, `${e.id} without an expiry date`);
    assert.ok((e.statement ?? '').length > 20, `${e.id} without a reason`);
    assert.ok(e.paths.length + e.purls.length > 0, `${e.id} is bound to no file and no package`);
    for (const p of e.purls)
      assert.match(p, /^pkg:apk\/alpine\/[a-z0-9.+-]+$/, `${e.id}: ${p} is not an Alpine package without a version`);
    for (const p of e.paths) assert.doesNotMatch(p, /^\/|\*/, `${e.id}: ${p} is not a fixed path in the image`);
  }
  // gosu is the only Go program in the Postgres image; its exceptions apply only there.
  assert.ok(
    list.some(e => e.paths.includes('usr/local/bin/gosu')),
    'no exception for gosu',
  );

  // trivy-action passes exactly ONE .yaml file through as TRIVY_IGNOREFILE; several or mixed abort.
  const sich = fs.readFileSync(path.join(REAL_LOCATION, 'sicherheit.yml'), 'utf8');
  assert.match(
    jobOf(sich, 'trivy-compose'),
    /^\s+trivyignores: \.github\/trivy-betrieb\.yaml\s*$/m,
    'trivy-compose reads the YAML exceptions',
  );
  assert.ok(
    !fs.existsSync(path.join(ROOT_CERT, '.github', 'trivy-betrieb.ignore')),
    'the old list without package binding is still there',
  );
});

// ── Android-Release (sec17) ──────────────────────────────────────────────────

/** The run block of a step, looked up by its name. */
function stepAfter(yml, name) {
  const z = yml.split('\n');
  const i = z.findIndex(l => l.trim() === `- name: ${name}`);
  assert.ok(i >= 0, `step „${name}“ not found`);
  const r = z.findIndex((l, j) => j > i && /^\s+run: \|\s*$/.test(l));
  const deep = z[r + 1]?.match(/^\s*/)?.[0].length ?? 0;
  const end = z.findIndex((l, j) => j > r && l.trim() && (l.match(/^\s*/)?.[0].length ?? 0) < deep);
  return z
    .slice(r + 1, end < 0 ? undefined : end)
    .map(l => l.slice(deep))
    .join('\n');
}

/** A job without comment lines, from its header line to the next job. */
function jobOf(yml, name) {
  const without = yml
    .split('\n')
    .filter(z => !z.trimStart().startsWith('#'))
    .join('\n');
  const part = without.split(new RegExp(`\\n  ${name}:\\n`))[1];
  assert.ok(part, `job ${name} is missing`);
  return part.split(/\n {2}[\w-]+:\n/)[0];
}

/** Runs [skript] in bash, with a `gh` stand-in that asks [antworten] per call. */
function withGh(t, script, answers, env = {}) {
  const location = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'gh-ersatz-'));
  t.after(() => fs.rmSync(location, { recursive: true, force: true }));
  const rules = Object.entries(answers)
    .map(([pattern, out]) => `  *'${pattern}'*) printf '%s' '${out.replace(/'/g, `'\\''`)}' ;;`)
    .join('\n');
  fs.writeFileSync(
    path.join(location, 'gh'),
    `#!/bin/bash\ncase "$*" in\n${rules}\n  *) echo "unbekannt: $*" >&2; exit 9 ;;\nesac\n`,
    { mode: 0o755 },
  );
  return spawnSync('bash', ['-e', '-c', script], {
    cwd: location,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${location}:${process.env.PATH}`,
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
  const build = jobOf(android, 'build');
  assert.match(
    build,
    /setup-gradle@[0-9a-f]{40}[^\n]*\n\s+with:\n\s+cache-disabled: \$\{\{ startsWith\(github\.ref, 'refs\/tags\/android-v'\) \}\}/,
    'build tags without cache',
  );
  assert.match(
    build,
    /if: startsWith\(github\.ref, 'refs\/tags\/android-v'\)\n\s+run: echo "GRADLE_USER_HOME=\$RUNNER_TEMP\/[\w-]+" >> "\$GITHUB_ENV"/,
    'build tags with an empty Gradle user directory',
  );
  for (const file of ['android.yml', 'sicherheit.yml']) {
    const yml = fs.readFileSync(path.join(REAL_LOCATION, file), 'utf8');
    const jobs = [...yml.matchAll(/\n {2}([\w-]+):\n/g)].map(m => m[1]).filter(j => j !== 'build');
    for (const job of jobs.filter(j => /setup-gradle@/.test(jobOf(yml, j))))
      assert.match(
        jobOf(yml, job),
        /setup-gradle@[0-9a-f]{40}[^\n]*\n(?:\s+if: [^\n]+\n)?\s+with:\n\s+cache-read-only: true/,
        `${file}:${job} writes the Gradle cache`,
      );
  }
});

// Counter-checks (measured 05.11.2026): `exit-code: '1'` of the Android check to '0' → red
// „… sperrt nicht“; the step „Abhängigkeiten ohne bekannte Lücke“ deleted → red
// „… ohne grüne Lückenprüfung“; a red job in the gh stand-in → red „ein roter …“.
test("the app's vulnerability check blocks, and without it no tag is signed (sec17 M2)", t => {
  const confidence = fs.readFileSync(path.join(REAL_LOCATION, 'sicherheit.yml'), 'utf8');
  const job = jobOf(confidence, 'android-abhaengigkeiten');
  assert.doesNotMatch(job.split('\n    steps:')[0], /continue-on-error/, 'the whole job must not be allowed to go red');
  const check = job.split('- name: Bekannte Lücken')[1].split('- name: ')[0];
  assert.match(check, /exit-code: '1'/, "the app's vulnerability check does not block");
  assert.match(check, /severity: HIGH,CRITICAL/);
  assert.match(check, /ignore-unfixed: true/);
  assert.match(job, /log4j-core:2\.14\.1/, 'the counter-check with a known vulnerable version is missing');
  assert.match(job, /steps\.gegenprobe\.outcome/);
  const list = check.match(/trivyignores: (\S+)/)?.[1];
  assert.ok(list && fs.existsSync(path.join(ROOT_CERT, list)), `exception list is missing: ${list}`);
  const lines = fs.readFileSync(path.join(ROOT_CERT, list), 'utf8').split('\n');
  lines.forEach((z, i) => {
    if (!z.trim() || z.startsWith('#')) return;
    assert.match(z, /^CVE-\d{4}-\d+ exp:\d{4}-\d{2}-\d{2}$/, `exception without an expiry date: ${z}`);
    assert.match(lines[i - 1] ?? '', /^# \S.{10,}/, `exception without a reason above it: ${z}`);
  });
  const name = confidence.match(/\n {2}android-abhaengigkeiten:\n {4}name: ([^\n]+)/)[1];
  const release = fs.readFileSync(path.join(REAL_LOCATION, 'android-release.yml'), 'utf8');
  const script = stepAfter(release, 'Abhängigkeiten ohne bekannte Lücke');
  assert.match(
    script,
    /workflows\/sicherheit\.yml\/runs\?head_sha=\$COMMIT/,
    'tag without a green vulnerability check',
  );
  assert.ok(name.startsWith('Trivy (Android-Abhängigkeiten'), `job name „${name}“ does not match the query`);
  const run = conclusion =>
    withGh(
      t,
      script,
      {
        'workflows/sicherheit.yml/runs': '17',
        'actions/runs/17/jobs': conclusion,
      },
      { COMMIT: 'a'.repeat(40) },
    );
  assert.equal(run('success').status, 0, 'a green run releases');
  assert.notEqual(run('failure').status, 0, 'a red run blocks');
  assert.notEqual(run('fehlt').status, 0, 'without the job it blocks');
});

// Counter-checks (measured 11.11.2026, each individually): in the step „main ist geschützt“ the loop
// deleted → red „ohne PR-Pflicht …“; the check of can_admins_bypass deleted → red
// „… umgehen …“; `tag:android-v*` as allowed rule again → red „… nur der Zweig main“; the
// comparison `$COMMIT != $LAUF_COMMIT` deleted → red „ein Etikett auf einem anderen Commit …“;
// the name check `^android-v…$` deleted → red „ein Name mit Sonderzeichen …“; in
// „Prüfsummen aus der Übergabe“ the selection of the handover job replaced by `true` → red „die
// Anmerkung eines anderen Jobs …“; the self-review `::warning` turned back into `::error` + `exit 1`
// → red „self-review is allowed“ (measured 26.11.2026). The gh stand-in evaluates no --jq: the count of
// annotations (`if length == 1`) is not checked by this test.
test('signing happens only with protected main, from main, for a real tag and without bypass by administrators (sec17 B1, B3)', t => {
  const release = fs.readFileSync(path.join(REAL_LOCATION, 'android-release.yml'), 'utf8');
  const main = stepAfter(release, 'main ist geschützt');
  const rules = kinds => withGh(t, main, { 'rules/branches/main': kinds }).status;
  assert.equal(rules('non_fast_forward,pull_request,required_status_checks'), 0);
  assert.notEqual(rules('non_fast_forward,required_status_checks'), 0, 'without mandatory PRs nothing is signed');
  assert.notEqual(rules('pull_request'), 0, 'without mandatory checks nothing is signed');
  const sign = fs.readFileSync(path.join(REAL_LOCATION, 'android-signieren.yml'), 'utf8');
  const environment = stepAfter(sign, 'Environment ist geschützt');
  const envRun = (bypass, rule = 'branch:main', selfReview = true) =>
    withGh(
      t,
      environment,
      {
        'environments/release/deployment-branch-policies': rule,
        'environments/release': JSON.stringify({
          can_admins_bypass: bypass,
          deployment_branch_policy: { custom_branch_policies: true },
          protection_rules: [{ type: 'required_reviewers', prevent_self_review: selfReview, reviewers: [{}] }],
        }),
      },
      { UMGEBUNG: 'release' },
    );
  const env = (...args) => envRun(...args).status;
  assert.equal(env(false), 0);
  assert.notEqual(env(true), 0, 'administrators must not bypass the approval');
  // The owner publishes alone: self-review only warns, the required approval stays.
  const own = envRun(false, 'branch:main', false);
  assert.equal(own.status, 0, 'self-review is allowed');
  assert.match(String(own.stdout), /::warning title=Selbstfreigabe::/, 'self-review is reported as a warning');
  assert.notEqual(
    env(false, 'tag:android-v*'),
    0,
    'a tag with its own workflow would get at the keys: only the main branch',
  );
  assert.notEqual(env(false, 'branch:main,tag:android-v*'), 0, 'only the main branch');

  const label = stepAfter(release, 'Etikett zeigt auf den gebauten Commit');
  const c = 'c'.repeat(40);
  const output = t2 => {
    const f = path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'aus-')), 'o');
    fs.writeFileSync(f, '');
    t2.after(() => fs.rmSync(path.dirname(f), { recursive: true, force: true }));
    return f;
  };
  const verify = (name, target, extra = {}) => {
    const o = output(t);
    const r = withGh(
      t,
      label,
      { [`git/ref/tags/${name}`]: `commit ${target}` },
      { GITHUB_OUTPUT: o, EINGABE: '', AUS_LAUF: name, LAUF_COMMIT: c, LAUF_ID: '99', ...extra },
    );
    return { status: r.status, out: fs.readFileSync(o, 'utf8') };
  };
  const good = verify('android-v2026.11.12', c);
  assert.equal(good.status, 0, 'a tag on the built commit counts');
  assert.match(good.out, new RegExp(`^commit=${c}$`, 'm'));
  assert.match(good.out, /^lauf=99$/m);
  assert.notEqual(verify('android-v2026.11.12', 'd'.repeat(40)).status, 0, 'a tag on another commit does not count');
  assert.notEqual(verify('android-v1;x', c).status, 0, 'a name with special characters does not count');
  assert.notEqual(
    withGh(
      t,
      label,
      {},
      { GITHUB_OUTPUT: output(t), EINGABE: '', AUS_LAUF: 'android-v9', LAUF_COMMIT: c, LAUF_ID: '99' },
    ).status,
    0,
    'without a tag (e.g. only a branch of that name) nothing counts',
  );

  const sums = stepAfter(release, 'Prüfsummen aus der Übergabe');
  assert.match(
    sums,
    /select\(\.name == "Übergabe an das Signieren" and \.conclusion == "success"\)/,
    "another job's annotation does not count",
  );
  const android = fs.readFileSync(path.join(REAL_LOCATION, 'android.yml'), 'utf8');
  assert.match(
    jobOf(android, 'uebergabe'),
    /^ {4}name: Übergabe an das Signieren$/m,
    'the name of the handover job does not match the query',
  );
  assert.match(
    stepAfter(android, 'Prüfsummen des Baujobs bezeugen'),
    /::notice title=Prüfsummen zum Signieren::apk=\$APK_SOLL aab=\$AAB_SOLL/,
  );
  const a = 'a'.repeat(64),
    b = 'b'.repeat(64);
  const read = (jobs, note) => {
    const o = output(t);
    const r = withGh(
      t,
      sums,
      { 'actions/runs/99/jobs': jobs, 'check-runs/55/annotations': note },
      { GITHUB_OUTPUT: o, LAUF: '99' },
    );
    return { status: r.status, out: fs.readFileSync(o, 'utf8') };
  };
  const ok = read('55', `apk=${a} aab=${b}`);
  assert.equal(ok.status, 0);
  assert.match(ok.out, new RegExp(`^sha256_apk=${a}\\nsha256_aab=${b}$`, 'm'));
  assert.notEqual(read('55 56', `apk=${a} aab=${b}`).status, 0, 'two handovers do not count');
  assert.notEqual(read('55', '').status, 0, 'without an annotation nothing counts');
  assert.notEqual(read('55', `apk=${a} aab=${b}; rm`).status, 0, 'a mangled annotation does not count');
});

// Counter-checks (measured 05.11.2026): the checksum step deleted in the release job → red
// „vor dem Veröffentlichen …“; in android-bescheinigung.yml `sha256sum -c -` replaced by
// `cat > /dev/null` → red „ein verändertes Byte …“.
test('only what the signing job output is published and attested (sec17 B-N1, B-N7)', t => {
  const android = fs.readFileSync(path.join(REAL_LOCATION, 'android-release.yml'), 'utf8');
  const attestation = fs.readFileSync(path.join(REAL_LOCATION, 'android-bescheinigung.yml'), 'utf8');
  const release = jobOf(android, 'release');
  assert.match(
    release,
    /- name: Artefakt gegen die Prüfsummen des Signierjobs/,
    'the comparison before publishing is missing',
  );
  assert.doesNotMatch(release, /attest-build-provenance|id-token: write/, 'the release job does not attest itself');
  assert.match(release, /needs: \[etikett, signieren, bescheinigen\]/);
  assert.match(jobOf(android, 'bescheinigen'), /uses: \.\/\.github\/workflows\/android-bescheinigung\.yml/);
  assert.match(attestation, /\non:\n {2}workflow_call:\n/);
  assert.doesNotMatch(attestation, /\n {2}(push|pull_request|workflow_dispatch):/, 'only as a reusable workflow');
  for (const file of ['apk/release/BrickInventory.apk', 'version-signiert.json', 'bundle/release/app-release.aab'])
    assert.match(
      attestation.split('subject-path:')[1],
      new RegExp(file.replace(/[./]/g, '\\$&')),
      `${file} is not attested`,
    );

  const location = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'signiert-'));
  t.after(() => fs.rmSync(location, { recursive: true, force: true }));
  const content = {
    'apk/release/BrickInventory.apk': 'apk',
    'version-signiert.json': '{}',
    'bundle/release/app-release.aab': 'aab',
  };
  const sum = s => require('node:crypto').createHash('sha256').update(s).digest('hex');
  for (const [d, s] of Object.entries(content)) {
    fs.mkdirSync(path.join(location, 'signiert', path.dirname(d)), { recursive: true });
    fs.writeFileSync(path.join(location, 'signiert', d), s);
  }
  const env = { RUNNER_TEMP: location, APK_SOLL: sum('apk'), BESCHREIBUNG_SOLL: sum('{}'), AAB_SOLL: sum('aab') };
  const script = stepAfter(attestation, 'Gegen die Prüfsummen des Signierjobs');
  const run = () =>
    spawnSync('bash', ['-e', '-c', script], { cwd: location, encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(run().status, 0, run().stdout + run().stderr);
  fs.writeFileSync(path.join(location, 'signiert', 'version-signiert.json'), '{ }');
  assert.notEqual(run().status, 0, 'a changed byte is attested');
});

// Gradle keeps a missing plugin artifact for 24 h in the shared cache: a plain retry hit the
// same cached miss three times on 26.11.2026. The retry must ask again (--refresh-dependencies).
// Counter-checks (measured 26.11.2026, each individually): `lauf --refresh-dependencies` back to
// `lauf` in „Unit-Tests“ → red „Unit-Tests: the retry asks the repositories again“; the retry
// in „Gerätetests“ removed → red „Gerätetests: a missing plugin is retried once“.
test('a missing Gradle plugin is retried once, bypassing the cached miss', t => {
  const android = fs.readFileSync(path.join(REAL_LOCATION, 'android.yml'), 'utf8');
  for (const name of ['Unit-Tests', 'Gerätetests']) {
    const script = stepAfter(android, name).replace(/\$\{\{[^}]*\}\}/g, 'aufgabe');
    const run = cause => {
      const location = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'gradle-ersatz-'));
      t.after(() => fs.rmSync(location, { recursive: true, force: true }));
      // Fails like the cached miss unless Gradle is told to ask the repositories again.
      fs.writeFileSync(
        path.join(location, 'gradlew'),
        `#!/bin/bash\necho "$*" >> calls\ncase "$*" in *--refresh-dependencies*) exit 0 ;; esac\necho "${cause}"; exit 1\n`,
        { mode: 0o755 },
      );
      const r = spawnSync('bash', ['-e', '-c', script], {
        cwd: location,
        encoding: 'utf8',
        env: { ...process.env, RUNNER_TEMP: location },
      });
      const calls = fs.existsSync(path.join(location, 'calls'))
        ? fs.readFileSync(path.join(location, 'calls'), 'utf8').trim().split('\n')
        : [];
      return { status: r.status, calls };
    };
    const missing = run("could not resolve plugin artifact 'org.jetbrains.kotlin.jvm'");
    assert.equal(missing.calls.length, 2, `${name}: a missing plugin is retried once`);
    assert.match(missing.calls[1], /--refresh-dependencies/, `${name}: the retry asks the repositories again`);
    assert.equal(missing.status, 0, `${name}: the retry decides`);
    const broken = run('e: Unresolved reference');
    assert.equal(broken.calls.length, 1, `${name}: a real error is not retried`);
    assert.notEqual(broken.status, 0, `${name}: a real error stays red`);
  }
});

// „test“ is required on main: without a pull_request paths filter the job `aenderungen` decides,
// and a skipped required job counts as passed. Counter-checks (measured 26.11.2026): `shared/`
// removed from MUSTER → red „a change under shared/ runs the suite“; the `else` branch writing
// web=true → red „only Android files skip the suite“.
test('the web suite runs for web changes and is skipped for Android-only pull requests', t => {
  const ci = fs.readFileSync(path.join(REAL_LOCATION, 'web-ci.yml'), 'utf8');
  const script = stepAfter(ci, 'Web-Pfade geändert?');
  // Only names in a diff list; nothing under the Android tree is read here.
  const android = ['Android', 'App'].join('-');
  const decide = (files, base = 'b'.repeat(40)) => {
    const location = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'git-ersatz-'));
    t.after(() => fs.rmSync(location, { recursive: true, force: true }));
    fs.writeFileSync(
      path.join(location, 'git'),
      `#!/bin/bash\nprintf '%s\\n' ${files.map(f => `'${f}'`).join(' ')}\n`,
      {
        mode: 0o755,
      },
    );
    const output = path.join(location, 'out');
    fs.writeFileSync(output, '');
    const r = spawnSync('bash', ['-e', '-c', script], {
      cwd: location,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${location}:${process.env.PATH}`,
        GITHUB_OUTPUT: output,
        BASE_SHA: base,
        HEAD_SHA: 'h'.repeat(40),
      },
    });
    assert.equal(r.status, 0, r.stderr);
    return fs.readFileSync(output, 'utf8').trim();
  };
  assert.equal(decide(['Web-App/server.ts']), 'web=true', 'a Web-App change runs the suite');
  assert.equal(decide(['shared/app-interface.json']), 'web=true', 'a change under shared/ runs the suite');
  assert.equal(decide(['.github/workflows/android.yml']), 'web=true', 'a workflow change runs the suite');
  assert.equal(
    decide([`${android}/playstore/1-collection.png`, `${android}/app/build.gradle.kts`]),
    'web=false',
    'only Android files skip the suite',
  );
  assert.equal(
    decide([`${android}/app/build.gradle.kts`], ''),
    'web=true',
    'without a pull request (push, dispatch) the suite runs',
  );
});
