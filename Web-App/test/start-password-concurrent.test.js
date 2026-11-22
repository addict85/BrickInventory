/**
 * The initial password file also arises when several processes write it
 * at the same time (parallel test files share data/), and a prepared
 * symlink at the target place does not redirect the password.
 *
 * Counter-checks (measured 11.11.2026, each on its own):
 *   A  writeStartPassword() (src/infra/startpasswort.ts) again as rmSync + writeFileSync
 *      with flag 'wx' on the target file → red: “all processes write the file” (EEXIST)
 *   B  writeFileSync directly on the target file with flag 'w' → red: “the symlink redirects nothing”
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
    for (let i = 0; i < 40; i++) s.writeStartPassword('admin', 'p${nr}-' + i);`;
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

test('all processes write the file', async () => {
  const results = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map(schreiber));
  for (const e of results) assert.equal(e.code, 0, e.fehler.split('\n').find(z => z.includes('Error')) ?? e.fehler);
  const datei = _req('src/infra/startpasswort.js').startPasswordFile();
  assert.match(fs.readFileSync(datei, 'utf8'), /^admin\np\d-\d+\n$/);
  const reste = fs.readdirSync(path.dirname(datei)).filter(n => n.startsWith('admin-startpasswort.txt.'));
  assert.deepEqual(reste, [], 'keine halben Dateien bleiben liegen');
});

test('the symlink redirects nothing', () => {
  const s = _req('src/infra/startpasswort.js');
  const datei = s.startPasswordFile();
  const fremd = path.join(wurzel, 'fremd.txt');
  fs.writeFileSync(fremd, 'unberuehrt');
  fs.rmSync(datei, { force: true });
  fs.symlinkSync(fremd, datei);
  s.writeStartPassword('admin', 'geheim');
  assert.equal(fs.readFileSync(fremd, 'utf8'), 'unberuehrt');
  assert.equal(fs.lstatSync(datei).isSymbolicLink(), false);
  assert.equal(fs.statSync(datei).mode & 0o777, 0o600);
});
