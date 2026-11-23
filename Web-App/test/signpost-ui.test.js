/**
 * Signposts in texts („Menü → Haushalt“) lead to where the UI
 * actually shows the thing. The targets are read from the rendered UI
 * (user menu, sections of the settings), not from a list
 * in the test: if somebody renames a menu item, every old signpost turns red. …
 *
 * Counter-checks (measured 02.11.2026, each on its own):
 *   A  household.invite_hint (de) again „… im anderen Konto unter
 *      Einstellungen ein …“ → red: “de: signposts are correct”
 *   B  wanted.cond_default (en) „default from Menu → Profile“ → red:
 *      “en: signposts are correct” (Profile is not a menu item)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi } = require('./helpers/ui');

const WITHOUT_PATH =
  /unter Einstellungen\b|in den Einstellungen\b|in the settings\b|under Settings\b|in Settings\b|Reiter (Sets|Teile)/i;

for (const language of ['de', 'en']) {
  test(`${language}: signposts are correct`, async () => {
    const { w, d } = await openUi({}, { language });
    try {
      const menu = [...d.querySelectorAll('#umenu-pop .umenu-item span')].map(s => s.textContent.trim());
      const sections = [...d.querySelectorAll('.settings-nav a')].map(a => a.textContent.trim());
      assert.ok(menu.length >= 8 && sections.length >= 5, `menu/sections not rendered: ${menu} / ${sections}`);
      const words = language === 'de' ? w.I18N_DE : w.I18N_EN;
      const MENU = language === 'de' ? 'Menü' : 'Menu';
      const findings = [];
      let seen = 0;
      for (const [k, text] of Object.entries(words)) {
        if (typeof text !== 'string') continue;
        if (WITHOUT_PATH.test(text)) findings.push(`${k}: Ziel ohne Pfad — „${text.match(WITHOUT_PATH)[0]}“`);
        // After „Menü → “ a menu item must stand (the longest one that fits);
        // after „Einstellungen → “ a section of the settings.
        const settings = language === 'de' ? 'Einstellungen' : 'Settings';
        const begins = (rest, names) =>
          [...names]
            .sort((x, y) => y.length - x.length)
            .find(n => rest.startsWith(n) && !/^[\p{L}\d]/u.test(rest.slice(n.length)));
        for (const m of text.matchAll(/\b(Menü|Menu|menu) → /g)) {
          seen++;
          if (m[1] !== MENU) findings.push(`${k}: „${m[1]}“ statt „${MENU}“`);
          const rest = text.slice(m.index + m[0].length);
          const target = begins(rest, menu);
          if (!target) {
            findings.push(`${k}: „${rest.slice(0, 24)}…“ beginnt mit keinem Menüpunkt`);
            continue;
          }
          const afterwards = rest.slice(target.length);
          if (target === settings && afterwards.startsWith(' → ') && !begins(afterwards.slice(3), sections))
            findings.push(`${k}: „${afterwards.slice(3, 27)}…“ ist kein Abschnitt der Einstellungen`);
        }
      }
      assert.ok(seen >= 4, `only ${seen} signposts found — does the search still check anything?`);
      assert.deepEqual(findings, []);
    } finally {
      w.close();
    }
  });
}
