/**
 * Eine Testdatei, die nach ihren Tests nicht endet, wird rot beendet
 * (test/helpers/auslauf.js), statt den Lauf bis zum Abbruch der CI anzuhalten.
 *
 * Gegenproben (10.11.2026 gemessen, Node 26):
 *   A  auslauf.js wirkungslos (Bedingung nie wahr) → rot: „ein offener
 *      Server …“ und „ein hängender t.after …“ (das Kind endet nie, ETIMEDOUT)
 *   B  `.unref()` am Zeitgeber nach dem letzten Test gestrichen → rot:
 *      „eine saubere Datei endet sofort …“ (wartet die volle Frist ab)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const AUSLAUF = path.join(__dirname, 'helpers', 'auslauf.js');
const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'auslauf-'));
test.after(() => fs.rmSync(ordner, { recursive: true, force: true }));

/** Eine Testdatei in einem eigenen `node --test` laufen lassen, wie test-lauf.js es tut.
 * @param {string} name @param {string} inhalt @param {Record<string, string>} env */
function lauf(name, inhalt, env) {
  const datei = path.join(ordner, name);
  fs.writeFileSync(datei, `const test = require('node:test');\n${inhalt}\n`);
  // Ohne diese Marken hielte sich das innere node --test selbst für ein Kind.
  const { NODE_TEST_CONTEXT: _k, TEST_AUSLAUF_AKTIV: _a, TEST_DATEI_FRIST_MS: _f, ...rest } = process.env;
  const start = Date.now();
  const r = spawnSync(process.execPath, ['--require', AUSLAUF, '--test', '--test-reporter=tap', datei], {
    cwd: ordner,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...rest, ...env },
  });
  return { status: r.status, fehler: r.error?.message, text: `${r.stdout}${r.stderr}`, ms: Date.now() - start };
}

test('ein offener Server nach dem letzten Test beendet die Datei rot und wird genannt', () => {
  const r = lauf(
    'server.test.js',
    "test('lässt einen Server offen', () => { require('node:net').createServer().listen(0); });",
    { TEST_AUSLAUF_MS: '500' },
  );
  assert.equal(r.fehler, undefined, `das Kind endete nicht: ${r.fehler}`);
  assert.equal(r.status, 1, r.text);
  assert.match(
    r.text,
    /\[auslauf\] server\.test\.js: 0\.5 s nach dem letzten Test nicht beendet — offen: .*TCPServerWrap/,
  );
  assert.match(r.text, /^ok 1 - lässt einen Server offen/m, 'der Test selbst bleibt grün');
});

test('ein hängender t.after trifft die Frist der ganzen Datei', () => {
  const r = lauf(
    'haken.test.js',
    "test('t.after hängt', (t) => { t.after(() => new Promise(() => { setInterval(() => {}, 1000); })); });",
    { TEST_AUSLAUF_MS: '60000', TEST_DATEI_FRIST_MS: '1500' },
  );
  assert.equal(r.fehler, undefined, `das Kind endete nicht: ${r.fehler}`);
  assert.equal(r.status, 1, r.text);
  assert.match(r.text, /\[auslauf\] haken\.test\.js: nach 1\.5 s nicht fertig/);
});

test('eine saubere Datei endet sofort und grün', () => {
  const r = lauf('sauber.test.js', "test('nichts offen', () => {});", {
    TEST_AUSLAUF_MS: '30000',
    TEST_DATEI_FRIST_MS: '30000',
  });
  assert.equal(r.status, 0, r.text);
  assert.doesNotMatch(r.text, /\[auslauf\]/);
  assert.ok(r.ms < 20_000, `wartete ${r.ms} ms auf die Frist`);
});
