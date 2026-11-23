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
function win({ server = 'classic', choice = null, dark = false } = {}) {
  const dom = new jsdom.JSDOM(`<!doctype html><html data-theme="${server}"><head></head><body></body></html>`, {
    runScripts: 'outside-only',
    url: 'http://localhost/',
  });
  const w = dom.window;
  const listener = [];
  const mq = { matches: dark, addEventListener: (_e, f) => listener.push(f) };
  w.matchMedia = () => mq;
  w.fetch = async () => ({ ok: false });
  if (choice) w.localStorage.setItem('bim_dark', choice);
  w.eval(BOOT);
  const systemSwitch = d => {
    mq.matches = d;
    for (const f of listener) f();
  };
  const hasDark = () => w.document.documentElement.hasAttribute('data-dark');
  return { w, theme: () => w.document.documentElement.getAttribute('data-theme'), dark: hasDark, systemSwitch };
}

test('without a choice the device follows the system', () => {
  const { w, theme, dark } = win({ dark: true });
  assert.equal(theme(), 'classic');
  assert.equal(dark(), true, 'Default is „system“, the dark system was ignored');
  assert.equal(w.__bimDarkValue(), 'system');
});

test('with the choice "server" the theme stays light — even with a dark system', () => {
  const { theme, dark } = win({ choice: 'server', dark: true });
  assert.equal(theme(), 'classic');
  assert.equal(dark(), false);
});

test('with the choice "system": dark with a dark system, and it follows the change', () => {
  const { w, theme, dark, systemSwitch } = win({ choice: 'system', dark: true });
  assert.equal(dark(), true, 'stays light although the system is dark');
  assert.equal(theme(), 'classic', 'the design stays — dark is a variant, not a different design');
  assert.equal(w.localStorage.getItem('bim_theme'), 'classic', 'Cache: the server design is remembered');
  systemSwitch(false);
  assert.equal(dark(), false);
  systemSwitch(true);
  assert.equal(dark(), true);
  assert.equal(theme(), 'classic');
});

test('werkbank is already dark and gets no variant', () => {
  const { theme, dark } = win({ server: 'werkbank', choice: 'system', dark: true });
  assert.equal(theme(), 'werkbank');
  assert.equal(dark(), false);
});

test('a later theme from the server applies, the device stays dark', () => {
  const { w, theme, dark } = win({ choice: 'system', dark: true });
  w.__bimApplyTheme('brick');
  assert.equal(theme(), 'brick');
  assert.equal(dark(), true);
  assert.equal(w.localStorage.getItem('bim_theme'), 'brick', 'Cache');
  w.__bimDark('server');
  assert.equal(theme(), 'brick');
  assert.equal(dark(), false);
  assert.equal(w.__bimDarkValue(), 'server');
});
