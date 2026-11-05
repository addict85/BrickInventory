/**
 * Einzelne Bedienbefunde in Chrome, an der echten App:
 *   - Bestätigungsdialog: Escape gibt den Fokus an den Auslöser zurück; ist
 *     „Weitere Aktionen“ zugeklappt (es klappt bei der Wahl zu), an dessen <summary>;
 *   - Set-Ansicht: „Teile neu importieren“ (unter „Weitere Aktionen“) ist ein
 *     beschrifteter Knopf von mindestens 24 × 24 px ohne Inline-Stil;
 *   - Konto: das Häkchen „Auch alle Passkeys entfernen“ ist selbst 24 × 24 px;
 *   - jede :hover-Regel der geladenen Stylesheets steht in @media (hover:hover):
 *     Auf Touchgeräten bleibt sonst der Hover-Zustand nach dem Tippen kleben;
 *   - Anmeldemaske in allen sechs Designs hell und dunkel: Knöpfe und Felder
 *     grenzen sich 3:1 ab („Mit Passkey anmelden“), Text 4,5:1.
 *
 * Gegenproben (02.11.2026 gemessen, je einzeln):
 *   A  rueckziel() in 01-dialoge.js gibt nur `el` zurück → rot:
 *      „Escape bei zugeklapptem Menü: Fokus auf Weitere Aktionen“
 *   B  Knopf wieder mit data-stil="padding:1px 6px;…" und ohne Text → rot:
 *      „Teile neu importieren: beschriftet, 24 px, ohne Inline-Stil“
 *   C  Regel input[type="checkbox"]{width:24px…} entfernt → rot: „Häkchen
 *      Passkeys 24 px“
 *   D  .period-btn:hover wieder ohne @media (hover:hover) → rot:
 *      „Hover nur bei Zeigergeräten“
 *   E  .bs wieder mit border var(--bdr) → rot: „Anmeldemaske“ classic, brick,
 *      werkbank, farbfaecher (Knopfgrenze „Mit Passkey anmelden“)
 *   F  (04.11.) im Set-Dialog die Klasse v-mehr entfernt (Menü bleibt bei
 *      der Wahl offen) → rot: „Escape im Bestätigungsdialog: Fokus zurück
 *      auf Weitere Aktionen“ („Menü klappt bei der Wahl zu“)
 *   (Erstlauf: rot an „Passwort vergessen?“ 131×20, „Build …“ 2,97:1 und
 *   brick dunkel „Anmelden“ 2,11:1 — behoben, siehe Commit.)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp, warte } = require('./helpers/app-browser');
const { musterSammlung } = require('./helpers/bestand');
const { LAYOUT } = require('./helpers/layout-messung');

const ESC = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 };

test('Bedienung: Fokus, Zielgrössen, Hover, Anmeldemaske', { timeout: 240_000 }, async (t) => {
  const app = await starteApp(t, { name: `bedien_${process.pid}`, bestand: musterSammlung });
  if (app.grund) { t.skip(app.grund); return; }
  const { b, bis } = app;
  await warte(1000);
  await b.auswerten(`document.querySelector('#einrichtung-modal.open [data-click="einrichtungSpaeter"]')?.click(); true`);
  await b.auswerten(`document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
  await bis(`document.querySelectorAll('#gallery .sc').length >= 4`, 'Kacheln');
  const escape = async () => {
    await b.tab('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...ESC });
    await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', ...ESC });
    await warte(150);
  };
  const fokus = () => b.auswerten(`(() => { const a = document.activeElement; return a.id || a.tagName.toLowerCase() + '.' + a.className; })()`);

  await b.auswerten(`document.querySelector('#gallery .sc[data-click="openModal"]').click(); true`);
  await bis(`document.getElementById('set-modal').classList.contains('open') && !!document.getElementById('m-det').querySelector('.dr')`, 'Set-Ansicht');

  await t.test('Teile neu importieren: beschriftet, 24 px, ohne Inline-Stil', async () => {
    const k = await b.auswerten(`(() => { document.querySelector('#set-modal details.mehr-menue').open = true;
      const k = document.querySelector('#set-modal [data-click="teileNeuImportieren"]'); const r = k.getBoundingClientRect();
      return { text: k.textContent.trim(), b: r.width, h: r.height, stil: k.getAttribute('style') }; })()`);
    assert.match(k.text, /Teile neu/);
    assert.ok(k.b >= 24 && k.h >= 24, `nur ${k.b}×${k.h}`);
    assert.equal(k.stil, null);
  });

  await t.test('Escape im Bestätigungsdialog: Fokus zurück auf „Weitere Aktionen“', async () => {
    // Das Menü klappt bei der Wahl zu; der sichtbare Auslöser ist dann sein Knopf.
    await b.auswerten(`document.querySelector('#set-modal details.mehr-menue').open = true; document.getElementById('btn-md').focus(); document.getElementById('btn-md').click(); true`);
    await bis(`document.getElementById('confirm-modal').style.display !== 'none'`, 'Bestätigung');
    assert.equal(await b.auswerten(`document.querySelector('#set-modal details.mehr-menue').open`), false, 'Menü klappt bei der Wahl zu');
    await escape();
    assert.equal(await b.auswerten(`document.getElementById('confirm-modal').style.display`), 'none');
    assert.equal(await b.auswerten(`document.activeElement === document.querySelector('#set-modal details.mehr-menue > summary')`), true,
      `Fokus auf ${await fokus()}`);
  });

  await t.test('Escape bei zugeklapptem Menü: Fokus auf Weitere Aktionen', async () => {
    await b.auswerten(`document.getElementById('btn-md').click(); true`);
    await bis(`document.getElementById('confirm-modal').style.display !== 'none'`, 'Bestätigung');
    await b.auswerten(`document.querySelector('#set-modal details.mehr-menue').open = false; true`);
    await escape();
    assert.equal(await b.auswerten(`document.activeElement === document.querySelector('#set-modal details.mehr-menue > summary')`), true,
      `Fokus auf ${await fokus()}`);
  });
  await escape();

  await t.test('Häkchen Passkeys 24 px', async () => {
    await b.auswerten(`document.querySelector('.umenu-item[data-arg="profil"]').click(); true`);
    await bis(`!!document.getElementById('pw-pk')?.checkVisibility()`, 'Konto');
    const r = await b.auswerten(`(() => { const r = document.getElementById('pw-pk').getBoundingClientRect(); return [r.width, r.height]; })()`);
    assert.ok(r[0] >= 24 && r[1] >= 24, `nur ${r[0]}×${r[1]}`);
  });

  await t.test('Hover nur bei Zeigergeräten', async () => {
    const frei = await b.auswerten(`(() => { const raus = [];
      const lauf = (regeln, inHover) => { for (const r of regeln) {
        if (r instanceof CSSMediaRule) lauf(r.cssRules, inHover || /hover:\\s*hover/.test(r.conditionText));
        else if (r instanceof CSSStyleRule && /:hover/.test(r.selectorText) && !inHover) raus.push(r.selectorText);
        else if (r.cssRules) lauf(r.cssRules, inHover); } };
      for (const s of document.styleSheets) { if (!s.href || /vendor/.test(s.href)) continue; lauf(s.cssRules, false); }
      return raus; })()`);
    assert.deepEqual(frei, []);
  });

  // Anmeldemaske: abmelden, dann jedes Design hell und dunkel messen.
  await b.auswerten(`document.getElementById('btn-logout').click(); true`);
  await bis(`getComputedStyle(document.getElementById('login-screen')).display !== 'none'`, 'Anmeldemaske');
  // Der Testserver hat keine Domäne in APP_BASE_URL und blendet Passkey und
  // „Passwort vergessen?“ aus; gemessen wird die volle Maske.
  // Erst wenn die jüngste Antwort eingetragen ist: Eine spätere blendete sonst
  // den eben eingeblendeten Passkey-Knopf wieder aus.
  await bis(`document.getElementById('login-screen').dataset.anmeldewege === 'geladen'`, 'Anmeldewege abgefragt');
  await b.auswerten(`document.getElementById('btn-passkey').hidden = false; document.getElementById('link-forgot').hidden = false; true`);
  for (const design of ['classic', 'brick', 'werkbank', 'farbfaecher', 'noppe', 'hochglanz']) {
    await t.test(`Anmeldemaske ${design}`, async () => {
      const funde = [];
      for (const dunkel of [false, true]) {
        await b.auswerten(`document.documentElement.setAttribute('data-theme', '${design}'); document.documentElement.toggleAttribute('data-dunkel', ${dunkel}); true`);
        await warte(80);
        assert.equal(await b.auswerten(`!!document.getElementById('btn-passkey')?.checkVisibility()`), true, 'Passkey-Knopf fehlt');
        for (const f of await b.auswerten(LAYOUT(false))) funde.push(`${dunkel ? 'dunkel' : 'hell'}: ${f}`);
      }
      assert.deepEqual(funde, []);
    });
  }
});
