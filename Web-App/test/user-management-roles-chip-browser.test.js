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
  const OTHERS = `rc_admin_${process.pid}`;
  const app = await startApp(t, { name: `rc_${process.pid}` });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, until, db } = app;
  await db.run(
    `INSERT INTO users (username, email, password_hash, is_active, email_verified, is_admin) VALUES ($1, $2, 'x', true, true, true)`,
    [OTHERS, `${OTHERS}@example.org`],
  );
  t.after(() => db.run('DELETE FROM users WHERE username = $1', [OTHERS]).catch(() => {}));
  const X = `[...document.querySelectorAll('#users-tbl tbody tr')].find(r => r.querySelector('strong')?.textContent === ${JSON.stringify(OTHERS)})?.querySelector('.role-chip .chip-remove')`;
  const metric = (width, phone) =>
    b.tab('Emulation.setDeviceMetricsOverride', {
      width: width,
      height: 800,
      deviceScaleFactor: 1,
      mobile: phone,
    });
  // Reload via another tab: the list then stands in the width that currently applies.
  const toList = async () => {
    await b.evaluate(`location.hash = '#/sammlung'; true`);
    await until(`document.getElementById('tab-gallery').classList.contains('active')`, 'Sammlung');
    await b.evaluate(`location.hash = '#/einstellungen/benutzer'; true`);
    await until(`!!(${X})`, 'X am fremden Administrator');
  };
  const mass = () =>
    b.evaluate(`(() => { const x = ${X}, r = x.getBoundingClientRect(), card = x.closest('tr').getBoundingClientRect();
      const el = x.closest('.role-chip'), chip = el.getBoundingClientRect();
      return { b: Math.round(r.width), h: Math.round(r.height), page: document.documentElement.scrollWidth, win: innerWidth,
        ragt: chip.left < card.left - 0.5 || chip.right > card.right + 0.5 || el.scrollWidth > el.clientWidth + 1 }; })()`);

  await t.test('desktop: X at least 24 px, visible focus, confirmation names the account', async () => {
    await metric(1280, false);
    await toList();
    const m = await mass();
    assert.ok(m.b >= 24 && m.h >= 24, `desktop: X at least 24 px (${m.b} × ${m.h})`);
    // Keyboard used last: then :focus-visible also applies to focus().
    await b.tab('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Shift', code: 'ShiftLeft' });
    await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft' });
    const f = await b.evaluate(`(() => { const x = ${X}; x.focus(); const s = getComputedStyle(x);
      return { visible: x.matches(':focus-visible'), style: s.outlineStyle, width: parseFloat(s.outlineWidth) }; })()`);
    assert.ok(f.visible && f.style !== 'none' && f.width >= 2, `desktop: visible focus ${JSON.stringify(f)}`);
    await b.evaluate(`${X}.click(); true`);
    await until(`getComputedStyle(document.getElementById('confirm-modal')).display !== 'none'`, 'Rückfrage');
    assert.equal(
      await b.evaluate(`document.getElementById('cd-title').textContent.trim()`),
      `„${OTHERS}“ die Administratorrolle entziehen?`,
    );
    await b.evaluate(`document.getElementById('cd-cancel').click(); true`);
    await until(`getComputedStyle(document.getElementById('confirm-modal')).display === 'none'`, 'Rückfrage zu');
  });

  await t.test('phone: X at least 44 px', async () => {
    await metric(390, true);
    await toList();
    const m = await mass();
    assert.ok(m.b >= 44 && m.h >= 44, `phone: X at least 44 px (${m.b} × ${m.h})`);
  });

  await t.test('320 px, 200 %: nothing sticks out of the card', async () => {
    for (const font of ['', '200%']) {
      await b.evaluate(`document.documentElement.style.fontSize = '${font}'; true`);
      await metric(320, true);
      await toList();
      const m = await mass();
      assert.ok(m.b >= 44 && m.h >= 44, `${font || '100 %'}: X ${m.b} × ${m.h}`);
      assert.equal(m.ragt, false, `${font || '100 %'}: the chip sticks out of the card`);
      assert.ok(m.page <= m.win, `${font || '100 %'}: page ${m.page} px wider than ${m.win} px`);
    }
    await b.evaluate(`document.documentElement.style.fontSize = ''; true`);
  });
});
