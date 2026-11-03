/**
 * Verschlüsselte Sicherungen: backup.sh mit BACKUP_AGE_EMPFAENGER legt nur
 * *.age-Dateien ab (kein Klartext daneben), restore.sh entschlüsselt sie mit
 * BACKUP_AGE_IDENTITAET und prüft danach wie gewohnt. Echtes `age`, `docker`
 * ist ein Stellvertreter, der einen vollständigen Dump liefert bzw. psql spielt.
 *
 * Gegenproben (03.11.2026 gemessen, je einzeln):
 *   A  in backup.sh `rm -f "$1"` nach dem Verschlüsseln gestrichen → rot:
 *      „kein Klartext neben der verschlüsselten Sicherung" (und Teil 2)
 *   B  in restore.sh das Entschlüsseln übergangen (DUMP bleibt *.age) → rot:
 *      „restore.sh spielt die verschlüsselte Sicherung ein" (Endmarke fehlt)
 *   C  in backup.sh die Prüfung auf age am Anfang gestrichen → rot: „ohne age
 *      kein Klartext"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const hatAge = spawnSync('age', ['--version']).status === 0;

function aufbau(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sicherung-age-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  // exec (restore: psql liest den Dump) schreibt mit, was ankommt; sonst Dump bzw. Ruhe.
  fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh
case "$2" in
  exec) if [ "$5" = pg_dump ]; then printf -- '-- Dump\\nCREATE TABLE probe();\\n-- PostgreSQL database dump complete\\n'; else cat > '${path.join(tmp, 'eingespielt.sql')}'; fi ;;
esac
exit 0
`, { mode: 0o755 });
  const arbeit = path.join(tmp, 'installation');
  fs.mkdirSync(path.join(arbeit, 'data', 'uploads'), { recursive: true });
  fs.mkdirSync(path.join(arbeit, 'schluessel'));
  fs.writeFileSync(path.join(arbeit, 'schluessel', 'datenschluessel'), 'k');
  fs.writeFileSync(path.join(arbeit, 'data', 'uploads', 'anleitung.pdf'), '%PDF-1.4 geheim');
  const identitaet = path.join(tmp, 'privat.txt');
  if (hatAge) execFileSync('age-keygen', ['-o', identitaet], { stdio: 'pipe' });
  const empfaenger = hatAge ? fs.readFileSync(identitaet, 'utf8').match(/public key: (age1\w+)/)[1] : 'age1probe';
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  const lauf = (skript, args, mehr = {}, input = '') => spawnSync('sh', [path.join(ROOT, 'scripts', skript), ...args],
    { cwd: arbeit, encoding: 'utf8', input, env: { ...env, ...mehr } });
  return { tmp, arbeit, ziel: path.join(tmp, 'ziel'), identitaet, empfaenger, lauf };
}

test('kein Klartext neben der verschlüsselten Sicherung', (t) => {
  if (!hatAge) { if (process.env.CI) assert.fail('age fehlt im CI-Lauf'); t.skip('age nicht installiert'); return; }
  const a = aufbau(t);
  const r = a.lauf('backup.sh', [a.ziel], { BACKUP_AGE_EMPFAENGER: a.empfaenger });
  assert.equal(r.status, 0, r.stderr);
  const dateien = fs.readdirSync(a.ziel).sort();
  assert.deepEqual(dateien.map(n => n.replace(/_\d{4}-\d\d-\d\d_\d{4}/, '')), ['data.tar.gz.age', 'db.sql.gz.age'],
    `kein Klartext neben der verschlüsselten Sicherung: ${dateien}`);
  for (const n of dateien) {
    const roh = fs.readFileSync(path.join(a.ziel, n));
    assert.match(roh.subarray(0, 40).toString('latin1'), /^age-encryption\.org\/v1/);
    assert.ok(!roh.includes('geheim') && !roh.includes('PostgreSQL database dump'), `${n} enthält Klartext`);
    assert.equal(fs.statSync(path.join(a.ziel, n)).mode & 0o077, 0);
  }
});

test('restore.sh spielt die verschlüsselte Sicherung ein', (t) => {
  if (!hatAge) { if (process.env.CI) assert.fail('age fehlt im CI-Lauf'); t.skip('age nicht installiert'); return; }
  const a = aufbau(t);
  assert.equal(a.lauf('backup.sh', [a.ziel], { BACKUP_AGE_EMPFAENGER: a.empfaenger }).status, 0);
  const [daten, dump] = fs.readdirSync(a.ziel).sort().map(n => path.join(a.ziel, n));
  fs.rmSync(path.join(a.arbeit, 'data'), { recursive: true });
  const ohne = a.lauf('restore.sh', [dump, daten], {}, 'ja\n');
  assert.notEqual(ohne.status, 0, 'ohne privaten Schlüssel eingespielt');
  assert.match(ohne.stderr, /BACKUP_AGE_IDENTITAET/);
  const r = a.lauf('restore.sh', [dump, daten], { BACKUP_AGE_IDENTITAET: a.identitaet }, 'ja\n');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(fs.readFileSync(path.join(a.tmp, 'eingespielt.sql'), 'utf8'), /CREATE TABLE probe\(\);/);
  assert.equal(fs.readFileSync(path.join(a.arbeit, 'data', 'uploads', 'anleitung.pdf'), 'utf8'), '%PDF-1.4 geheim');
});

test('ohne age kein Klartext', (t) => {
  const a = aufbau(t);
  const r = a.lauf('backup.sh', [a.ziel], { BACKUP_AGE_EMPFAENGER: 'age1probe', AGE: path.join(a.tmp, 'gibt-es-nicht') });
  assert.notEqual(r.status, 0, 'ohne age kein Klartext');
  assert.deepEqual(fs.existsSync(a.ziel) ? fs.readdirSync(a.ziel) : [], []);
});
