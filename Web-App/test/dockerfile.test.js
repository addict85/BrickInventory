/**
 * Bau-Image: keine Werkzeuge ohne Zweck.
 * Ausführlich: docs/begruendungen/test/dockerfile.test.js.md#kopf
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

test('das Build-Stage installiert keine Compiler-Werkzeuge', () => {
  const df = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  // Kommentare zählen nicht — dort steht die Zeile als Hinweis für den Fall,
  // dass sie doch einmal gebraucht wird.
  const cmds = df.split('\n').filter(l => !l.trim().startsWith('#'));
  for (const tool of ['python3', 'make', 'g++']) {
    assert.ok(!cmds.some(l => l.includes('apk add') && l.includes(tool)),
      `${tool} wird installiert, obwohl nichts kompiliert`);
  }
});

test('und keine Abhängigkeit braucht sie', () => {
  // Zwei Belege, beide aus der Lockfile — sie gilt im Build (npm ci):
  //   1. kein Paket mit nativer Erweiterung
  //   2. die Pakete mit Install-Skript sind bekannt und harmlos
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const withScript = Object.entries(lock.packages || {})
    // Der leere Schlüssel ist das Projekt selbst; es hat kein Install-Skript
    // (test/version.test.js).
    .filter(([k, v]) => k && v.hasInstallScript)
    .map(([k]) => k.replace(/^.*node_modules\//, ''));

  // esbuild lädt eine fertige Binärdatei für die Plattform, fsevents ist
  // macOS-only und wird auf Linux gar nicht erst installiert.
  const harmless = new Set(['esbuild', 'fsevents']);
  const unknown = [...new Set(withScript)].filter(p => !harmless.has(p));
  assert.deepEqual(unknown, [],
    `Neue Pakete mit Install-Skript: ${unknown.join(', ')} — prüfen, ob sie kompilieren. ` +
    'Falls ja, gehört `RUN apk add --no-cache python3 make g++` zurück ins Build-Stage.');
});

// Gegenprobe (am 28.10.2026 gemessen): `ENV PGPASSWORD=brickinventory_secret`
// wieder ins Dockerfile → rot. Ein ENV steht in jeder Kopie des Images.
test('das Image trägt kein Datenbankpasswort', () => {
  const df = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  const zeilen = df.split('\n').filter(l => !l.trim().startsWith('#'));
  assert.deepEqual(zeilen.filter(l => /^\s*(ENV|ARG)\b.*(PASSWORD|_SECRET|PGPASS)/i.test(l)), []);
  const compose = fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');
  assert.match(compose, /PGPASSWORD_FILE: \/run\/secrets\/db_app_password/, 'compose.yaml muss das Passwort als Datei hereinreichen');
});

// Gegenprobe (am 28.10.2026 gemessen): den Digest an der zweiten FROM-Zeile
// entfernt → rot. Ein Tag wie node:26-alpine zeigt morgen auf ein anderes Image.
test('Basis-Images stehen per Digest fest', () => {
  const quellen = {
    Dockerfile: fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8'),
    'compose.yaml': fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8'),
  };
  const lose = [];
  for (const [name, text] of Object.entries(quellen))
    for (const m of text.matchAll(/^\s*(?:FROM|image:)\s+(node|postgres)(:[^\s]+)/gm))
      if (!/@sha256:[0-9a-f]{64}/.test(m[2])) lose.push(`${name}: ${m[1]}${m[2]}`);
  assert.ok([...quellen.Dockerfile.matchAll(/^FROM /gm)].length >= 2, 'FROM-Zeilen nicht gefunden');
  assert.deepEqual(lose, []);
});

// Gegenprobe (30.10.2026): die rm-Zeile im Laufzeit-Stage entfernt → rot.
test('das Laufzeit-Image trägt kein npm, corepack oder yarn', () => {
  const df = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  const laufzeit = df.split(/^FROM /m).pop().split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
  for (const pfad of ['/usr/local/lib/node_modules', '/usr/local/bin/npm', '/usr/local/bin/corepack', '/opt/yarn-'])
    assert.ok(laufzeit.includes(pfad), `${pfad} bleibt im Laufzeit-Image`);
});

test('Geheimnisse und Sicherungen bleiben aus Image und Repository', (t) => {
  // Der Build-Kontext ist Web-App/: Ohne Eintrag landeten .env (Passwörter),
  // die Sicherungen von scripts/backup.sh und der Datenschlüssel im Image.
  // Gegenprobe (01.11.2026): `backups` aus .dockerignore gestrichen → rot.
  const muster = fs.readFileSync(path.join(ROOT, '.dockerignore'), 'utf8').split('\n').map(l => l.trim());
  // (03.11.2026) `geheimnisse` aus .gitignore gestrichen → rot.
  for (const m of ['.env', '.env.*', 'backups', 'schluessel', 'data', 'geheimnisse'])
    assert.ok(muster.includes(m), `.dockerignore schliesst ${m} nicht aus`);
  // Der zweite Teil fragt git; ohne Arbeitsbaum (Kopie ohne .git, Image) nur
  // mit Meldung übersprungen, in der CI (REQUIRE_DB=1) ein Fehler.
  // Gegenprobe (04.11.2026): Kopie des Baums ohne .git → übersprungen mit
  // „kein Git-Arbeitsbaum“, mit REQUIRE_DB=1 rot.
  const baum = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ROOT, encoding: 'utf8' });
  if (baum.error || baum.status !== 0) {
    const grund = `kein Git-Arbeitsbaum unter ${ROOT} (${baum.error?.message || baum.stderr.trim()})`;
    if (process.env.REQUIRE_DB === '1') assert.fail(`REQUIRE_DB=1: .gitignore lässt sich nicht prüfen, ${grund}`);
    t.skip(grund); return;
  }
  const git = spawnSync('git', ['check-ignore', '--no-index', 'backups/x.sql.gz', 'schluessel/datenschluessel', '.env',
    'geheimnisse/db_password'], { cwd: ROOT, encoding: 'utf8' });
  assert.deepEqual(git.stdout.trim().split('\n').sort(), ['.env', 'backups/x.sql.gz', 'geheimnisse/db_password', 'schluessel/datenschluessel']);
});

// Gegenproben (03.11.2026 gemessen, je einzeln): im Dockerfile wieder `RUN npm ci`
// → rot „Dockerfile: npm ci ohne --ignore-scripts“; `npm rebuild esbuild` in
// web-ci.yml gestrichen → rot „web-ci.yml baut nicht genau …“.
test('Install-Skripte laufen nur gezielt, für genau die Pakete, die eines haben', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  // fsevents gibt es nur unter macOS; auf Linux wird es nie installiert.
  const mitSkript = Object.entries(lock.packages)
    .filter(([n, p]) => p.hasInstallScript && !/(^|\/)fsevents$/.test(n))
    .map(([n]) => n.replace(/^.*node_modules\//, '')).sort();
  assert.ok(mitSkript.includes('esbuild'), `Vorbedingung: esbuild hat ein Install-Skript (${mitSkript})`);
  const quellen = {
    Dockerfile: fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8'),
    'web-ci.yml': fs.readFileSync(path.join(ROOT, '..', '.github', 'workflows', 'web-ci.yml'), 'utf8'),
    'sicherheit.yml': fs.readFileSync(path.join(ROOT, '..', '.github', 'workflows', 'sicherheit.yml'), 'utf8'),
  };
  for (const [name, text] of Object.entries(quellen)) {
    const code = text.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
    const aufrufe = [...code.matchAll(/npm ci\b[^\n&]*/g)].map(m => m[0]);
    assert.ok(aufrufe.length > 0, `${name}: kein npm ci gefunden`);
    for (const a of aufrufe) assert.match(a, /--ignore-scripts/, `${name}: npm ci ohne --ignore-scripts`);
    const gebaut = [...code.matchAll(/npm rebuild ([^\n&]+)/g)].flatMap(m => m[1].trim().split(/\s+/)).sort();
    assert.deepEqual(gebaut, mitSkript, `${name} baut nicht genau die Pakete mit Install-Skript`);
  }
});
