/**
 * „Dunkel, wenn das System dunkel ist" — je Gerät, über 00-theme-boot.js.
 * Seit dem 29.10. heisst das: dasselbe Design in seiner dunklen Variante
 * (data-dunkel am <html>, Farben aus tokens.css), nicht mehr „werkbank".
 * Ohne gespeicherte Wahl folgt das Gerät dem System (Vorgabe „system“).
 *
 * Ausgeführt in jsdom mit nachgestelltem matchMedia: Das Skript läuft wie im
 * Browser im <head>, mit einem vom Server gesetzten data-theme.
 *
 * Gegenproben (am 25.10. gemessen):
 *   A  wirksam() gibt immer das Server-Design zurück → rot: „bleibt hell"
 *   B  in apply() das angezeigte statt des Server-Designs gecacht
 *      (localStorage KEY = werkbank) → rot: „Cache"
 *   C  (29.10.) wirksam() setzt data-dunkel nie → rot: „bleibt hell";
 *      wirksam() wieder mit 'werkbank' bei dunklem System → rot: „das Design
 *      bleibt"
 *   D  (29.10.) folgtSystem() wieder mit === 'system' → rot: „ohne Wahl folgt
 *      das Gerät dem System“ (data-dunkel fehlte)
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
  const hatDunkel = () => w.document.documentElement.hasAttribute('data-dunkel');
  return { w, thema: () => w.document.documentElement.getAttribute('data-theme'), dunkel: hatDunkel, systemWechsel };
}

test('ohne Wahl folgt das Gerät dem System', () => {
  const { w, thema, dunkel } = fenster({ dunkel: true });
  assert.equal(thema(), 'classic');
  assert.equal(dunkel(), true, 'Vorgabe ist „system“, das dunkle System wurde übergangen');
  assert.equal(w.__bimDunkelWert(), 'system');
});

test('mit Wahl „server" bleibt das Design hell — auch bei dunklem System', () => {
  const { thema, dunkel } = fenster({ wahl: 'server', dunkel: true });
  assert.equal(thema(), 'classic');
  assert.equal(dunkel(), false);
});

test('mit Wahl „system": dunkel bei dunklem System, und es folgt dem Wechsel', () => {
  const { w, thema, dunkel, systemWechsel } = fenster({ wahl: 'system', dunkel: true });
  assert.equal(dunkel(), true, 'bleibt hell, obwohl das System dunkel ist');
  assert.equal(thema(), 'classic', 'das Design bleibt — dunkel ist eine Variante, kein anderes Design');
  assert.equal(w.localStorage.getItem('bim_theme'), 'classic', 'Cache: gemerkt wird das Design des Servers');
  systemWechsel(false);
  assert.equal(dunkel(), false);
  systemWechsel(true);
  assert.equal(dunkel(), true);
  assert.equal(thema(), 'classic');
});

test('werkbank ist schon dunkel und bekommt keine Variante', () => {
  const { thema, dunkel } = fenster({ server: 'werkbank', wahl: 'system', dunkel: true });
  assert.equal(thema(), 'werkbank');
  assert.equal(dunkel(), false);
});

test('ein späteres Design vom Server gilt, das Gerät bleibt dunkel', () => {
  const { w, thema, dunkel } = fenster({ wahl: 'system', dunkel: true });
  w.__bimApplyTheme('brick');
  assert.equal(thema(), 'brick');
  assert.equal(dunkel(), true);
  assert.equal(w.localStorage.getItem('bim_theme'), 'brick', 'Cache');
  w.__bimDunkel('server');
  assert.equal(thema(), 'brick');
  assert.equal(dunkel(), false);
  assert.equal(w.__bimDunkelWert(), 'server');
});
