/**
 * „Dunkel, wenn das System dunkel ist" — je Gerät, über 00-theme-boot.js.
 *
 * Ausgeführt in jsdom mit nachgestelltem matchMedia: Das Skript läuft wie im
 * Browser im <head>, mit einem vom Server gesetzten data-theme.
 *
 * Gegenproben (am 25.10. gemessen):
 *   A  wirksam() gibt immer das Server-Design zurück → rot: „bleibt hell"
 *   B  in apply() das angezeigte statt des Server-Designs gecacht
 *      (localStorage KEY = werkbank) → rot: „Cache"
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
const jsdom = require(path.join(ROOT, 'node_modules', 'jsdom'));
const BOOT = fs.readFileSync(path.join(ROOT, 'public', 'js', '00-theme-boot.js'), 'utf8');

/** Ein Fenster mit Server-Design, Gerätewahl und Systemfarbe. */
function fenster({ server = 'classic', wahl = null, dunkel = false } = {}) {
  const dom = new jsdom.JSDOM(`<!doctype html><html data-theme="${server}"><head></head><body></body></html>`,
    { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  const hoerer = [];
  const mq = { matches: dunkel, addEventListener: (_e, f) => hoerer.push(f) };
  w.matchMedia = () => mq;
  w.fetch = async () => ({ ok: false });
  if (wahl) w.localStorage.setItem('bim_dunkel', wahl);
  w.eval(BOOT);
  const systemWechsel = (d) => { mq.matches = d; hoerer.forEach(f => f()); };
  return { w, thema: () => w.document.documentElement.getAttribute('data-theme'), systemWechsel };
}

test('ohne Wahl bleibt das Design des Servers — auch bei dunklem System', () => {
  const { thema } = fenster({ dunkel: true });
  assert.equal(thema(), 'classic');
});

test('mit Wahl „system": dunkel bei dunklem System, und es folgt dem Wechsel', () => {
  const { w, thema, systemWechsel } = fenster({ wahl: 'system', dunkel: true });
  assert.equal(thema(), 'werkbank', 'bleibt hell, obwohl das System dunkel ist');
  assert.equal(w.localStorage.getItem('bim_theme'), 'classic', 'Cache: gemerkt wird das Design des Servers');
  systemWechsel(false);
  assert.equal(thema(), 'classic');
  systemWechsel(true);
  assert.equal(thema(), 'werkbank');
});

test('ein späteres Design vom Server gilt, das Gerät bleibt dunkel', () => {
  const { w, thema } = fenster({ wahl: 'system', dunkel: true });
  w.__bimApplyTheme('brick');
  assert.equal(thema(), 'werkbank');
  assert.equal(w.localStorage.getItem('bim_theme'), 'brick', 'Cache');
  w.__bimDunkel('server');
  assert.equal(thema(), 'brick');
  assert.equal(w.__bimDunkelWert(), 'server');
});
