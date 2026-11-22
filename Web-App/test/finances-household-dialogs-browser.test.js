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
const { startApp, warte } = require('./helpers/app-browser');
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
  const { b, bis, db, ruhig } = app;
  // Startup loads settings and prices afterwards; only then is the state fixed.
  await ruhig();
  const geh = async path => {
    await b.auswerten(`location.hash = '#/${path}'; true`);
    await warte(300);
  };
  const telefon = an =>
    b.tab(
      'Emulation.setDeviceMetricsOverride',
      an
        ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }
        : { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false },
    );

  await t.test('finances: one purchase per row, with account', async () => {
    await geh('finanzen');
    await bis(`!!document.querySelector('#fin-tbl [data-fin-kind="sets"] tfoot')`, 'Finanzen geladen', 200);
    const zeilen = await b.auswerten(`[...document.querySelectorAll('#fin-tbl [data-fin-kind="sets"] tbody tr')]
      .filter(r => r.textContent.includes('Tree House')).map(r => [...r.querySelectorAll('.owner-badge')].map(x => x.textContent.replace('Konto: ', '')))`);
    assert.deepEqual(
      zeilen.map(z => z.join()).sort(),
      [KIND, `${NAME} (ich)`].sort(),
      'je Kauf eine Zeile mit ihrem Konto',
    );
    assert.match(
      await b.auswerten(text('#fin-tbl .fin-legend')),
      /Kaufpreis dieser Zeile/,
      'die Legende erklärt die Prozente',
    );
  });

  await t.test('finances: sums without double counting', async () => {
    const z =
      await b.auswerten(`Promise.all([fetch('/api/v2/finance/pnl').then(r => r.json()), fetch('/api/v2/finance/valuation').then(r => r.json())])
      .then(([p, v]) => ({ kauf: p.totals.sets_purchase, markt: v.totals.avg, baum: p.sets.filter(s => s.set_number === '21318-1').map(s => s.quantity) }))`);
    // 679.99 + 650 + 0 (gift) + 199.99 + 210; market value 712.40 + 801.50 + 163.80 + 2 × 186.20.
    assert.deepEqual(z, { kauf: '1739.98', markt: '2050.10', baum: [2] });
  });

  await t.test('delete dialog names the account', async () => {
    await db.run(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified) VALUES ($1, $2, 'x', true, true)`,
      [OTHERS, `${OTHERS}@example.org`],
    );
    await geh('einstellungen/benutzer');
    await bis(
      `[...document.querySelectorAll('#users-tbl tr')].some(r => r.textContent.includes(${JSON.stringify(OTHERS)}))`,
      'Benutzerliste',
      100,
    );
    for (const [action, titel] of /** @type {[string, RegExp][]} */ ([
      ['delUser', /^Konto „r12x_\d+“ löschen\?$/],
      ['toggleAdmin', /^„r12x_\d+“ zum Administrator machen\?$/],
      ['toggleActive', /^Konto „r12x_\d+“ deaktivieren\?$/],
    ])) {
      await b.auswerten(`(() => { const z = [...document.querySelectorAll('#users-tbl tbody tr')].find(r => r.querySelector('strong')?.textContent === ${JSON.stringify(OTHERS)});
        z.querySelector('[data-click="${action}"]').click(); return true; })()`);
      await bis(`getComputedStyle(document.getElementById('confirm-modal')).display !== 'none'`, `Dialog ${action}`);
      assert.match(await b.auswerten(text('#cd-title')), titel);
      if (action === 'delUser')
        assert.match(await b.auswerten(text('#cd-confirm')), new RegExp(`${OTHERS}“ endgültig löschen`));
      await b.auswerten(klick('#cd-cancel'));
      await bis(`getComputedStyle(document.getElementById('confirm-modal')).display === 'none'`, 'Dialog zu');
    }
    await db.run('DELETE FROM users WHERE username = $1', [OTHERS]);
  });

  await t.test('logo and card names once', async () => {
    await geh('sammlung');
    await bis(`!!document.querySelector('#gallery .sc')`, 'Sammlung');
    await b.tab('Accessibility.enable');
    const { nodes } = await b.tab('Accessibility.getFullAXTree');
    const namen = nodes.filter(n => !n.ignored && n.name?.value).map(n => `${n.role?.value}: ${n.name.value}`);
    assert.deepEqual(
      namen.filter(n => /BIM|6\+/.test(n)),
      [],
      'das Logo wird nicht vorgelesen',
    );
    // Since UI review 22 only number and name; the rest is description.
    const karte = namen.find(n => n === 'button: 10294-1 Titanic');
    assert.ok(karte, 'Kachel Titanic als Knopf');
    assert.equal(karte.match(/Titanic/g).length, 1, `Name einmal: ${karte}`);
  });

  await t.test('color name in German', async () => {
    await geh('teile');
    await bis(
      `!!document.querySelector('.part-card[data-click="openSetItemDetail"][data-arg3="0"]')`,
      'Teile aus Sets',
    );
    await b.auswerten(klick('.part-card[data-click="openSetItemDetail"][data-arg3="0"]'));
    await bis(
      `document.getElementById('setitem-modal').classList.contains('open') && /·/.test(document.getElementById('setitem-sub').textContent)`,
      'Teil-Dialog',
    );
    assert.match(await b.auswerten(text('#setitem-sub')), /· Schwarz$/);
    await b.auswerten(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
  });

  await t.test('placeholder does not look like a value', async () => {
    const z = await b.auswerten(`(() => { const f = document.getElementById('alert-new-set');
      return { text: f.placeholder, stil: getComputedStyle(f, '::placeholder').fontStyle }; })()`);
    assert.deepEqual(z, { text: 'z. B. 75192-1', stil: 'italic' });
  });

  // ── Phone ─────────────────────────────────────────────────────────────────
  await telefon(true);

  await t.test('wishlist: list before the form', async () => {
    await geh('merkliste');
    await bis(`!!document.querySelector('#mk-list .mk-row')`, 'Merkliste');
    const z = await b.auswerten(`({ offen: document.getElementById('mk-box').open,
      oben: document.querySelector('#mk-list .mk-row').getBoundingClientRect().top, hoehe: innerHeight })`);
    assert.equal(z.offen, false, 'Formular am Telefon zugeklappt');
    assert.ok(z.oben < z.hoehe * 0.6, `erster Merkposten im ersten Bild: ${JSON.stringify(z)}`);
  });

  await t.test('toast does not cover the title', async () => {
    await geh('sammlung/set/99999-9');
    await bis(
      `[...document.querySelectorAll('#toasts .toast')].some(x => /nicht in deiner Sammlung/.test(x.textContent))`,
      'Toast',
    );
    await b.auswerten(`scrollTo(0, 0); true`);
    await ruhig();
    const z = await b.auswerten(`(() => { const r = e => e.getBoundingClientRect();
      const toast = r(document.querySelector('#toasts .toast')), titel = r(document.querySelector('#tab-gallery h1')), leiste = r(document.querySelector('nav.tabs, nav:not(.settings-nav)'));
      return { viaTitle: toast.top < titel.bottom && toast.bottom > titel.top, viaBar: toast.bottom <= leiste.top + 1, unten: toast.top > innerHeight / 2 }; })()`);
    assert.deepEqual(z, { viaTitle: false, viaBar: true, unten: true });
    await b.auswerten(`document.querySelectorAll('#toasts .toast').forEach(x => x.remove()); true`);
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
      await bis(`document.querySelector('.button-floating')?.disabled === true`, 'Knopf gesperrt');
      const z = await b.auswerten(`(() => { const s = getComputedStyle(document.querySelector('.button-floating'));
        return { deckend: s.opacity, grund: s.backgroundColor }; })()`);
      assert.equal(z.deckend, '1', 'der gesperrte Knopf ist deckend');
      assert.doesNotMatch(z.grund, /rgba\(.*, 0(\.\d+)?\)$/, `mit deckendem Grund: ${z.grund}`);
    } finally {
      await b.tab('Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
      await b.auswerten(`dispatchEvent(new Event('online')); true`);
    }
    await bis(`document.querySelector('.button-floating')?.disabled === false`, 'wieder frei', 100);
  });

  await t.test('user card starts with the name', async () => {
    await geh('einstellungen/benutzer');
    await bis(`!!document.querySelector('#users-tbl tbody tr')`, 'Benutzerliste');
    const z = await b.auswerten(`(() => { const zeilen = [...document.querySelectorAll('#users-tbl tbody tr')];
      return { erste: zeilen.map(r => [...r.cells].find(c => c.checkVisibility()).textContent.trim()), namen: zeilen.map(r => r.querySelector('strong').textContent),
        ids: [...document.querySelectorAll('#users-tbl .user-id')].filter(c => c.checkVisibility()).length }; })()`);
    assert.ok(z.namen.includes(NAME), 'Testdaten: das eigene Konto steht in der Liste');
    assert.deepEqual(z.erste, z.namen, 'jede Karte beginnt mit dem Namen');
    assert.equal(z.ids, 0, 'die ID steht am Telefon nicht');
  });

  await t.test('voucher: one button size', async () => {
    await b.auswerten(klick('.umenu-item[data-arg="vouchers"]'));
    await bis(`!!document.querySelector('.voucher-row')`, 'Gutscheine');
    const sizes = await b.auswerten(
      `[...document.querySelectorAll('.voucher-row :is(.v-btn, .btn)')].filter(k => k.checkVisibility()).map(k => getComputedStyle(k).fontSize)`,
    );
    assert.ok(sizes.length >= 4, `nur ${sizes.length} Knöpfe`);
    assert.equal(new Set(sizes).size, 1, `Schriftgrössen ${sizes}`);
  });

  await t.test('200 %: axis short, header gives way', async () => {
    await b.auswerten(
      `document.documentElement.style.fontSize = '200%'; document.getElementById('portfolio-chart').innerHTML = ''; true`,
    );
    try {
      await geh('sammlung');
      await geh('finanzen');
      await bis(`!!document.querySelector('#portfolio-chart svg polyline')`, 'Wertdiagramm', 200);
      assert.ok(
        await b.auswerten(
          `[...document.querySelectorAll('#portfolio-chart svg text')].some(x => /Tsd\\./.test(x.textContent))`,
        ),
        'Tausender kurz',
      );
      await b.auswerten(`scrollTo(0, 0); true`);
      await warte(200);
      await b.auswerten(`scrollTo(0, 600); true`);
      await warte(400);
      const z = await b.auswerten(
        `({ kopf: getComputedStyle(document.querySelector('header')).transform, leiste: getComputedStyle(document.querySelector('nav:not(.settings-nav)')).transform })`,
      );
      assert.notEqual(z.kopf, 'none', 'der Kopf weicht beim Rollen');
      assert.notEqual(z.leiste, 'none', 'die Leiste weicht beim Rollen');
    } finally {
      await b.auswerten(`document.documentElement.style.fontSize = ''; scrollTo(0, 0); true`);
    }
  });

  await t.test('401 without success ends the session', async () => {
    // Like an upstream proxy: 401 without a JSON field success.
    await b.auswerten(`(() => { const f = window.fetch; window.fetch = (u, o) => String(u).includes('/api/v2/wanted')
      ? Promise.resolve(new Response('{"message":"Unauthorized"}', { status: 401, headers: { 'Content-Type': 'application/json' } })) : f(u, o); return true; })()`);
    await geh('merkliste');
    await bis(
      `getComputedStyle(document.getElementById('login-screen')).display !== 'none' && !document.getElementById('login-hint').hidden`,
      'Anmeldung mit Hinweis',
    );
    assert.match(await b.auswerten(text('#login-hint')), /Sitzung abgelaufen/);
  });
});
