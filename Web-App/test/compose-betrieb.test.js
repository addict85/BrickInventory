/**
 * Betrieb laut `docker compose config` (Interpolation, Anker, Kurzschreibweisen
 * aufgelöst, nicht per Regex): Jeder Dienst hat begrenzte Protokolle, jedes
 * tmpfs ist ohne Ausführen und begrenzt, die Datenbank hängt nur in internen
 * Netzen und schreibt nur in Daten und Socket, pgweb gibt es nicht mehr, und
 * Caddy entsteht aus Dockerfile.caddy. Ohne Docker-CLI übersprungen, in CI nicht.
 *
 * Gegenproben (05.11.2026 gemessen, je einzeln):
 *   A  bei caddy `logging: *protokoll` gestrichen → rot: „jeder Dienst hat
 *      begrenzte Protokolle“ (caddy: json-file ohne Grenze)
 *   B  bei jobs wieder `- /tmp` ohne Optionen → rot: „jedes tmpfs …“
 *   C  postgres wieder zusätzlich in brickinventory-net → rot: „die Datenbank
 *      hängt nur in internen Netzen“
 *   D  bei db-net `internal: true` gestrichen → rot: dieselbe Prüfung
 *   E  postgres ohne `read_only: true` → rot: „… schreibt nur in Daten und Socket“
 *   F  caddy wieder `image: caddy:…@sha256:…` ohne build → rot: „Caddy wird
 *      hier gebaut …“
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
        BRICK_IMAGE: `addict85/brickinventory@sha256:${'0'.repeat(64)}`,
      },
    },
  );
  if (r.error || r.status !== 0) return { fehler: r.error?.message || r.stderr };
  return { j: JSON.parse(r.stdout) };
}

/** @param {import('node:test').TestContext} t */
function mitKonfig(t) {
  const { j, fehler } = konfig();
  if (!j) {
    if (process.env.CI) assert.fail(`docker compose config im CI-Lauf: ${fehler}`);
    t.skip(`kein docker compose: ${fehler}`);
  }
  return j;
}

test('jeder Dienst hat begrenzte Protokolle', t => {
  const j = mitKonfig(t);
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

test('jedes tmpfs ist ohne Ausführen, ohne setuid und in der Grösse begrenzt', t => {
  const j = mitKonfig(t);
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

test('die Datenbank hängt nur in internen Netzen und schreibt nur in Daten und Socket', t => {
  const j = mitKonfig(t);
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

test('pgweb gibt es nicht mehr, auch nicht im Profil tools', t => {
  const j = mitKonfig(t);
  if (!j) return;
  assert.equal(j.services.pgweb, undefined);
  assert.ok(!Object.keys(j.networks ?? {}).some(n => /pgweb/.test(n)), Object.keys(j.networks ?? {}).join(', '));
});

test('Caddy wird hier gebaut, aus Basis-Images per Digest', t => {
  const j = mitKonfig(t);
  if (!j) return;
  const c = j.services.caddy;
  assert.equal(c.build?.dockerfile, 'Dockerfile.caddy', JSON.stringify(c.build ?? null));
  assert.equal(c.pull_policy, 'build');
  const df = fs.readFileSync(path.join(ROOT, 'Dockerfile.caddy'), 'utf8');
  const basis = [...df.matchAll(/^FROM\s+(\S+)/gm)].map(m => m[1]);
  assert.equal(basis.length, 2);
  for (const b of basis) assert.match(b, /^caddy:[\w.-]+@sha256:[0-9a-f]{64}$/);
  assert.match(df, /^RUN xcaddy build v[\d.]+ /m);
});
