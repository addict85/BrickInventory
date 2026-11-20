/**
 * Die ausgelieferte Startseite trägt keine Entwicklerkommentare: Sie stehen
 * in public/index.html für den Quelltext, der Renderer streift sie ab.
 * Geprüft am gebauten Renderer (startPageHtml), nicht an der Datei.
 *
 * Gegenprobe (02.11.2026 gemessen): in readIndex() stripComments() entfernt
 * → rot: „keine Kommentare in der ausgelieferten Seite“ (153 Kommentare).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAndRequire } = require('./helpers/sources');

test('no comments in the delivered page', async () => {
  const { startPageHtml } = buildAndRequire()('src/profile/indexHtml.js');
  const html = await startPageHtml();
  assert.equal((html.match(/<!--/g) || []).length, 0);
  // Was die Seite braucht, ist noch da.
  assert.match(html, /<main id="inhalt"/);
  assert.match(html, /<script src="\/js\/app\.bundle\.js/);
  assert.match(html, /<html[^>]*data-theme="/);
});
