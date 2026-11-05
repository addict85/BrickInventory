/**
 * Das Benutzermenü verhält sich wie ein Menü nach dem APG-Muster „Menu
 * Button“: Enter und Pfeil öffnen es mit Fokus auf einem Eintrag, Pfeile,
 * Pos1 und Ende wandern, Escape schliesst und gibt den Fokus an den Knopf
 * zurück, eine Wahl setzt ihn auf die Überschrift der neuen Seite. Echte
 * Tastendrücke über das DevTools-Protokoll in Chrome.
 *
 * Gegenproben (02.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  menueOeffnen() ohne Fokus auf den Eintrag → rot: „Enter öffnet und
 *      fokussiert den ersten Eintrag“
 *   B  Pfeil-Behandlung im keydown-Hörer entfernt → rot: „Pfeil ab wandert“
 *   C  menueSchliessen(true) bei Escape wieder ohne Argument → rot: „Escape
 *      schliesst, Fokus zurück auf den Knopf“
 *   D  fokusAufTitel() in oeffneSicht entfernt → rot: „Wahl fokussiert die
 *      Überschrift der Sicht“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp, warte } = require('./helpers/app-browser');
const { musterSammlung } = require('./helpers/bestand');

const TASTEN = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, Home: 36, End: 35, Tab: 9 };

test('Benutzermenü: Tastatur nach dem Menü-Muster', { timeout: 120_000 }, async (t) => {
  const app = await starteApp(t, { name: `umenu_${process.pid}`, bestand: musterSammlung });
  if (app.grund) { t.skip(app.grund); return; }
  const { b, ruhig } = app;
  // Der Start lädt Einstellungen und Preise nach; erst danach ist der Zustand fest.
  await ruhig();
  // Der Einrichtungsassistent ist ein Dialog und finge Escape ab.
  const taste = async (key) => {
    const k = { key, code: key, windowsVirtualKeyCode: TASTEN[key] };
    await b.tab('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k });
    if (key === 'Enter') await b.tab('Input.dispatchKeyEvent', { type: 'char', text: '\r', ...k });
    await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
    await warte(60);
  };
  const fokus = () => b.auswerten(`(() => { const a = document.activeElement;
    return a.id || a.getAttribute('data-arg') || a.className || a.tagName; })()`);
  const offen = () => b.auswerten(`document.getElementById('umenu-pop').style.display !== 'none'
    && document.getElementById('btn-umenu').getAttribute('aria-expanded') === 'true'`);
  const eintraege = await b.auswerten(`[...document.querySelectorAll('#umenu-pop [role=menuitem]')]
    .filter(e => e.style.display !== 'none').map(e => e.id || e.getAttribute('data-arg'))`);
  assert.ok(eintraege.length >= 8, `zu wenige Einträge: ${eintraege}`);

  await b.auswerten(`document.getElementById('btn-umenu').focus(); true`);
  await taste('Enter');
  await t.test('Enter öffnet und fokussiert den ersten Eintrag', async () => {
    assert.equal(await offen(), true);
    assert.equal(await fokus(), eintraege[0]);
  });
  await t.test('Pfeil ab wandert, Ende und Pos1 springen, Pfeil auf läuft rund', async () => {
    await taste('ArrowDown');
    assert.equal(await fokus(), eintraege[1]);
    await taste('End');
    assert.equal(await fokus(), eintraege.at(-1));
    await taste('Home');
    assert.equal(await fokus(), eintraege[0]);
    await taste('ArrowUp');
    assert.equal(await fokus(), eintraege.at(-1));
  });
  await t.test('Escape schliesst, Fokus zurück auf den Knopf', async () => {
    await taste('Escape');
    assert.equal(await offen(), false);
    assert.equal(await fokus(), 'btn-umenu');
  });
  await t.test('Pfeil auf am Knopf öffnet mit Fokus auf dem letzten Eintrag', async () => {
    await taste('ArrowUp');
    assert.equal(await offen(), true);
    assert.equal(await fokus(), eintraege.at(-1));
    await taste('Escape');
  });
  await t.test('Wahl fokussiert die Überschrift der Sicht', async () => {
    await taste('Enter');
    await taste('ArrowDown');            // Gutscheine
    await taste('Enter');
    await ruhig();
    assert.equal(await offen(), false);
    assert.equal(await b.auswerten(`document.activeElement.classList.contains('ptitle')
      && !!document.activeElement.closest('#tab-gutscheine')`), true, `Fokus auf ${await fokus()}`);
  });
});
