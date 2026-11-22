/**
 * Role chip of the account management in the real browser: the X is at least
 * 24 px on the computer, 44 px on the phone, shows the keyboard focus, opens the
 * confirmation with the account name, and at 320 px (also with 200 % font)
 * nothing sticks out of the card.
 *
 * Counter-checks (measured 16.11.2026, each on its own, bundle rebuilt):
 *   A  .chip-remove without min-width/min-height → red: „Rechner: X mindestens 24 px“
 *      (16 × 16)
 *   B  the phone rule .chip-remove { min-width: 44px … } removed → red:
 *      „Telefon: X mindestens 44 px“ (24 × 24)
 *   C  .chip-remove:focus-visible{outline:none} → red: „Rechner: sichtbarer Fokus“
 *   D  .role-chip with min-width:20rem and white-space:nowrap → red: “320 px,
 *      200 %: nothing sticks out of the card” (100 %: the chip begins on the left
 *      outside the card). With the first version, which only checked the right edge,
 *      it stayed green.
 *   E  the rule .role-word (word may break) removed → red: the same
 *      (200 %: the word sticks out of the chip). Without the check on scrollWidth
 *      it stayed green.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');

test('role chip: tap area, focus, 320 px and 200 %', { timeout: 200_000 }, async t => {
  const ANDERE = `rc_admin_${process.pid}`;
  const app = await startApp(t, { name: `rc_${process.pid}` });
  if (app.grund) {
    t.skip(app.grund);
    return;
  }
  const { b, bis, db } = app;
  await db.run(
    `INSERT INTO users (username, email, password_hash, is_active, email_verified, is_admin) VALUES ($1, $2, 'x', true, true, true)`,
    [ANDERE, `${ANDERE}@example.org`],
  );
  t.after(() => db.run('DELETE FROM users WHERE username = $1', [ANDERE]).catch(() => {}));
  const X = `[...document.querySelectorAll('#users-tbl tbody tr')].find(r => r.querySelector('strong')?.textContent === ${JSON.stringify(ANDERE)})?.querySelector('.role-chip .chip-remove')`;
  const metric = (breite, telefon) =>
    b.tab('Emulation.setDeviceMetricsOverride', {
      width: breite,
      height: 800,
      deviceScaleFactor: 1,
      mobile: telefon,
    });
  // Reload via another tab: the list then stands in the width that currently applies.
  const toList = async () => {
    await b.auswerten(`location.hash = '#/sammlung'; true`);
    await bis(`document.getElementById('tab-gallery').classList.contains('active')`, 'Sammlung');
    await b.auswerten(`location.hash = '#/einstellungen/benutzer'; true`);
    await bis(`!!(${X})`, 'X am fremden Administrator');
  };
  const mass = () =>
    b.auswerten(`(() => { const x = ${X}, r = x.getBoundingClientRect(), karte = x.closest('tr').getBoundingClientRect();
      const el = x.closest('.role-chip'), chip = el.getBoundingClientRect();
      return { b: Math.round(r.width), h: Math.round(r.height), seite: document.documentElement.scrollWidth, fenster: innerWidth,
        ragt: chip.left < karte.left - 0.5 || chip.right > karte.right + 0.5 || el.scrollWidth > el.clientWidth + 1 }; })()`);

  await t.test('desktop: X at least 24 px, visible focus, confirmation names the account', async () => {
    await metric(1280, false);
    await toList();
    const m = await mass();
    assert.ok(m.b >= 24 && m.h >= 24, `Rechner: X mindestens 24 px (${m.b} × ${m.h})`);
    // Keyboard used last: then :focus-visible also applies to focus().
    await b.tab('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Shift', code: 'ShiftLeft' });
    await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft' });
    const f = await b.auswerten(`(() => { const x = ${X}; x.focus(); const s = getComputedStyle(x);
      return { sichtbar: x.matches(':focus-visible'), stil: s.outlineStyle, breite: parseFloat(s.outlineWidth) }; })()`);
    assert.ok(f.sichtbar && f.stil !== 'none' && f.breite >= 2, `Rechner: sichtbarer Fokus ${JSON.stringify(f)}`);
    await b.auswerten(`${X}.click(); true`);
    await bis(`getComputedStyle(document.getElementById('confirm-modal')).display !== 'none'`, 'Rückfrage');
    assert.equal(
      await b.auswerten(`document.getElementById('cd-title').textContent.trim()`),
      `„${ANDERE}“ die Administratorrolle entziehen?`,
    );
    await b.auswerten(`document.getElementById('cd-cancel').click(); true`);
    await bis(`getComputedStyle(document.getElementById('confirm-modal')).display === 'none'`, 'Rückfrage zu');
  });

  await t.test('phone: X at least 44 px', async () => {
    await metric(390, true);
    await toList();
    const m = await mass();
    assert.ok(m.b >= 44 && m.h >= 44, `Telefon: X mindestens 44 px (${m.b} × ${m.h})`);
  });

  await t.test('320 px, 200 %: nothing sticks out of the card', async () => {
    for (const schrift of ['', '200%']) {
      await b.auswerten(`document.documentElement.style.fontSize = '${schrift}'; true`);
      await metric(320, true);
      await toList();
      const m = await mass();
      assert.ok(m.b >= 44 && m.h >= 44, `${schrift || '100 %'}: X ${m.b} × ${m.h}`);
      assert.equal(m.ragt, false, `${schrift || '100 %'}: der Chip ragt aus der Karte`);
      assert.ok(m.seite <= m.fenster, `${schrift || '100 %'}: Seite ${m.seite} px breiter als ${m.fenster} px`);
    }
    await b.auswerten(`document.documentElement.style.fontSize = ''; true`);
  });
});
