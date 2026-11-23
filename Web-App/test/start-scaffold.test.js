/**
 * Start skeleton: on the first load a skeleton stands immediately (header, bar,
 * tiles) instead of a white page. Its rules stand inline in
 * index.html and are released via their hash in the CSP; the big
 * stylesheets and scripts only follow afterwards. As soon as login or app
 * stand there, the skeleton disappears.
 *
 * Counter-checks (measured on 03.11.2026):
 *   A  a character changed in <style id="start-style">, hash not recomputed
 *      (static copy) → red: “the hash matches the delivered block”
 *   B  removeStartupScaffold() removed in showApp() → red: “logged in: skeleton gone”
 *   C  styles.css again in the <head> → red: “before the first stylesheet”
 *   D  (08.11.2026) the two rules for [data-theme=brick] deleted from the start style
 *      → red: “Stein (blue): header blue, background blue-gray”
 *   E  the setting of data-signed-out deleted in startPageHtml() → red:
 *      “without a session: no app tiles in the skeleton”; the rule
 *      [data-signed-out] deleted in the start style → likewise red
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { startPageStyleHash, startPageHtml, stripComments } = _req('src/profile/indexHtml.js');
const { openUi, waitFor } = require('./helpers/ui');
// startPageHtml() asks the database for the theme; left open, the pool would stall the run.
test.after(() =>
  testData()
    .pool.end()
    .catch(() => {}),
);

test('the hash matches the delivered block', async () => {
  const html = await startPageHtml();
  const block = /<style id="start-style">([\s\S]*?)<\/style>/.exec(html);
  assert.ok(block, 'no start scaffold style in the served HTML');
  const expected = `'sha256-${crypto.createHash('sha256').update(block[1]).digest('base64')}'`;
  assert.equal(startPageStyleHash(false), expected);
});

test('before the first stylesheet and before every blocking script', () => {
  const html = stripComments(fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8'));
  const scaffold = html.indexOf('id="start-skeleton"');
  assert.ok(scaffold > 0);
  const firstStylesheet = html.search(/<link rel="stylesheet"/);
  const firstScript = html.search(/<script (?!defer)[^>]*src=/);
  assert.ok(scaffold < firstStylesheet, 'before the first stylesheet');
  assert.ok(scaffold < firstScript, 'before the first blocking script');
});

test('logged in: skeleton gone, app there', async () => {
  const { w, d } = await openUi({});
  try {
    await waitFor(() => !d.getElementById('start-skeleton'));
    assert.equal(d.getElementById('start-skeleton'), null, 'logged in: scaffold gone');
  } finally {
    w.close();
  }
});

test('logged out: skeleton gone, login there', async () => {
  const { w, d } = await openUi({}, { loggedIn: false });
  try {
    await waitFor(() => d.getElementById('login-screen').style.display === 'flex');
    assert.equal(d.getElementById('start-skeleton'), null);
  } finally {
    w.close();
  }
});

test('Stein (blue): header blue, background blue-gray', () => {
  const { JSDOM } = require('jsdom');
  const html = fs
    .readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8')
    .replace('<html lang="de">', '<html lang="de" data-theme="brick">');
  // By default JSDOM runs no scripts and loads no foreign ones: the skeleton stands alone.
  const w = new JSDOM(html).window;
  try {
    const head = w.getComputedStyle(w.document.querySelector('#start-skeleton .sg-header'));
    assert.equal(head.backgroundColor, 'rgb(61, 90, 128)', 'the header tile is blue as in the brick design');
    const reason = w.getComputedStyle(w.document.querySelector('#start-skeleton'));
    assert.equal(reason.getPropertyValue('--sg-bg').trim(), '#c9d5e2', 'the background is blue-grey, not white');
  } finally {
    w.close();
  }
});

test('without a session: no app tiles in the skeleton, with a session yes', async () => {
  const { JSDOM } = require('jsdom');
  const visible = html => {
    const w = new JSDOM(html).window;
    try {
      return ['.sg-header', '.sg-bar', '.sg-content'].map(
        s => w.getComputedStyle(w.document.querySelector(`#start-skeleton ${s}`)).display !== 'none',
      );
    } finally {
      w.close();
    }
  };
  assert.deepEqual(
    visible(await startPageHtml()),
    [false, false, false],
    'without a session: no app tiles in the scaffold',
  );
  assert.deepEqual(visible(await startPageHtml(1)), [true, true, true], 'with a session: header, bar and tiles');
});
