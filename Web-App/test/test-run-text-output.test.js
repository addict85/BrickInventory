/**
 * „Unable to deserialize cloned data" under load: node:test (Node 22) reads
 * report frames and text of the child from the same stream. If text with a
 * non-ASCII byte at position 2 stands directly behind a frame in the same read chunk,
 * its length is read as negative and the text is deserialized. Under load …
 *
 * Counter-check (05.11.2026): in scripts/test-run.js the preloading of
 * test/helpers/text-output.js deleted → red (exit 1, the run aborts after
 * a few frames without a summary).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

test('test-run.js survives frames with non-ASCII text behind them', () => {
  const env = { ...process.env };
  // Without a database: only the path of the output is checked.
  delete env.TEST_DATABASE_URL;
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'test-run.js'), 'test/fixtures/frame-and-text.js'],
    { cwd: ROOT, env, encoding: 'utf8', timeout: 120_000 },
  );
  const output = r.stdout + r.stderr;
  assert.equal(r.status, 0, output.slice(-2000));
  assert.match(output, /^(# |ℹ )pass 1$/m);
  // The frames of the dummy follow the format of Node 22; newer runners (CI:
  // Node 26) do not read them as frames. There only counts that the run stays intact.
  if (Number(process.versions.node.split('.')[0]) <= 22) {
    assert.equal((output.match(/^(# |ℹ )rahmen$/gm) || []).length, 300, 'nicht alle Rahmen kamen an');
  }
});
