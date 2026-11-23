/**
 * Findings of UI review 13 in the real browser: the household invitation names
 * the inviting account, the code is readable, dialogs and confirmation page
 * say what is confirmed, toasts and floating button cover nothing,
 * and finances show missing prices without alarm and the curve also at 200 %.
 *
 * Counter-checks (measured 04.11.2026, each alone, bundle or dist rebuilt):
 *   A  redeemHouseholdInvite again without a check route (title “Einladung annehmen”)
 *      → red: “invitation names the main account”
 *   B  createInvitation again with randomBytes(24).base64url → red: “invitation code
 *      in groups of four” (format) and “invitation names the main account”
 *      (entered in lower case without dashes: expired)
 *   C  profile again with tRaw('account.profile') without explanation → red: “e-mail
 *      change: title and new address”
 *   D  discardToasts again “all with a button stay” → red: “toast of the view
 *      closes on switching”
 *   E  Delete branch removed in aktionen.js → red: “delete cross: Delete on the card”
 *   F  priceRow again with gift in the price box → red: “gift as a badge”
 *   G  jobIconSvg without imgDl and pdfJobs → red: “background jobs: every service
 *      with an icon”
 *   H  priceStatusBadge without a neutral branch → red: “price missing: gray when it
 *      is missing almost everywhere” (6 red triangles)
 *   I  the rules .button-floating > span { display: none } removed → red:
 *      “floating button: only icon” (measured again 05.11.2026 with waiting for the state:
 *      red after 5 s at “when scrolling only the icon”)
 *   K  referenceLine without the space test at the top → red: “sub-account: purchase price
 *      label in the chart” (cut off at the top)
 *   L  showConfirmationTarget not called → red: “confirmation page names
 *      account and address”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, warte } = require('./helpers/app-browser');
const { patternHousehold, holdsSet } = require('./helpers/inventory');
const { buildAndRequire } = require('./helpers/sources');
const { LAYOUT } = require('./helpers/layout-measurement');

const klick = sel => `document.querySelector(${JSON.stringify(sel)})?.click(); true`;
const text = sel => `(document.querySelector(${JSON.stringify(sel)})?.textContent || '').replace(/\\s+/g, ' ').trim()`;
const open = `getComputedStyle(document.getElementById('confirm-modal')).display !== 'none'`;
const CODE = /^[2-9A-HJKMNP-Z]{4}(-[2-9A-HJKMNP-Z]{4}){3}$/;

test('invitation, toasts, background jobs, price status', { timeout: 280_000 }, async t => {
  const NAME = `r13_${process.pid}`,
    KIND = `${NAME}_kind`,
    OTHERS = `r13x_${process.pid}`;
  const app = await startApp(t, { name: NAME, holding: patternHousehold });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, bis, db, port, ruhig } = app;
  // Startup loads settings and prices afterwards; only then is the state fixed.
  await ruhig();
  buildAndRequire();
  const haushalt = require('./helpers/sources').testServices().household;
  const geh = async path => {
    await b.auswerten(`location.hash = '#/${path}'; true`);
    await warte(300);
  };
  const zu = async () => {
    await b.auswerten(klick('#cd-cancel'));
    await bis(`!(${open})`, 'Dialog zu');
  };
  const andere = (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified) VALUES ($1, $2, 'x', true, true) RETURNING id`,
      [OTHERS, `${OTHERS}@example.org`],
    )
  ).id;
  t.after(() => db.run('DELETE FROM users WHERE id = $1', [andere]).catch(() => {}));

  await t.test('invitation code in groups of four', async () => {
    await b.auswerten(klick('.umenu-item[data-arg="household"]'));
    await bis(`document.getElementById('household-invite-box')?.checkVisibility()`, 'Household');
    await b.auswerten(klick('[data-click="createHouseholdInvite"]'));
    await bis(`!!document.getElementById('household-invite-code').value`, 'Code created');
    assert.match(await b.auswerten(`document.getElementById('household-invite-code').value`), CODE);
  });

  await t.test('invitation names the main account', async () => {
    const { code } = await require('./helpers/sources').asAccount(andere, () => haushalt.createInvitation(andere));
    assert.match(code, CODE);
    assert.match(
      await b.auswerten(text('#household-redeem-box')),
      /sieht und bearbeitet danach deine Sammlung; du kannst die Verknüpfung jederzeit lösen/,
    );
    // As typed: lower case and without dashes.
    await b.auswerten(`document.getElementById('household-redeem-code').value = ${JSON.stringify(code.replace(/-/g, '').toLowerCase())};
      document.querySelector('[data-click="redeemHouseholdInvite"]').click(); true`);
    await bis(open, 'Confirmation');
    assert.equal(await b.auswerten(text('#cd-title')), `Einladung von „${OTHERS}“ annehmen?`);
    assert.match(
      await b.auswerten(text('#cd-msg')),
      new RegExp(`„${OTHERS}“ kann danach deine Sets, Teile und Minifiguren sehen und ändern`),
    );
    await zu();
    // A wrong code opens no dialog, and without login the route reveals nothing.
    await b.auswerten(`document.getElementById('household-redeem-code').value = 'AAAA-BBBB-CCCC-DDDD';
      document.querySelector('[data-click="redeemHouseholdInvite"]').click(); true`);
    await bis(
      `[...document.querySelectorAll('#toasts .toast.error')].some(x => /abgelaufen|ungültig/i.test(x.textContent))`,
      'Refusal',
    );
    assert.equal(await b.auswerten(open), false);
    const fremd = await fetch(`http://127.0.0.1:${port}/api/v2/settings/household/redeem/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    assert.equal(fremd.status, 401);
    assert.doesNotMatch(await fremd.text(), new RegExp(OTHERS));
  });

  await t.test('email change: title and new address', async () => {
    await b.auswerten(klick('.umenu-item[data-arg="profile"]'));
    await bis(`!!document.getElementById('prof-email').value`, 'Profile');
    await b.auswerten(
      `document.getElementById('prof-email').value = 'neu-${process.pid}@example.org'; document.getElementById('btn-sav-prof').click(); true`,
    );
    await bis(open, 'Passwortabfrage');
    assert.equal(await b.auswerten(text('#cd-title')), 'E-Mail-Adresse ändern?');
    assert.match(
      await b.auswerten(text('#cd-msg')),
      new RegExp(`Neue Adresse: neu-${process.pid}@example.org\\..*Passwort`),
    );
    await zu();
  });

  await t.test("the view's toast closes on a switch", async () => {
    await geh('sammlung/set/99999-9');
    await bis(
      `[...document.querySelectorAll('#toasts .toast')].some(x => /nicht in deiner Sammlung/.test(x.textContent))`,
      'Toast',
    );
    await b.auswerten(klick('.ntab[data-tab="parts"]'));
    await bis(`document.getElementById('tab-parts').classList.contains('active')`, 'Parts');
    assert.equal(
      await b.auswerten(
        `[...document.querySelectorAll('#toasts .toast')].filter(x => /nicht in deiner Sammlung/.test(x.textContent)).length`,
      ),
      0,
    );
  });

  await t.test('delete cross: Del on the card', async () => {
    await geh('sammlung');
    await bis(`!!document.querySelector('#gallery .sc')`, 'Collection');
    // Only once the collection has finished loading: a later rebuild would replace the
    // focused card, and Delete would go to the body of the page.
    await ruhig();
    // An own set (not shared with the sub-account): restorable, so Del deletes at once and offers undo.
    const z =
      await b.auswerten(`(() => { const k = document.querySelector('#gallery .sc[data-arg="75192-1"]'); k.focus();
      return { taste: k.getAttribute('aria-keyshortcuts'), cross: k.querySelector('.delbtn').getAttribute('aria-hidden'),
        fokus: document.activeElement === k }; })()`);
    assert.deepEqual(z, { taste: 'Delete', cross: 'true', fokus: true });
    for (const type of ['rawKeyDown', 'keyUp'])
      await b.tab('Input.dispatchKeyEvent', { type, key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
    await bis(`!document.querySelector('#gallery .sc[data-arg="75192-1"]')`, 'deleted');
    assert.equal(await b.auswerten(open), false, 'Confirmation before something restorable');
    await b.auswerten(`[...document.querySelectorAll('#toasts .toast-action')].at(-1).click(); true`);
    await bis(`!!document.querySelector('#gallery .sc[data-arg="75192-1"]')`, 'restored');
    await ruhig();
  });

  await t.test('gift as a badge', async () => {
    const z =
      await b.auswerten(`(() => { const k = [...document.querySelectorAll('#gallery .sc')].find(x => x.textContent.includes('10300-1'));
      return { plakette: k.querySelector('.sbadges .gift-badge')?.textContent, preis: k.querySelector('.price-badge').textContent }; })()`);
    assert.equal(z.plakette, 'Geschenk');
    assert.doesNotMatch(z.preis, /Geschenk/);
  });

  await t.test('background jobs: every service with an icon', async () => {
    await b.auswerten(klick('.ntab[data-tab="monitor"]'));
    await bis(`document.querySelectorAll('.mon-services .mon-name').length >= 6`, 'Services');
    const ohne = await b.auswerten(
      `[...document.querySelectorAll('.mon-services .mon-name')].filter(n => !n.querySelector('svg.mon-icon *')).map(n => n.textContent.trim())`,
    );
    assert.deepEqual(ohne, []);
  });

  await t.test('price missing: grey if it is missing almost everywhere', async () => {
    const zeichen = async () => {
      await geh('sammlung');
      await geh('finanzen');
      await bis(`!!document.querySelector('#fin-tbl [data-fin-kind="sets"] tfoot')`, 'Finances', 300);
      return b.auswerten(
        `({ rot: document.querySelectorAll('#fin-tbl tbody .pst-err').length, grau: document.querySelectorAll('#fin-tbl [data-fin-kind="sets"] tbody .pst-empty').length })`,
      );
    };
    // Without a price in the cache and without BrickLink access the fetch fails.
    await holdsSet(db, app.uid, '60001-1', 1, { preis: 20, am: '2026-06-03T10:00:00Z' });
    assert.deepEqual(await zeichen(), { rot: 1, grau: 0 }, 'a single failure stays red');
    for (const nr of ['60002-1', '60003-1', '60004-1', '60005-1', '60006-1'])
      await holdsSet(db, app.uid, nr, 1, { preis: 20, am: '2026-06-03T10:00:00Z' });
    assert.deepEqual(await zeichen(), { rot: 0, grau: 6 }, 'if it is missing almost everywhere, it is no alarm');
    await db.run(`DELETE FROM set_acquisitions WHERE user_id = $1 AND set_number LIKE '6000_-1'`, [app.uid]);
    await db.run(`DELETE FROM sets WHERE user_id = $1 AND set_number LIKE '6000_-1'`, [app.uid]);
  });

  // ── Phone ─────────────────────────────────────────────────────────────────
  await b.tab('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

  await t.test('sub-account: purchase price label in the chart', async () => {
    const kid = (await db.get('SELECT id FROM users WHERE username = $1', [KIND])).id;
    await geh('sammlung');
    await geh('finanzen');
    await b.auswerten(
      `(() => { const s = document.getElementById('scope-finance'); s.value = '${kid}'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
    );
    await bis(
      `/Kaufpreis .*210[.,]00/.test(document.querySelector('#portfolio-chart .cost-basis-line')?.textContent || '')`,
      'Kaufpreislinie',
      200,
    );
    const funde = (await b.auswerten(LAYOUT(true))).filter(f => /Diagramm/.test(f));
    assert.deepEqual(funde, []);
    assert.doesNotMatch(
      await b.auswerten(text('#portfolio-chart .cost-basis-line')),
      /gesamt|bewertete/,
      'short on the phone',
    );
    await b.auswerten(
      `(() => { const s = document.getElementById('scope-finance'); s.value = 'all'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
    );
  });

  await t.test('floating button: icon only', async () => {
    const knopf = `(() => { const k = document.querySelector('#tab-gallery .button-floating');
      return { breit: Math.round(k.getBoundingClientRect().width), text: k.querySelector('span').checkVisibility(), name: k.getAttribute('aria-label') }; })()`;
    // Under load scroll event and recomputation come late: the wait is for
    // the state (at most 5 s), checked afterwards — a fixed pause tipped over.
    const sobald = async bedingung => {
      for (
        let i = 0;
        i < 50 && !(await b.auswerten(`(() => { const z = ${knopf}; return ${bedingung}; })()`).catch(() => false));
        i++
      )
        await warte(100);
    };
    await geh('sammlung');
    await bis(`document.querySelectorAll('#gallery .sc').length >= 4`, 'Kacheln');
    await b.auswerten(`scrollTo(0, 0); true`);
    await sobald('z.text');
    assert.equal((await b.auswerten(knopf)).text, true, 'at the top with a label');
    await b.auswerten(`scrollTo(0, 400); true`);
    await sobald('!z.text && z.breit === 56');
    assert.deepEqual(
      await b.auswerten(knopf),
      { breit: 56, text: false, name: 'Set hinzufügen' },
      'only the icon when scrolling',
    );
    await b.auswerten(`scrollTo(0, 0); document.documentElement.style.fontSize = '200%'; true`);
    await sobald('!z.text && z.breit <= 120');
    try {
      const z = await b.auswerten(knopf);
      assert.equal(z.text, false, 'only the icon at 200 %');
      assert.ok(z.breit <= 120, `schmal: ${z.breit} px`);
    } finally {
      await b.auswerten(`document.documentElement.style.fontSize = ''; true`);
    }
  });

  await t.test('confirmation page names account and address', async () => {
    const roh = `r13-${process.pid}-link`;
    await db.run(
      `UPDATE users SET new_email = $2, new_email_token = encode(sha256($3::bytea), 'hex'),
      new_email_until = NOW() + INTERVAL '1 hour' WHERE id = $1`,
      [app.uid, `neu-${process.pid}@example.org`, roh],
    );
    await b.tab('Page.navigate', { url: `http://127.0.0.1:${port}/verify?token=${roh}` });
    await bis(
      `/neu-${process.pid}@example\\.org/.test(document.getElementById('verify-target')?.textContent || '')`,
      'Target named',
    );
    assert.match(await b.auswerten(text('#verify-target')), new RegExp(`Konto „${NAME}“`));
  });
});
