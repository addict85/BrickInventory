/**
 * Findings of UI check 14 in the real browser: registration without mail sending
 * and approval, categories, confirmation page while logged in, menus and
 * floating button with large font, household, wishlist, terms,
 * voucher card, offline banner and focus after Esc.
 *
 * Counter-checks (measured 04.11.2026, each on its own, bundle rebuilt):
 *   A  category in the SQL again COALESCE(…, 'Unbekannt') → red: „Kategorie in
 *      Tabelle und Filter“
 *   B  confirmedSignedIn() again location.replace('/') → red: „Bestätigung
 *      angemeldet“ (no toast)
 *   C  .v-more > .more-list again min-width:14rem → red: „Weitere Aktionen bei
 *      320 px und 200 %“
 *   D  container rule (max-width: 15em) for the floating button ineffective
 *      → red: „Schwebender Knopf bei 200 %“
 *   E  unlinkHousehold() without names → red: „Verknüpfung lösen nennt das Konto“
 *   F  loadWanted() does not collapse the form in the error case → red:
 *      „Merkliste: Fehler 500 über der Falz“
 *   G  approve button gone / role again „Admin“ / switch free without mail
 *      → each red: „Verwaltung: wartendes Konto, Schalter ohne Mail“
 *   H  .voucher-actions > .more-menu again flex → red: „Gutscheinkarte ruhig“
 *   I  offline banner again with a date → red: „Offline-Band: heute“
 *   K  fallback to the heading in dialoge.js gone → red: „Fokus nach Esc
 *      bei Direktaufruf“
 *   L  „Registrieren“ again <p> / confirming stays bp without a pending
 *      address → each red: „Bestätigung angemeldet“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, sleep } = require('./helpers/app-browser');
const { patternHousehold, holdsPart } = require('./helpers/inventory');
const { buildAndRequire } = require('./helpers/sources');

const klick = sel => `document.querySelector(${JSON.stringify(sel)})?.click(); true`;
const text = sel => `(document.querySelector(${JSON.stringify(sel)})?.textContent || '').replace(/\\s+/g, ' ').trim()`;
const open = `getComputedStyle(document.getElementById('confirm-modal')).display !== 'none'`;
const rect = sel => `(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect();
  return r ? { l: Math.round(r.left), r: Math.round(r.right), o: Math.round(r.top), u: Math.round(r.bottom), b: Math.round(r.width) } : null; })()`;
const cut = (a, b) => a.l < b.r && b.l < a.r && a.o < b.u && b.o < a.u;

test('registration, categories, phone, terms', { timeout: 300_000 }, async t => {
  const NAME = `r14_${process.pid}`,
    KIND = `${NAME}_kind`,
    WAITING = `${NAME}_wartet`;
  const app = await startApp(t, {
    name: NAME,
    holding: async (db, uid) => {
      await patternHousehold(db, uid);
      await db.run(
        `INSERT INTO part_catalog (part_number, part_name, category_name) VALUES ('99901', 'Rätselteil', '999') ON CONFLICT DO NOTHING`,
      );
      await holdsPart(db, uid, '99901', { setNumber: '10294-1', colorId: 0, quantity: 3 });
      await db.run(
        `INSERT INTO part_catalog (part_number, part_name, category_name) VALUES ('99902', 'Kennstein', 'Bricks') ON CONFLICT DO NOTHING`,
      );
      await holdsPart(db, uid, '99902', { setNumber: '10294-1', colorId: 0, quantity: 2 });
      await db.run(
        `INSERT INTO users (username, new_email, password_hash, is_active, email_verified, registration_pending)
      VALUES ($1, $2, 'x', true, false, true)`,
        [WAITING, `${WAITING}@example.org`],
      );
    },
  });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, until, db, port, uid, settle } = app;
  // The startup loads settings and prices afterwards; only then is the state fixed.
  await settle();
  const smtpBefore = await db.all(
    "SELECT key, value FROM global_settings WHERE key IN ('smtp_host', 'smtp_user', 'registration_enabled')",
  );
  await db.run("DELETE FROM global_settings WHERE key IN ('smtp_host', 'smtp_user', 'registration_enabled')");
  const geh = async path => {
    await b.evaluate(`location.hash = '#/${path}'; true`);
    await sleep(400);
  };
  const closed = async () => {
    await b.evaluate(klick('#cd-cancel'));
    await until(`!(${open})`, 'Dialog zu');
  };
  const phone = (width, height) =>
    b.tab('Emulation.setDeviceMetricsOverride', { width: width, height: height, deviceScaleFactor: 1, mobile: true });
  const font = percentValue => b.evaluate(`document.documentElement.style.fontSize = '${percentValue}'; true`);

  await phone(390, 844);

  await t.test('wishlist: error 500 above the fold', async () => {
    await b.evaluate(`(() => { const original = window.fetch; window.__echtFetch = original;
      window.fetch = (u, o) => String(u).includes('/api/v2/wanted?') ? Promise.resolve(new Response('{"success":false,"error":"kaputt"}', { status: 500, headers: { 'Content-Type': 'application/json' } })) : original(u, o);
      return true; })()`);
    try {
      await geh('merkliste');
      await until(`!!document.querySelector('#mk-list .error-state')`, 'Fehlerzustand');
      const z =
        await b.evaluate(`(() => { const f = document.querySelector('#mk-list .error-state').getBoundingClientRect();
        return { box: document.getElementById('mk-box').open, belowBar: f.top > document.querySelector('nav:not(.settings-nav)').getBoundingClientRect().top - 40 }; })()`);
      assert.deepEqual(z, { box: false, belowBar: false });
    } finally {
      await b.evaluate(`window.fetch = window.__echtFetch; true`);
    }
  });

  await t.test('voucher card calm', async () => {
    await geh('gutscheine');
    await until(`!!document.querySelector('.voucher-row .voucher-actions')`, 'Gutscheine');
    const z = await b.evaluate(`(() => { const w = (e) => Math.round(e.getBoundingClientRect().width);
      const button = [...document.querySelectorAll('.voucher-row .v-btn')].map(w);
      const [a, m] = [document.querySelector('.voucher-actions > .btn'), document.querySelector('.voucher-actions > .more-menu > summary')].map(e => e.getBoundingClientRect());
      const lower = ['queryAllBalances', 'exportVouchers'].map(k => w(document.querySelector('[data-click="' + k + '"]')));
      return { button: [...new Set(button)], nebeneinander: Math.round(a.top) === Math.round(m.top), same: Math.abs(a.width - m.width) < 2, lower: lower[0] === lower[1] }; })()`);
    assert.deepEqual(z, { button: [44], nebeneinander: true, same: true, lower: true });
  });

  await t.test('floating button at 200 %', async () => {
    await geh('sammlung');
    await until(`document.querySelectorAll('#gallery .sc').length >= 4`, 'Kacheln');
    await font('200%');
    try {
      await b.evaluate(`scrollTo(0, 0); true`);
      await sleep(300);
      const button = await b.evaluate(rect('#tab-gallery .button-floating'));
      for (const sel of [
        '#gs',
        '#tab-gallery .brick-stats',
        '#tab-gallery .filter-button',
        // On the phone the toggle is the visible heading (UX check 19 M4).
        '#tab-gallery .collection-choice',
      ])
        assert.equal(cut(button, await b.evaluate(rect(sel))), false, `over ${sel}`);
    } finally {
      await font('');
    }
  });

  await t.test('offline banner: today', async () => {
    await b.tab('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    try {
      await until(`!document.getElementById('offline-band').hidden`, 'Band');
      assert.match(await b.evaluate(text('#offline-band')), /seit heute, \d\d:\d\d\./);
    } finally {
      await b.tab('Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
      await b.evaluate(`dispatchEvent(new Event('online')); true`);
    }
    await until(`document.getElementById('offline-band').hidden`, 'wieder online', 100);
  });

  await phone(320, 640);
  await font('200%');

  await t.test('more actions at 320 px and 200 %', async () => {
    await geh('sammlung/set/10294-1');
    await until(
      `document.getElementById('set-modal').classList.contains('open') && !document.querySelector('#set-modal .skeleton-row')`,
      'Set-Dialog',
    );
    await b.evaluate(klick('#set-modal .v-more > summary'));
    await until(`document.querySelector('#set-modal .v-more').open`, 'Menü offen');
    const r = await b.evaluate(rect('#set-modal .v-more > .more-list'));
    assert.ok(r.l >= 0 && r.r <= 320, `menu from ${r.l} to ${r.r}`);
    await b.evaluate(`document.querySelector('#set-modal .v-more').open = false; true`);
  });

  await t.test('focus after Esc on direct call', async () => {
    for (const type of ['rawKeyDown', 'keyUp'])
      await b.tab('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await until(`!document.getElementById('set-modal').classList.contains('open')`, 'Dialog zu');
    assert.equal(
      await b.evaluate(`document.activeElement?.closest('h1')?.dataset.tabTitle ?? document.activeElement?.tagName`),
      'gallery',
    );
  });

  await font('');
  await b.tab('Emulation.clearDeviceMetricsOverride');
  await settle();

  await t.test('unlink names the account', async () => {
    await geh('haushalt');
    await until(`!!document.querySelector('[data-click="unlinkHousehold"]')`, 'Haushalt');
    await b.evaluate(klick('[data-click="unlinkHousehold"]'));
    await until(open, 'Dialog');
    assert.equal(await b.evaluate(text('#cd-title')), `Verknüpfung mit „${KIND}“ lösen?`);
    assert.match(
      await b.evaluate(text('#cd-msg')),
      new RegExp(`Sammlung von „${KIND}“ danach nicht mehr.*zwischen den Konten verschoben habt`),
    );
    await closed();
  });

  await t.test('administration: waiting account, switch without mail', async () => {
    await geh('einstellungen/benutzer');
    await until(
      `!!document.querySelector('#users-tbl tbody tr') && !document.getElementById('reg-mail-hint').hidden`,
      'Benutzerliste',
    );
    const z =
      await b.evaluate(`(() => { const line = [...document.querySelectorAll('#users-tbl tbody tr')].find(r => r.textContent.includes(${JSON.stringify(WAITING)}));
      const table = document.getElementById('users-tbl').innerText;
      return { waits: /wartet auf Bestätigung/.test(line.textContent), button: !!line.querySelector('[data-click="unlockAccount"]'),
        administrator: /Administrator/.test(table), admin: /\\bAdmin\\b/.test(table), toggle: document.getElementById('reg-enabled').disabled,
        hint: document.getElementById('reg-mail-hint').textContent }; })()`);
    assert.deepEqual(
      { ...z, hint: /E-Mail-Versand/.test(z.hint) },
      { waits: true, button: true, administrator: true, admin: false, toggle: true, hint: true },
    );
    assert.match(await b.evaluate(text('#ubadge')), new RegExp(`${NAME} \\(Administrator\\)`));
    await b.evaluate(
      `[...document.querySelectorAll('#users-tbl tbody tr')].find(r => r.textContent.includes(${JSON.stringify(WAITING)})).querySelector('[data-click="unlockAccount"]').click(); true`,
    );
    await until(open, 'Dialog');
    assert.equal(await b.evaluate(text('#cd-title')), `Konto „${WAITING}“ freischalten?`);
    await closed();
  });

  await t.test('category in table and filter', async () => {
    await geh('teile');
    await b.evaluate(klick('[data-click="chooseView"][data-arg="parts-view"][data-arg2="table"]'));
    await until(
      `[...document.querySelectorAll('#parts-main tbody.parts-body tr')].some(r => r.textContent.includes('99901'))`,
      'Teiletabelle',
    );
    const categoryList = `(() => { const cell = (nr) => [...document.querySelectorAll('#parts-main tbody.parts-body tr')].find(r => r.children[1]?.textContent.trim() === nr)?.children[4]?.textContent.trim();
      return { b99902: cell('99902'), b99901: cell('99901'), filter: [...document.querySelectorAll('#parts-cat option')].map(o => o.textContent).slice(1).sort() }; })()`;
    assert.deepEqual(await b.evaluate(categoryList), {
      b99902: 'Bricks',
      b99901: 'Unbekannt',
      filter: ['Bricks', 'Unbekannt'],
    });
    await b.evaluate(
      `(() => { const s = document.getElementById('lang-select'); s.value = 'en'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
    );
    try {
      await until(
        `[...document.querySelectorAll('#parts-cat option')].some(o => o.textContent === 'Unknown')`,
        'englisch',
        50,
      );
      assert.equal(await b.evaluate(text('#link-register')), 'Register');
    } finally {
      await b.evaluate(
        `(() => { const s = document.getElementById('lang-select'); s.value = 'de'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
      );
    }
  });

  await t.test('background jobs: instructions', async () => {
    await geh('hintergrund');
    await until(`document.querySelectorAll('.mon-services .mon-name').length >= 6`, 'Dienste');
    const names = await b.evaluate(
      `[...document.querySelectorAll('.mon-services .mon-name')].map(n => n.textContent.trim()).join(' | ')`,
    );
    assert.match(names, /Anleitungen herunterladen/);
    assert.doesNotMatch(names, /Handbücher/);
  });

  await t.test('confirmation logged in', async () => {
    const { tokenDigest } = buildAndRequire()('src/account/deviceToken.js');
    const NEW = `${NAME}-neu@example.org`,
      TOKEN = `r14-${process.pid}-${Date.now()}`;
    await db.run(
      `UPDATE users SET new_email = $2, new_email_token = $3, new_email_until = NOW() + INTERVAL '1 hour' WHERE id = $1`,
      [uid, NEW, tokenDigest(TOKEN)],
    );
    await b.tab('Page.navigate', { url: `http://127.0.0.1:${port}/verify?token=${TOKEN}` });
    await until(
      `(document.getElementById('verify-target')?.textContent || '').includes(${JSON.stringify(NEW)})`,
      'Ziel genannt',
    );
    const z =
      await b.evaluate(`({ main: document.getElementById('btn-verify').classList.contains('bp'), back: ${text('#link-verify-to-login')},
      formular: { title: ${text('#panel-register h1')}, required: ['reg-user', 'reg-email', 'reg-pass', 'reg-pass2'].every(id => document.getElementById(id).required && document.getElementById(id).getAttribute('aria-required') === 'true'),
        rule: document.getElementById(document.getElementById('reg-pass').getAttribute('aria-describedby'))?.textContent } })`);
    assert.deepEqual(z, {
      main: true,
      back: '← Zurück zur Sammlung',
      formular: {
        title: 'Registrieren',
        required: true,
        rule: 'Mindestens 12 Zeichen, kein häufig verwendetes Passwort.',
      },
    });
    await b.evaluate(klick('#btn-verify'));
    await until(`getComputedStyle(document.getElementById('app')).display !== 'none'`, 'App offen');
    await until(
      `[...document.querySelectorAll('#toasts .toast')].some(x => x.textContent.includes(${JSON.stringify(`Neue Adresse ${NEW} bestätigt.`)}))`,
      'Toast',
    );
    assert.equal((await db.get('SELECT email FROM users WHERE id = $1', [uid])).email, NEW);
    // Nothing pending: confirming is no longer the suggested step.
    await b.tab('Page.navigate', { url: `http://127.0.0.1:${port}/verify?token=veraltet` });
    await until(
      `/wartet keine neue Adresse/.test(document.getElementById('verify-target')?.textContent || '')`,
      'nichts ausstehend',
    );
    assert.deepEqual(
      await b.evaluate(`[...document.getElementById('btn-verify').classList].filter(k => k === 'bp' || k === 'bs')`),
      ['bs'],
    );
  });

  // Clean up here, not in t.after: there the pool from startApp ends first.
  for (const z of smtpBefore)
    await db.run('INSERT INTO global_settings (key, value) VALUES ($1, $2) ON CONFLICT DO NOTHING', [z.key, z.value]);
});
