/**
 * A test file that does not end after its tests is terminated red
 * (test/helpers/expiry.js) instead of holding the run until the CI aborts.
 *
 * Counter-checks (measured 10.11.2026, Node 26):
 *   A  expiry.js ineffective (condition never true) → red: “an open
 *      server …” and “a hanging t.after …” (the child never ends, ETIMEDOUT)
 *   B  `.unref()` on the timer after the last test deleted → red:
 *      “a clean file ends immediately …” (waits out the full deadline)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const EXPIRY = path.join(__dirname, 'helpers', 'expiry.js');
const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'auslauf-'));
test.after(() => fs.rmSync(ordner, { recursive: true, force: true }));

/** Run a test file in its own `node --test`, as test-run.js does.
 * @param {string} name @param {string} inhalt @param {Record<string, string>} env */
function lauf(name, inhalt, env) {
  const datei = path.join(ordner, name);
  fs.writeFileSync(datei, `const test = require('node:test');\n${inhalt}\n`);
  // Without these markers the inner node --test would consider itself a child.
  const { NODE_TEST_CONTEXT: _k, TEST_AUSLAUF_AKTIV: _a, TEST_DATEI_FRIST_MS: _f, ...rest } = process.env;
  const start = Date.now();
  const r = spawnSync(process.execPath, ['--require', EXPIRY, '--test', '--test-reporter=tap', datei], {
    cwd: ordner,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...rest, ...env },
  });
  return { status: r.status, error: r.error?.message, text: `${r.stdout}${r.stderr}`, ms: Date.now() - start };
}

test('an open server after the last test ends the file red and is named', () => {
  const r = lauf(
    'server.test.js',
    "test('lässt einen Server offen', () => { require('node:net').createServer().listen(0); });",
    { TEST_AUSLAUF_MS: '500' },
  );
  assert.equal(r.error, undefined, `the child did not end: ${r.error}`);
  assert.equal(r.status, 1, r.text);
  assert.match(
    r.text,
    /\[auslauf\] server\.test\.js: 0\.5 s nach dem letzten Test nicht beendet — offen: .*TCPServerWrap/,
  );
  assert.match(r.text, /^ok 1 - lässt einen Server offen/m, 'the test itself stays green');
});

test('a hanging t.after hits the deadline of the whole file', () => {
  const r = lauf(
    'haken.test.js',
    "test('t.after hängt', (t) => { t.after(() => new Promise(() => { setInterval(() => {}, 1000); })); });",
    { TEST_AUSLAUF_MS: '60000', TEST_DATEI_FRIST_MS: '1500' },
  );
  assert.equal(r.error, undefined, `the child did not end: ${r.error}`);
  assert.equal(r.status, 1, r.text);
  assert.match(r.text, /\[auslauf\] haken\.test\.js: nach 1\.5 s nicht fertig/);
});

test('a clean file ends immediately and green', () => {
  const r = lauf('sauber.test.js', "test('nichts offen', () => {});", {
    TEST_AUSLAUF_MS: '30000',
    TEST_DATEI_FRIST_MS: '30000',
  });
  assert.equal(r.status, 0, r.text);
  assert.doesNotMatch(r.text, /\[auslauf\]/);
  assert.ok(r.ms < 20_000, `waited ${r.ms} ms for the deadline`);
});
