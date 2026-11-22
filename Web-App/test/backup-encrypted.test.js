/**
 * Encrypted backups: backup.sh with BACKUP_AGE_EMPFAENGER stores only
 * *.age files (no plain text next to them), restore.sh decrypts them with
 * BACKUP_AGE_IDENTITAET and then checks as usual. Real `age`, `docker`
 * is a stand-in that delivers a complete dump or plays psql.
 *
 * Counter-checks (measured 03.11.2026, each alone):
 *   A  in backup.sh `rm -f "$1"` after encrypting deleted → red:
 *      “no plain text next to the encrypted backup" (and part 2)
 *   B  in restore.sh decryption skipped (DUMP stays *.age) → red:
 *      “restore.sh restores the encrypted backup" (end marker missing)
 *   C  in backup.sh the check for age at the start deleted → red: “without age
 *      no plain text"
 *   D  (03.11.2026, default encrypted) in backup.sh the abort without
 *      recipient deleted (branch `else … exit 1`) → red: “without recipient
 *      no backup"
 *   E  the default ./backup-empfaenger.txt deleted → red: “the recipients
 *      from backup-empfaenger.txt apply without further input" (abort instead of .age)
 *   F  BACKUP_KLARTEXT no longer respected (branch deleted) → red:
 *      “unencrypted only with BACKUP_KLARTEXT=ja"
 * Counter-checks (measured 04.11.2026, each alone):
 *   G  scripts/backup.sh at state 5c2e641 (gzip/tar write to the target, age
 *      afterwards) → red: “there is never plain text at the target …” (db_….sql.gz seen)
 *   H  in backup.sh the removal of $TEIL in the trap deleted → red: “a dump
 *      without end marker leaves nothing at the target”
 *   I  in restore.sh the pre-pass against backslash lines deleted → red:
 *      “restore.sh rejects psql commands in the dump”
 * Counter-checks (round 13, H4; measured 04.11.2026, each alone):
 *   J  in backup.sh `|| echo $? > "$KLAR/tar"` deleted → red: “a tar error
 *      aborts …” (exit 0, archive at the target)
 *   K  in backup.sh the check UNLESBAR deleted → red: “an unreadable file
 *      under data/ …” (tar only reported the error after the dump)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

/** Otherwise a hanging script blocks the file and with it the whole run. */
const CALL_DEADLINE = 120_000;

const ROOT = path.join(__dirname, '..');
const hatAge = spawnSync('age', ['--version']).status === 0;

function setup(t, basis = os.tmpdir()) {
  const tmp = fs.mkdtempSync(path.join(basis, 'sicherung-age-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  // exec (restore: psql reads the dump) records what arrives; otherwise dump or silence.
  fs.writeFileSync(
    path.join(bin, 'docker'),
    `#!/bin/sh
case "$2" in
  exec) if [ "$5" = pg_dump ]; then printf -- '-- Dump\\nCREATE TABLE probe();\\n-- PostgreSQL database dump complete\\n'; else cat > '${path.join(tmp, 'eingespielt.sql')}'; fi ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  const work = path.join(tmp, 'installation');
  fs.mkdirSync(path.join(work, 'data', 'uploads'), { recursive: true });
  fs.mkdirSync(path.join(work, 'schluessel'));
  fs.writeFileSync(path.join(work, 'schluessel', 'datenschluessel'), 'k');
  fs.writeFileSync(path.join(work, 'data', 'uploads', 'anleitung.pdf'), '%PDF-1.4 geheim');
  const identity = path.join(tmp, 'privat.txt');
  if (hatAge) execFileSync('age-keygen', ['-o', identity], { stdio: 'pipe' });
  const recipient = hatAge ? fs.readFileSync(identity, 'utf8').match(/public key: (age1\w+)/)[1] : 'age1probe';
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  const scriptList = {
    'backup.sh': path.join(ROOT, 'scripts', 'backup.sh'),
    'restore.sh': path.join(ROOT, 'scripts', 'restore.sh'),
  };
  const lauf = (script, args, mehr = {}, input = '') =>
    spawnSync('sh', [scriptList[script], ...args], {
      cwd: work,
      encoding: 'utf8',
      input,
      env: { ...env, ...mehr },
      timeout: CALL_DEADLINE,
    });
  return { tmp, work, ziel: path.join(tmp, 'ziel'), identity, recipient, lauf };
}

test('no plaintext next to the encrypted backup', t => {
  if (!hatAge) {
    if (process.env.CI) assert.fail('age fehlt im CI-Lauf');
    t.skip('age not installed');
    return;
  }
  const a = setup(t);
  const r = a.lauf('backup.sh', [a.ziel], { BACKUP_AGE_EMPFAENGER: a.recipient });
  assert.equal(r.status, 0, r.stderr);
  const dateien = fs.readdirSync(a.ziel).sort();
  assert.deepEqual(
    dateien.map(n => n.replace(/_\d{4}-\d\d-\d\d_\d{4}/, '')),
    ['data.tar.gz.age', 'db.sql.gz.age'],
    `kein Klartext neben der verschlüsselten Sicherung: ${dateien}`,
  );
  for (const n of dateien) {
    const roh = fs.readFileSync(path.join(a.ziel, n));
    assert.match(roh.subarray(0, 40).toString('latin1'), /^age-encryption\.org\/v1/);
    assert.ok(!roh.includes('geheim') && !roh.includes('PostgreSQL database dump'), `${n} enthält Klartext`);
    assert.equal(fs.statSync(path.join(a.ziel, n)).mode & 0o077, 0);
  }
});

test('restore.sh loads the encrypted backup', t => {
  if (!hatAge) {
    if (process.env.CI) assert.fail('age fehlt im CI-Lauf');
    t.skip('age not installed');
    return;
  }
  const a = setup(t);
  assert.equal(a.lauf('backup.sh', [a.ziel], { BACKUP_AGE_EMPFAENGER: a.recipient }).status, 0);
  const [daten, dump] = fs
    .readdirSync(a.ziel)
    .sort()
    .map(n => path.join(a.ziel, n));
  fs.rmSync(path.join(a.work, 'data'), { recursive: true });
  const ohne = a.lauf('restore.sh', [dump, daten], {}, 'ja\n');
  assert.notEqual(ohne.status, 0, 'ohne privaten Schlüssel eingespielt');
  assert.match(ohne.stderr, /BACKUP_AGE_IDENTITAET/);
  const r = a.lauf('restore.sh', [dump, daten], { BACKUP_AGE_IDENTITAET: a.identity }, 'ja\n');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(fs.readFileSync(path.join(a.tmp, 'eingespielt.sql'), 'utf8'), /CREATE TABLE probe\(\);/);
  assert.equal(fs.readFileSync(path.join(a.work, 'data', 'uploads', 'anleitung.pdf'), 'utf8'), '%PDF-1.4 geheim');
});

test('without age no plaintext', t => {
  const a = setup(t);
  const r = a.lauf('backup.sh', [a.ziel], {
    BACKUP_AGE_EMPFAENGER: 'age1probe',
    AGE: path.join(a.tmp, 'gibt-es-nicht'),
  });
  assert.notEqual(r.status, 0, 'ohne age kein Klartext');
  assert.deepEqual(fs.existsSync(a.ziel) ? fs.readdirSync(a.ziel) : [], []);
});

test('without recipients no backup', t => {
  const a = setup(t);
  const r = a.lauf('backup.sh', [a.ziel]);
  assert.notEqual(r.status, 0, 'ohne Empfänger gesichert');
  assert.match(r.stderr, /kein Empfänger.*nichts gesichert/s);
  assert.match(r.stderr, /backup-empfaenger\.txt/);
  assert.match(r.stderr, /BACKUP_KLARTEXT=ja/);
  assert.deepEqual(fs.existsSync(a.ziel) ? fs.readdirSync(a.ziel) : [], []);
});

test('the recipients from backup-empfaenger.txt apply without further information', t => {
  if (!hatAge) {
    if (process.env.CI) assert.fail('age fehlt im CI-Lauf');
    t.skip('age not installed');
    return;
  }
  const a = setup(t);
  fs.writeFileSync(path.join(a.work, 'backup-empfaenger.txt'), `# Sicherung\n${a.recipient}\n`);
  const r = a.lauf('backup.sh', [a.ziel]);
  assert.equal(r.status, 0, r.stderr);
  const dateien = fs.readdirSync(a.ziel).sort();
  assert.deepEqual(
    dateien.map(n => n.replace(/_\d{4}-\d\d-\d\d_\d{4}/, '')),
    ['data.tar.gz.age', 'db.sql.gz.age'],
  );
  // Round trip: restore.sh decrypts with the private key and restores.
  const [daten, dump] = dateien.map(n => path.join(a.ziel, n));
  fs.rmSync(path.join(a.work, 'data'), { recursive: true });
  const z = a.lauf('restore.sh', [dump, daten], { BACKUP_AGE_IDENTITAET: a.identity }, 'ja\n');
  assert.equal(z.status, 0, z.stdout + z.stderr);
  assert.match(fs.readFileSync(path.join(a.tmp, 'eingespielt.sql'), 'utf8'), /CREATE TABLE probe\(\);/);
  assert.equal(fs.readFileSync(path.join(a.work, 'data', 'uploads', 'anleitung.pdf'), 'utf8'), '%PDF-1.4 geheim');
});

test('unencrypted only with BACKUP_KLARTEXT=ja', t => {
  const a = setup(t);
  const nein = a.lauf('backup.sh', [a.ziel], { BACKUP_KLARTEXT: '1' });
  assert.notEqual(nein.status, 0, 'BACKUP_KLARTEXT=1 genügt nicht, nur „ja"');
  const r = a.lauf('backup.sh', [a.ziel], { BACKUP_KLARTEXT: 'ja' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /WARNUNG: unverschlüsselt/);
  assert.deepEqual(
    fs
      .readdirSync(a.ziel)
      .map(n => n.replace(/_\d{4}-\d\d-\d\d_\d{4}/, ''))
      .sort(),
    ['data.tar.gz', 'db.sql.gz'],
  );
});

test('there is never plaintext at the target, not even during the backup', t => {
  if (!hatAge) {
    if (process.env.CI) assert.fail('age fehlt im CI-Lauf');
    t.skip('age not installed');
    return;
  }
  const a = setup(t);
  const bin = path.join(a.tmp, 'bin'),
    probe = path.join(a.tmp, 'probe');
  // See what lies at the target in the middle of the dump and after tar.
  fs.writeFileSync(
    path.join(bin, 'docker'),
    `#!/bin/sh
printf -- '-- Dump\\nCREATE TABLE probe();\\n'
sleep 1; ls '${a.ziel}' >> '${probe}'
printf -- '-- PostgreSQL database dump complete\\n'
`,
    { mode: 0o755 },
  );
  const realTar = spawnSync('sh', ['-c', 'command -v tar'], { encoding: 'utf8' }).stdout.trim();
  fs.writeFileSync(
    path.join(bin, 'tar'),
    `#!/bin/sh\n'${realTar}' "$@"; s=$?; ls '${a.ziel}' >> '${probe}'; exit $s\n`,
    { mode: 0o755 },
  );
  const r = a.lauf('backup.sh', [a.ziel], { BACKUP_AGE_EMPFAENGER: a.recipient });
  assert.equal(r.status, 0, r.stderr);
  const gesehen = fs.readFileSync(probe, 'utf8').split('\n').filter(Boolean);
  assert.ok(
    gesehen.some(n => /^db_.*\.sql\.gz\.age$/.test(n)),
    `Vorbedingung: nach tar angesehen: ${gesehen}`,
  );
  assert.deepEqual(
    gesehen.filter(n => !/\.age(\.teil)?$/.test(n)),
    [],
    'Klartext am Ziel',
  );
});

test('a dump without an end marker leaves nothing at the target', t => {
  if (!hatAge) {
    if (process.env.CI) assert.fail('age fehlt im CI-Lauf');
    t.skip('age not installed');
    return;
  }
  const a = setup(t);
  fs.writeFileSync(path.join(a.tmp, 'bin', 'docker'), "#!/bin/sh\nprintf -- '-- Dump, abgebrochen\\n'\nexit 1\n", {
    mode: 0o755,
  });
  const r = a.lauf('backup.sh', [a.ziel], { BACKUP_AGE_EMPFAENGER: a.recipient });
  assert.notEqual(r.status, 0, 'ein Torso gilt als Sicherung');
  assert.match(r.stderr, /Endmarke fehlt/);
  assert.deepEqual(fs.readdirSync(a.ziel), [], 'eine halbe Datei bleibt am Ziel');
});

test('restore.sh rejects psql commands in the dump', t => {
  const a = setup(t);
  const geknackt = path.join(a.tmp, 'geknackt');
  for (const row of [`\\! touch '${geknackt}'`, `  \\copy x to program 'touch ${geknackt}'`]) {
    const dump = path.join(a.tmp, 'fremd.sql');
    fs.writeFileSync(
      dump,
      `-- Dump\nCOPY t (x) FROM stdin;\n\\\\in den Daten erlaubt\n\\.\n${row}\n-- PostgreSQL database dump complete\n`,
    );
    execFileSync('gzip', ['-f', dump]);
    const r = a.lauf('restore.sh', [`${dump}.gz`], {}, 'ja\n');
    assert.notEqual(r.status, 0, `eingespielt: ${row}`);
    assert.match(r.stderr, /psql-Befehle/);
    assert.ok(!fs.existsSync(path.join(a.tmp, 'eingespielt.sql')), 'psql bekam den Dump');
  }
  assert.ok(!fs.existsSync(geknackt));
});

test('a tar error aborts and leaves no archive', t => {
  const a = setup(t);
  fs.writeFileSync(
    path.join(a.tmp, 'bin', 'tar'),
    "#!/bin/sh\nprintf 'halb'\necho 'tar: data/x: Cannot open' >&2\nexit 2\n",
    { mode: 0o755 },
  );
  const r = a.lauf('backup.sh', [a.ziel], { BACKUP_KLARTEXT: 'ja' });
  assert.notEqual(r.status, 0, 'ein tar-Fehler bricht ab …');
  assert.match(r.stderr, /tar endete mit Status 2/);
  assert.deepEqual(
    fs.readdirSync(a.ziel).filter(n => n.startsWith('data_')),
    [],
    'ein halbes Archiv liegt am Ziel',
  );
});

test('an unreadable file under data/ aborts before the dump', t => {
  // As root the script below runs as “nobody”; its path must lead through all folders.
  // TMPDIR and the working tree may be private (0700), /tmp never is.
  const a = setup(t, process.getuid() === 0 ? '/tmp' : os.tmpdir());
  const geheim = path.join(a.work, 'data', 'uploads', 'fremd.pdf');
  fs.writeFileSync(geheim, 'nur für den Dienst', { mode: 0o600 });
  let r;
  if (process.getuid() === 0) {
    // root reads everything: run as “nobody”, the file stays with root.
    if (spawnSync('setpriv', ['--version']).status !== 0) {
      t.skip('setpriv is missing');
      return;
    }
    fs.chmodSync(a.tmp, 0o755);
    execFileSync('chown', ['-R', '65534:65534', a.tmp]);
    fs.chownSync(geheim, 0, 0);
    const script = path.join(a.tmp, 'backup.sh');
    fs.copyFileSync(path.join(ROOT, 'scripts', 'backup.sh'), script);
    fs.chmodSync(script, 0o755);
    r = spawnSync('setpriv', ['--reuid=65534', '--regid=65534', '--clear-groups', 'sh', script, a.ziel], {
      cwd: a.work,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${path.join(a.tmp, 'bin')}:${process.env.PATH}`,
        BACKUP_KLARTEXT: 'ja',
        TMPDIR: a.tmp,
      },
      timeout: CALL_DEADLINE,
    });
  } else {
    fs.chmodSync(geheim, 0o000);
    // The setup clears its folder first; then there is nothing left to restore.
    t.after(() => {
      if (fs.existsSync(geheim)) fs.chmodSync(geheim, 0o600);
    });
    r = a.lauf('backup.sh', [a.ziel], { BACKUP_KLARTEXT: 'ja' });
  }
  assert.notEqual(r.status, 0, 'eine unlesbare Datei unter data/ …');
  assert.match(r.stderr, /nicht vollständig lesbar \(data\/uploads\/fremd\.pdf\)/, r.stderr);
  assert.match(r.stderr, /root oder mit der UID des Dienstes/);
  assert.deepEqual(fs.existsSync(a.ziel) ? fs.readdirSync(a.ziel) : [], [], 'vor dem Dump abbrechen');
});
