/**
 * UX review 27 in real Chrome: error state of the finances (N3), sticky jump bars in account,
 * settings and background jobs (M2), field errors in the two-column dialog (N2), the bottom bar at
 * 200 % zoom (N4), badges on one baseline (N5), the set image as a button via keyboard (N7) and the
 * contrast under the text in the “hochglanz” design.
 *
 * Counter-checks (measured 15.11.2026, each alone, bundle rebuilt):
 *   A  .account-nav without position:sticky → red: “M2 …” all cases with account and background jobs (“bar
 *      scrolls away”); the mobile rule of the settings back to position:static → red: “M2 390 px … settings”
 *   B  background jobs without jump bar → red: “M2 …” (no bar); without tabindex on the titles → red:
 *      same place (focus)
 *   C  errorPlace() without the branch for grid cells → red: “N2 …” (message not below its field)
 *   D  finances-error hides nothing → red: “N3 …” (period and chips visible)
 *   E  the rule for 601–640 px removed (names hidden only up to 640 px again) → red: “N4 …” (640 × 450)
 *   F  .owner-badge back to overflow:hidden → red: “N5 …” (badges offset by 4–6 px)
 *   G  set image without a button again (img with role=button, no button) → red: “N7 …” (no button around the image)
 *   H  hochglanz.css: badges again with the light of the buttons → red: “contrast …” (#fin-tbl .cond-new 3.03:1);
 *      --mut back to #5a6270 from noppe → red: same place (.fin-footnote 4.21:1)
 *
 * Skipped without Chrome (CHROME_BIN, google-chrome, chromium).
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');
const { patternHousehold } = require('./helpers/inventory');

async function size(b, width, height, phone) {
  await b.tab('Emulation.setDeviceMetricsOverride', {
    width: width,
    height: height,
    deviceScaleFactor: 1,
    mobile: phone,
  });
}
const visible = sel => `[...document.querySelectorAll(${JSON.stringify(sel)})].map(e => e.checkVisibility())`;

test('account bar, field error in the grid, bottom bar, set image', { concurrency: 1, timeout: 420_000 }, async t => {
  const app = await startApp(t, {
    name: `r27_${process.pid}`,
    holding: async (db, uid) => {
      await patternHousehold(db, uid);
      // An image delivered by the own server: only with an image is the zoom button usable.
      await db.run(`UPDATE set_catalog SET image_local = '/favicon.svg' WHERE set_number = '10294-1'`);
    },
  });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, until, settle } = app;
  const closed = async hash => {
    await b.evaluate(`location.hash = ${JSON.stringify(hash)}; scrollTo(0, 0); true`);
    await settle();
  };

  // First: only without a loaded list and curve does the error land in the chart box.
  await t.test('N3 finance error: period, chips and search gone, back after success', async () => {
    const broken = JSON.stringify({ success: false, error: 'interner Fehler', code: 'internal_error' });
    const intercept = d => {
      if (d.method !== 'Fetch.requestPaused') return;
      b.tab('Fetch.fulfillRequest', {
        requestId: d.params.requestId,
        responseCode: 500,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(broken).toString('base64'),
      }).catch(() => {});
    };
    b.listener.push(intercept);
    await b.tab('Fetch.enable', { patterns: [{ urlPattern: '*/api/v2/finance/valuation*', requestStage: 'Request' }] });
    const ELEMENTS = '.period-choice .period-btn, #fin-filter button, #fin-search';
    try {
      await size(b, 1280, 900, false);
      await closed('#/finanzen');
      await until(`!!document.querySelector('#portfolio-chart .error-state')`, 'Fehlerzustand');
      const error = await b.evaluate(visible(ELEMENTS));
      assert.equal(error.length, 9);
      assert.deepEqual(error, Array(9).fill(false), 'visible on error');
    } finally {
      await b.tab('Fetch.disable');
      b.listener.splice(b.listener.indexOf(intercept), 1);
    }
    await b.evaluate(`document.querySelector('#portfolio-chart .error-state button[data-click]').click(); true`);
    await until(`!!document.querySelector('#fin-tbl table')`, 'Table after „Erneut versuchen“');
    await settle();
    assert.deepEqual(await b.evaluate(visible(ELEMENTS)), Array(9).fill(true), 'after success');
  });

  for (const [width, phone] of [
    [390, true],
    [1280, false],
  ])
    for (const dark of [false, true])
      for (const [viewName, hash, bar] of [
        ['Konto', '#/konto', '#tab-profile .account-nav'],
        ['Hintergrundarbeiten', '#/hintergrund', '#tab-monitor .account-nav'],
        ...(phone ? [['Einstellungen', '#/einstellungen/benutzer', '#global-settings-grid > .settings-nav']] : []),
      ])
        await t.test(`M2 ${width} px ${dark ? 'dark' : 'light'}: jump bar ${viewName} sticks`, async () => {
          await size(b, width, phone ? 844 : 900, phone);
          await b.tab('Emulation.setEmulatedMedia', {
            features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }],
          });
          await closed(hash);
          await until(`!!document.querySelector(${JSON.stringify(bar)})?.checkVisibility()`, `Bar ${viewName}`);
          await b.evaluate(`scrollTo(0, document.documentElement.scrollHeight); true`);
          await settle(400);
          const m = await b.evaluate(`(() => {
            const nav = document.querySelector(${JSON.stringify(bar)});
            const r = nav.getBoundingClientRect();
            const lower = [...document.querySelectorAll('nav')].find(n => getComputedStyle(n).position === 'fixed');
            return {
              scrolled: scrollY,
              upper: Math.round(r.top), lower: Math.round(r.bottom),
              want: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bar-top')) || 0,
              lowerBar: lower ? Math.round(lower.getBoundingClientRect().top) : innerHeight,
              reason: getComputedStyle(nav).backgroundColor,
              pageWider: document.documentElement.scrollWidth > innerWidth,
            };
          })()`);
          assert.ok(m.scrolled > 300, `Page too short to scroll (${m.scrolled} px)`);
          assert.ok(Math.abs(m.upper - m.want) <= 1, `Bar scrolls away: top ${m.upper} px instead of ${m.want} px`);
          assert.ok(m.lower < m.lowerBar, 'Bar above the bottom navigation');
          assert.notEqual(m.reason, 'rgba(0, 0, 0, 0)', 'Bar without its own background: content shows through');
          assert.equal(m.pageWider, false, 'Page wider than the window');
          if (viewName !== 'Hintergrundarbeiten') return;
          // A jump to the very top: the heading is in view and not below the bar.
          await b.evaluate(`document.querySelector('${bar} a[data-arg="mon-t-quotas"]').click(); true`);
          await settle(400);
          const z =
            await b.evaluate(`(() => { const h = document.getElementById('mon-t-quotas').getBoundingClientRect();
            return { focused: document.activeElement.id, upper: h.top, lower: h.bottom,
              bar: document.querySelector(${JSON.stringify(bar)}).getBoundingClientRect().bottom, h: innerHeight }; })()`);
          assert.equal(z.focused, 'mon-t-quotas', 'Focus on the heading');
          assert.ok(z.upper >= z.bar - 1 && z.lower <= z.h, `Heading covered or not in view: ${JSON.stringify(z)}`);
        });

  await t.test('N2 field errors in the two-column dialog below their field', async () => {
    await size(b, 1280, 900, false);
    await b.tab('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await closed('#/sammlung');
    await b.evaluate(`document.querySelector('[data-click="openCapture"][data-arg="set"]').click(); true`);
    await until(`document.getElementById('add-set-modal').classList.contains('open')`, 'Dialog open');
    await b.evaluate(`document.getElementById('add-qty').value = '0'; document.getElementById('add-price').value = 'abc';
      document.getElementById('btn-add').click(); true`);
    await until(`!document.getElementById('add-price-error')?.hidden`, 'Feldfehler');
    const m = await b.evaluate(`['add-num', 'add-qty', 'add-price'].map(id => {
      const f = (document.getElementById(id).closest('.price-with-currency') ?? document.getElementById(id)).getBoundingClientRect();
      const e = document.getElementById(id + '-error').getBoundingClientRect();
      return { id, links: Math.round(e.left - f.left), abstand: Math.round(e.top - f.bottom), breiter: e.width > f.width + 1 };
    })`);
    for (const x of m) {
      assert.equal(x.links, 0, `${x.id}: message not below its field (${x.links} px offset)`);
      assert.ok(x.abstand >= 0 && x.abstand < 12, `${x.id}: ${x.abstand} px below the field`);
      assert.equal(x.breiter, false, `${x.id}: message wider than its column`);
    }
    await b.evaluate(`document.querySelector('[data-click="closeCapture"][data-arg="set"]').click(); true`);
  });

  await t.test('N4 bottom bar at low height: names up to 601 px', async () => {
    const BAR = `(() => { const tabs = [...document.querySelectorAll('nav .ntab')].filter(x => x.checkVisibility());
      return { n: tabs.length, pageWider: document.documentElement.scrollWidth > innerWidth,
        names: tabs.map(x => { const t = x.getBoundingClientRect(), l = x.querySelector('.tab-label').getBoundingClientRect();
          return { breit: l.width > 20, inner: l.left >= t.left - 0.5 && l.right <= t.right + 0.5 }; }) }; })()`;
    await closed('#/sammlung');
    for (const [width, height, names] of /** @type {[number, number, boolean][]} */ ([
      [640, 450, true],
      [610, 450, true],
      [600, 450, false],
      [390, 844, true],
      [320, 700, true],
    ])) {
      await size(b, width, height, width < 600);
      await settle(300);
      const m = await b.evaluate(BAR);
      assert.equal(m.n, 5, `${width} × ${height}: Reiter`);
      assert.equal(m.pageWider, false, `${width} × ${height}: page wider than the window`);
      for (const x of m.names) {
        assert.equal(x.breit, names, `${width} × ${height}: names ${names ? 'missing' : 'present'}`);
        if (names) assert.ok(x.inner, `${width} × ${height}: name sticks out of the tab`);
      }
    }
  });

  await t.test('N5 finance table: condition and account on one baseline', async () => {
    await size(b, 1280, 900, false);
    await closed('#/finanzen');
    await until(`!!document.querySelector('#fin-tbl .owner-badge')`, 'Abzeichen');
    const m = await b.evaluate(`[...document.querySelectorAll('#fin-tbl td.fin-name')].flatMap(td => {
      const a = td.querySelector('.cond-new, .cond-used'), k = td.querySelector('.owner-badge');
      if (!a || !k) return [];
      const lower = x => { const r = document.createRange(); r.selectNodeContents(x); return r.getBoundingClientRect().bottom; };
      // Nur Abzeichen auf derselben Zeile; ein umbrochenes steht zu Recht tiefer.
      if (Math.abs(a.getBoundingClientRect().top - k.getBoundingClientRect().top) > 12) return [];
      return [Math.round((lower(k) - lower(a)) * 10) / 10];
    })`);
    assert.ok(m.length >= 3, `too few rows with both badges: ${m.length}`);
    assert.deepEqual(
      m.filter(x => Math.abs(x) > 0.5),
      [],
      `Baseline offset in px: ${m.join(', ')}`,
    );
  });

  await t.test('N7 set image: button, can be opened with the keyboard', async () => {
    await size(b, 1280, 900, false);
    await closed('#/sammlung');
    await b.evaluate(`document.querySelector('#gallery [data-click="openModal"][data-arg="10294-1"]').click(); true`);
    await until(`/favicon\\.svg/.test(document.getElementById('m-img').getAttribute('src') || '')`, 'Set-Bild');
    const k = await b.evaluate(`(() => { const k = document.getElementById('m-img').parentElement; k.focus();
      return { tag: k.tagName, focused: document.activeElement === k, name: k.getAttribute('aria-label') }; })()`);
    assert.deepEqual(k, { tag: 'BUTTON', focused: true, name: 'Bild vergrössern' }, 'no button around the image');
    const enter = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 };
    await b.tab('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...enter });
    await b.tab('Input.dispatchKeyEvent', { type: 'char', text: '\r', ...enter });
    await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', ...enter });
    await until(
      `/favicon\\.svg/.test(document.getElementById('lightbox-img').getAttribute('src') || '')`,
      'Bildansicht',
    );
    await b.evaluate(`document.getElementById('img-lightbox').click();
      document.querySelector('#set-modal [data-click="closeModal"]').click(); true`);
  });

  // The background is measured exactly under the text pixels: image with and without text, where they differ.
  // The computed background color does not know the gradient above it.
  await t.test('contrast "hochglanz" light (390 px): badge and quiet text on their gradient', async () => {
    const sharp = require('sharp');
    const image = async r =>
      (
        await sharp(
          Buffer.from(
            (
              await b.tab('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1 } })
            ).data,
            'base64',
          ),
        )
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true })
      ).data;
    const lum = f => {
      const k = c => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
      return 0.2126 * k(f[0]) + 0.7152 * k(f[1]) + 0.0722 * k(f[2]);
    };
    const kontrast = (a, z) => {
      const [h, d] = [lum(a), lum(z)].sort((x, y) => y - x);
      return (h + 0.05) / (d + 0.05);
    };
    // On the phone the footnote sits in the darker foot of the card gradient.
    await size(b, 390, 844, true);
    await b.tab('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await closed('#/finanzen');
    await b.evaluate(`window.__bimApplyTheme('hochglanz'); true`);
    await until(
      `document.documentElement.dataset.theme === 'hochglanz' &&
      getComputedStyle(document.querySelector('#fin-tbl .cond-new')).fontWeight === '800'`,
      'Design „hochglanz“',
    );
    await settle();
    try {
      for (const sel of ['#fin-tbl .cond-new', '.fin-footnote']) {
        const r =
          await b.evaluate(`(() => { const e = document.querySelector('${sel}'); e.scrollIntoView({ block: 'center' });
          const r = e.getBoundingClientRect();
          return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height,
            farbe: getComputedStyle(e).color.match(/[\\d.]+/g).slice(0, 3).map(Number) }; })()`);
        const { farbe: color, ...excerpt } = r;
        const withIt = await image(excerpt);
        await b.evaluate(
          `document.querySelector('${sel}').style.setProperty('color', 'transparent', 'important'); true`,
        );
        const without = await image(excerpt);
        await b.evaluate(`document.querySelector('${sel}').style.removeProperty('color'); true`);
        const values = [];
        for (let i = 0; i < without.length; i += 3)
          if (
            Math.abs(withIt[i] - without[i]) +
              Math.abs(withIt[i + 1] - without[i + 1]) +
              Math.abs(withIt[i + 2] - without[i + 2]) >
            60
          )
            values.push(kontrast(color, [without[i], without[i + 1], without[i + 2]]));
        assert.ok(values.length > 20, `${sel}: no text pixels found (${values.length})`);
        const min = Math.min(...values);
        assert.ok(min >= 4.5, `${sel}: ${min.toFixed(2)}:1 below the text`);
      }
    } finally {
      await b.evaluate(`window.__bimApplyTheme('classic'); true`);
    }
  });
});
