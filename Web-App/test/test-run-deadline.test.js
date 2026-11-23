/**
 * scripts/test-run.js: a file that only fails on the deadline is rerun
 * alone with a doubled deadline. If it turns green there, the run is green and
 * says so; if it stays red, it is red. A real error is never rerun.
 *
 * Checked on the real runner with a short deadline (TEST_DEADLINE_MS) and three small
 * test files in the temp folder.
 *
 * Counter-checks (measured 05.11.2026):
 *   A  in withFollowUp() immediately `return r.code` → red: “too slow under load,
 *      green alone: the run is green”
 *   B  in deadlineError() every red file counted as a deadline error → red: “a
 *      real error is not rerun”
 *   C  in the rerun the same deadline instead of the doubled one → red: “too
 *      slow under load …” (the file needs more than the single deadline)
 *   D  reportFollowUp() not called → red: “too slow under load …” (no WARNUNG)
 *   E  TEST_NACHLAUF not evaluated → red: “with TEST_NACHLAUF=aus …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

function runner(files, more = {}) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, TEST_DEADLINE_MS: '3000', TEST_PARALLEL: '2' };
  delete env.TEST_NACHLAUF;
  Object.assign(env, more);
  // Without a database and not as a child of this test run: otherwise node --test would write differently.
  for (const k of ['TEST_DATABASE_URL', 'TEST_DB_VORLAGE', 'TEST_DB_BASIS', 'TEST_DB_OWN', 'NODE_TEST_CONTEXT'])
    delete env[k];
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'test-run.js'), ...files], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

test('deadline and rerun in the runner', { concurrency: 1, timeout: 240_000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-lauf-frist-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const mark = path.join(dir, 'schon-gelaufen');
  const file = (name, body) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, `const test = require('node:test');\n${body}\n`);
    return p;
  };
  // First 8 s, then 3 s: above the deadline (3 s), below the doubled one — as under foreign load.
  const slow = file(
    'langsam.test.js',
    `const fs = require('node:fs');
test('braucht erst 8 s, dann 3 s', async () => {
  const firstItem = !fs.existsSync(${JSON.stringify(mark)});
  fs.writeFileSync(${JSON.stringify(mark)}, '1');
  await new Promise(r => setTimeout(r, firstItem ? 8000 : 3000));
});`,
  );
  const alwaysSlow = file(
    'immer-langsam.test.js',
    `test('braucht immer 9 s', () => new Promise(r => setTimeout(r, 9000)));`,
  );
  const broken = file('kaputt.test.js', `test('scheitert', () => { throw new Error('echter Fehler'); });`);

  await t.test('too slow under load, green alone: the run is green', () => {
    const r = runner([slow]);
    assert.match(r.out, /Nachlauf einzeln: .*langsam\.test\.js/);
    assert.match(r.out, /Nachlauf grün/);
    assert.match(r.out, /::warning title=Frist überschritten::.*langsam\.test\.js/);
    assert.match(r.out, /WARNUNG: 1 Datei\(en\) nur im Nachlauf grün .*langsam\.test\.js/);
    assert.equal(r.code, 0, r.out.slice(-1500));
  });

  await t.test('with TEST_NACHLAUF=aus exceeding the deadline is red', () => {
    fs.rmSync(mark, { force: true });
    const r = runner([slow], { TEST_NACHLAUF: 'aus' });
    assert.match(r.out, /kein Nachlauf \(TEST_NACHLAUF=aus\)/);
    assert.notEqual(r.code, 0);
  });

  await t.test('still too slow alone: the run is red', () => {
    const r = runner([alwaysSlow]);
    assert.match(r.out, /Nachlauf ROT/);
    assert.notEqual(r.code, 0);
  });

  await t.test('a real error is not rerun', () => {
    const r = runner([broken]);
    assert.doesNotMatch(r.out, /Nachlauf/);
    assert.notEqual(r.code, 0);
  });
});
