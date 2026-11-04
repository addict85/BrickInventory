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
 *   D  (03.11.2026, Vorgabe verschlüsselt) in backup.sh den Abbruch ohne
 *      Empfänger gestrichen (Zweig `else … exit 1`) → rot: „ohne Empfänger
 *      keine Sicherung"
 *   E  die Vorgabe ./backup-empfaenger.txt gestrichen → rot: „die Empfänger
 *      aus backup-empfaenger.txt gelten ohne weitere Angabe" (Abbruch statt .age)
 *   F  BACKUP_KLARTEXT nicht mehr beachtet (Zweig gestrichen) → rot:
 *      „unverschlüsselt nur mit BACKUP_KLARTEXT=ja"
 * Gegenproben (04.11.2026 gemessen, je einzeln):
 *   G  scripts/backup.sh auf Stand 5c2e641 (gzip/tar schreiben ans Ziel, age
 *      danach) → rot: „am Ziel liegt nie Klartext …“ (db_….sql.gz gesehen)
 *   H  in backup.sh das Entfernen von $TEIL im trap gestrichen → rot: „ein Dump
 *      ohne Endmarke hinterlässt nichts am Ziel“
 *   I  in restore.sh den Vorlauf gegen Backslash-Zeilen gestrichen → rot:
 *      „restore.sh weist psql-Befehle im Dump ab“
 * Gegenproben (Runde 13, H4; 04.11.2026 gemessen, je einzeln):
 *   J  in backup.sh `|| echo $? > "$KLAR/tar"` gestrichen → rot: „ein tar-Fehler
 *      bricht ab …“ (Exit 0, Archiv am Ziel)
 *   K  in backup.sh die Prüfung UNLESBAR gestrichen → rot: „eine unlesbare Datei
 *      unter data/ …“ (tar meldete den Fehler erst nach dem Dump)
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
  const skripte = { 'backup.sh': path.join(ROOT, 'scripts', 'backup.sh'), 'restore.sh': path.join(ROOT, 'scripts', 'restore.sh') };
  const lauf = (skript, args, mehr = {}, input = '') => spawnSync('sh', [skripte[skript], ...args],
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

test('ohne Empfänger keine Sicherung', (t) => {
  const a = aufbau(t);
  const r = a.lauf('backup.sh', [a.ziel]);
  assert.notEqual(r.status, 0, 'ohne Empfänger gesichert');
  assert.match(r.stderr, /kein Empfänger.*nichts gesichert/s);
  assert.match(r.stderr, /backup-empfaenger\.txt/);
  assert.match(r.stderr, /BACKUP_KLARTEXT=ja/);
  assert.deepEqual(fs.existsSync(a.ziel) ? fs.readdirSync(a.ziel) : [], []);
});

test('die Empfänger aus backup-empfaenger.txt gelten ohne weitere Angabe', (t) => {
  if (!hatAge) { if (process.env.CI) assert.fail('age fehlt im CI-Lauf'); t.skip('age nicht installiert'); return; }
  const a = aufbau(t);
  fs.writeFileSync(path.join(a.arbeit, 'backup-empfaenger.txt'), `# Sicherung\n${a.empfaenger}\n`);
  const r = a.lauf('backup.sh', [a.ziel]);
  assert.equal(r.status, 0, r.stderr);
  const dateien = fs.readdirSync(a.ziel).sort();
  assert.deepEqual(dateien.map(n => n.replace(/_\d{4}-\d\d-\d\d_\d{4}/, '')), ['data.tar.gz.age', 'db.sql.gz.age']);
  // Rundlauf: restore.sh entschlüsselt mit dem privaten Schlüssel und spielt ein.
  const [daten, dump] = dateien.map(n => path.join(a.ziel, n));
  fs.rmSync(path.join(a.arbeit, 'data'), { recursive: true });
  const z = a.lauf('restore.sh', [dump, daten], { BACKUP_AGE_IDENTITAET: a.identitaet }, 'ja\n');
  assert.equal(z.status, 0, z.stdout + z.stderr);
  assert.match(fs.readFileSync(path.join(a.tmp, 'eingespielt.sql'), 'utf8'), /CREATE TABLE probe\(\);/);
  assert.equal(fs.readFileSync(path.join(a.arbeit, 'data', 'uploads', 'anleitung.pdf'), 'utf8'), '%PDF-1.4 geheim');
});

test('unverschlüsselt nur mit BACKUP_KLARTEXT=ja', (t) => {
  const a = aufbau(t);
  const nein = a.lauf('backup.sh', [a.ziel], { BACKUP_KLARTEXT: '1' });
  assert.notEqual(nein.status, 0, 'BACKUP_KLARTEXT=1 genügt nicht, nur „ja"');
  const r = a.lauf('backup.sh', [a.ziel], { BACKUP_KLARTEXT: 'ja' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /WARNUNG: unverschlüsselt/);
  assert.deepEqual(fs.readdirSync(a.ziel).map(n => n.replace(/_\d{4}-\d\d-\d\d_\d{4}/, '')).sort(), ['data.tar.gz', 'db.sql.gz']);
});

test('am Ziel liegt nie Klartext, auch nicht während der Sicherung', (t) => {
  if (!hatAge) { if (process.env.CI) assert.fail('age fehlt im CI-Lauf'); t.skip('age nicht installiert'); return; }
  const a = aufbau(t);
  const bin = path.join(a.tmp, 'bin'), probe = path.join(a.tmp, 'probe');
  // Mitten im Dump und nach tar sehen, was am Ziel liegt.
  fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh
printf -- '-- Dump\\nCREATE TABLE probe();\\n'
sleep 1; ls '${a.ziel}' >> '${probe}'
printf -- '-- PostgreSQL database dump complete\\n'
`, { mode: 0o755 });
  const echtesTar = spawnSync('sh', ['-c', 'command -v tar'], { encoding: 'utf8' }).stdout.trim();
  fs.writeFileSync(path.join(bin, 'tar'), `#!/bin/sh\n'${echtesTar}' "$@"; s=$?; ls '${a.ziel}' >> '${probe}'; exit $s\n`, { mode: 0o755 });
  const r = a.lauf('backup.sh', [a.ziel], { BACKUP_AGE_EMPFAENGER: a.empfaenger });
  assert.equal(r.status, 0, r.stderr);
  const gesehen = fs.readFileSync(probe, 'utf8').split('\n').filter(Boolean);
  assert.ok(gesehen.some(n => /^db_.*\.sql\.gz\.age$/.test(n)), `Vorbedingung: nach tar angesehen: ${gesehen}`);
  assert.deepEqual(gesehen.filter(n => !/\.age(\.teil)?$/.test(n)), [], 'Klartext am Ziel');
});

test('ein Dump ohne Endmarke hinterlässt nichts am Ziel', (t) => {
  if (!hatAge) { if (process.env.CI) assert.fail('age fehlt im CI-Lauf'); t.skip('age nicht installiert'); return; }
  const a = aufbau(t);
  fs.writeFileSync(path.join(a.tmp, 'bin', 'docker'), "#!/bin/sh\nprintf -- '-- Dump, abgebrochen\\n'\nexit 1\n", { mode: 0o755 });
  const r = a.lauf('backup.sh', [a.ziel], { BACKUP_AGE_EMPFAENGER: a.empfaenger });
  assert.notEqual(r.status, 0, 'ein Torso gilt als Sicherung');
  assert.match(r.stderr, /Endmarke fehlt/);
  assert.deepEqual(fs.readdirSync(a.ziel), [], 'eine halbe Datei bleibt am Ziel');
});

test('restore.sh weist psql-Befehle im Dump ab', (t) => {
  const a = aufbau(t);
  const geknackt = path.join(a.tmp, 'geknackt');
  for (const zeile of [`\\! touch '${geknackt}'`, `  \\copy x to program 'touch ${geknackt}'`]) {
    const dump = path.join(a.tmp, 'fremd.sql');
    fs.writeFileSync(dump, `-- Dump\nCOPY t (x) FROM stdin;\n\\\\in den Daten erlaubt\n\\.\n${zeile}\n-- PostgreSQL database dump complete\n`);
    execFileSync('gzip', ['-f', dump]);
    const r = a.lauf('restore.sh', [`${dump}.gz`], {}, 'ja\n');
    assert.notEqual(r.status, 0, `eingespielt: ${zeile}`);
    assert.match(r.stderr, /psql-Befehle/);
    assert.ok(!fs.existsSync(path.join(a.tmp, 'eingespielt.sql')), 'psql bekam den Dump');
  }
  assert.ok(!fs.existsSync(geknackt));
});

test('ein tar-Fehler bricht ab und hinterlässt kein Archiv', (t) => {
  const a = aufbau(t);
  fs.writeFileSync(path.join(a.tmp, 'bin', 'tar'), "#!/bin/sh\nprintf 'halb'\necho 'tar: data/x: Cannot open' >&2\nexit 2\n", { mode: 0o755 });
  const r = a.lauf('backup.sh', [a.ziel], { BACKUP_KLARTEXT: 'ja' });
  assert.notEqual(r.status, 0, 'ein tar-Fehler bricht ab …');
  assert.match(r.stderr, /tar endete mit Status 2/);
  assert.deepEqual(fs.readdirSync(a.ziel).filter(n => n.startsWith('data_')), [], 'ein halbes Archiv liegt am Ziel');
});

test('eine unlesbare Datei unter data/ bricht vor dem Dump ab', (t) => {
  const a = aufbau(t);
  const geheim = path.join(a.arbeit, 'data', 'uploads', 'fremd.pdf');
  fs.writeFileSync(geheim, 'nur für den Dienst', { mode: 0o600 });
  let r;
  if (process.getuid() === 0) {
    // root liest alles: als „nobody“ ausführen, die Datei bleibt bei root.
    if (spawnSync('setpriv', ['--version']).status !== 0) { t.skip('setpriv fehlt'); return; }
    fs.chmodSync(a.tmp, 0o755);
    execFileSync('chown', ['-R', '65534:65534', a.tmp]);
    fs.chownSync(geheim, 0, 0);
    r = spawnSync('setpriv', ['--reuid=65534', '--regid=65534', '--clear-groups', 'sh', path.join(ROOT, 'scripts', 'backup.sh'), a.ziel],
      { cwd: a.arbeit, encoding: 'utf8', env: { ...process.env, PATH: `${path.join(a.tmp, 'bin')}:${process.env.PATH}`, BACKUP_KLARTEXT: 'ja' } });
  } else {
    fs.chmodSync(geheim, 0o000);
    t.after(() => fs.chmodSync(geheim, 0o600));
    r = a.lauf('backup.sh', [a.ziel], { BACKUP_KLARTEXT: 'ja' });
  }
  assert.notEqual(r.status, 0, 'eine unlesbare Datei unter data/ …');
  assert.match(r.stderr, /nicht vollständig lesbar \(data\/uploads\/fremd\.pdf\)/, r.stderr);
  assert.match(r.stderr, /root oder mit der UID des Dienstes/);
  assert.deepEqual(fs.existsSync(a.ziel) ? fs.readdirSync(a.ziel) : [], [], 'vor dem Dump abbrechen');
});
