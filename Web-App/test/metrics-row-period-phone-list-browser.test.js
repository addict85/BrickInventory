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

async function groesse(b, breite, hoehe, telefon) {
  await b.tab('Emulation.setDeviceMetricsOverride', {
    width: breite,
    height: hoehe,
    deviceScaleFactor: 1,
    mobile: telefon,
  });
}

test('metrics row, period as a segment, parts list and zoom on the phone', {
  concurrency: 1,
  timeout: 420_000,
}, async t => {
  const app = await startApp(t, { name: `r28_${process.pid}`, bestand: patternHousehold });
  if (app.grund) {
    t.skip(app.grund);
    return;
  }
  const { b, bis, ruhig, port } = app;
  const zu = async hash => {
    await b.auswerten(`location.hash = ${JSON.stringify(hash)}; scrollTo(0, 0); true`);
    await ruhig();
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
    await groesse(b, 390, 844, true);
    await zu('#/finanzen');
    b.listener.push(intercept);
    await b.tab('Fetch.enable', { patterns: [{ urlPattern: '*/api/v1/stats*', requestStage: 'Request' }] });
    try {
      await zu('#/sammlung');
      await bis(`document.getElementById('bstat-sets').textContent.trim() === '1'`, 'Kennzahlen aus der Antwort');
      await ruhig();
    } finally {
      await b.tab('Fetch.disable');
      b.listener.splice(b.listener.indexOf(intercept), 1);
    }
    const m = await b.auswerten(`(() => {
      const k = [...document.querySelectorAll('#tab-gallery .brick-stats .bstat')].filter(e => e.checkVisibility());
      const h = document.getElementById('bstat-hint');
      return {
        text: k.map(e => e.querySelector('.bstat-v').textContent.trim() + ' ' + e.querySelector('.bstat-l').textContent.trim()),
        punkte: k.map(e => getComputedStyle(e, '::after').content).filter(c => c.includes('·')).length,
        oben: [...new Set(k.map(e => Math.round(e.getBoundingClientRect().top)))],
        unten: Math.max(...k.map(e => e.getBoundingClientRect().bottom)),
        hinweis: h.checkVisibility() ? h.textContent.trim() : '',
        hintTop: h.getBoundingClientRect().top,
        visibleBelowRows: k.filter(e => e.querySelector('.bstat-s')?.checkVisibility()).length,
      };
    })()`);
    assert.deepEqual(m.text, ['1 Set', '0 Teile', '0 Minifiguren']);
    assert.equal(m.punkte, 2, 'Trenner zwischen drei Kennzahlen');
    assert.equal(m.oben.length, 1, `Kennzahlen auf mehreren Zeilen: ${m.oben}`);
    assert.equal(m.visibleBelowRows, 0);
    assert.equal(m.hinweis, 'Teileliste für das Set fehlt noch');
    assert.ok(m.hintTop >= m.unten, 'Erklärsatz unter der ganzen Leiste');
  });

  await t.test('N4 period as a segment: one background, the chosen button framed, aria-pressed', async () => {
    await groesse(b, 390, 844, true);
    await zu('#/finanzen');
    await bis(`!!document.querySelector('.period-choice .period-btn')?.checkVisibility()`, 'Zeitraum');
    const m = await b.auswerten(`(() => {
      const g = document.querySelector('.period-choice');
      const k = [...g.querySelectorAll('.period-btn')];
      const s = getComputedStyle(g);
      return {
        grund: s.backgroundColor, rand: s.borderTopWidth,
        oben: [...new Set(k.map(e => Math.round(e.getBoundingClientRect().top)))].length,
        runde: k.map(e => parseFloat(getComputedStyle(e).borderTopLeftRadius)),
        gedrueckt: k.map(e => e.getAttribute('aria-pressed')),
        rahmen: k.map(e => getComputedStyle(e).borderTopColor),
        flaeche: k.map(e => getComputedStyle(e).backgroundColor),
      };
    })()`);
    assert.notEqual(m.grund, 'rgba(0, 0, 0, 0)', 'Segment ohne Grund');
    assert.equal(m.rand, '1px');
    assert.equal(m.oben, 1, 'Zeitraum bricht um');
    assert.ok(Math.max(...m.runde) <= 8, `Knöpfe wie Pillen gerundet: ${m.runde}`);
    assert.deepEqual(m.gedrueckt, ['false', 'false', 'false', 'true']);
    assert.deepEqual(m.rahmen.slice(0, 3), Array(3).fill('rgba(0, 0, 0, 0)'), 'ungewählte Knöpfe gerahmt');
    assert.notEqual(m.rahmen[3], 'rgba(0, 0, 0, 0)', 'gewählter Knopf ohne Rahmen');
    assert.deepEqual(m.flaeche.slice(0, 3), Array(3).fill('rgba(0, 0, 0, 0)'), 'ungewählte Knöpfe mit Fläche');
  });

  await t.test('N8 390 px: parts selectable as a compact list', async () => {
    await groesse(b, 390, 844, true);
    await zu('#/teile');
    await bis(`!!document.querySelector('#parts-main .part-card')`, 'Teilekarten');
    const hoehe = () =>
      b.auswerten(`Math.round(document.querySelector('#parts-main .part-card').getBoundingClientRect().height)`);
    const karte = await hoehe();
    const knopf = `document.querySelector('#tab-parts [data-click="chooseView"][data-arg2="table"]')`;
    assert.equal(await b.auswerten(`!!${knopf}?.checkVisibility()`), true, 'Umschalter Karten/Liste fehlt');
    await b.auswerten(`${knopf}.click(); true`);
    await ruhig();
    await bis(`!!document.querySelector('#parts-main .part-card')`, 'Teile als Liste');
    const zeile = await hoehe();
    const breit =
      await b.auswerten(`(() => { const r = document.querySelector('#parts-main .part-card').getBoundingClientRect();
      return { breite: Math.round(r.width), seite: document.documentElement.scrollWidth > innerWidth,
        gedrueckt: ${knopf}.getAttribute('aria-pressed') }; })()`);
    assert.ok(karte > 120, `Karte nur ${karte} px hoch`);
    assert.ok(zeile <= 72, `Listenzeile ${zeile} px hoch`);
    assert.ok(breit.breite > 300, `Zeile nicht über die Breite: ${breit.breite} px`);
    assert.equal(breit.seite, false, 'Seite breiter als das Fenster');
    assert.equal(breit.gedrueckt, 'true');
    await b.auswerten(`document.querySelector('#tab-parts [data-click="chooseView"][data-arg2="grid"]').click(); true`);
    await ruhig();
  });

  await t.test('N9 200 % zoom (640 × 450): "add set" covers no card', async () => {
    await groesse(b, 640, 450, false);
    await zu('#/sammlung');
    await bis(`document.querySelectorAll('#gallery .sc').length >= 3`, 'drei Karten');
    for (const y of [0, 200, 350, 500]) {
      await b.auswerten(`scrollTo(0, ${y}); true`);
      await ruhig(300);
      const m = await b.auswerten(`(() => {
        const k = document.querySelector('#tab-gallery .button-floating').getBoundingClientRect();
        const ueber = [...document.querySelectorAll('#gallery .sc')].map(e => e.getBoundingClientRect())
          .filter(r => r.left < k.right && r.right > k.left && r.top < k.bottom && r.bottom > k.top).length;
        return { ueber, oben: Math.round(k.top), unten: Math.round(k.bottom) };
      })()`);
      assert.equal(m.ueber, 0, `bei ${y} px gerollt liegt der Knopf über einer Karte (${m.oben}–${m.unten})`);
    }
    await b.auswerten(`scrollTo(0, 0); true`);
    assert.equal(
      await b.auswerten(`document.querySelector('#tab-gallery .button-floating').checkVisibility()`),
      true,
      'Knopf oben nicht sichtbar',
    );
  });

  // Logged out from here on.
  await t.test('N5 390 px: the same gap below both field messages of the login', async () => {
    await groesse(b, 390, 844, true);
    await b.tab('Network.clearBrowserCookies');
    // The old page also has a login button: first wait until it is gone.
    await b.auswerten(`window.__alteSeite = true`);
    await b.tab('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    await bis(
      `!window.__alteSeite && document.getElementById('login-screen')?.style.display === 'flex' && typeof document.getElementById('btn-login')?.onclick === 'function'`,
      'Anmeldemaske',
    );
    await b.auswerten(`document.getElementById('lu').value = ''; document.getElementById('lp').value = '';
      document.getElementById('btn-login').click(); true`);
    await bis(`!!document.getElementById('lp-error')?.textContent`, 'Feldmeldungen');
    const m = await b.auswerten(`(() => {
      const r = id => document.getElementById(id).getBoundingClientRect();
      const naechstes = id => document.getElementById(id).closest('.fg').nextElementSibling;
      const folgt = e => { while (e && !e.checkVisibility()) e = e.nextElementSibling; return e?.getBoundingClientRect() ?? { top: NaN }; };
      return { lu: folgt(naechstes('lu-error')).top - r('lu-error').bottom, lp: folgt(naechstes('lp-error')).top - r('lp-error').bottom };
    })()`);
    assert.ok(Math.abs(m.lu - m.lp) <= 1, `Abstand unter den Meldungen ${m.lu} px gegen ${m.lp} px`);
  });

  for (const dunkel of [false, true])
    await t.test(`M3 start box ${dunkel ? 'dark' : 'light'}`, async () => {
      await b.tab('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: dunkel ? 'dark' : 'light' }],
      });
      await b.tab('Page.reload');
      await bis(`typeof document.getElementById('btn-login')?.onclick === 'function'`, 'Anmeldemaske');
      const m = await b.auswerten(`(() => { const k = document.getElementById('start-offline'); k.hidden = false;
        const s = getComputedStyle(k); const r = { grund: s.backgroundColor, schrift: s.color,
        dunkel: document.documentElement.hasAttribute('data-dark') }; k.hidden = true; return r; })()`);
      assert.equal(m.dunkel, dunkel, 'data-dark folgt dem System');
      const hell = c =>
        c
          .match(/\d+/g)
          .slice(0, 3)
          .reduce((a, x) => a + Number(x), 0) / 3;
      if (dunkel) {
        assert.ok(hell(m.grund) < 60, `Kasten im Dunkelmodus hell: ${m.grund}`);
        assert.ok(hell(m.schrift) > 180, `Schrift dunkel auf dunkel: ${m.schrift}`);
      } else assert.equal(m.grund, 'rgb(255, 255, 255)');
    });
});
