/**
 * The delivered start page carries no developer comments: they stand
 * in public/index.html for the source text, the renderer strips them.
 * Checked on the built renderer (startPageHtml), not on the file.
 *
 * Counter-check (measured 02.11.2026): stripComments() removed in readIndex()
 * → red: “no comments in the delivered page” (153 comments).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAndRequire } = require('./helpers/sources');

test('no comments in the delivered page', async () => {
  const { startPageHtml } = buildAndRequire()('src/profile/indexHtml.js');
  const html = await startPageHtml();
  assert.equal((html.match(/<!--/g) || []).length, 0);
  // What the page needs is still there.
  assert.match(html, /<main id="content"/);
  assert.match(html, /<script src="\/js\/app\.bundle\.js/);
  assert.match(html, /<html[^>]*data-theme="/);
});
