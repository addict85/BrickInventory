/**
 * Kein Dienst bekommt ein Passwort oder Geheimnis als Umgebungsvariable: Die
 * zeigt `docker inspect` jedem mit Zugang zu Docker. Gelesen wird compose.yaml
 * von `docker compose config` selbst (Interpolation, Profile, Kurzschreibweisen),
 * nicht per Regex. Ohne Docker-CLI wird übersprungen, in CI nicht.
 *
 * Gegenproben (03.11.2026 gemessen, je einzeln):
 *   A  bei app wieder `SESSION_SECRET: ${SESSION_SECRET:-x}` → rot: „app:
 *      Geheimnis als Umgebungsvariable (SESSION_SECRET)“
 *   B  bei jobs `secrets: [db_app_password]` gestrichen → rot: „jobs:
 *      PGPASSWORD_FILE zeigt auf ein nicht eingehängtes Secret“
 *   C  pgweb-Port wieder "8081:8081" → rot: „pgweb ist nur auf 127.0.0.1 erreichbar“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

function konfig() {
  const r = spawnSync('docker', ['compose', '-f', path.join(ROOT, 'compose.yaml'), '--profile', 'tools', 'config', '--format', 'json'],
    { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, BRICK_HOST: 'nas.example.lan',
           BRICK_IMAGE: `addict85/brickinventory@sha256:${'0'.repeat(64)}` } });
  if (r.error || r.status !== 0) return { fehler: r.error?.message || r.stderr };
  return { j: JSON.parse(r.stdout) };
}

test('Geheimnisse nur als Dateien unter /run/secrets', (t) => {
  const { j, fehler } = konfig();
  if (!j) {
    if (process.env.CI) assert.fail(`docker compose config im CI-Lauf: ${fehler}`);
    t.skip(`kein docker compose: ${fehler}`); return;
  }
  const dienste = Object.keys(j.services).sort();
  assert.deepEqual(dienste, ['app', 'caddy', 'db-rolle', 'jobs', 'pgweb', 'postgres', 'schluessel']);
  let dateien = 0;
  for (const [name, d] of Object.entries(j.services)) {
    const env = d.environment || {};
    const verdaechtig = Object.keys(env).filter(k => /(PASSWORD|SECRET|_PASS|DATABASE_URL|DATA_KEY)$/.test(k));
    assert.deepEqual(verdaechtig, [], `${name}: Geheimnis als Umgebungsvariable (${verdaechtig})`);
    const eingehaengt = (d.secrets || []).map(s => s.target || `/run/secrets/${s.source}`);
    for (const [k, v] of Object.entries(env).filter(([k]) => k.endsWith('_FILE') && k !== 'DATA_KEY_FILE')) {
      dateien++;
      assert.ok(eingehaengt.includes(v), `${name}: ${k} zeigt auf ein nicht eingehängtes Secret (${v})`);
    }
  }
  assert.ok(dateien >= 8, `nur ${dateien} *_FILE-Angaben — liest der Test noch die richtige Datei?`);
  for (const s of Object.values(j.secrets)) assert.match(s.file, /[\\/]geheimnisse[\\/][a-z_]+$/);
});

test('pgweb ist nur auf 127.0.0.1 erreichbar und teilt sein Netz nur mit postgres', (t) => {
  const { j, fehler } = konfig();
  if (!j) {
    if (process.env.CI) assert.fail(`docker compose config im CI-Lauf: ${fehler}`);
    t.skip(`kein docker compose: ${fehler}`); return;
  }
  const p = j.services.pgweb;
  assert.ok(p.ports.length > 0);
  for (const port of p.ports) assert.equal(port.host_ip, '127.0.0.1', 'pgweb ist nur auf 127.0.0.1 erreichbar');
  assert.equal(p.read_only, true);
  assert.equal(p.user, '1000:1000');
  assert.deepEqual(p.cap_drop, ['ALL']);
  const imNetz = Object.entries(j.services).filter(([, d]) => Object.keys(d.networks || {}).includes('pgweb-net')).map(([n]) => n).sort();
  assert.deepEqual(imNetz, ['pgweb', 'postgres']);
  assert.deepEqual(Object.keys(p.networks), ['pgweb-net']);
});
