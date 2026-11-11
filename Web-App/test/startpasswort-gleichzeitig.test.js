/**
 * Die Startpasswort-Datei entsteht auch dann, wenn mehrere Prozesse sie zugleich
 * schreiben (parallele Testdateien teilen sich data/), und ein vorbereiteter
 * Symlink am Zielort leitet das Passwort nicht um.
 *
 * Gegenproben (11.11.2026 gemessen, je einzeln):
 *   A  schreibeStartpasswort() (src/infra/startpasswort.ts) wieder als rmSync + writeFileSync
 *      mit flag 'wx' auf die Zieldatei → rot: „alle Prozesse schreiben die Datei“ (EEXIST)
 *   B  writeFileSync direkt auf die Zieldatei mit flag 'w' → rot: „der Symlink leitet nichts um“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'startpasswort-gleich-'));
process.env.APP_ROOT = wurzel;
const _req = require('./helpers/sources').buildAndRequire();
const modul = require.resolve(path.join(__dirname, '..', 'dist', 'src', 'infra', 'startpasswort.js'));

test.after(() => fs.rmSync(wurzel, { recursive: true, force: true }));

function schreiber(nr) {
  const code = `const s = require(${JSON.stringify(modul)});
    for (let i = 0; i < 40; i++) s.schreibeStartpasswort('admin', 'p${nr}-' + i);`;
  return new Promise(fertig => {
    const k = spawn(process.execPath, ['-e', code], {
      env: { ...process.env, APP_ROOT: wurzel },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let fehler = '';
    k.stderr.on('data', d => {
      fehler += d;
    });
    k.on('exit', code => fertig({ code, fehler }));
  });
}

test('alle Prozesse schreiben die Datei', async () => {
  const ergebnisse = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map(schreiber));
  for (const e of ergebnisse) assert.equal(e.code, 0, e.fehler.split('\n').find(z => z.includes('Error')) ?? e.fehler);
  const datei = _req('src/infra/startpasswort.js').startpasswortDatei();
  assert.match(fs.readFileSync(datei, 'utf8'), /^admin\np\d-\d+\n$/);
  const reste = fs.readdirSync(path.dirname(datei)).filter(n => n.startsWith('admin-startpasswort.txt.'));
  assert.deepEqual(reste, [], 'keine halben Dateien bleiben liegen');
});

test('der Symlink leitet nichts um', () => {
  const s = _req('src/infra/startpasswort.js');
  const datei = s.startpasswortDatei();
  const fremd = path.join(wurzel, 'fremd.txt');
  fs.writeFileSync(fremd, 'unberuehrt');
  fs.rmSync(datei, { force: true });
  fs.symlinkSync(fremd, datei);
  s.schreibeStartpasswort('admin', 'geheim');
  assert.equal(fs.readFileSync(fremd, 'utf8'), 'unberuehrt');
  assert.equal(fs.lstatSync(datei).isSymbolicLink(), false);
  assert.equal(fs.statSync(datei).mode & 0o777, 0o600);
});
