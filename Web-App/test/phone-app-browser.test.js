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
 *      → red: on the computer two navigations again (teile: true)
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
const { startApp, warte } = require('./helpers/app-browser');
const { holdsSet } = require('./helpers/inventory');

/** Smallest font in px across all labels of the charts below `wurzel`. */
const DIAGRAMMSCHRIFT = wurzel => `(() => {
  const svgs = [...document.querySelectorAll(${JSON.stringify(wurzel)} + ' svg.chart')];
  return svgs.map(svg => {
    const massstab = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    const sizes = [...svg.querySelectorAll('text')].map(x => parseFloat(getComputedStyle(x).fontSize) * massstab);
    return { rolle: svg.getAttribute('role'), name: svg.getAttribute('aria-label') || '',
             kleinste: Math.min(...sizes), anzahl: sizes.length };
  });
})()`;

/** Visible controls below 44 × 44 px and text below 12 px. */
const SMALL = `(() => {
  const sichtbar = e => { const q = e.getBoundingClientRect(); return q.width > 0 && q.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const klein = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, [role=button], label.btn')]
    // Ein verstecktes Dateifeld wird über sein Knopf-Label getippt; gemessen wird das Label.
    .filter(sichtbar).filter(e => !e.closest('.vh') && !e.matches('.file-hidden'))
    .map(e => { const q = e.getBoundingClientRect(); return [e, Math.round(q.width), Math.round(q.height)]; })
    .filter(([, w, h]) => w < 44 || h < 44)
    .map(([e, w, h]) => e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).trim().replace(/\\s+/g, '.') : '') + ' ' + w + '×' + h);
  const schrift = [...document.querySelectorAll('body *')]
    .filter(e => !e.closest('svg') && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
    .filter(sichtbar)
    .map(e => [e, parseFloat(getComputedStyle(e).fontSize)]).filter(([, px]) => px < 12)
    .map(([e, px]) => e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).trim().replace(/\\s+/g, '.') : '') + ' ' + px + ' px');
  return { klein, schrift };
})()`;

test('phone', { concurrency: 1, timeout: 240_000 }, async t => {
  const app = await startApp(t, {
    name: `telefon_${process.pid}`,
    telefon: true,
    // Twelve parts in twelve colors — the case that used to produce twelve almost empty rows.
    // The parts come 1.5 s later so that the skeleton is visible before.
    intercept: [
      {
        muster: '*/api/v2/parts?*',
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
          ].map((farbe, i) => ({
            part_number: `300${i}`,
            part_name: `Stein ${i}`,
            color_name: farbe,
            color_hex: '777777',
            color_id: i + 1,
            total_quantity: 2,
          })),
        },
      },
    ],
    holding: async (db, uid) => {
      await holdsSet(db, uid, '10300-1', 1, { preis: 199 });
      await db.run(`DELETE FROM price_history WHERE set_number = '10300-1'`);
      for (const [tage, preis] of [
        [90, 210],
        [60, 230],
        [30, 250],
        [1, 260],
      ])
        await db.run(
          `INSERT INTO price_history (set_number, condition, currency_code, avg_price, qty_avg_price, recorded_at)
                      VALUES ('10300-1', 'N', 'EUR', $1, $1, NOW() - ($2 || ' days')::interval)`,
          [preis, String(tage)],
        );
    },
  });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, bis, ruhig } = app;
  // What is measured is the final state: a dialog that is just opening (say the
  // setup after the login) stands at scale(.985) in the first frame.
  const rest = () =>
    b.auswerten(`Promise.all(document.getAnimations()
    .filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
    .map(a => a.finished.catch(() => {}))).then(() => true)`);
  const reiter = async name => {
    await b.auswerten(`document.querySelector('.ntab[data-tab="${name}"]').click(); true`);
    await warte(400);
    await rest();
  };

  await t.test('skeleton while loading the parts', async () => {
    await b.auswerten(`document.querySelector('.ntab[data-tab="parts"]').click(); true`);
    // The skeleton comes after metrics and filters; the parts themselves are delayed by 1.5 s.
    await bis(`!!document.querySelector('#parts-main .skeleton-grid')`, 'Skelett der Teile', 30);
    const s = await b.auswerten(`(() => { const r = document.querySelector('#parts-main .skeleton-grid');
      return r && { kacheln: r.querySelectorAll('.part-card.skeleton').length, rolle: r.getAttribute('role'), text: r.textContent.trim() }; })()`);
    assert.deepEqual(s, { kacheln: 12, rolle: 'status', text: 'Lade Teile…' });
    await bis(
      `!document.querySelector('#parts-main .skeleton-grid') && document.querySelectorAll('#parts-main .part-card').length === 12`,
      'Teile statt Skelett',
    );
  });

  await t.test('tap targets and font per tab', async () => {
    const tabList = await b.auswerten(`[...document.querySelectorAll('.ntab[data-tab]')].map(x => x.dataset.tab)`);
    const klein = [],
      schrift = [];
    for (const r of tabList) {
      await reiter(r);
      // The settings show one section at a time; all of them are measured.
      const seiten =
        r === 'settings'
          ? await b.auswerten(`[...document.querySelectorAll('.settings-nav a')].map(a => a.dataset.arg)`)
          : [null];
      for (const seite of seiten) {
        if (seite) {
          await b.auswerten(`document.querySelector('.settings-nav a[data-arg="${seite}"]').click(); true`);
          await warte(100);
        }
        await rest();
        const m = await b.auswerten(SMALL);
        klein.push(...m.klein.map(k => `${r}: ${k}`));
        schrift.push(...m.schrift.map(k => `${r}: ${k}`));
      }
    }
    assert.deepEqual([...new Set(klein)], [], 'Tippziele unter 44 × 44 px');
    assert.deepEqual([...new Set(schrift)], [], 'Text unter 12 px');
  });

  await t.test('skip link and exactly one h1 per tab', async () => {
    const tabList = await b.auswerten(`[...document.querySelectorAll('.ntab[data-tab]')].map(x => x.dataset.tab)`);
    assert.ok(tabList.length >= 8, `nur ${tabList.length} Reiter`);
    const falsch = [];
    for (const r of tabList) {
      await reiter(r);
      const h1 = await b.auswerten(
        `[...document.querySelectorAll('h1')].filter(h => h.getClientRects().length > 0).map(h => h.textContent.trim())`,
      );
      if (h1.length !== 1) falsch.push(`${r}: ${JSON.stringify(h1)}`);
    }
    assert.deepEqual(falsch, []);
    await reiter('gallery');
    // The first tab stop in document order — that is where Tab jumps after loading.
    const fokus = await b.auswerten(`(() => {
      const e = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')]
        .find(x => x.tabIndex >= 0 && !x.disabled && x.getClientRects().length > 0);
      e.focus(); const r = e.getBoundingClientRect();
      return { klasse: e.className, text: e.textContent.trim(), oben: r.top, hoehe: r.height }; })()`);
    assert.equal(fokus.klasse, 'skip-link', `Erster Tab-Halt: ${JSON.stringify(fokus)}`);
    assert.equal(fokus.text, 'Zum Inhalt');
    assert.ok(
      fokus.oben >= 0 && fokus.hoehe >= 24,
      `Der Sprunglink ist mit Fokus nicht sichtbar: ${JSON.stringify(fokus)}`,
    );
    await b.tab('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await ruhig();
    assert.equal(await b.auswerten(`document.activeElement.id`), 'content');
  });

  await t.test('settings: one section per subpage', async () => {
    await reiter('settings');
    const state = () =>
      b.auswerten(`(() => {
      const sichtbar = [...document.querySelectorAll('#global-settings-grid > .ssec')].filter(s => s.getClientRects().length > 0);
      const nav = document.querySelector('.settings-nav').getBoundingClientRect();
      return { sichtbar: sichtbar.map(s => s.id), aktuell: document.querySelector('.settings-nav a[aria-current="page"]')?.dataset.arg,
               navRows: new Set([...document.querySelectorAll('.settings-nav a')].map(a => Math.round(a.getBoundingClientRect().top))).size,
               navHoehe: Math.round(nav.height), pagesWidth: document.documentElement.scrollWidth }; })()`);
    const vorher = await state();
    assert.equal(vorher.sichtbar.length, 1, `sichtbar: ${vorher.sichtbar}`);
    assert.equal(vorher.aktuell, vorher.sichtbar[0]);
    assert.equal(vorher.navRows, 1, 'am Telefon steht die Leiste in einer Zeile');
    assert.ok(vorher.pagesWidth <= 390, `Seite ${vorher.pagesWidth} px breit`);
    await b.auswerten(`document.querySelector('.settings-nav a[data-arg="settings-smtp"]').click(); true`);
    await ruhig();
    const nachher = await state();
    assert.deepEqual([nachher.sichtbar, nachher.aktuell], [['settings-smtp'], 'settings-smtp']);
    assert.equal(await b.auswerten(`localStorage.getItem('bim_settings_section')`), 'settings-smtp');
  });

  await t.test('parts and minifigures findable in the bar', async () => {
    await reiter('gallery');
    await b.auswerten(`document.querySelector('#tab-gallery .collection-choice [data-arg="parts"]').click(); true`);
    await ruhig();
    const telefon = await b.auswerten(`(() => { const s = document.querySelector('.ntab[data-tab="gallery"]');
      return { text: s.innerText.trim(), aktuell: s.getAttribute('aria-current'),
               partsVisible: document.querySelector('.ntab[data-tab="parts"]').getClientRects().length > 0 }; })()`);
    // The place is always called „Sammlung“; which view is open is told by the toggle at the top.
    assert.equal(telefon.text, 'Sammlung', 'Der erste Platz der Leiste wechselt seinen Namen');
    assert.equal(telefon.aktuell, 'page');
    assert.equal(telefon.partsVisible, false, 'Am Telefon passen nur fünf Ziele in die Leiste');
    // On the computer ONE navigation: „Sammlung“ in the bar, sets/parts/
    // minifigures only in the toggle on the page (before, both).
    await b.tab('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await bis('innerWidth === 1280', 'Fensterbreite');
    await ruhig();
    const calculator = await b.auswerten(`(() => { const r = n => document.querySelector('.ntab[data-tab="' + n + '"]');
      return { teile: r('parts').getClientRects().length > 0, figuren: r('minifigs').getClientRects().length > 0,
               toggle: document.querySelector('#tab-parts .collection-choice').getClientRects().length > 0,
               collectionActive: r('gallery').classList.contains('group-active') }; })()`);
    await b.tab('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await bis('innerWidth === 390', 'Fensterbreite');
    await ruhig();
    assert.deepEqual(calculator, { teile: false, figuren: false, toggle: true, collectionActive: true });
    await reiter('gallery');
    assert.equal(await b.auswerten(`document.querySelector('.ntab[data-tab="gallery"]').innerText.trim()`), 'Sammlung');
  });

  await t.test('parts: one grid, filters as a sheet', async () => {
    await reiter('parts');
    await bis(`document.querySelectorAll('#parts-main .part-card:not(.skeleton)').length === 12`, 'zwölf Teile');
    const raster = await b.auswerten(`(() => {
      const liste = document.querySelector('#parts-main .parts-list').getBoundingClientRect();
      const gruppen = [...document.querySelectorAll('#parts-main .parts-group')];
      return { gruppen: gruppen.length,
        schmal: gruppen.filter(g => g.querySelector('.group-hd').getBoundingClientRect().width < liste.width - 1).length,
        scattered: gruppen.filter(g => new Set([...g.querySelectorAll('.part-card')].map(k => Math.round(k.getBoundingClientRect().top))).size > 1).length,
        breit: [...document.querySelectorAll('#parts-main .part-card')].filter(k => k.getBoundingClientRect().width > liste.width * 0.6).length };
    })()`);
    assert.equal(raster.gruppen, 12);
    assert.deepEqual(
      { schmal: raster.schmal, scattered: raster.scattered, breit: raster.breit },
      { schmal: 0, scattered: 0, breit: 0 },
      'Farbüberschrift nicht über die volle Breite, oder die Teile stehen nicht im Raster',
    );
    const sichtbar = id => `document.getElementById('${id}').getClientRects().length > 0`;
    assert.equal(await b.auswerten(sichtbar('parts-spare')), false, 'Die Auswahlfelder stehen offen da');
    await b.auswerten(`document.querySelector('#tab-parts .filter-button').click(); true`);
    const open = await b.auswerten(`(() => ({
      erweitert: document.querySelector('#tab-parts .filter-button').getAttribute('aria-expanded'),
      sichtbar: ${sichtbar('parts-spare')},
      breiten: [...document.querySelectorAll('#tab-parts .filter-bar > select:not(.vh)')].filter(x => x.getClientRects().length)
        .map(x => Math.round(x.getBoundingClientRect().width)) }))()`);
    assert.equal(open.erweitert, 'true');
    assert.equal(open.sichtbar, true);
    assert.equal(new Set(open.breiten).size, 1, `ungleich breite Felder: ${open.breiten}`);
    await b.auswerten(`document.querySelector('#tab-parts .filter-button').click(); true`);
  });

  await t.test('wishlist: capture row aligned', async () => {
    await reiter('wanted');
    const messen = () =>
      b.auswerten(`['mk-num', 'mk-cond', 'mk-add', 'mk-csv-file'].map(id => {
      const e = document.getElementById(id); const z = (id === 'mk-csv-file' ? e.closest('label') : e).getBoundingClientRect();
      return { id, oben: Math.round(z.top), hoehe: Math.round(z.height) };
    })`);
    for (const [breite, hoehe, mobil] of [
      [1280, 900, false],
      [390, 844, true],
    ]) {
      await b.tab('Emulation.setDeviceMetricsOverride', {
        width: breite,
        height: hoehe,
        deviceScaleFactor: mobil ? 2 : 1,
        mobile: mobil,
      });
      await bis(`innerWidth === ${breite}`, 'Fensterbreite');
      await ruhig();
      const m = await messen();
      // On the phone the fields wrap; there only the equal height counts.
      const row = mobil ? m : m.filter(x => x.oben === m[0].oben);
      assert.equal(row.length, m.length, `${breite} px: nicht in einer Zeile ${JSON.stringify(m)}`);
      assert.equal(new Set(m.map(x => x.hoehe)).size, 1, `${breite} px: Höhen ${JSON.stringify(m)}`);
    }
  });

  await t.test('chart font finances', async () => {
    await reiter('finance');
    await bis(`!!document.querySelector('#portfolio-chart svg.chart')`, 'Wertdiagramm');
    const [d] = await b.auswerten(DIAGRAMMSCHRIFT('#portfolio-chart'));
    assert.ok(d.anzahl >= 4, `nur ${d.anzahl} Beschriftungen`);
    assert.ok(d.kleinste >= 11, `kleinste Beschriftung ${d.kleinste.toFixed(1)} px`);
    assert.equal(d.rolle, 'img');
    assert.match(d.name, /Wert der Sammlung, .+ bis .+: von .+ auf .+/);
  });

  await t.test('set view: chart, delete, price alert', async () => {
    await reiter('gallery');
    await bis(`!!document.querySelector('[data-click="openModal"]')`, 'Set-Karte');
    await b.auswerten(`document.querySelector('[data-click="openModal"]').click(); true`);
    await bis(`!!document.querySelector('#m-sparkline-content svg.chart')`, 'Preisverlauf');
    const [d] = await b.auswerten(DIAGRAMMSCHRIFT('#m-sparkline-content'));
    assert.ok(d.kleinste >= 11, `kleinste Beschriftung ${d.kleinste.toFixed(1)} px`);
    assert.equal(d.rolle, 'img');
    assert.match(d.name, /Preisverlauf, .+ bis .+: Neuware zuletzt/);
    // Set detail: delete stands behind „Weitere Aktionen“, the price alert in
    // a row of its own across the full width.
    const sichtbar = sel => `!!document.querySelector('${sel}')?.checkVisibility({ contentVisibilityAuto: true })`;
    assert.equal(await b.auswerten(sichtbar('#btn-md')), false, 'Löschen steht offen im Fuss');
    await b.auswerten(`document.querySelector('#set-modal .more-menu > summary').click(); true`);
    await ruhig();
    assert.equal(await b.auswerten(sichtbar('#btn-md')), true, 'Löschen ist hinter „Weitere Aktionen“ nicht zu finden');
    const alarm = await b.auswerten(`(() => {
      const zeile = document.querySelector('#set-modal .alert-row');
      const titel = zeile.querySelector('.dl').getBoundingClientRect();
      const felder = [...zeile.querySelectorAll('.alert-field')].map(f => f.getBoundingClientRect());
      const z = zeile.getBoundingClientRect();
      const preis = zeile.querySelector('.alert-price');
      return { belowTitle: felder.every(f => f.top >= titel.bottom - 1), zeilen: new Set(felder.map(f => Math.round(f.top))).size,
               beschriftung: preis?.textContent.trim(), hoehe: Math.min(...felder.map(f => f.height)),
               // Die Währung steht in der Zeile des Preisfelds, nicht darunter.
               currencyBeside: (() => { const w = zeile.querySelector('.alert-currency').getBoundingClientRect(), p = felder[2];
                 return w.top >= p.top - 1 && w.bottom <= p.bottom + 1 && w.left >= p.right - 1; })(),
               breite: Math.round((felder[1].right - felder[0].left) / z.width * 100) };
    })()`);
    assert.deepEqual(
      { ...alarm, breite: alarm.breite >= 90 },
      {
        belowTitle: true,
        zeilen: 2,
        beschriftung: 'Grenzpreis',
        hoehe: alarm.hoehe,
        currencyBeside: true,
        breite: true,
      },
      `Preisalarm: ${JSON.stringify(alarm)}`,
    );
    assert.ok(alarm.hoehe >= 44, `Preisalarm-Felder ${alarm.hoehe} px hoch`);
    await b.auswerten(`document.querySelector('#set-modal [data-click="closeModal"]')?.click(); true`);
  });
  await t.test('reduced motion: dialog and tab without animation', async () => {
    // A sample dialog without role="dialog", so that the focus handling of the real
    // dialogs (js/dialogs.js) does not kick in.
    const duration = () =>
      b.auswerten(`(() => { const o = document.createElement('div');
      o.className = 'ovl open'; const m = document.createElement('div'); m.className = 'modal'; o.append(m); document.body.append(o);
      const d = getComputedStyle(o.firstElementChild).animationDuration; o.remove();
      return { dialog: parseFloat(d), reiter: parseFloat(getComputedStyle(document.querySelector('.tab.active')).animationDuration) }; })()`);
    const ruhig = await duration();
    await b.tab('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    });
    const bewegt = await duration();
    await b.tab('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert.ok(
      bewegt.dialog >= 0.15 && bewegt.reiter >= 0.15,
      `ohne Einstellung keine Übergänge: ${JSON.stringify(bewegt)}`,
    );
    assert.ok(
      ruhig.dialog < 0.001 && ruhig.reiter < 0.001,
      `mit „weniger Bewegung“ trotzdem Animation: ${JSON.stringify(ruhig)}`,
    );
  });
});
