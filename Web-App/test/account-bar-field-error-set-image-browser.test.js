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

async function groesse(b, breite, hoehe, telefon) {
  await b.tab('Emulation.setDeviceMetricsOverride', {
    width: breite,
    height: hoehe,
    deviceScaleFactor: 1,
    mobile: telefon,
  });
}
const sichtbar = sel => `[...document.querySelectorAll(${JSON.stringify(sel)})].map(e => e.checkVisibility())`;

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
  const { b, bis, ruhig } = app;
  const zu = async hash => {
    await b.auswerten(`location.hash = ${JSON.stringify(hash)}; scrollTo(0, 0); true`);
    await ruhig();
  };

  // First: only without a loaded list and curve does the error land in the chart box.
  await t.test('N3 finance error: period, chips and search gone, back after success', async () => {
    const kaputt = JSON.stringify({ success: false, error: 'interner Fehler', code: 'internal_error' });
    const intercept = d => {
      if (d.method !== 'Fetch.requestPaused') return;
      b.tab('Fetch.fulfillRequest', {
        requestId: d.params.requestId,
        responseCode: 500,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(kaputt).toString('base64'),
      }).catch(() => {});
    };
    b.listener.push(intercept);
    await b.tab('Fetch.enable', { patterns: [{ urlPattern: '*/api/v2/finance/valuation*', requestStage: 'Request' }] });
    const ELEMENTS = '.period-choice .period-btn, #fin-filter button, #fin-search';
    try {
      await groesse(b, 1280, 900, false);
      await zu('#/finanzen');
      await bis(`!!document.querySelector('#portfolio-chart .error-state')`, 'Fehlerzustand');
      const error = await b.auswerten(sichtbar(ELEMENTS));
      assert.equal(error.length, 9);
      assert.deepEqual(error, Array(9).fill(false), 'im Fehlerfall sichtbar');
    } finally {
      await b.tab('Fetch.disable');
      b.listener.splice(b.listener.indexOf(intercept), 1);
    }
    await b.auswerten(`document.querySelector('#portfolio-chart .error-state button[data-click]').click(); true`);
    await bis(`!!document.querySelector('#fin-tbl table')`, 'Tabelle nach „Erneut versuchen“');
    await ruhig();
    assert.deepEqual(await b.auswerten(sichtbar(ELEMENTS)), Array(9).fill(true), 'nach Erfolg');
  });

  for (const [breite, telefon] of [
    [390, true],
    [1280, false],
  ])
    for (const dunkel of [false, true])
      for (const [ansicht, hash, leiste] of [
        ['Konto', '#/konto', '#tab-profile .account-nav'],
        ['Hintergrundarbeiten', '#/hintergrund', '#tab-monitor .account-nav'],
        ...(telefon ? [['Einstellungen', '#/einstellungen/benutzer', '#global-settings-grid > .settings-nav']] : []),
      ])
        await t.test(`M2 ${breite} px ${dunkel ? 'dark' : 'light'}: jump bar ${ansicht} sticks`, async () => {
          await groesse(b, breite, telefon ? 844 : 900, telefon);
          await b.tab('Emulation.setEmulatedMedia', {
            features: [{ name: 'prefers-color-scheme', value: dunkel ? 'dark' : 'light' }],
          });
          await zu(hash);
          await bis(`!!document.querySelector(${JSON.stringify(leiste)})?.checkVisibility()`, `Leiste ${ansicht}`);
          await b.auswerten(`scrollTo(0, document.documentElement.scrollHeight); true`);
          await ruhig(400);
          const m = await b.auswerten(`(() => {
            const nav = document.querySelector(${JSON.stringify(leiste)});
            const r = nav.getBoundingClientRect();
            const unten = [...document.querySelectorAll('nav')].find(n => getComputedStyle(n).position === 'fixed');
            return {
              gerollt: scrollY,
              oben: Math.round(r.top), unten: Math.round(r.bottom),
              soll: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bar-top')) || 0,
              lowerBar: unten ? Math.round(unten.getBoundingClientRect().top) : innerHeight,
              grund: getComputedStyle(nav).backgroundColor,
              pageWider: document.documentElement.scrollWidth > innerWidth,
            };
          })()`);
          assert.ok(m.gerollt > 300, `Seite zu kurz zum Rollen (${m.gerollt} px)`);
          assert.ok(Math.abs(m.oben - m.soll) <= 1, `Leiste rollt weg: oben ${m.oben} px statt ${m.soll} px`);
          assert.ok(m.unten < m.lowerBar, 'Leiste über der unteren Navigation');
          assert.notEqual(m.reason, 'rgba(0, 0, 0, 0)', 'Leiste ohne eigenen Grund: Inhalt scheint durch');
          assert.equal(m.pageWider, false, 'Seite breiter als das Fenster');
          if (ansicht !== 'Hintergrundarbeiten') return;
          // A jump to the very top: the heading is in view and not below the bar.
          await b.auswerten(`document.querySelector('${leiste} a[data-arg="mon-t-quotas"]').click(); true`);
          await ruhig(400);
          const z =
            await b.auswerten(`(() => { const h = document.getElementById('mon-t-quotas').getBoundingClientRect();
            return { fokus: document.activeElement.id, oben: h.top, unten: h.bottom,
              leiste: document.querySelector(${JSON.stringify(leiste)}).getBoundingClientRect().bottom, h: innerHeight }; })()`);
          assert.equal(z.fokus, 'mon-t-quotas', 'Fokus auf der Überschrift');
          assert.ok(
            z.oben >= z.leiste - 1 && z.unten <= z.h,
            `Überschrift verdeckt oder nicht im Bild: ${JSON.stringify(z)}`,
          );
        });

  await t.test('N2 field errors in the two-column dialog below their field', async () => {
    await groesse(b, 1280, 900, false);
    await b.tab('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await zu('#/sammlung');
    await b.auswerten(`document.querySelector('[data-click="openCapture"][data-arg="set"]').click(); true`);
    await bis(`document.getElementById('add-set-modal').classList.contains('open')`, 'Dialog offen');
    await b.auswerten(`document.getElementById('add-qty').value = '0'; document.getElementById('add-price').value = 'abc';
      document.getElementById('btn-add').click(); true`);
    await bis(`!document.getElementById('add-price-error')?.hidden`, 'Feldfehler');
    const m = await b.auswerten(`['add-num', 'add-qty', 'add-price'].map(id => {
      const f = (document.getElementById(id).closest('.price-with-currency') ?? document.getElementById(id)).getBoundingClientRect();
      const e = document.getElementById(id + '-error').getBoundingClientRect();
      return { id, links: Math.round(e.left - f.left), abstand: Math.round(e.top - f.bottom), breiter: e.width > f.width + 1 };
    })`);
    for (const x of m) {
      assert.equal(x.links, 0, `${x.id}: Meldung nicht unter ihrem Feld (${x.links} px versetzt)`);
      assert.ok(x.abstand >= 0 && x.abstand < 12, `${x.id}: ${x.abstand} px unter dem Feld`);
      assert.equal(x.breiter, false, `${x.id}: Meldung breiter als ihre Spalte`);
    }
    await b.auswerten(`document.querySelector('[data-click="closeCapture"][data-arg="set"]').click(); true`);
  });

  await t.test('N4 bottom bar at low height: names up to 601 px', async () => {
    const BAR = `(() => { const tabs = [...document.querySelectorAll('nav .ntab')].filter(x => x.checkVisibility());
      return { n: tabs.length, pageWider: document.documentElement.scrollWidth > innerWidth,
        namen: tabs.map(x => { const t = x.getBoundingClientRect(), l = x.querySelector('.tab-label').getBoundingClientRect();
          return { breit: l.width > 20, innen: l.left >= t.left - 0.5 && l.right <= t.right + 0.5 }; }) }; })()`;
    await zu('#/sammlung');
    for (const [breite, hoehe, namen] of /** @type {[number, number, boolean][]} */ ([
      [640, 450, true],
      [610, 450, true],
      [600, 450, false],
      [390, 844, true],
      [320, 700, true],
    ])) {
      await groesse(b, breite, hoehe, breite < 600);
      await ruhig(300);
      const m = await b.auswerten(BAR);
      assert.equal(m.n, 5, `${breite} × ${hoehe}: Reiter`);
      assert.equal(m.pageWider, false, `${breite} × ${hoehe}: Seite breiter als das Fenster`);
      for (const x of m.namen) {
        assert.equal(x.breit, namen, `${breite} × ${hoehe}: Namen ${namen ? 'missing' : 'stehen da'}`);
        if (namen) assert.ok(x.innen, `${breite} × ${hoehe}: Name ragt aus dem Reiter`);
      }
    }
  });

  await t.test('N5 finance table: condition and account on one baseline', async () => {
    await groesse(b, 1280, 900, false);
    await zu('#/finanzen');
    await bis(`!!document.querySelector('#fin-tbl .owner-badge')`, 'Abzeichen');
    const m = await b.auswerten(`[...document.querySelectorAll('#fin-tbl td.fin-name')].flatMap(td => {
      const a = td.querySelector('.cond-new, .cond-used'), k = td.querySelector('.owner-badge');
      if (!a || !k) return [];
      const unten = x => { const r = document.createRange(); r.selectNodeContents(x); return r.getBoundingClientRect().bottom; };
      // Nur Abzeichen auf derselben Zeile; ein umbrochenes steht zu Recht tiefer.
      if (Math.abs(a.getBoundingClientRect().top - k.getBoundingClientRect().top) > 12) return [];
      return [Math.round((unten(k) - unten(a)) * 10) / 10];
    })`);
    assert.ok(m.length >= 3, `zu wenige Zeilen mit beiden Abzeichen: ${m.length}`);
    assert.deepEqual(
      m.filter(x => Math.abs(x) > 0.5),
      [],
      `Versatz der Grundlinie in px: ${m.join(', ')}`,
    );
  });

  await t.test('N7 set image: button, can be opened with the keyboard', async () => {
    await groesse(b, 1280, 900, false);
    await zu('#/sammlung');
    await b.auswerten(`document.querySelector('#gallery [data-click="openModal"][data-arg="10294-1"]').click(); true`);
    await bis(`/favicon\\.svg/.test(document.getElementById('m-img').getAttribute('src') || '')`, 'Set-Bild');
    const k = await b.auswerten(`(() => { const k = document.getElementById('m-img').parentElement; k.focus();
      return { tag: k.tagName, fokus: document.activeElement === k, name: k.getAttribute('aria-label') }; })()`);
    assert.deepEqual(k, { tag: 'BUTTON', fokus: true, name: 'Bild vergrössern' }, 'kein Knopf um das Bild');
    const enter = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 };
    await b.tab('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...enter });
    await b.tab('Input.dispatchKeyEvent', { type: 'char', text: '\r', ...enter });
    await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', ...enter });
    await bis(`/favicon\\.svg/.test(document.getElementById('lightbox-img').getAttribute('src') || '')`, 'Bildansicht');
    await b.auswerten(`document.getElementById('img-lightbox').click();
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
    await groesse(b, 390, 844, true);
    await b.tab('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await zu('#/finanzen');
    await b.auswerten(`window.__bimApplyTheme('hochglanz'); true`);
    await bis(
      `document.documentElement.dataset.theme === 'hochglanz' &&
      getComputedStyle(document.querySelector('#fin-tbl .cond-new')).fontWeight === '800'`,
      'Design hochglanz',
    );
    await ruhig();
    try {
      for (const sel of ['#fin-tbl .cond-new', '.fin-footnote']) {
        const r =
          await b.auswerten(`(() => { const e = document.querySelector('${sel}'); e.scrollIntoView({ block: 'center' });
          const r = e.getBoundingClientRect();
          return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height,
            farbe: getComputedStyle(e).color.match(/[\\d.]+/g).slice(0, 3).map(Number) }; })()`);
        const { farbe, ...excerpt } = r;
        const mit = await image(excerpt);
        await b.auswerten(
          `document.querySelector('${sel}').style.setProperty('color', 'transparent', 'important'); true`,
        );
        const ohne = await image(excerpt);
        await b.auswerten(`document.querySelector('${sel}').style.removeProperty('color'); true`);
        const values = [];
        for (let i = 0; i < ohne.length; i += 3)
          if (Math.abs(mit[i] - ohne[i]) + Math.abs(mit[i + 1] - ohne[i + 1]) + Math.abs(mit[i + 2] - ohne[i + 2]) > 60)
            values.push(kontrast(farbe, [ohne[i], ohne[i + 1], ohne[i + 2]]));
        assert.ok(values.length > 20, `${sel}: keine Schriftpixel gefunden (${values.length})`);
        const min = Math.min(...values);
        assert.ok(min >= 4.5, `${sel}: ${min.toFixed(2)}:1 unter der Schrift`);
      }
    } finally {
      await b.auswerten(`window.__bimApplyTheme('classic'); true`);
    }
  });
});
