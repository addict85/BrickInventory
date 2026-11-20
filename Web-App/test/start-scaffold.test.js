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
 *   D  (08.11.2026) die zwei Regeln für [data-theme=brick] aus dem Startstil
 *      gestrichen → rot: „Stein (Blau): Kopf blau, Grund blaugrau“
 *   E  in startPageHtml() das Setzen von data-abgemeldet gestrichen → rot:
 *      „ohne Sitzung: keine App-Kacheln im Gerüst“; die Regel
 *      [data-abgemeldet] im Startstil gestrichen → ebenso rot
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
const { openUi, warte } = require('./helpers/ui');
// startPageHtml() fragt das Design aus der Datenbank; offen hielte der Pool den Lauf an.
test.after(() =>
  testData()
    .pool.end()
    .catch(() => {}),
);

test('the hash matches the delivered block', async () => {
  const html = await startPageHtml();
  const block = /<style id="startstil">([\s\S]*?)<\/style>/.exec(html);
  assert.ok(block, 'kein Startgerüst-Stil im ausgelieferten HTML');
  const erwartet = `'sha256-${crypto.createHash('sha256').update(block[1]).digest('base64')}'`;
  assert.equal(startPageStyleHash(false), erwartet);
});

test('before the first stylesheet and before every blocking script', () => {
  const html = stripComments(fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8'));
  const geruest = html.indexOf('id="startgeruest"');
  assert.ok(geruest > 0);
  const firstStylesheet = html.search(/<link rel="stylesheet"/);
  const firstScript = html.search(/<script (?!defer)[^>]*src=/);
  assert.ok(geruest < firstStylesheet, 'vor dem ersten Stylesheet');
  assert.ok(geruest < firstScript, 'vor dem ersten blockierenden Skript');
});

test('logged in: skeleton gone, app there', async () => {
  const { w, d } = await openUi({});
  try {
    await warte(() => !d.getElementById('startgeruest'));
    assert.equal(d.getElementById('startgeruest'), null, 'angemeldet: Gerüst weg');
  } finally {
    w.close();
  }
});

test('logged out: skeleton gone, login there', async () => {
  const { w, d } = await openUi({}, { angemeldet: false });
  try {
    await warte(() => d.getElementById('login-screen').style.display === 'flex');
    assert.equal(d.getElementById('startgeruest'), null);
  } finally {
    w.close();
  }
});

test('Stein (blue): header blue, background blue-gray', () => {
  const { JSDOM } = require('jsdom');
  const html = fs
    .readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8')
    .replace('<html lang="de">', '<html lang="de" data-theme="brick">');
  // JSDOM führt Skripte standardmässig nicht aus und lädt keine fremden: Das Gerüst steht allein da.
  const w = new JSDOM(html).window;
  try {
    const kopf = w.getComputedStyle(w.document.querySelector('#startgeruest .sg-kopf'));
    assert.equal(kopf.backgroundColor, 'rgb(61, 90, 128)', 'die Kopfkachel ist blau wie im Stein-Design');
    const grund = w.getComputedStyle(w.document.querySelector('#startgeruest'));
    assert.equal(grund.getPropertyValue('--sg-bg').trim(), '#c9d5e2', 'der Grund ist blaugrau, nicht weiss');
  } finally {
    w.close();
  }
});

test('without a session: no app tiles in the skeleton, with a session yes', async () => {
  const { JSDOM } = require('jsdom');
  const sichtbar = html => {
    const w = new JSDOM(html).window;
    try {
      return ['.sg-kopf', '.sg-leiste', '.sg-inhalt'].map(
        s => w.getComputedStyle(w.document.querySelector(`#startgeruest ${s}`)).display !== 'none',
      );
    } finally {
      w.close();
    }
  };
  assert.deepEqual(sichtbar(await startPageHtml()), [false, false, false], 'ohne Sitzung: keine App-Kacheln im Gerüst');
  assert.deepEqual(sichtbar(await startPageHtml(1)), [true, true, true], 'mit Sitzung: Kopf, Leiste und Kacheln');
});
