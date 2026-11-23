/**
 * The app on the phone (390 × 844, mobile) — measured in Chrome on the real
 * server with the real stylesheets.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  chartWidth() always delivers 700 → red: “chart font
 *      finances” (5.6 px) and the set view (6.2 px)
 *   B  (29.10.) brand in the header bar again <h1> → red: “skip link and exactly one
 *      h1 per tab” (two h1 per tab)
 *   C  (29.10.) skip link removed from index.html → red: the same check (first
 *      tab stop was .ubadge-button)
 *   D  (29.10.) --fs-0 again .6875rem → red: “tap targets and font per
 *      tab” (span.tab-label 11 px); .delbtn again 36 px → red (36×36)
 *   E  (02.11.) the class group-active no longer set in markGroup
 *      → red: “parts and minifigures findable in the bar” (aria-current);
 *      (29.10.) `.ntab.ntab-collection{display:none}` removed from styles.css
 *      → red: on the computer two navigations again (parts: true)
 *   F  (29.10.; 30.10. with color heading across the full width) .parts-list
 *      without display:grid → red: “parts: one grid, filters as a sheet” (breit:
 *      12); class filterleiste on the
 *      parts filter row removed → red („Die Auswahlfelder stehen offen da“)
 *   G  (29.10.) .wanted-capture > .btn{height:38px…} removed → red:
 *      “wishlist: capture row aligned” (button 34 px, CSV 39 px, offset)
 *   H  (29.10.) <details class="more-menu"> around #btn-md removed → red:
 *      “set view: chart, delete, price alert” („Löschen steht offen im
 *      Fuss“); the three .alert-row rules removed from mobile.css → red
 *      (fields next to the label)
 *   J  (08.11.) in mobile.css `.alert-row .alert-price` again flex 1 1 100% and `.alert-currency`
 *      without a rule → red: “set view: chart, delete, price alert” (currencyBeside: false)
 *   I  (29.10.) in loadPartsData again loadDisplay() → red: “skeleton while
 *      loading the parts”; the prefers-reduced-motion rule removed → red:
 *      „weniger Bewegung“ (dialog 0.2 s); the animation on .tab.active
 *      removed → red (without the setting no transitions)
 *   J  (29.10.) the rule `.ssec:not(.settings-active){display:none…}` removed
 *      → red: “settings: one section per subpage” (seven visible);
 *      the phone rule of the bar removed → red (bar in several rows)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, sleep } = require('./helpers/app-browser');
const { holdsSet } = require('./helpers/inventory');

/** Smallest font in px across all labels of the charts below `root`. */
const DIAGRAMMSCHRIFT = root => `(() => {
  const svgs = [...document.querySelectorAll(${JSON.stringify(root)} + ' svg.chart')];
  return svgs.map(svg => {
    const massstab = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    const sizes = [...svg.querySelectorAll('text')].map(x => parseFloat(getComputedStyle(x).fontSize) * massstab);
    return { role: svg.getAttribute('role'), name: svg.getAttribute('aria-label') || '',
             kleinste: Math.min(...sizes), count: sizes.length };
  });
})()`;

/** Visible controls below 44 × 44 px and text below 12 px. */
const SMALL = `(() => {
  const visible = e => { const q = e.getBoundingClientRect(); return q.width > 0 && q.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const small = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, [role=button], label.btn')]
    // Ein verstecktes Dateifeld wird über sein Knopf-Label getippt; gemessen wird das Label.
    .filter(visible).filter(e => !e.closest('.vh') && !e.matches('.file-hidden'))
    .map(e => { const q = e.getBoundingClientRect(); return [e, Math.round(q.width), Math.round(q.height)]; })
    .filter(([, w, h]) => w < 44 || h < 44)
    .map(([e, w, h]) => e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).trim().replace(/\\s+/g, '.') : '') + ' ' + w + '×' + h);
  const font = [...document.querySelectorAll('body *')]
    .filter(e => !e.closest('svg') && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
    .filter(visible)
    .map(e => [e, parseFloat(getComputedStyle(e).fontSize)]).filter(([, px]) => px < 12)
    .map(([e, px]) => e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).trim().replace(/\\s+/g, '.') : '') + ' ' + px + ' px');
  return { small, font };
})()`;

test('phone', { concurrency: 1, timeout: 240_000 }, async t => {
  const app = await startApp(t, {
    name: `telefon_${process.pid}`,
    phone: true,
    // Twelve parts in twelve colors — the case that used to produce twelve almost empty rows.
    // The parts come 1.5 s later so that the skeleton is visible before.
    intercept: [
      {
        pattern: '*/api/v2/parts?*',
        contains: '/api/v2/parts?',
        delay: 1500,
        response: {
          success: true,
          total: 12,
          parts: [
            'Red',
            'Blue',
            'Yellow',
            'Green',
            'Black',
            'White',
            'Orange',
            'Tan',
            'Lime',
            'Pink',
            'Brown',
            'Purple',
          ].map((color, i) => ({
            part_number: `300${i}`,
            part_name: `Stein ${i}`,
            color_name: color,
            color_hex: '777777',
            color_id: i + 1,
            total_quantity: 2,
          })),
        },
      },
    ],
    holding: async (db, uid) => {
      await holdsSet(db, uid, '10300-1', 1, { price: 199 });
      await db.run(`DELETE FROM price_history WHERE set_number = '10300-1'`);
      for (const [days, price] of [
        [90, 210],
        [60, 230],
        [30, 250],
        [1, 260],
      ])
        await db.run(
          `INSERT INTO price_history (set_number, condition, currency_code, avg_price, qty_avg_price, recorded_at)
                      VALUES ('10300-1', 'N', 'EUR', $1, $1, NOW() - ($2 || ' days')::interval)`,
          [price, String(days)],
        );
    },
  });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, until, settle } = app;
  // What is measured is the final state: a dialog that is just opening (say the
  // setup after the login) stands at scale(.985) in the first frame.
  const rest = () =>
    b.evaluate(`Promise.all(document.getAnimations()
    .filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
    .map(a => a.finished.catch(() => {}))).then(() => true)`);
  const switchTab = async name => {
    await b.evaluate(`document.querySelector('.ntab[data-tab="${name}"]').click(); true`);
    await sleep(400);
    await rest();
  };

  await t.test('skeleton while loading the parts', async () => {
    await b.evaluate(`document.querySelector('.ntab[data-tab="parts"]').click(); true`);
    // The skeleton comes after metrics and filters; the parts themselves are delayed by 1.5 s.
    await until(`!!document.querySelector('#parts-main .skeleton-grid')`, 'Skelett der Teile', 30);
    const s = await b.evaluate(`(() => { const r = document.querySelector('#parts-main .skeleton-grid');
      return r && { kacheln: r.querySelectorAll('.part-card.skeleton').length, role: r.getAttribute('role'), text: r.textContent.trim() }; })()`);
    assert.deepEqual(s, { kacheln: 12, role: 'status', text: 'Lade Teile…' });
    await until(
      `!document.querySelector('#parts-main .skeleton-grid') && document.querySelectorAll('#parts-main .part-card').length === 12`,
      'Teile statt Skelett',
    );
  });

  await t.test('tap targets and font per tab', async () => {
    const tabList = await b.evaluate(`[...document.querySelectorAll('.ntab[data-tab]')].map(x => x.dataset.tab)`);
    const small = [],
      font = [];
    for (const r of tabList) {
      await switchTab(r);
      // The settings show one section at a time; all of them are measured.
      const pages =
        r === 'settings'
          ? await b.evaluate(`[...document.querySelectorAll('.settings-nav a')].map(a => a.dataset.arg)`)
          : [null];
      for (const page of pages) {
        if (page) {
          await b.evaluate(`document.querySelector('.settings-nav a[data-arg="${page}"]').click(); true`);
          await sleep(100);
        }
        await rest();
        const m = await b.evaluate(SMALL);
        small.push(...m.small.map(k => `${r}: ${k}`));
        font.push(...m.font.map(k => `${r}: ${k}`));
      }
    }
    assert.deepEqual([...new Set(small)], [], 'tap targets below 44 × 44 px');
    assert.deepEqual([...new Set(font)], [], 'text below 12 px');
  });

  await t.test('skip link and exactly one h1 per tab', async () => {
    const tabList = await b.evaluate(`[...document.querySelectorAll('.ntab[data-tab]')].map(x => x.dataset.tab)`);
    assert.ok(tabList.length >= 8, `nur ${tabList.length} Reiter`);
    const wrong = [];
    for (const r of tabList) {
      await switchTab(r);
      const h1 = await b.evaluate(
        `[...document.querySelectorAll('h1')].filter(h => h.getClientRects().length > 0).map(h => h.textContent.trim())`,
      );
      if (h1.length !== 1) wrong.push(`${r}: ${JSON.stringify(h1)}`);
    }
    assert.deepEqual(wrong, []);
    await switchTab('gallery');
    // The first tab stop in document order — that is where Tab jumps after loading.
    const focused = await b.evaluate(`(() => {
      const e = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')]
        .find(x => x.tabIndex >= 0 && !x.disabled && x.getClientRects().length > 0);
      e.focus(); const r = e.getBoundingClientRect();
      return { cls: e.className, text: e.textContent.trim(), upper: r.top, height: r.height }; })()`);
    assert.equal(focused.cls, 'skip-link', `first tab stop: ${JSON.stringify(focused)}`);
    assert.equal(focused.text, 'Zum Inhalt');
    assert.ok(
      focused.upper >= 0 && focused.height >= 24,
      `The skip link is not visible with focus: ${JSON.stringify(focused)}`,
    );
    await b.tab('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await settle();
    assert.equal(await b.evaluate(`document.activeElement.id`), 'content');
  });

  await t.test('settings: one section per subpage', async () => {
    await switchTab('settings');
    const state = () =>
      b.evaluate(`(() => {
      const visible = [...document.querySelectorAll('#global-settings-grid > .ssec')].filter(s => s.getClientRects().length > 0);
      const nav = document.querySelector('.settings-nav').getBoundingClientRect();
      return { visible: visible.map(s => s.id), current: document.querySelector('.settings-nav a[aria-current="page"]')?.dataset.arg,
               navRows: new Set([...document.querySelectorAll('.settings-nav a')].map(a => Math.round(a.getBoundingClientRect().top))).size,
               navHoehe: Math.round(nav.height), pagesWidth: document.documentElement.scrollWidth }; })()`);
    const prior = await state();
    assert.equal(prior.visible.length, 1, `visible: ${prior.visible}`);
    assert.equal(prior.current, prior.visible[0]);
    assert.equal(prior.navRows, 1, 'on the phone the bar is on one line');
    assert.ok(prior.pagesWidth <= 390, `page ${prior.pagesWidth} px wide`);
    await b.evaluate(`document.querySelector('.settings-nav a[data-arg="settings-smtp"]').click(); true`);
    await settle();
    const later = await state();
    assert.deepEqual([later.visible, later.current], [['settings-smtp'], 'settings-smtp']);
    assert.equal(await b.evaluate(`localStorage.getItem('bim_settings_section')`), 'settings-smtp');
  });

  await t.test('parts and minifigures findable in the bar', async () => {
    await switchTab('gallery');
    await b.evaluate(`document.querySelector('#tab-gallery .collection-choice [data-arg="parts"]').click(); true`);
    await settle();
    const phone = await b.evaluate(`(() => { const s = document.querySelector('.ntab[data-tab="gallery"]');
      return { text: s.innerText.trim(), current: s.getAttribute('aria-current'),
               partsVisible: document.querySelector('.ntab[data-tab="parts"]').getClientRects().length > 0 }; })()`);
    // The place is always called „Sammlung“; which view is open is told by the toggle at the top.
    assert.equal(phone.text, 'Sammlung', 'The first place in the bar changes its name');
    assert.equal(phone.current, 'page');
    assert.equal(phone.partsVisible, false, 'On the phone only five targets fit into the bar');
    // On the computer ONE navigation: „Sammlung“ in the bar, sets/parts/
    // minifigures only in the toggle on the page (before, both).
    await b.tab('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await until('innerWidth === 1280', 'Fensterbreite');
    await settle();
    const calculator = await b.evaluate(`(() => { const r = n => document.querySelector('.ntab[data-tab="' + n + '"]');
      return { parts: r('parts').getClientRects().length > 0, minifigs: r('minifigs').getClientRects().length > 0,
               toggle: document.querySelector('#tab-parts .collection-choice').getClientRects().length > 0,
               collectionActive: r('gallery').classList.contains('group-active') }; })()`);
    await b.tab('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await until('innerWidth === 390', 'Fensterbreite');
    await settle();
    assert.deepEqual(calculator, { parts: false, minifigs: false, toggle: true, collectionActive: true });
    await switchTab('gallery');
    assert.equal(await b.evaluate(`document.querySelector('.ntab[data-tab="gallery"]').innerText.trim()`), 'Sammlung');
  });

  await t.test('parts: one grid, filters as a sheet', async () => {
    await switchTab('parts');
    await until(`document.querySelectorAll('#parts-main .part-card:not(.skeleton)').length === 12`, 'zwölf Teile');
    const raster = await b.evaluate(`(() => {
      const list = document.querySelector('#parts-main .parts-list').getBoundingClientRect();
      const groups = [...document.querySelectorAll('#parts-main .parts-group')];
      return { groups: groups.length,
        schmal: groups.filter(g => g.querySelector('.group-hd').getBoundingClientRect().width < list.width - 1).length,
        scattered: groups.filter(g => new Set([...g.querySelectorAll('.part-card')].map(k => Math.round(k.getBoundingClientRect().top))).size > 1).length,
        breit: [...document.querySelectorAll('#parts-main .part-card')].filter(k => k.getBoundingClientRect().width > list.width * 0.6).length };
    })()`);
    assert.equal(raster.groups, 12);
    assert.deepEqual(
      { schmal: raster.schmal, scattered: raster.scattered, breit: raster.breit },
      { schmal: 0, scattered: 0, breit: 0 },
      'Colour heading not across the full width, or the parts are not in the grid',
    );
    const visible = id => `document.getElementById('${id}').getClientRects().length > 0`;
    assert.equal(await b.evaluate(visible('parts-spare')), false, 'The select fields are shown openly');
    await b.evaluate(`document.querySelector('#tab-parts .filter-button').click(); true`);
    const open = await b.evaluate(`(() => ({
      erweitert: document.querySelector('#tab-parts .filter-button').getAttribute('aria-expanded'),
      visible: ${visible('parts-spare')},
      widths: [...document.querySelectorAll('#tab-parts .filter-bar > select:not(.vh)')].filter(x => x.getClientRects().length)
        .map(x => Math.round(x.getBoundingClientRect().width)) }))()`);
    assert.equal(open.erweitert, 'true');
    assert.equal(open.visible, true);
    assert.equal(new Set(open.widths).size, 1, `fields of unequal width: ${open.widths}`);
    await b.evaluate(`document.querySelector('#tab-parts .filter-button').click(); true`);
  });

  await t.test('wishlist: capture row aligned', async () => {
    await switchTab('wanted');
    const messen = () =>
      b.evaluate(`['mk-num', 'mk-cond', 'mk-add', 'mk-csv-file'].map(id => {
      const e = document.getElementById(id); const z = (id === 'mk-csv-file' ? e.closest('label') : e).getBoundingClientRect();
      return { id, upper: Math.round(z.top), height: Math.round(z.height) };
    })`);
    for (const [width, height, mobileView] of [
      [1280, 900, false],
      [390, 844, true],
    ]) {
      await b.tab('Emulation.setDeviceMetricsOverride', {
        width: width,
        height: height,
        deviceScaleFactor: mobileView ? 2 : 1,
        mobile: mobileView,
      });
      await until(`innerWidth === ${width}`, 'Fensterbreite');
      await settle();
      const m = await messen();
      // On the phone the fields wrap; there only the equal height counts.
      const row = mobileView ? m : m.filter(x => x.upper === m[0].upper);
      assert.equal(row.length, m.length, `${width} px: not on one line ${JSON.stringify(m)}`);
      assert.equal(new Set(m.map(x => x.height)).size, 1, `${width} px: heights ${JSON.stringify(m)}`);
    }
  });

  await t.test('chart font finances', async () => {
    await switchTab('finance');
    await until(`!!document.querySelector('#portfolio-chart svg.chart')`, 'Wertdiagramm');
    const [d] = await b.evaluate(DIAGRAMMSCHRIFT('#portfolio-chart'));
    assert.ok(d.count >= 4, `nur ${d.count} Beschriftungen`);
    assert.ok(d.kleinste >= 11, `kleinste Beschriftung ${d.kleinste.toFixed(1)} px`);
    assert.equal(d.role, 'img');
    assert.match(d.name, /Wert der Sammlung, .+ bis .+: von .+ auf .+/);
  });

  await t.test('set view: chart, delete, price alert', async () => {
    await switchTab('gallery');
    await until(`!!document.querySelector('[data-click="openModal"]')`, 'Set-Karte');
    await b.evaluate(`document.querySelector('[data-click="openModal"]').click(); true`);
    await until(`!!document.querySelector('#m-sparkline-content svg.chart')`, 'Preisverlauf');
    const [d] = await b.evaluate(DIAGRAMMSCHRIFT('#m-sparkline-content'));
    assert.ok(d.kleinste >= 11, `kleinste Beschriftung ${d.kleinste.toFixed(1)} px`);
    assert.equal(d.role, 'img');
    assert.match(d.name, /Preisverlauf, .+ bis .+: Neuware zuletzt/);
    // Set detail: delete stands behind „Weitere Aktionen“, the price alert in
    // a row of its own across the full width.
    const visible = sel => `!!document.querySelector('${sel}')?.checkVisibility({ contentVisibilityAuto: true })`;
    assert.equal(await b.evaluate(visible('#btn-md')), false, '„Löschen“ is shown openly in the footer');
    await b.evaluate(`document.querySelector('#set-modal .more-menu > summary').click(); true`);
    await settle();
    assert.equal(await b.evaluate(visible('#btn-md')), true, '„Löschen“ cannot be found behind „Weitere Aktionen“');
    const alarm = await b.evaluate(`(() => {
      const line = document.querySelector('#set-modal .alert-row');
      const title = line.querySelector('.dl').getBoundingClientRect();
      const fields = [...line.querySelectorAll('.alert-field')].map(f => f.getBoundingClientRect());
      const z = line.getBoundingClientRect();
      const price = line.querySelector('.alert-price');
      return { belowTitle: fields.every(f => f.top >= title.bottom - 1), lines: new Set(fields.map(f => Math.round(f.top))).size,
               beschriftung: price?.textContent.trim(), height: Math.min(...fields.map(f => f.height)),
               // Die Währung steht in der Zeile des Preisfelds, nicht darunter.
               currencyBeside: (() => { const w = line.querySelector('.alert-currency').getBoundingClientRect(), p = fields[2];
                 return w.top >= p.top - 1 && w.bottom <= p.bottom + 1 && w.left >= p.right - 1; })(),
               width: Math.round((fields[1].right - fields[0].left) / z.width * 100) };
    })()`);
    assert.deepEqual(
      { ...alarm, width: alarm.width >= 90 },
      {
        belowTitle: true,
        lines: 2,
        beschriftung: 'Grenzpreis',
        height: alarm.height,
        currencyBeside: true,
        width: true,
      },
      `price alert: ${JSON.stringify(alarm)}`,
    );
    assert.ok(alarm.height >= 44, `price alert fields ${alarm.height} px high`);
    await b.evaluate(`document.querySelector('#set-modal [data-click="closeModal"]')?.click(); true`);
  });
  await t.test('reduced motion: dialog and tab without animation', async () => {
    // A sample dialog without role="dialog", so that the focus handling of the real
    // dialogs (js/dialogs.js) does not kick in.
    const duration = () =>
      b.evaluate(`(() => { const o = document.createElement('div');
      o.className = 'ovl open'; const m = document.createElement('div'); m.className = 'modal'; o.append(m); document.body.append(o);
      const d = getComputedStyle(o.firstElementChild).animationDuration; o.remove();
      return { dialog: parseFloat(d), tab: parseFloat(getComputedStyle(document.querySelector('.tab.active')).animationDuration) }; })()`);
    const settle = await duration();
    await b.tab('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    });
    const bewegt = await duration();
    await b.tab('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert.ok(
      bewegt.dialog >= 0.15 && bewegt.tab >= 0.15,
      `without the setting no transitions: ${JSON.stringify(bewegt)}`,
    );
    assert.ok(
      settle.dialog < 0.001 && settle.tab < 0.001,
      `with „weniger Bewegung“ still an animation: ${JSON.stringify(settle)}`,
    );
  });
});
