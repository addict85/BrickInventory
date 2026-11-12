/**
 * Wegweiser in Texten („Menü → Haushalt“) führen dorthin, wo die Oberfläche
 * die Sache tatsächlich zeigt. Die Ziele werden aus der gerenderten Oberfläche
 * gelesen (Benutzermenü, Abschnitte der Einstellungen), nicht aus einer Liste
 * im Test: Benennt jemand einen Menüpunkt um, wird jeder alte Wegweiser rot. …
 *
 * Gegenproben (02.11.2026 gemessen, je einzeln):
 *   A  household.invite_hint (de) wieder „… im anderen Konto unter
 *      Einstellungen ein …“ → rot: „de: Wegweiser stimmen“
 *   B  wanted.cond_default (en) „default from Menu → Profile“ → rot:
 *      „en: Wegweiser stimmen“ (Profile ist kein Menüpunkt)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche } = require('./helpers/oberflaeche');

const OHNE_PFAD =
  /unter Einstellungen\b|in den Einstellungen\b|in the settings\b|under Settings\b|in Settings\b|Reiter (Sets|Teile)/i;

for (const sprache of ['de', 'en']) {
  test(`${sprache}: Wegweiser stimmen`, async () => {
    const { w, d } = await oeffneOberflaeche({}, { sprache });
    try {
      const menue = [...d.querySelectorAll('#umenu-pop .umenu-item span')].map(s => s.textContent.trim());
      const abschnitte = [...d.querySelectorAll('.einst-nav a')].map(a => a.textContent.trim());
      assert.ok(
        menue.length >= 8 && abschnitte.length >= 5,
        `Menü/Abschnitte nicht gerendert: ${menue} / ${abschnitte}`,
      );
      const woerter = sprache === 'de' ? w.I18N_DE : w.I18N_EN;
      const MENUE = sprache === 'de' ? 'Menü' : 'Menu';
      const funde = [];
      let gesehen = 0;
      for (const [k, text] of Object.entries(woerter)) {
        if (typeof text !== 'string') continue;
        if (OHNE_PFAD.test(text)) funde.push(`${k}: Ziel ohne Pfad — „${text.match(OHNE_PFAD)[0]}“`);
        // Nach „Menü → “ muss ein Menüpunkt stehen (der längste, der passt);
        // nach „Einstellungen → “ ein Abschnitt der Einstellungen.
        const einst = sprache === 'de' ? 'Einstellungen' : 'Settings';
        const beginnt = (rest, namen) =>
          [...namen]
            .sort((x, y) => y.length - x.length)
            .find(n => rest.startsWith(n) && !/^[\p{L}\d]/u.test(rest.slice(n.length)));
        for (const m of text.matchAll(/\b(Menü|Menu|menu) → /g)) {
          gesehen++;
          if (m[1] !== MENUE) funde.push(`${k}: „${m[1]}“ statt „${MENUE}“`);
          const rest = text.slice(m.index + m[0].length);
          const ziel = beginnt(rest, menue);
          if (!ziel) {
            funde.push(`${k}: „${rest.slice(0, 24)}…“ beginnt mit keinem Menüpunkt`);
            continue;
          }
          const danach = rest.slice(ziel.length);
          if (ziel === einst && danach.startsWith(' → ') && !beginnt(danach.slice(3), abschnitte))
            funde.push(`${k}: „${danach.slice(3, 27)}…“ ist kein Abschnitt der Einstellungen`);
        }
      }
      assert.ok(gesehen >= 4, `nur ${gesehen} Wegweiser gefunden — prüft die Suche noch etwas?`);
      assert.deepEqual(funde, []);
    } finally {
      w.close();
    }
  });
}
