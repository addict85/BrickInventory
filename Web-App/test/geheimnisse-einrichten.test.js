/**
 * scripts/geheimnisse-einrichten.sh legt die Dateien an, die compose.yaml als
 * Docker-Secrets einhängt: neu erzeugt, aus einer alten .env übernommen, nie
 * überschrieben, und ohne das Passwort einer bestehenden Datenbank gar nicht.
 * Das Skript läuft wirklich (sh in einem Sandkasten).
 *
 * Gegenproben (03.11.2026 gemessen, je einzeln):
 *   A  `chmod 700 "$ORDNER"` gestrichen → rot: „ein zweiter Lauf …“ (ein
 *      vorhandener Ordner mit 755 bleibt offen)
 *   B  die Prüfung auf ./pgdata18 ohne DB_PASSWORD gestrichen → rot: „eine
 *      bestehende Datenbank ohne DB_PASSWORD …“ (neues Passwort erzeugt)
 *   C  in richte_ein die Abfrage `[ -s "$ORDNER/$1" ]` gestrichen → rot: „ein
 *      zweiter Lauf …“ (session_secret neu erzeugt)
 *   D  compose.yaml: Datei ./geheimnisse/pgweb_passwort statt …_password → rot: „compose.yaml
 *      hängt genau diese Dateien ein“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SKRIPT = path.join(ROOT, 'scripts', 'geheimnisse-einrichten.sh');
const NAMEN = ['db_app_password', 'db_migration_password', 'db_password', 'pgweb_db_password', 'session_secret'];

function sandkasten(t) {
  const ort = fs.mkdtempSync(path.join(os.tmpdir(), 'geheimnisse-'));
  t.after(() => fs.rmSync(ort, { recursive: true, force: true }));
  const lauf = (mehr = {}) => spawnSync('sh', ['-c', 'umask 022; exec sh "$0"', SKRIPT],
    { cwd: ort, encoding: 'utf8', env: { PATH: process.env.PATH, ...mehr } });
  const lies = (n) => fs.readFileSync(path.join(ort, 'geheimnisse', n), 'utf8');
  return { ort, lauf, lies };
}

test('eine neue Installation bekommt zufällige Geheimnisse, nur für den Besitzer erreichbar', (t) => {
  const s = sandkasten(t);
  const r = s.lauf();
  assert.equal(r.status, 0, r.stderr);
  const ordner = path.join(s.ort, 'geheimnisse');
  assert.deepEqual(fs.readdirSync(ordner).sort(), NAMEN);
  assert.equal(fs.statSync(ordner).mode & 0o777, 0o700, 'der Ordner ist für andere offen');
  for (const n of NAMEN) assert.equal(fs.statSync(path.join(ordner, n)).mode & 0o777, 0o444, `${n}: Modus`);
  assert.match(s.lies('session_secret'), /^[0-9a-f]{96}$/);
  assert.match(s.lies('db_password'), /^[0-9a-f]{48}$/);
  assert.match(s.lies('db_app_password'), /^[0-9a-f]{48}$/);
  assert.notEqual(s.lies('db_password'), s.lies('db_app_password'));
  assert.match(s.lies('db_migration_password'), /^[0-9a-f]{48}$/);
  // Leer heisst: Die Leserolle meldet sich nicht an.
  assert.equal(s.lies('pgweb_db_password'), '');
});

test('eine bestehende Installation übernimmt die Werte aus .env', (t) => {
  const s = sandkasten(t);
  fs.mkdirSync(path.join(s.ort, 'pgdata18'));
  fs.writeFileSync(path.join(s.ort, '.env'), [
    'BRICK_HOST=nas.example.lan', 'SESSION_SECRET="alt-sitzung-mindestens-zweiunddreissig-zeichen"',
    'DB_PASSWORD=su+/=pw', "DB_APP_PASSWORD='app pw'", 'PGWEB_PASSWORD=browser', ''].join('\n'));
  const r = s.lauf({ PGWEB: 'ja' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(s.lies('session_secret'), 'alt-sitzung-mindestens-zweiunddreissig-zeichen');
  assert.equal(s.lies('db_password'), 'su+/=pw');
  assert.equal(s.lies('db_app_password'), 'app pw');
  // Die Migrationsrolle kam später dazu; db-rolle setzt ihr Passwort, ein neues passt also.
  assert.match(s.lies('db_migration_password'), /^[0-9a-f]{48}$/);
  assert.match(s.lies('pgweb_db_password'), /^[0-9a-f]{48}$/);
  assert.match(r.stderr, /aus \.env löschen.*SESSION_SECRET DB_PASSWORD DB_APP_PASSWORD PGWEB_PASSWORD/);
});

test('eine bestehende Datenbank ohne DB_PASSWORD bekommt kein neues', (t) => {
  const s = sandkasten(t);
  fs.mkdirSync(path.join(s.ort, 'pgdata18'));
  const r = s.lauf();
  assert.notEqual(r.status, 0, 'ein neues Superuser-Passwort passte nicht zur Datenbank');
  assert.match(r.stderr, /DB_PASSWORD/);
  assert.equal(fs.existsSync(path.join(s.ort, 'geheimnisse', 'db_password')), false);
});

test('ein zweiter Lauf ändert nichts, PGWEB=ja füllt nur die leeren', (t) => {
  const s = sandkasten(t);
  assert.equal(s.lauf().status, 0);
  const vorher = Object.fromEntries(NAMEN.map(n => [n, s.lies(n)]));
  fs.chmodSync(path.join(s.ort, 'geheimnisse'), 0o755);
  const r = s.lauf({ PGWEB: 'ja' });
  assert.equal(r.status, 0, r.stderr);
  for (const n of ['session_secret', 'db_password', 'db_app_password', 'db_migration_password']) assert.equal(s.lies(n), vorher[n], `${n} neu erzeugt`);
  assert.match(s.lies('pgweb_db_password'), /^[0-9a-f]{48}$/);
  assert.equal(fs.statSync(path.join(s.ort, 'geheimnisse')).mode & 0o777, 0o700, 'ein offener Ordner bleibt offen');
  const pw = s.lies('pgweb_db_password');
  assert.equal(s.lauf({ PGWEB: 'ja' }).status, 0);
  assert.equal(s.lies('pgweb_db_password'), pw);
});

test('compose.yaml hängt genau diese Dateien ein', () => {
  const compose = fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');
  const teil = compose.slice(compose.search(/^secrets:/m));
  const dateien = [...teil.matchAll(/^\s+file:\s*\.\/geheimnisse\/(\S+)\s*$/gm)].map(m => m[1]).sort();
  assert.deepEqual(dateien, NAMEN);
});
