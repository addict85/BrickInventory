/**
 * Build image: no tools without a purpose.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { missingPrecondition } = require('./helpers/db');

const ROOT = path.join(__dirname, '..');

test('the build stage installs no compiler tools', () => {
  const df = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  // Comments do not count — there the line stands as a hint for the case
  // that it is needed after all.
  const cmds = df.split('\n').filter(l => !l.trim().startsWith('#'));
  for (const tool of ['python3', 'make', 'g++']) {
    assert.ok(
      !cmds.some(l => l.includes('apk add') && l.includes(tool)),
      `${tool} wird installiert, obwohl nichts kompiliert`,
    );
  }
});

test('and no dependency needs them', () => {
  // Two proofs, both from the lockfile — it applies in the build (npm ci):
  //   1. no package with a native extension
  //   2. the packages with an install script are known and harmless
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const withScript = Object.entries(lock.packages || {})
    // The empty key is the project itself; it has no install script
    // (test/version.test.js).
    .filter(([k, v]) => k && v.hasInstallScript)
    .map(([k]) => k.replace(/^.*node_modules\//, ''));

  // esbuild downloads a finished binary for the platform, fsevents is
  // macOS-only and is not even installed on Linux.
  const harmless = new Set(['esbuild', 'fsevents']);
  const unknown = [...new Set(withScript)].filter(p => !harmless.has(p));
  assert.deepEqual(
    unknown,
    [],
    `Neue Pakete mit Install-Skript: ${unknown.join(', ')} — prüfen, ob sie kompilieren. ` +
      'Falls ja, gehört `RUN apk add --no-cache python3 make g++` zurück ins Build-Stage.',
  );
});

// Counter-check (measured on 28.10.2026): `ENV PGPASSWORD=brickinventory_secret`
// back in the Dockerfile → red. An ENV stands in every copy of the image.
test('the image carries no database password', () => {
  const df = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  const zeilen = df.split('\n').filter(l => !l.trim().startsWith('#'));
  assert.deepEqual(
    zeilen.filter(l => /^\s*(ENV|ARG)\b.*(PASSWORD|_SECRET|PGPASS)/i.test(l)),
    [],
  );
  const compose = fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');
  assert.match(
    compose,
    /PGPASSWORD_FILE: \/run\/secrets\/db_app_password/,
    'compose.yaml muss das Passwort als Datei hereinreichen',
  );
});

// Counter-check (measured on 28.10.2026): the digest on the second FROM line
// removed → red. A tag like node:26-alpine points to another image tomorrow.
test('base images are fixed by digest', () => {
  const sources = {
    Dockerfile: fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8'),
    'compose.yaml': fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8'),
  };
  const loose = [];
  for (const [name, text] of Object.entries(sources))
    for (const m of text.matchAll(/^\s*(?:FROM|image:)\s+(node|postgres)(:[^\s]+)/gm))
      if (!/@sha256:[0-9a-f]{64}/.test(m[2])) loose.push(`${name}: ${m[1]}${m[2]}`);
  assert.ok([...sources.Dockerfile.matchAll(/^FROM /gm)].length >= 2, 'FROM-Zeilen nicht gefunden');
  assert.deepEqual(loose, []);
});

// Counter-check (30.10.2026): the rm line in the runtime stage removed → red.
test('the runtime image carries no npm, corepack or yarn', () => {
  const df = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  const laufzeit = df
    .split(/^FROM /m)
    .pop()
    .split('\n')
    .filter(l => !l.trim().startsWith('#'))
    .join('\n');
  for (const path of ['/usr/local/lib/node_modules', '/usr/local/bin/npm', '/usr/local/bin/corepack', '/opt/yarn-'])
    assert.ok(laufzeit.includes(path), `${path} bleibt im Laufzeit-Image`);
});

test('secrets and backups stay out of image and repository', t => {
  // The build context is Web-App/: without an entry .env (passwords),
  // the backups of scripts/backup.sh and the data key would land in the image.
  // Counter-check (01.11.2026): `backups` deleted from .dockerignore → red.
  const muster = fs
    .readFileSync(path.join(ROOT, '.dockerignore'), 'utf8')
    .split('\n')
    .map(l => l.trim());
  // (03.11.2026) `geheimnisse` deleted from .gitignore → red.
  for (const m of ['.env', '.env.*', 'backups', 'schluessel', 'data', 'geheimnisse'])
    assert.ok(muster.includes(m), `.dockerignore schliesst ${m} nicht aus`);
  // The second part asks git; without a working tree (copy without .git, image) only
  // skipped with a message, in CI (REQUIRE_DB=1) an error.
  // Counter-check (04.11.2026): copy of the tree without .git → skipped with
  // “no Git working tree”, red with REQUIRE_DB=1.
  const baum = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ROOT, encoding: 'utf8' });
  if (baum.error || baum.status !== 0) {
    const reason = `kein Git-Arbeitsbaum unter ${ROOT} (${baum.error?.message || baum.stderr.trim()})`;
    missingPrecondition(t, reason, `.gitignore lässt sich nicht prüfen, ${reason}`);
    return;
  }
  const git = spawnSync(
    'git',
    ['check-ignore', '--no-index', 'backups/x.sql.gz', 'schluessel/datenschluessel', '.env', 'geheimnisse/db_password'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.deepEqual(git.stdout.trim().split('\n').sort(), [
    '.env',
    'backups/x.sql.gz',
    'geheimnisse/db_password',
    'schluessel/datenschluessel',
  ]);
});

// Counter-checks (measured 03.11.2026, each alone): in the Dockerfile again `RUN npm ci`
// → red “Dockerfile: npm ci without --ignore-scripts”; `npm rebuild esbuild` in
// web-ci.yml deleted → red “web-ci.yml does not build exactly …”.
test('install scripts only run selectively, for exactly the packages that have one', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  // fsevents only exists under macOS; on Linux it is never installed.
  const withScriptTag = Object.entries(lock.packages)
    .filter(([n, p]) => p.hasInstallScript && !/(^|\/)fsevents$/.test(n))
    .map(([n]) => n.replace(/^.*node_modules\//, ''))
    .sort();
  assert.ok(withScriptTag.includes('esbuild'), `Vorbedingung: esbuild hat ein Install-Skript (${withScriptTag})`);
  const sources = {
    Dockerfile: fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8'),
    'web-ci.yml': fs.readFileSync(path.join(ROOT, '..', '.github', 'workflows', 'web-ci.yml'), 'utf8'),
    'sicherheit.yml': fs.readFileSync(path.join(ROOT, '..', '.github', 'workflows', 'sicherheit.yml'), 'utf8'),
  };
  for (const [name, text] of Object.entries(sources)) {
    const code = text
      .split('\n')
      .filter(l => !/^\s*#/.test(l))
      .join('\n');
    const aufrufe = [...code.matchAll(/npm ci\b[^\n&]*/g)].map(m => m[0]);
    assert.ok(aufrufe.length > 0, `${name}: kein npm ci gefunden`);
    for (const a of aufrufe) assert.match(a, /--ignore-scripts/, `${name}: npm ci ohne --ignore-scripts`);
    const gebaut = [...code.matchAll(/npm rebuild ([^\n&]+)/g)].flatMap(m => m[1].trim().split(/\s+/)).sort();
    assert.deepEqual(gebaut, withScriptTag, `${name} baut nicht genau die Pakete mit Install-Skript`);
  }
});

// The image starts as brickinv; the entrypoint with substitutes for id, su-exec and node, /app in the sandbox.
// Counter-checks (measured 13.11.2026, each alone): `USER brickinv` deleted → red “the image starts
// as root without --user”; the condition `[ "$(id -u)" = 0 ]` replaced by `true` → red “without root
// node starts directly, without su-exec”.
test('the image starts as brickinv, the entrypoint runs that way and as root', () => {
  const laufzeit =
    fs
      .readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8')
      .split(/^FROM /m)
      .pop() ?? '';
  const nutzer = [...laufzeit.matchAll(/^USER\s+(\S+)/gm)].map(m => m[1]);
  assert.equal(nutzer.at(-1), 'brickinv', 'das Image startet ohne --user als root');
  assert.match(laufzeit, /adduser -S brickinv/, 'der Nutzer entsteht im Laufzeit-Stage');
  const location = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'entrypoint-'));
  try {
    const app = path.join(location, 'app'),
      bin = path.join(location, 'bin'),
      spur = path.join(location, 'spur');
    fs.mkdirSync(path.join(app, 'data'), { recursive: true });
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(app, 'data-permissions.sh'), 'echo daten-rechte >> "$SPUR"\n');
    const ersatz = (name, rumpf) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${rumpf}\n`, { mode: 0o755 });
    ersatz('id', '[ "$1" = -u ] && echo "$KENNUNG" || echo brickinv');
    ersatz('chown', 'exit 0');
    ersatz('su-exec', 'echo "su-exec $1" >> "$SPUR"; shift; KENNUNG=1000 exec "$@"');
    ersatz('node', 'echo "node $*" >> "$SPUR"');
    const ep = fs.readFileSync(path.join(ROOT, 'docker-entrypoint.sh'), 'utf8').replaceAll('/app/', `${app}/`);
    const script = path.join(location, 'entrypoint.sh');
    fs.writeFileSync(script, ep, { mode: 0o755 });
    const lauf = kennung => {
      fs.rmSync(spur, { force: true });
      const r = spawnSync('sh', [script], {
        encoding: 'utf8',
        cwd: location,
        env: { PATH: `${bin}:/usr/bin:/bin`, KENNUNG: kennung, SPUR: spur },
      });
      assert.equal(r.status, 0, r.stderr);
      return fs.readFileSync(spur, 'utf8').trim().split('\n');
    };
    assert.deepEqual(lauf('1000'), ['node dist/server.js'], 'ohne root startet node direkt, ohne su-exec');
    assert.deepEqual(lauf('0'), ['daten-rechte', 'su-exec brickinv', 'node dist/server.js']);
  } finally {
    fs.rmSync(location, { recursive: true, force: true });
  }
});
