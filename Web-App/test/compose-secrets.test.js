/**
 * No service gets a password or secret as an environment variable: those are
 * shown by `docker inspect` to everyone with access to Docker. compose.yaml is read
 * by `docker compose config` itself (interpolation, profiles, short notations),
 * not via regex. Skipped without Docker CLI, not in CI.
 *
 * Counter-checks (measured 03.11.2026, each alone):
 *   A  for app again `SESSION_SECRET: ${SESSION_SECRET:-x}` → red: “app:
 *      secret as environment variable (SESSION_SECRET)”
 *   B  for jobs `secrets: [db_app_password]` deleted → red: “jobs:
 *      PGPASSWORD_FILE points to a secret that is not mounted”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

function config() {
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
        CADDY_IMAGE: 'brickinventory-caddy:probe',
      },
    },
  );
  if (r.error || r.status !== 0) return { error: r.error?.message || r.stderr };
  return { j: JSON.parse(r.stdout) };
}

test('secrets only as files under /run/secrets', t => {
  const { j, error } = config();
  if (!j) {
    if (process.env.CI) assert.fail(`docker compose config im CI-Lauf: ${error}`);
    t.skip(`no docker compose: ${error}`);
    return;
  }
  const dienste = Object.keys(j.services).sort();
  assert.deepEqual(dienste, [
    'app',
    'caddy',
    'caddy-rechte',
    'daten-rechte',
    'db-rolle',
    'jobs',
    'migration',
    'postgres',
    'schluessel',
  ]);
  let dateien = 0;
  for (const [name, d] of Object.entries(j.services)) {
    const env = d.environment || {};
    const suspicious = Object.keys(env).filter(k => /(PASSWORD|SECRET|_PASS|DATABASE_URL|DATA_KEY)$/.test(k));
    assert.deepEqual(suspicious, [], `${name}: Geheimnis als Umgebungsvariable (${suspicious})`);
    const mounted = (d.secrets || []).map(s => s.target || `/run/secrets/${s.source}`);
    for (const [k, v] of Object.entries(env).filter(
      ([k]) => k.endsWith('_FILE') && !['DATA_KEY_FILE', 'DATA_KEY_ALT_FILE'].includes(k),
    )) {
      dateien++;
      assert.ok(mounted.includes(v), `${name}: ${k} zeigt auf ein nicht eingehängtes Secret (${v})`);
    }
  }
  assert.ok(dateien >= 8, `nur ${dateien} *_FILE-Angaben — liest der Test noch die richtige Datei?`);
  for (const s of Object.values(j.secrets)) assert.match(s.file, /[\\/]geheimnisse[\\/][a-z_]+$/);
});
