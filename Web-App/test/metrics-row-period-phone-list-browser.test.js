/**
 * UX check 28 in real Chrome: metrics row on the phone (M1), start box in dark mode (M3), period
 * as a segment (N4), equal gap below the field messages of the login (N5), parts on the phone as a list
 * (N8) and the button „Set hinzufügen“ at 200 % zoom (N9).
 *
 * Counter-checks (measured 15.11.2026, each on its own, bundle rebuilt):
 *   A  .bstat-hint:not(:empty) in mobile.css set to display:none → red: “M1 …” (explanation invisible)
 *   B  the dark rule for #start-offline removed → red: “M3 …” (background rgb(255, 255, 255))
 *   C  background, border and button shape of .period-choice removed → red: “N4 …” („Segment ohne Grund“)
 *   D  .sform .fg > .field-error{contain:none} removed → red: “N5 …” (27.5 px against 8 px)
 *   E  #tab-parts .filter-bar > .vtgl hidden again → red: “N8 …” (toggle missing);
 *      the list card without display:grid → red: same place („Listenzeile 131 px hoch“)
 *   F  the rule for max-height 500px ineffective (50px) → red: “N9 …” (button over a card)
 *
 * Without Chrome (CHROME_BIN, google-chrome, chromium) it is skipped.
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

test('metrics row, period as a segment, parts list and zoom on the phone', {
  concurrency: 1,
  timeout: 420_000,
}, async t => {
  const app = await startApp(t, { name: `r28_${process.pid}`, holding: patternHousehold });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, until, settle, port } = app;
  const closed = async hash => {
    await b.evaluate(`location.hash = ${JSON.stringify(hash)}; scrollTo(0, 0); true`);
    await settle();
  };

  await t.test('M1 390 px: "1 set · 0 parts · 0 minifigures" in one line, explanation below', async () => {
    const stats = JSON.stringify({
      success: true,
      stats: {
        total_sets: 1,
        total_quantity: 1,
        total_parts: 0,
        set_parts: 0,
        manual_parts: 0,
        total_minifigs: 0,
        total_instructions: 0,
      },
    });
    const intercept = d => {
      if (d.method !== 'Fetch.requestPaused') return;
      b.tab('Fetch.fulfillRequest', {
        requestId: d.params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(stats).toString('base64'),
      }).catch(() => {});
    };
    await size(b, 390, 844, true);
    await closed('#/finanzen');
    b.listener.push(intercept);
    await b.tab('Fetch.enable', { patterns: [{ urlPattern: '*/api/v2/stats*', requestStage: 'Request' }] });
    try {
      await closed('#/sammlung');
      await until(`document.getElementById('bstat-sets').textContent.trim() === '1'`, 'Kennzahlen aus der Antwort');
      await settle();
    } finally {
      await b.tab('Fetch.disable');
      b.listener.splice(b.listener.indexOf(intercept), 1);
    }
    const m = await b.evaluate(`(() => {
      const k = [...document.querySelectorAll('#tab-gallery .brick-stats .bstat')].filter(e => e.checkVisibility());
      const h = document.getElementById('bstat-hint');
      return {
        text: k.map(e => e.querySelector('.bstat-v').textContent.trim() + ' ' + e.querySelector('.bstat-l').textContent.trim()),
        points: k.map(e => getComputedStyle(e, '::after').content).filter(c => c.includes('·')).length,
        upper: [...new Set(k.map(e => Math.round(e.getBoundingClientRect().top)))],
        lower: Math.max(...k.map(e => e.getBoundingClientRect().bottom)),
        hint: h.checkVisibility() ? h.textContent.trim() : '',
        hintTop: h.getBoundingClientRect().top,
        visibleBelowRows: k.filter(e => e.querySelector('.bstat-s')?.checkVisibility()).length,
      };
    })()`);
    assert.deepEqual(m.text, ['1 Set', '0 Teile', '0 Minifiguren']);
    assert.equal(m.points, 2, 'separator between three metrics');
    assert.equal(m.upper.length, 1, `metrics on several lines: ${m.upper}`);
    assert.equal(m.visibleBelowRows, 0);
    assert.equal(m.hint, 'Teileliste für das Set fehlt noch');
    assert.ok(m.hintTop >= m.lower, 'explanatory sentence below the whole bar');
  });

  await t.test('N4 period as a segment: one background, the chosen button framed, aria-pressed', async () => {
    await size(b, 390, 844, true);
    await closed('#/finanzen');
    await until(`!!document.querySelector('.period-choice .period-btn')?.checkVisibility()`, 'Zeitraum');
    const m = await b.evaluate(`(() => {
      const g = document.querySelector('.period-choice');
      const k = [...g.querySelectorAll('.period-btn')];
      const s = getComputedStyle(g);
      return {
        reason: s.backgroundColor, rand: s.borderTopWidth,
        upper: [...new Set(k.map(e => Math.round(e.getBoundingClientRect().top)))].length,
        round: k.map(e => parseFloat(getComputedStyle(e).borderTopLeftRadius)),
        pressed: k.map(e => e.getAttribute('aria-pressed')),
        frame: k.map(e => getComputedStyle(e).borderTopColor),
        flaeche: k.map(e => getComputedStyle(e).backgroundColor),
      };
    })()`);
    assert.notEqual(m.reason, 'rgba(0, 0, 0, 0)', 'segment without background');
    assert.equal(m.rand, '1px');
    assert.equal(m.upper, 1, 'Zeitraum bricht um');
    assert.ok(Math.max(...m.round) <= 8, `buttons rounded like pills: ${m.round}`);
    assert.deepEqual(m.pressed, ['false', 'false', 'false', 'true']);
    assert.deepEqual(m.frame.slice(0, 3), Array(3).fill('rgba(0, 0, 0, 0)'), 'unselected buttons framed');
    assert.notEqual(m.frame[3], 'rgba(0, 0, 0, 0)', 'selected button without border');
    assert.deepEqual(m.flaeche.slice(0, 3), Array(3).fill('rgba(0, 0, 0, 0)'), 'unselected buttons with a fill');
  });

  await t.test('N8 390 px: parts selectable as a compact list', async () => {
    await size(b, 390, 844, true);
    await closed('#/teile');
    await until(`!!document.querySelector('#parts-main .part-card')`, 'Teilekarten');
    const height = () =>
      b.evaluate(`Math.round(document.querySelector('#parts-main .part-card').getBoundingClientRect().height)`);
    const card = await height();
    const button = `document.querySelector('#tab-parts [data-click="chooseView"][data-arg2="table"]')`;
    assert.equal(await b.evaluate(`!!${button}?.checkVisibility()`), true, 'cards/list toggle is missing');
    await b.evaluate(`${button}.click(); true`);
    await settle();
    await until(`!!document.querySelector('#parts-main .part-card')`, 'Teile als Liste');
    const row = await height();
    const breit =
      await b.evaluate(`(() => { const r = document.querySelector('#parts-main .part-card').getBoundingClientRect();
      return { width: Math.round(r.width), page: document.documentElement.scrollWidth > innerWidth,
        pressed: ${button}.getAttribute('aria-pressed') }; })()`);
    assert.ok(card > 120, `card only ${card} px high`);
    assert.ok(row <= 72, `list row ${row} px high`);
    assert.ok(breit.width > 300, `row does not span the width: ${breit.width} px`);
    assert.equal(breit.page, false, 'page wider than the window');
    assert.equal(breit.pressed, 'true');
    await b.evaluate(`document.querySelector('#tab-parts [data-click="chooseView"][data-arg2="grid"]').click(); true`);
    await settle();
  });

  await t.test('N9 200 % zoom (640 × 450): "add set" covers no card', async () => {
    await size(b, 640, 450, false);
    await closed('#/sammlung');
    await until(`document.querySelectorAll('#gallery .sc').length >= 3`, 'drei Karten');
    for (const y of [0, 200, 350, 500]) {
      await b.evaluate(`scrollTo(0, ${y}); true`);
      await settle(300);
      const m = await b.evaluate(`(() => {
        const k = document.querySelector('#tab-gallery .button-floating').getBoundingClientRect();
        const over = [...document.querySelectorAll('#gallery .sc')].map(e => e.getBoundingClientRect())
          .filter(r => r.left < k.right && r.right > k.left && r.top < k.bottom && r.bottom > k.top).length;
        return { over, upper: Math.round(k.top), lower: Math.round(k.bottom) };
      })()`);
      assert.equal(m.over, 0, `scrolled to ${y} px the button covers a card (${m.upper}–${m.lower})`);
    }
    await b.evaluate(`scrollTo(0, 0); true`);
    assert.equal(
      await b.evaluate(`document.querySelector('#tab-gallery .button-floating').checkVisibility()`),
      true,
      'button not visible at the top',
    );
  });

  // Logged out from here on.
  await t.test('N5 390 px: the same gap below both field messages of the login', async () => {
    await size(b, 390, 844, true);
    await b.tab('Network.clearBrowserCookies');
    // The old page also has a login button: first wait until it is gone.
    await b.evaluate(`window.__alteSeite = true`);
    await b.tab('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    await until(
      `!window.__alteSeite && document.getElementById('login-screen')?.style.display === 'flex' && typeof document.getElementById('btn-login')?.onclick === 'function'`,
      'Anmeldemaske',
    );
    await b.evaluate(`document.getElementById('lu').value = ''; document.getElementById('lp').value = '';
      document.getElementById('btn-login').click(); true`);
    await until(`!!document.getElementById('lp-error')?.textContent`, 'Feldmeldungen');
    const m = await b.evaluate(`(() => {
      const r = id => document.getElementById(id).getBoundingClientRect();
      const naechstes = id => document.getElementById(id).closest('.fg').nextElementSibling;
      const folgt = e => { while (e && !e.checkVisibility()) e = e.nextElementSibling; return e?.getBoundingClientRect() ?? { top: NaN }; };
      return { lu: folgt(naechstes('lu-error')).top - r('lu-error').bottom, lp: folgt(naechstes('lp-error')).top - r('lp-error').bottom };
    })()`);
    assert.ok(Math.abs(m.lu - m.lp) <= 1, `gap below the messages ${m.lu} px versus ${m.lp} px`);
  });

  for (const dark of [false, true])
    await t.test(`M3 start box ${dark ? 'dark' : 'light'}`, async () => {
      await b.tab('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }],
      });
      await b.tab('Page.reload');
      await until(`typeof document.getElementById('btn-login')?.onclick === 'function'`, 'Anmeldemaske');
      const m = await b.evaluate(`(() => { const k = document.getElementById('start-offline'); k.hidden = false;
        const s = getComputedStyle(k); const r = { reason: s.backgroundColor, font: s.color,
        dark: document.documentElement.hasAttribute('data-dark') }; k.hidden = true; return r; })()`);
      assert.equal(m.dark, dark, 'data-dark follows the system');
      const hell = c =>
        c
          .match(/\d+/g)
          .slice(0, 3)
          .reduce((a, x) => a + Number(x), 0) / 3;
      if (dark) {
        assert.ok(hell(m.reason) < 60, `box light in dark mode: ${m.reason}`);
        assert.ok(hell(m.font) > 180, `text dark on dark: ${m.font}`);
      } else assert.equal(m.reason, 'rgb(255, 255, 255)');
    });
});
