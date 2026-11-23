/**
 * Individual usability findings in Chrome, on the real app:
 *   - Confirmation dialog: Escape returns focus to the trigger; if
 *     “more actions” is collapsed (it collapses on choosing), to its <summary>;
 *   - Set view: “reimport parts” (under “more actions”) is a …
 *
 * Counter-checks (measured 02.11.2026, each alone):
 *   A  rueckziel() in dialoge.js only returns `el` → red:
 *      “Escape with collapsed menu: focus on more actions”
 *   B  button again with data-style="padding:1px 6px;…" and without text → red:
 *      “reimport parts: labeled, 24 px, without inline style”
 *   C  rule input[type="checkbox"]{width:24px…} removed → red: “checkbox
 *      passkeys 24 px”
 *   D  .period-btn:hover again without @media (hover:hover) → red:
 *      “hover only on pointer devices”
 *   E  .bs again with border var(--bdr) → red: “login mask” classic, brick,
 *      werkbank, farbfaecher (button border “Mit Passkey anmelden”)
 *   F  (04.11.) the class v-more removed in the set dialog (menu stays open
 *      on choosing) → red: “Escape in the confirmation dialog: focus back
 *      on more actions” (“menu collapses on choosing”)
 *   G  (07.11.) `checked` removed from the checkbox #pw-pk in index.html → red:
 *      “password change: passkeys checkbox is preselected”
 *   (First run: red at “Passwort vergessen?” 131×20, “Build …” 2.97:1 and
 *   brick dark “Anmelden” 2.11:1 — fixed, see commit.)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, warte } = require('./helpers/app-browser');
const { patternHousehold } = require('./helpers/inventory');
const { LAYOUT } = require('./helpers/layout-measurement');

const ESC = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 };

test('operation: focus, target sizes, hover, login mask', { timeout: 240_000 }, async t => {
  const app = await startApp(t, { name: `bedien_${process.pid}`, holding: patternHousehold, allDesigns: true });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, bis, ruhig } = app;
  // Startup loads settings and prices afterwards; only then is the state fixed.
  await ruhig();
  await b.auswerten(`document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
  await bis(`document.querySelectorAll('#gallery .sc').length >= 4`, 'Kacheln');
  const printEscape = async () => {
    await b.tab('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...ESC });
    await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', ...ESC });
    await ruhig();
  };
  const fokus = () =>
    b.auswerten(
      `(() => { const a = document.activeElement; return a.id || a.tagName.toLowerCase() + '.' + a.className; })()`,
    );

  // Shared with the sub-account: deleting asks which copy, the own set alone would go without a question.
  await bis(`!!document.querySelector('#gallery .sc[data-arg="21318-1"]')`, 'Tree House');
  await b.auswerten(`document.querySelector('#gallery .sc[data-arg="21318-1"]').click(); true`);
  await bis(
    `document.getElementById('set-modal').classList.contains('open') && !!document.getElementById('m-det').querySelector('.dr')`,
    'Set-Ansicht',
  );

  await t.test('reimport parts: labeled, 24 px, without inline style', async () => {
    const k = await b.auswerten(`(() => { document.querySelector('#set-modal details.more-menu').open = true;
      const k = document.querySelector('#set-modal [data-click="reimportOpenSetParts"]'); const r = k.getBoundingClientRect();
      return { text: k.textContent.trim(), b: r.width, h: r.height, stil: k.getAttribute('style') }; })()`);
    assert.match(k.text, /Teile neu/);
    assert.ok(k.b >= 24 && k.h >= 24, `nur ${k.b}×${k.h}`);
    assert.equal(k.stil, null);
  });

  await t.test('Escape in the confirmation dialog: focus back on "more actions"', async () => {
    // The menu collapses on choosing; the visible trigger is then its button.
    await b.auswerten(
      `document.querySelector('#set-modal details.more-menu').open = true; document.getElementById('btn-md').focus(); document.getElementById('btn-md').click(); true`,
    );
    await bis(`document.getElementById('confirm-modal').style.display !== 'none'`, 'Confirmation');
    assert.equal(
      await b.auswerten(`document.querySelector('#set-modal details.more-menu').open`),
      false,
      'Menu closes on selection',
    );
    await printEscape();
    assert.equal(await b.auswerten(`document.getElementById('confirm-modal').style.display`), 'none');
    assert.equal(
      await b.auswerten(`document.activeElement === document.querySelector('#set-modal details.more-menu > summary')`),
      true,
      `Focus on ${await fokus()}`,
    );
  });

  await t.test('Escape with a collapsed menu: focus on more actions', async () => {
    await b.auswerten(`document.getElementById('btn-md').click(); true`);
    await bis(`document.getElementById('confirm-modal').style.display !== 'none'`, 'Confirmation');
    await b.auswerten(`document.querySelector('#set-modal details.more-menu').open = false; true`);
    await printEscape();
    assert.equal(
      await b.auswerten(`document.activeElement === document.querySelector('#set-modal details.more-menu > summary')`),
      true,
      `Focus on ${await fokus()}`,
    );
  });
  await printEscape();

  await t.test('passkeys check box 24 px', async () => {
    await b.auswerten(`document.querySelector('.umenu-item[data-arg="profile"]').click(); true`);
    await bis(`!!document.getElementById('pw-pk')?.checkVisibility()`, 'Account');
    const r = await b.auswerten(
      `(() => { const r = document.getElementById('pw-pk').getBoundingClientRect(); return [r.width, r.height]; })()`,
    );
    assert.ok(r[0] >= 24 && r[1] >= 24, `nur ${r[0]}×${r[1]}`);
  });

  await t.test('password change: passkeys check box is preselected', async () => {
    assert.equal(await b.auswerten(`document.getElementById('pw-pk').checked`), true);
  });

  await t.test('hover only on pointer devices', async () => {
    const frei = await b.auswerten(`(() => { const raus = [];
      const lauf = (regeln, inHover) => { for (const r of regeln) {
        if (r instanceof CSSMediaRule) lauf(r.cssRules, inHover || /hover:\\s*hover/.test(r.conditionText));
        else if (r instanceof CSSStyleRule && /:hover/.test(r.selectorText) && !inHover) raus.push(r.selectorText);
        else if (r.cssRules) lauf(r.cssRules, inHover); } };
      for (const s of document.styleSheets) { if (!s.href || /vendor/.test(s.href)) continue; lauf(s.cssRules, false); }
      return raus; })()`);
    assert.deepEqual(frei, []);
  });

  // Login mask: log out, then measure every design light and dark.
  await b.auswerten(`window.__alt = true; document.getElementById('btn-logout').click(); true`);
  await bis(
    `!window.__alt && getComputedStyle(document.getElementById('login-screen')).display !== 'none'`,
    'Anmeldemaske',
  );
  // Logging out reloads the page, and it only brings the active design: add the others again.
  await b.auswerten(`(() => { const v = document.getElementById('theme-styles');
    return Promise.all([...v.content.querySelectorAll('link')].map(l => new Promise(r => {
      l.onload = l.onerror = r; v.before(document.adoptNode(l)); }))).then(() => true); })()`);
  // The test server has no domain in APP_BASE_URL and hides passkey and
  // “Passwort vergessen?”; the full mask is measured.
  // Only when the latest response is registered: a later one would otherwise hide
  // the just shown passkey button again.
  await bis(`document.getElementById('login-screen').dataset.loginMethods === 'loaded'`, 'Anmeldewege abgefragt');
  await b.auswerten(
    `document.getElementById('btn-passkey').hidden = false; document.getElementById('link-forgot').hidden = false; true`,
  );
  for (const design of ['classic', 'brick', 'werkbank', 'farbfaecher', 'noppe', 'hochglanz']) {
    await t.test(`login mask ${design}`, async () => {
      const funde = [];
      for (const dunkel of [false, true]) {
        await b.auswerten(
          `document.documentElement.setAttribute('data-theme', '${design}'); document.documentElement.toggleAttribute('data-dark', ${dunkel}); true`,
        );
        await warte(80);
        assert.equal(
          await b.auswerten(`!!document.getElementById('btn-passkey')?.checkVisibility()`),
          true,
          'Passkey button is missing',
        );
        for (const f of await b.auswerten(LAYOUT(false))) funde.push(`${dunkel ? 'dark' : 'hell'}: ${f}`);
      }
      assert.deepEqual(funde, []);
    });
  }
});
