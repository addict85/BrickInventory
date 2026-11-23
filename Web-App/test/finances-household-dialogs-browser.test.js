/**
 * Findings of UI review 12 in the real browser, with a household (sub-account
 * with the same set): finances name the account per row and count nothing
 * twice, dialogs against a foreign account name it, screen readers do not hear logo and
 * card names twice, and on the phone neither toasts cover the title
 * nor the disabled button the content.
 *
 * Counter-checks (measured 04.11.2026, each alone, bundle or dist rebuilt):
 *   A  valueSets collects the purchases only by set number again →
 *      red: “finances: one purchase per row, with account” (4 rows Tree House)
 *   B  setsWithEntries without GROUP BY → red: “finances: sums without
 *      double counting” (purchase prices 2149.97 instead of 1739.98)
 *   C  delUser again with tRaw('users.delete.title') and the button
 *      confirm.btn.account_delete → red: “delete dialog names the account”
 *   D  aria-hidden removed from the header logo → red: “logo and card names
 *      once” (img “BIM 6+”)
 *   E  placeholder of the tile again role="img" aria-label=set name → red:
 *      “logo and card names once” (Titanic twice in the name)
 *   F  openSetItemDetail again without colorName → red: “color name German”
 *   G  the rule :root .btn.knopf-schwebend:disabled removed → red:
 *      “offline: button opaque” (opacity 0.5)
 *   H  #toasts at the top on the phone again → red: “toast does not cover the title”
 *   I  in api() the early report on 401 removed → red: “401 without success”
 *   K  .user-tbl rules removed in mobile.css → red: “user card starts
 *      with the name”
 *   L  axesAmount without the short form → red: “200 %: axis short, header gives way”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, sleep } = require('./helpers/app-browser');
const { patternHousehold } = require('./helpers/inventory');

const klick = sel => `document.querySelector(${JSON.stringify(sel)})?.click(); true`;
const text = sel => `(document.querySelector(${JSON.stringify(sel)})?.textContent || '').replace(/\\s+/g, ' ').trim()`;

test('finances in the household, delete dialogs, phone', { timeout: 280_000 }, async t => {
  const NAME = `r12_${process.pid}`,
    KIND = `${NAME}_kind`,
    OTHERS = `r12x_${process.pid}`;
  const app = await startApp(t, { name: NAME, holding: patternHousehold });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, until, db, settle } = app;
  // Startup loads settings and prices afterwards; only then is the state fixed.
  await settle();
  const geh = async path => {
    await b.evaluate(`location.hash = '#/${path}'; true`);
    await sleep(300);
  };
  const phone = an =>
    b.tab(
      'Emulation.setDeviceMetricsOverride',
      an
        ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }
        : { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false },
    );

  await t.test('finances: one purchase per row, with account', async () => {
    await geh('finanzen');
    await until(`!!document.querySelector('#fin-tbl [data-fin-kind="sets"] tfoot')`, 'Finances loaded', 200);
    const lines = await b.evaluate(`[...document.querySelectorAll('#fin-tbl [data-fin-kind="sets"] tbody tr')]
      .filter(r => r.textContent.includes('Tree House')).map(r => [...r.querySelectorAll('.owner-badge')].map(x => x.textContent.replace('Konto: ', '')))`);
    assert.deepEqual(
      lines.map(z => z.join()).sort(),
      [KIND, `${NAME} (ich)`].sort(),
      'one row per purchase with its account',
    );
    assert.match(
      await b.evaluate(text('#fin-tbl .fin-legend')),
      /Kaufpreis dieser Zeile/,
      'the legend explains the percentages',
    );
  });

  await t.test('finances: sums without double counting', async () => {
    const z =
      await b.evaluate(`Promise.all([fetch('/api/v2/finance/pnl').then(r => r.json()), fetch('/api/v2/finance/valuation').then(r => r.json())])
      .then(([p, v]) => ({ purchase: p.totals.sets_purchase, market: v.totals.avg, tree: p.sets.filter(s => s.set_number === '21318-1').map(s => s.quantity) }))`);
    // 679.99 + 650 + 0 (gift) + 199.99 + 210; market value 712.40 + 801.50 + 163.80 + 2 × 186.20.
    assert.deepEqual(z, { purchase: '1739.98', market: '2050.10', tree: [2] });
  });

  await t.test('delete dialog names the account', async () => {
    await db.run(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified) VALUES ($1, $2, 'x', true, true)`,
      [OTHERS, `${OTHERS}@example.org`],
    );
    await geh('einstellungen/benutzer');
    await until(
      `[...document.querySelectorAll('#users-tbl tr')].some(r => r.textContent.includes(${JSON.stringify(OTHERS)}))`,
      'Benutzerliste',
      100,
    );
    for (const [action, title] of /** @type {[string, RegExp][]} */ ([
      ['delUser', /^Konto „r12x_\d+“ löschen\?$/],
      ['toggleAdmin', /^„r12x_\d+“ zum Administrator machen\?$/],
      ['toggleActive', /^Konto „r12x_\d+“ deaktivieren\?$/],
    ])) {
      await b.evaluate(`(() => { const z = [...document.querySelectorAll('#users-tbl tbody tr')].find(r => r.querySelector('strong')?.textContent === ${JSON.stringify(OTHERS)});
        z.querySelector('[data-click="${action}"]').click(); return true; })()`);
      await until(`getComputedStyle(document.getElementById('confirm-modal')).display !== 'none'`, `Dialog ${action}`);
      assert.match(await b.evaluate(text('#cd-title')), title);
      if (action === 'delUser')
        assert.match(await b.evaluate(text('#cd-confirm')), new RegExp(`${OTHERS}“ endgültig löschen`));
      await b.evaluate(klick('#cd-cancel'));
      await until(`getComputedStyle(document.getElementById('confirm-modal')).display === 'none'`, 'Dialog zu');
    }
    await db.run('DELETE FROM users WHERE username = $1', [OTHERS]);
  });

  await t.test('logo and card names once', async () => {
    await geh('sammlung');
    await until(`!!document.querySelector('#gallery .sc')`, 'Collection');
    await b.tab('Accessibility.enable');
    const { nodes } = await b.tab('Accessibility.getFullAXTree');
    const names = nodes.filter(n => !n.ignored && n.name?.value).map(n => `${n.role?.value}: ${n.name.value}`);
    assert.deepEqual(
      names.filter(n => /BIM|6\+/.test(n)),
      [],
      'the logo is not read aloud',
    );
    // Since UI review 22 only number and name; the rest is description.
    const card = names.find(n => n === 'button: 10294-1 Titanic');
    assert.ok(card, 'Tile Titanic as a button');
    assert.equal(card.match(/Titanic/g).length, 1, `Name once: ${card}`);
  });

  await t.test('color name in German', async () => {
    await geh('teile');
    await until(
      `!!document.querySelector('.part-card[data-click="openSetItemDetail"][data-arg3="0"]')`,
      'Parts from sets',
    );
    await b.evaluate(klick('.part-card[data-click="openSetItemDetail"][data-arg3="0"]'));
    await until(
      `document.getElementById('setitem-modal').classList.contains('open') && /·/.test(document.getElementById('setitem-sub').textContent)`,
      'Teil-Dialog',
    );
    assert.match(await b.evaluate(text('#setitem-sub')), /· Schwarz$/);
    await b.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
  });

  await t.test('placeholder does not look like a value', async () => {
    const z = await b.evaluate(`(() => { const f = document.getElementById('alert-new-set');
      return { text: f.placeholder, style: getComputedStyle(f, '::placeholder').fontStyle }; })()`);
    assert.deepEqual(z, { text: 'z. B. 75192-1', style: 'italic' });
  });

  // ── Phone ─────────────────────────────────────────────────────────────────
  await phone(true);

  await t.test('wishlist: list before the form', async () => {
    await geh('merkliste');
    await until(`!!document.querySelector('#mk-list .mk-row')`, 'Wishlist');
    const z = await b.evaluate(`({ isOpen: document.getElementById('mk-box').open,
      upper: document.querySelector('#mk-list .mk-row').getBoundingClientRect().top, height: innerHeight })`);
    assert.equal(z.isOpen, false, 'Form collapsed on the phone');
    assert.ok(z.upper < z.height * 0.6, `first watch item in the first view: ${JSON.stringify(z)}`);
  });

  await t.test('toast does not cover the title', async () => {
    await geh('sammlung/set/99999-9');
    await until(
      `[...document.querySelectorAll('#toasts .toast')].some(x => /nicht in deiner Sammlung/.test(x.textContent))`,
      'Toast',
    );
    await b.evaluate(`scrollTo(0, 0); true`);
    await settle();
    const z = await b.evaluate(`(() => { const r = e => e.getBoundingClientRect();
      const toast = r(document.querySelector('#toasts .toast')), title = r(document.querySelector('#tab-gallery h1')), bar = r(document.querySelector('nav.tabs, nav:not(.settings-nav)'));
      return { viaTitle: toast.top < title.bottom && toast.bottom > title.top, viaBar: toast.bottom <= bar.top + 1, lower: toast.top > innerHeight / 2 }; })()`);
    assert.deepEqual(z, { viaTitle: false, viaBar: true, lower: true });
    await b.evaluate(`document.querySelectorAll('#toasts .toast').forEach(x => x.remove()); true`);
  });

  await t.test('offline: button opaque', async () => {
    await geh('sammlung');
    await b.tab('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    try {
      await until(`document.querySelector('.button-floating')?.disabled === true`, 'Button disabled');
      const z = await b.evaluate(`(() => { const s = getComputedStyle(document.querySelector('.button-floating'));
        return { deckend: s.opacity, reason: s.backgroundColor }; })()`);
      assert.equal(z.deckend, '1', 'the disabled button is opaque');
      assert.doesNotMatch(z.reason, /rgba\(.*, 0(\.\d+)?\)$/, `with an opaque background: ${z.reason}`);
    } finally {
      await b.tab('Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
      await b.evaluate(`dispatchEvent(new Event('online')); true`);
    }
    await until(`document.querySelector('.button-floating')?.disabled === false`, 'free again', 100);
  });

  await t.test('user card starts with the name', async () => {
    await geh('einstellungen/benutzer');
    await until(`!!document.querySelector('#users-tbl tbody tr')`, 'Benutzerliste');
    const z = await b.evaluate(`(() => { const lines = [...document.querySelectorAll('#users-tbl tbody tr')];
      return { first: lines.map(r => [...r.cells].find(c => c.checkVisibility()).textContent.trim()), names: lines.map(r => r.querySelector('strong').textContent),
        ids: [...document.querySelectorAll('#users-tbl .user-id')].filter(c => c.checkVisibility()).length }; })()`);
    assert.ok(z.names.includes(NAME), 'Test data: the own account is in the list');
    assert.deepEqual(z.first, z.names, 'every card starts with the name');
    assert.equal(z.ids, 0, 'the ID is not shown on the phone');
  });

  await t.test('voucher: one button size', async () => {
    await b.evaluate(klick('.umenu-item[data-arg="vouchers"]'));
    await until(`!!document.querySelector('.voucher-row')`, 'Vouchers');
    const sizes = await b.evaluate(
      `[...document.querySelectorAll('.voucher-row :is(.v-btn, .btn)')].filter(k => k.checkVisibility()).map(k => getComputedStyle(k).fontSize)`,
    );
    assert.ok(sizes.length >= 4, `only ${sizes.length} buttons`);
    assert.equal(new Set(sizes).size, 1, `Font sizes ${sizes}`);
  });

  await t.test('200 %: axis short, header gives way', async () => {
    await b.evaluate(
      `document.documentElement.style.fontSize = '200%'; document.getElementById('portfolio-chart').innerHTML = ''; true`,
    );
    try {
      await geh('sammlung');
      await geh('finanzen');
      await until(`!!document.querySelector('#portfolio-chart svg polyline')`, 'Wertdiagramm', 200);
      assert.ok(
        await b.evaluate(
          `[...document.querySelectorAll('#portfolio-chart svg text')].some(x => /Tsd\\./.test(x.textContent))`,
        ),
        'Thousands short',
      );
      await b.evaluate(`scrollTo(0, 0); true`);
      await sleep(200);
      await b.evaluate(`scrollTo(0, 600); true`);
      await sleep(400);
      const z = await b.evaluate(
        `({ head: getComputedStyle(document.querySelector('header')).transform, bar: getComputedStyle(document.querySelector('nav:not(.settings-nav)')).transform })`,
      );
      assert.notEqual(z.head, 'none', 'the header moves away when scrolling');
      assert.notEqual(z.bar, 'none', 'the bar moves away when scrolling');
    } finally {
      await b.evaluate(`document.documentElement.style.fontSize = ''; scrollTo(0, 0); true`);
    }
  });

  await t.test('401 without success ends the session', async () => {
    // Like an upstream proxy: 401 without a JSON field success.
    await b.evaluate(`(() => { const f = window.fetch; window.fetch = (u, o) => String(u).includes('/api/v2/wanted')
      ? Promise.resolve(new Response('{"message":"Unauthorized"}', { status: 401, headers: { 'Content-Type': 'application/json' } })) : f(u, o); return true; })()`);
    await geh('merkliste');
    await until(
      `getComputedStyle(document.getElementById('login-screen')).display !== 'none' && !document.getElementById('login-hint').hidden`,
      'Sign-in with a hint',
    );
    assert.match(await b.evaluate(text('#login-hint')), /Sitzung abgelaufen/);
  });
});
