/**
 * Operation according to `docker compose config` (resolved, not via regex): every
 * service has bounded logs, every tmpfs is without exec and bounded,
 * the database only hangs in internal networks and only writes to data and
 * socket, pgweb no longer exists, Caddy comes signed via digest or from
 * Dockerfile.caddy. Skipped without Docker CLI, not in CI.
 *
 * Counter-checks (measured 05.11.2026, each alone):
 *   A  for caddy `logging: *protokoll` deleted → red: “every service has
 *      bounded logs” (caddy: json-file without limit)
 *   B  for jobs again `- /tmp` without options → red: “every tmpfs …”
 *   C  postgres again additionally in brickinventory-net → red: “the database
 *      only hangs in internal networks”
 *   D  for db-net `internal: true` deleted → red: the same check
 *   E  postgres without `read_only: true` → red: “… only writes to data and socket”
 *   F  caddy again `image: caddy:…@sha256:…` without build → red: “Caddy comes
 *      as a signed image …” (back then: “Caddy is built here …”)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

function konfig() {
  const r = spawnSync(
    'docker',
    ['compose', '-f', path.join(ROOT, 'compose.yaml'), '--profile', 'tools', 'config', '--format', 'json'],
    {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        BRICK_HOST: 'nas.example.lan',
        VORGELAGERTER_PROXY: 'keiner',
        BRICK_IMAGE: `addict85/brickinventory@sha256:${'0'.repeat(64)}`,
        CADDY_IMAGE: `addict85/brickinventory-caddy@sha256:${'0'.repeat(64)}`,
      },
    },
  );
  if (r.error || r.status !== 0) return { fehler: r.error?.message || r.stderr };
  return { j: JSON.parse(r.stdout) };
}

/** @param {import('node:test').TestContext} t */
function withKonfig(t) {
  const { j, fehler } = konfig();
  if (!j) {
    if (process.env.CI) assert.fail(`docker compose config im CI-Lauf: ${fehler}`);
    t.skip(`no docker compose: ${fehler}`);
  }
  return j;
}

test('every service has limited logs', t => {
  const j = withKonfig(t);
  if (!j) return;
  const dienste = Object.entries(j.services);
  assert.ok(dienste.length >= 6, Object.keys(j.services).join(', '));
  const ohne = dienste
    .filter(
      ([, d]) =>
        !(
          d.logging &&
          d.logging.driver === 'local' &&
          /^\d+m$/.test(d.logging.options?.['max-size'] ?? '') &&
          Number(d.logging.options?.['max-file']) >= 1
        ),
    )
    .map(([n, d]) => `${n}: ${JSON.stringify(d.logging ?? null)}`);
  assert.deepEqual(ohne, []);
});

test('every tmpfs is without exec, without setuid and limited in size', t => {
  const j = withKonfig(t);
  if (!j) return;
  const falsch = [];
  for (const [n, d] of Object.entries(j.services))
    for (const eintrag of d.tmpfs ?? []) {
      const optionen = eintrag.split(':')[1]?.split(',') ?? [];
      const noetig = [eintrag.startsWith('/var/run/postgresql') ? 'nosuid' : 'noexec', 'nosuid', 'nodev'];
      if (!noetig.every(o => optionen.includes(o)) || !optionen.some(o => /^size=\d+[km]$/.test(o)))
        falsch.push(`${n}: ${eintrag}`);
    }
  assert.deepEqual(falsch, []);
  assert.ok(
    Object.values(j.services).filter(d => d.tmpfs?.length).length >= 4,
    'die Liste der tmpfs ist leer — greift die Prüfung?',
  );
});

test('the database hangs only in internal networks and only writes to data and socket', t => {
  const j = withKonfig(t);
  if (!j) return;
  const pg = j.services.postgres;
  const netze = Object.keys(pg.networks ?? {});
  assert.ok(netze.length >= 1, 'postgres hängt in keinem Netz');
  for (const n of netze)
    assert.equal(j.networks[n]?.internal, true, `postgres hängt im Netz ${n} mit Weg nach draussen`);
  for (const d of ['app', 'jobs', 'db-rolle'])
    assert.ok(
      netze.some(n => Object.keys(j.services[d].networks ?? {}).includes(n)),
      `${d} erreicht postgres nicht`,
    );
  assert.ok(!netze.some(n => Object.keys(j.services.caddy.networks ?? {}).includes(n)), 'caddy erreicht postgres');
  assert.equal(pg.read_only, true, 'postgres: read_only fehlt');
  assert.ok(
    (pg.tmpfs ?? []).some(e => e.startsWith('/var/run/postgresql:')),
    'postgres: Socket-Ordner nicht als tmpfs',
  );
});

test('pgweb no longer exists, not even in the tools profile', t => {
  const j = withKonfig(t);
  if (!j) return;
  assert.equal(j.services.pgweb, undefined);
  assert.ok(!Object.keys(j.networks ?? {}).some(n => /pgweb/.test(n)), Object.keys(j.networks ?? {}).join(', '));
});

// Counter-check (measured 11.11.2026): caddy-rechte back to `brickinventory-caddy:2.11.8`
// → red “caddy-rechte takes the same signed image”.
test('Caddy comes as a signed image by digest, built itself from base images by digest', t => {
  const j = withKonfig(t);
  if (!j) return;
  const c = j.services.caddy;
  assert.equal(c.image, `addict85/brickinventory-caddy@sha256:${'0'.repeat(64)}`, 'caddy zieht nicht CADDY_IMAGE');
  assert.equal(c.pull_policy, 'missing');
  assert.equal(j.services['caddy-rechte'].image, c.image, 'caddy-rechte nimmt dasselbe signierte Image');
  // `up -d --build` with own CADDY_IMAGE still builds from Dockerfile.caddy.
  assert.equal(c.build?.dockerfile, 'Dockerfile.caddy', JSON.stringify(c.build ?? null));
  const df = fs.readFileSync(path.join(ROOT, 'Dockerfile.caddy'), 'utf8');
  const basis = [...df.matchAll(/^FROM\s+(\S+)/gm)].map(m => m[1]);
  assert.equal(basis.length, 2);
  for (const b of basis) assert.match(b, /^caddy:[\w.-]+@sha256:[0-9a-f]{64}$/);
  assert.match(df, /^RUN xcaddy build v[\d.]+ /m);
});
