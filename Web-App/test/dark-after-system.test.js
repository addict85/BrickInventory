/**
 * “Dark when the system is dark" — per device, via theme-boot.js.
 * Since 29.10. that means: the same design in its dark variant
 * (data-dark on <html>, colors from tokens.css), no longer “werkbank".
 * Without a stored choice the device follows the system (default “system”).
 *
 * Counter-checks (measured on 25.10.):
 *   A  wirksam() always returns the server design → red: “stays light"
 *   B  in apply() the displayed instead of the server design cached
 *      (localStorage KEY = werkbank) → red: “cache"
 *   C  (29.10.) wirksam() never sets data-dark → red: “stays light";
 *      wirksam() again with 'werkbank' on a dark system → red: “the design
 *      stays"
 *   D  (29.10.) folgtSystem() again with === 'system' → red: “without a choice the
 *      device follows the system” (data-dark was missing)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const jsdom = require(path.join(ROOT, 'node_modules', 'jsdom'));
const BOOT = fs.readFileSync(path.join(ROOT, 'public', 'js', 'theme-boot.js'), 'utf8');

/** A window with server design, device choice and system color. */
function fenster({ server = 'classic', wahl = null, dunkel = false } = {}) {
  const dom = new jsdom.JSDOM(`<!doctype html><html data-theme="${server}"><head></head><body></body></html>`, {
    runScripts: 'outside-only',
    url: 'http://localhost/',
  });
  const w = dom.window;
  const listener = [];
  const mq = { matches: dunkel, addEventListener: (_e, f) => listener.push(f) };
  w.matchMedia = () => mq;
  w.fetch = async () => ({ ok: false });
  if (wahl) w.localStorage.setItem('bim_dark', wahl);
  w.eval(BOOT);
  const systemSwitch = d => {
    mq.matches = d;
    for (const f of listener) f();
  };
  const hatDark = () => w.document.documentElement.hasAttribute('data-dark');
  return { w, thema: () => w.document.documentElement.getAttribute('data-theme'), dunkel: hatDark, systemSwitch };
}

test('without a choice the device follows the system', () => {
  const { w, thema, dunkel } = fenster({ dunkel: true });
  assert.equal(thema(), 'classic');
  assert.equal(dunkel(), true, 'Vorgabe ist „system“, das dunkle System wurde übergangen');
  assert.equal(w.__bimDarkValue(), 'system');
});

test('with the choice "server" the theme stays light — even with a dark system', () => {
  const { thema, dunkel } = fenster({ wahl: 'server', dunkel: true });
  assert.equal(thema(), 'classic');
  assert.equal(dunkel(), false);
});

test('with the choice "system": dark with a dark system, and it follows the change', () => {
  const { w, thema, dunkel, systemSwitch } = fenster({ wahl: 'system', dunkel: true });
  assert.equal(dunkel(), true, 'bleibt hell, obwohl das System dunkel ist');
  assert.equal(thema(), 'classic', 'das Design bleibt — dunkel ist eine Variante, kein anderes Design');
  assert.equal(w.localStorage.getItem('bim_theme'), 'classic', 'Cache: gemerkt wird das Design des Servers');
  systemSwitch(false);
  assert.equal(dunkel(), false);
  systemSwitch(true);
  assert.equal(dunkel(), true);
  assert.equal(thema(), 'classic');
});

test('werkbank is already dark and gets no variant', () => {
  const { thema, dunkel } = fenster({ server: 'werkbank', wahl: 'system', dunkel: true });
  assert.equal(thema(), 'werkbank');
  assert.equal(dunkel(), false);
});

test('a later theme from the server applies, the device stays dark', () => {
  const { w, thema, dunkel } = fenster({ wahl: 'system', dunkel: true });
  w.__bimApplyTheme('brick');
  assert.equal(thema(), 'brick');
  assert.equal(dunkel(), true);
  assert.equal(w.localStorage.getItem('bim_theme'), 'brick', 'Cache');
  w.__bimDark('server');
  assert.equal(thema(), 'brick');
  assert.equal(dunkel(), false);
  assert.equal(w.__bimDarkValue(), 'server');
});
