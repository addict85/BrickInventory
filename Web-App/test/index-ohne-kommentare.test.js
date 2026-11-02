/**
 * Die ausgelieferte Startseite trägt keine Entwicklerkommentare: Sie stehen
 * in public/index.html für den Quelltext, der Renderer streift sie ab.
 * Geprüft am gebauten Renderer (renderIndexHtml), nicht an der Datei.
 *
 * Gegenprobe (02.11.2026 gemessen): in readIndex() ohneKommentare() entfernt
 * → rot: „keine Kommentare in der ausgelieferten Seite“ (153 Kommentare).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAndRequire } = require('./helpers/sources');

test('keine Kommentare in der ausgelieferten Seite', async () => {
  const { renderIndexHtml } = buildAndRequire()('src/konto/indexHtml.js');
  const html = await renderIndexHtml();
  assert.equal((html.match(/<!--/g) || []).length, 0);
  // Was die Seite braucht, ist noch da.
  assert.match(html, /<main id="inhalt"/);
  assert.match(html, /<script src="\/js\/app\.bundle\.js/);
  assert.match(html, /<html[^>]*data-theme="/);
});
