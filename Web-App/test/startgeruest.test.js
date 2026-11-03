/**
 * Startgerüst: Beim ersten Laden steht sofort ein Gerüst (Kopf, Leiste,
 * Kacheln) statt einer weissen Seite. Seine Regeln stehen inline in
 * index.html und sind über ihren Hash in der CSP freigegeben; die grossen
 * Stylesheets und Skripte folgen erst danach. Sobald Anmeldung oder App
 * dastehen, verschwindet das Gerüst.
 *
 * Gegenproben (am 03.11.2026 gemessen):
 *   A  ein Zeichen im <style id="startstil"> geändert, Hash nicht neu
 *      gerechnet (statische Kopie) → rot: „der Hash passt zum ausgelieferten Block“
 *   B  startgeruestWeg() in showApp() entfernt → rot: „angemeldet: Gerüst weg“
 *   C  styles.css wieder im <head> → rot: „vor dem ersten Stylesheet“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { startStilHash, renderIndexHtml } = _req('src/konto/indexHtml.js');
const { oeffneOberflaeche, warte } = require('./helpers/oberflaeche');
// renderIndexHtml() fragt das Design aus der Datenbank; offen hielte der Pool den Lauf an.
test.after(() => _req('db/database.js').pool.end().catch(() => {}));

test('der Hash passt zum ausgelieferten Block', async () => {
  const html = await renderIndexHtml();
  const block = /<style id="startstil">([\s\S]*?)<\/style>/.exec(html);
  assert.ok(block, 'kein Startgerüst-Stil im ausgelieferten HTML');
  const erwartet = `'sha256-${crypto.createHash('sha256').update(block[1]).digest('base64')}'`;
  assert.equal(startStilHash(), erwartet);
});

test('vor dem ersten Stylesheet und vor jedem blockierenden Skript', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const geruest = html.indexOf('id="startgeruest"');
  assert.ok(geruest > 0);
  const erstesStylesheet = html.search(/<link rel="stylesheet"/);
  const erstesSkript = html.search(/<script (?!defer)[^>]*src=/);
  assert.ok(geruest < erstesStylesheet, 'vor dem ersten Stylesheet');
  assert.ok(geruest < erstesSkript, 'vor dem ersten blockierenden Skript');
});

test('angemeldet: Gerüst weg, App da', async () => {
  const { w, d } = await oeffneOberflaeche({});
  try {
    await warte(() => !d.getElementById('startgeruest'));
    assert.equal(d.getElementById('startgeruest'), null, 'angemeldet: Gerüst weg');
  } finally { w.close(); }
});

test('abgemeldet: Gerüst weg, Anmeldung da', async () => {
  const { w, d } = await oeffneOberflaeche({}, { angemeldet: false });
  try {
    await warte(() => d.getElementById('login-screen').style.display === 'flex');
    assert.equal(d.getElementById('startgeruest'), null);
  } finally { w.close(); }
});
