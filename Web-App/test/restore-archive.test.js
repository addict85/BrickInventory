/**
 * scripts/restore.sh only unpacks a data archive if it consists of files and
 * folders under data/ (scripts/archiv-pruefen.sh). The real
 * script runs with a valid dump: a malicious archive aborts BEFORE the
 * confirmation prompt, a good one gets as far as the prompt (ended there with „nein",
 * docker is never reached).
 *
 * Counter-checks (measured 01.11.2026, each on its own):
 *   A  call of archiv-pruefen.sh removed in restore.sh → red for all
 *      malicious archives („erreicht die Rückfrage nicht")
 *   B  check for links removed → red: „Verknüpfung nach aussen"
 *      and „harter Link"
 *   C  check for ".." removed → red: „Pfad mit .."
 *   D  check for data/ removed → red: „absoluter Pfad", „anderer Ordner"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync, execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const RESTORE = path.join(ROOT, 'scripts', 'restore.sh');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-archiv-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const DUMP = path.join(tmp, 'db.sql.gz');
fs.writeFileSync(DUMP, zlib.gzipSync('SELECT 1;\n--\n-- PostgreSQL database dump complete\n--\n'));

/** Build an archive from a working folder; `bauen(ordner)` creates the content. */
function archive(name, bauen, tarArgs = ['data']) {
  const ordner = path.join(tmp, `quelle-${name}`);
  fs.mkdirSync(path.join(ordner, 'data'), { recursive: true });
  fs.writeFileSync(path.join(ordner, 'data', 'bild.jpg'), 'x');
  bauen(ordner);
  const ziel = path.join(tmp, `${name}.tar.gz`);
  execFileSync('tar', ['czf', ziel, '-C', ordner, ...tarArgs]);
  return ziel;
}

/** restore.sh in the empty folder, input „nein": it never gets further than the prompt. */
function restore(tar) {
  const lauf = path.join(tmp, `lauf-${path.basename(tar)}`);
  fs.mkdirSync(lauf, { recursive: true });
  const r = spawnSync('sh', [RESTORE, DUMP, tar], {
    cwd: lauf,
    input: 'nein\n',
    encoding: 'utf8',
    env: { ...process.env, PATH: '/usr/bin:/bin' },
  });
  return { status: r.status, aus: r.stdout + r.stderr };
}

test('a good archive gets as far as the confirmation prompt', () => {
  const r = restore(archive('gut', o => fs.mkdirSync(path.join(o, 'data', 'anleitungen'))));
  assert.match(r.aus, /Archiv geprüft/, r.aus);
  assert.match(r.aus, /Abgebrochen/, r.aus);
});

const BOESE = {
  'Verknüpfung nach aussen': () => archive('link', o => fs.symlinkSync('/etc', path.join(o, 'data', 'aussen'))),
  'harter Link': () =>
    archive('hart', o => fs.linkSync(path.join(o, 'data', 'bild.jpg'), path.join(o, 'data', 'zwilling.jpg'))),
  'Pfad mit ..': () => archive('punkte', () => {}, ['--transform', 's,^data/bild.jpg,data/../../boese.jpg,', 'data']),
  'absoluter Pfad': () =>
    archive('absolut', () => {}, ['-P', '--transform', 's,^data/bild.jpg,/tmp/boese.jpg,', 'data']),
  'anderer Ordner': () =>
    archive(
      'anderer',
      o => {
        fs.mkdirSync(path.join(o, 'schluessel'));
        fs.writeFileSync(path.join(o, 'schluessel', 'datenschluessel'), 'k');
      },
      ['data', 'schluessel'],
    ),
};

// db-rolle before (roles and ownership for restoring as the migration role) and afterwards.
// Counter-check (measured 02.11.2026): one of the two calls of db-rolle
// removed → red. (11.11.2026) the run of migration removed → red.
test('after restoring db-rolle adjusts the roles, migration runs, then app and jobs start', () => {
  const lauf = path.join(tmp, 'lauf-rolle');
  fs.mkdirSync(path.join(lauf, 'schluessel'), { recursive: true });
  fs.writeFileSync(path.join(lauf, 'schluessel', 'datenschluessel'), 'k');
  const bin = path.join(tmp, 'bin-rolle');
  fs.mkdirSync(bin);
  const protokoll = path.join(tmp, 'docker.log');
  fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh\necho "$*" >> '${protokoll}'\ncat > /dev/null\n`, {
    mode: 0o755,
  });
  const r = spawnSync('sh', [RESTORE, DUMP], {
    cwd: lauf,
    input: 'ja\n',
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const aufrufe = fs
    .readFileSync(protokoll, 'utf8')
    .trim()
    .split('\n')
    .map(z => z.split(' ').slice(0, 4).join(' '));
  assert.deepEqual(aufrufe, [
    'compose run --rm db-rolle',
    'compose exec -T postgres',
    'compose run --rm db-rolle',
    'compose run --rm migration',
    'compose restart app jobs',
  ]);
});

for (const [fall, bauen] of Object.entries(BOESE)) {
  test(`rejected: ${fall}`, () => {
    const tar = bauen();
    const r = restore(tar);
    assert.notEqual(r.status, 0);
    assert.match(
      r.aus,
      /FEHLER: .*Abbruch, nichts verändert/,
      `${fall}: erreicht die Rückfrage nicht — Ausgabe: ${r.aus}`,
    );
    assert.doesNotMatch(r.aus, /Fortfahren\?/, `${fall}: erreicht die Rückfrage nicht`);
  });
}
