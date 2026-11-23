/**
 * `/` goes through the renderer over the real server, not as a static file: the start page carries
 * the server-side design, the signed-out skeleton and the version in its footer.
 *
 * Counter-check (22.11.2026): express.static with `index: 'index.html'` instead of `index: false`
 * (startup/app.ts) → red “the start page …” (no data-signed-out, no version).
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');

test('the start page comes from the renderer', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const { base } = testServer(_req, { t });
  const r = await fetch(`${base}/`);
  const html = await r.text();
  assert.equal(r.status, 200);
  assert.match(html, /<html[^>]*\sdata-signed-out/, 'the skeleton without a session comes from the renderer');
  assert.match(html, /<html[^>]*\sdata-theme="[a-z]+"/);
  assert.match(html, /data-version>Version [\w.+-]+</, 'the footer carries no version');
});
