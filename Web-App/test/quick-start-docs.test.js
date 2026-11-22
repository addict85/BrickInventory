/**
 * The quick start in README.md (root) and Web-App/README.md leads to an
 * installation that compose.yaml can start. The commands of the block really run,
 * in a sandbox with compose.yaml, .env.example and scripts/;
 * only git and docker do not. Afterwards `docker compose config` reads the result: …
 *
 * Counter-checks (measured 04.11.2026, each on its own):
 *   A  compose.yaml: secret file ./geheimnisse/db_app_passwort instead of …_password
 *      → red: „Secret db_app_password: geheimnisse/db_app_passwort fehlt“
 *   B  README.md: `sh scripts/setup-secrets.sh` deleted → red:
 *      „Secret session_secret: … fehlt“
 *   C  Web-App/README.md: `scripts/setup-ca.sh` changed to a name
 *      that does not exist → red: „Schritt scheitert: sudo sh scripts/…“
 *   D  compose.yaml: for app `ports: ["3000:3000"]` → red: „app veröffentlicht
 *      keinen Port“
 *   E  compose.yaml: `image:` deleted for jobs → red: „jobs zieht das
 *      veröffentlichte Image“
 *   F  README.md: `docker compose logs app worker` → red: „unbekannter Dienst worker“;
 *      (09.11.2026) `docker compose exec worker cat …` → red: „unbekannter Dienst worker“
 * Counter-check L1 (measured 05.11.2026): in both READMEs again `docker
 *   compose pull` instead of `sh scripts/check-image.sh` → red: „docker compose
 *   config“ (BRICK_IMAGE missing).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DOKUS = [
  { datei: path.join(ROOT, '..', 'README.md'), abschnitt: '## Schnellstart' },
  { datei: path.join(ROOT, 'README.md'), abschnitt: '## Docker (empfohlen)' },
];
const DIGEST = 'sha256:' + '5'.repeat(64);
const PUBLISHED = fs
  .readFileSync(path.join(ROOT, '..', '.github', 'workflows', 'docker-publish.yml'), 'utf8')
  .match(/^\s*IMAGE:\s*(\S+)/m)?.[1];

/** The lines of the first ```bash block in the section, without comments. */
function quickStart(datei, abschnitt) {
  const text = fs.readFileSync(datei, 'utf8');
  const ab = text.indexOf(`\n${abschnitt}\n`);
  assert.ok(ab >= 0, `${path.basename(datei)}: Abschnitt „${abschnitt}“ fehlt`);
  const block = text.slice(ab).match(/```bash\n([\s\S]*?)```/)?.[1];
  assert.ok(block, `${path.basename(datei)}: kein bash-Block im Schnellstart`);
  return block
    .split('\n')
    .map(z => z.replace(/\s+#.*$/, '').trim())
    .filter(Boolean);
}

function sandbox(t) {
  const location = fs.mkdtempSync(path.join(os.tmpdir(), 'schnellstart-'));
  t.after(() => fs.rmSync(location, { recursive: true, force: true }));
  fs.copyFileSync(path.join(ROOT, 'compose.yaml'), path.join(location, 'compose.yaml'));
  fs.copyFileSync(path.join(ROOT, '.env.example'), path.join(location, '.env.example'));
  fs.copyFileSync(path.join(ROOT, 'Caddyfile'), path.join(location, 'Caddyfile'));
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(location, 'scripts'), { recursive: true });
  // cosign and docker as stand-ins: the signature check reports DIGEST, docker only records.
  const bin = path.join(location, 'ersatz-bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, 'cosign'),
    `#!/bin/sh\necho '[{"critical":{"image":{"docker-manifest-digest":"${DIGEST}"}}}]'\n`,
    { mode: 0o755 },
  );
  fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh\necho "docker $*" >> "${location}/docker.log"\n`, {
    mode: 0o755,
  });
  return location;
}

function compose(location, ...args) {
  return spawnSync('docker', ['compose', '-f', path.join(location, 'compose.yaml'), ...args], {
    cwd: location,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
}

for (const { datei, abschnitt } of DOKUS) {
  const name = path.relative(path.join(ROOT, '..'), datei);
  test(`${name}: the quick start matches compose.yaml`, t => {
    const probe = compose(path.join(ROOT), 'version');
    if (probe.error || probe.status !== 0) {
      if (process.env.CI) assert.fail(`docker compose im CI-Lauf: ${probe.error?.message || probe.stderr}`);
      t.skip('no docker compose');
      return;
    }
    assert.ok(PUBLISHED, 'IMAGE in docker-publish.yml nicht gefunden');
    const location = sandbox(t);
    const steps = quickStart(datei, abschnitt);
    const dockerRows = [];
    for (const row of steps) {
      if (/^(git|cd)\s/.test(row)) continue;
      if (/^docker\s/.test(row)) {
        dockerRows.push(row);
        continue;
      }
      // sudo only for the file permissions; CA_ORDNER names the same folder as the
      // default and allows the run without root (CI).
      const r = spawnSync('sh', ['-c', row.replace(/^sudo\s+/, '')], {
        cwd: location,
        encoding: 'utf8',
        env: {
          PATH: `${path.join(location, 'ersatz-bin')}:${process.env.PATH}`,
          HOME: location,
          CA_ORDNER: './caddy/ca',
        },
      });
      assert.equal(r.status, 0, `Schritt scheitert: ${row}\n${r.stdout}${r.stderr}`);
    }
    const gezogen = fs.existsSync(path.join(location, 'docker.log'))
      ? fs.readFileSync(path.join(location, 'docker.log'), 'utf8')
      : '';
    assert.ok(
      dockerRows.some(z => /^docker compose pull\b/.test(z)) || /^docker compose pull\b/m.test(gezogen),
      'der Schnellstart zieht das Image (docker compose pull)',
    );
    assert.ok(
      dockerRows.some(z => /^docker compose up -d\b/.test(z)),
      'der Schnellstart startet (docker compose up -d)',
    );

    const k = compose(location, 'config', '--format', 'json');
    assert.equal(k.status, 0, `docker compose config: ${k.stderr}`);
    const j = JSON.parse(k.stdout);
    const dienste = Object.keys(j.services);

    // Every service named by a docker command of the quick start exists.
    for (const z of dockerRows) {
      const [, command, rest = ''] = z.match(/^docker compose (\w+)((?:\s+[\w-]+)*)/) || [];
      assert.ok(command, `unbekannte Form: ${z}`);
      const words = rest
        .trim()
        .split(/\s+/)
        .filter(w => w && !w.startsWith('-'));
      // With exec and run the command in the container follows the service.
      for (const d of ['exec', 'run'].includes(command) ? words.slice(0, 1) : words)
        assert.ok(dienste.includes(d), `unbekannter Dienst ${d} in „${z}“`);
    }

    // The steps have created every file that compose mounts as a secret.
    const brauchen = new Set(
      Object.values(j.services).flatMap(d => (d.profiles ? [] : (d.secrets || []).map(s => s.source))),
    );
    assert.ok(brauchen.size >= 3, `nur ${brauchen.size} Secrets — liest der Test die richtige Datei?`);
    for (const s of brauchen) {
      const f = j.secrets[s].file;
      assert.ok(fs.existsSync(f), `Secret ${s}: ${path.relative(location, f)} fehlt`);
    }
    for (const s of ['session_secret', 'db_password', 'db_app_password'])
      assert.ok(fs.statSync(j.secrets[s].file).size >= 16, `Secret ${s} ist leer`);

    // BRICK_HOST from .env arrives at Caddy, and Caddy finds its own CA
    // (its start script selects it at /ca-eigen/zwischen.key).
    assert.match(j.services.caddy.environment.BRICK_HOST, /\S/, 'BRICK_HOST ist bei Caddy leer');
    const ca = j.services.caddy.volumes.find(v => v.target === '/ca-eigen');
    for (const f of ['zwischen.key', 'zwischen-kette.crt', 'root.crt'])
      assert.ok(
        fs.existsSync(path.join(ca.source, f)),
        `Caddy findet ${f} nicht unter ${path.relative(location, ca.source)}`,
      );

    // Reachable only via Caddy; app, jobs and schluessel share the published image.
    assert.deepEqual(j.services.app.ports ?? [], [], 'app veröffentlicht keinen Port');
    assert.ok(
      j.services.caddy.ports.some(p => p.target === 443),
      'Caddy veröffentlicht 443',
    );
    for (const d of ['app', 'jobs', 'schluessel'])
      assert.equal(
        j.services[d].image,
        `${PUBLISHED}@${DIGEST}`,
        `${d} zieht das veröffentlichte Image als geprüften Digest`,
      );
    assert.equal(
      new Set(['app', 'jobs', 'schluessel'].map(d => j.services[d].image)).size,
      1,
      'ein Image für alle drei',
    );
    for (const d of ['caddy', 'caddy-rechte'])
      assert.equal(
        j.services[d].image,
        `${PUBLISHED}-caddy@${DIGEST}`,
        `${d} zieht das signierte Caddy-Image als geprüften Digest`,
      );
    const gebaut = dienste.filter(d => j.services[d].build?.dockerfile === 'Dockerfile');
    assert.deepEqual(gebaut, ['app'], 'genau ein Dienst baut das Dockerfile');
  });
}

// ── The threat model (docs/SICHERHEIT.md) only names what exists ────────
// Counter-checks (measured 05.11.2026, each on its own): a reference back to
// `utils/konfig.ts` → red „jeder genannte Pfad …“; „Dependabot“ into a
// paragraph → red „kein Dependabot …“; a reference `compose-pgweb` added → red
// „jeder genannte Test existiert“.
const ROOT_DOCS = path.join(__dirname, '..', '..');
const TEXT = fs.readFileSync(path.join(ROOT_DOCS, 'docs', 'SICHERHEIT.md'), 'utf8');

function allFiles() {
  const raus = [];
  (function lauf(d) {
    for (const n of fs.readdirSync(d)) {
      if (['node_modules', 'dist', '.git', 'build', '.gradle'].includes(n)) continue;
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) lauf(p);
      else raus.push(path.relative(ROOT_DOCS, p).split(path.sep).join('/'));
    }
  })(ROOT_DOCS);
  return raus;
}

test('every named path to .ts, .sh, .yml and .yaml exists', () => {
  const dateien = allFiles();
  const pfade = [...TEXT.matchAll(/[\w./-]+\.(?:ts|sh|ya?ml)\b/g)].map(m => m[0].replace(/^\.\//, ''));
  assert.ok(pfade.length > 40, `nur ${pfade.length} Pfade gefunden — greift die Suche noch?`);
  const fehlt = pfade.filter(p => !dateien.some(d => d === p || d.endsWith('/' + p)));
  assert.deepEqual([...new Set(fehlt)], []);
});

test('no Renovate: Dependabot proposes new versions', () => {
  assert.doesNotMatch(TEXT, /renovate/i);
});

test('every named test exists', () => {
  const tests = new Set(
    fs
      .readdirSync(path.join(ROOT_DOCS, 'Web-App', 'test'))
      .filter(n => n.endsWith('.test.js'))
      .map(n => n.replace(/\.test\.js$/, '')),
  );
  // References stand after a dash, as `name` with a hyphen, separated by commas.
  const receipts = [...TEXT.matchAll(/ —\s+((?:`[a-z0-9-]+`(?:,\s*)?)+)/g)].flatMap(m =>
    [...m[1].matchAll(/`([a-z0-9-]+)`/g)].map(x => x[1]),
  );
  assert.ok(receipts.length > 40, `nur ${receipts.length} Belege gefunden — greift die Suche noch?`);
  assert.deepEqual([...new Set(receipts.filter(b => !tests.has(b)))], []);
});
