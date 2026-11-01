/**
 * scripts/restore.sh entpackt ein data-Archiv nur, wenn es aus Dateien und
 * Ordnern unter data/ besteht (scripts/archiv-pruefen.sh). Läuft das echte
 * Skript mit einem gültigen Dump: Ein bösartiges Archiv bricht VOR der
 * Rückfrage ab, ein gutes kommt bis zur Rückfrage (dort mit „nein" beendet,
 * docker wird nie erreicht).
 *
 * Gegenproben (01.11.2026 gemessen, je einzeln):
 *   A  Aufruf von archiv-pruefen.sh in restore.sh entfernt → rot bei allen
 *      bösartigen Archiven („erreicht die Rückfrage nicht")
 *   B  Prüfung auf Verknüpfungen entfernt → rot: „Verknüpfung nach aussen"
 *      und „harter Link"
 *   C  Prüfung auf ".." entfernt → rot: „Pfad mit .."
 *   D  Prüfung auf data/ entfernt → rot: „absoluter Pfad", „anderer Ordner"
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

/** Ein Archiv aus einem Arbeitsordner bauen; `bauen(ordner)` legt den Inhalt an. */
function archiv(name, bauen, tarArgs = ['data']) {
  const ordner = path.join(tmp, `quelle-${name}`);
  fs.mkdirSync(path.join(ordner, 'data'), { recursive: true });
  fs.writeFileSync(path.join(ordner, 'data', 'bild.jpg'), 'x');
  bauen(ordner);
  const ziel = path.join(tmp, `${name}.tar.gz`);
  execFileSync('tar', ['czf', ziel, '-C', ordner, ...tarArgs]);
  return ziel;
}

/** restore.sh im leeren Ordner, Eingabe „nein": Weiter als bis zur Rückfrage kommt es nie. */
function restore(tar) {
  const lauf = path.join(tmp, `lauf-${path.basename(tar)}`);
  fs.mkdirSync(lauf, { recursive: true });
  const r = spawnSync('sh', [RESTORE, DUMP, tar], { cwd: lauf, input: 'nein\n', encoding: 'utf8',
    env: { ...process.env, PATH: '/usr/bin:/bin' } });
  return { status: r.status, aus: r.stdout + r.stderr };
}

test('ein gutes Archiv kommt bis zur Rückfrage', () => {
  const r = restore(archiv('gut', o => fs.mkdirSync(path.join(o, 'data', 'anleitungen'))));
  assert.match(r.aus, /Archiv geprüft/, r.aus);
  assert.match(r.aus, /Abgebrochen/, r.aus);
});

const BOESE = {
  'Verknüpfung nach aussen': () => archiv('link', o => fs.symlinkSync('/etc', path.join(o, 'data', 'aussen'))),
  'harter Link': () => archiv('hart', o => fs.linkSync(path.join(o, 'data', 'bild.jpg'), path.join(o, 'data', 'zwilling.jpg'))),
  'Pfad mit ..': () => archiv('punkte', () => {}, ['--transform', 's,^data/bild.jpg,data/../../boese.jpg,', 'data']),
  'absoluter Pfad': () => archiv('absolut', () => {}, ['-P', '--transform', 's,^data/bild.jpg,/tmp/boese.jpg,', 'data']),
  'anderer Ordner': () => archiv('anderer', o => {
    fs.mkdirSync(path.join(o, 'schluessel')); fs.writeFileSync(path.join(o, 'schluessel', 'datenschluessel'), 'k');
  }, ['data', 'schluessel']),
};

for (const [fall, bauen] of Object.entries(BOESE)) {
  test(`abgewiesen: ${fall}`, () => {
    const tar = bauen();
    const r = restore(tar);
    assert.notEqual(r.status, 0);
    assert.match(r.aus, /FEHLER: .*Abbruch, nichts verändert/, `${fall}: erreicht die Rückfrage nicht — Ausgabe: ${r.aus}`);
    assert.doesNotMatch(r.aus, /Fortfahren\?/, `${fall}: erreicht die Rückfrage nicht`);
  });
}
