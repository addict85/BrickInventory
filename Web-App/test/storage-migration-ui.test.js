/**
 * Device settings survive the English renaming: theme-boot.js moves the old German localStorage keys
 * (and the dark-mode value "immer") to their new names once, before it reads them itself.
 *
 * Counter-checks (22.11.2026, measured):
 *   A  the entry ['bim_dunkel', 'bim_dark'] removed from RENAMED_PREFIXES → red: “dark mode kept”
 *      (the page stayed light although the device had chosen "always dark")
 *   B  the value mapping "immer" → "always" removed → red: same test, value 'immer' instead of 'always'
 *   C  moveOldKey() no longer removes the old key → red: “old keys are gone”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const jsdom = require(path.join(ROOT, 'node_modules', 'jsdom'));
const BOOT = fs.readFileSync(path.join(ROOT, 'public', 'js', 'theme-boot.js'), 'utf8');

/** @param {Record<string, string>} stored */
function boot(stored) {
  const dom = new jsdom.JSDOM('<!doctype html><html data-theme="classic"><head></head><body></body></html>', {
    runScripts: 'outside-only',
    url: 'http://localhost/',
  });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false, addEventListener: () => {} });
  w.fetch = async () => ({ ok: false });
  for (const [k, v] of Object.entries(stored)) w.localStorage.setItem(k, v);
  w.eval(BOOT);
  return w;
}

test('dark mode kept: "immer" under the old key becomes "always" under the new one', () => {
  const w = boot({ bim_dunkel: 'immer' });
  assert.equal(w.localStorage.getItem('bim_dark'), 'always');
  assert.equal(w.__bimDarkValue(), 'always');
  assert.equal(w.document.documentElement.hasAttribute('data-dark'), true, 'the page stayed light');
  w.close();
});

test('filters, order and dismissed hints move to the new names', () => {
  const w = boot({
    bim_lager_gallery: 'Regal 3',
    bim_scope_merkliste: 'own',
    bim_teile_ordnung: 'name',
    bim_einst_abschnitt: 'settings-smtp',
    'bim_rb_hinweis_weg:7': '1',
    bim_alarm_marke_7: '1700000000000',
  });
  assert.deepEqual(
    {
      location: w.localStorage.getItem('bim_location_gallery'),
      scope: w.localStorage.getItem('bim_scope_wanted'),
      order: w.localStorage.getItem('bim_parts_order'),
      section: w.localStorage.getItem('bim_settings_section'),
      hint: w.localStorage.getItem('bim_rb_hint_dismissed:7'),
      seen: w.localStorage.getItem('bim_alert_seen_7'),
    },
    { location: 'Regal 3', scope: 'own', order: 'name', section: 'settings-smtp', hint: '1', seen: '1700000000000' },
  );
  w.close();
});

test('old keys are gone and a newer value is not overwritten', () => {
  const w = boot({ bim_dunkel: 'immer', bim_dark: 'server', bim_teile_ordnung: 'farbe' });
  assert.equal(w.localStorage.getItem('bim_dark'), 'server', 'the newer choice was overwritten');
  assert.deepEqual(
    Object.keys(w.localStorage).filter(k => k === 'bim_dunkel' || k === 'bim_teile_ordnung'),
    [],
  );
  w.close();
});
