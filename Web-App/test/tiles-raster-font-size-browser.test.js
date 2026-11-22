/**
 * UX check 22 in real Chrome, in the household with a storage location: M4 and N1–N13
 * (names of the tiles up to the set detail). M3 is checked by collection-header-browser, M1 and
 * M2 by error-without-jump-browser.
 *
 * Counter-checks (measured 14.11.2026, each on its own, bundle rebuilt):
 *   A  tileName(): parts without aria-hidden → red: „Kachelnamen“, „Merkliste“
 *   B  catalog query of the wishlist without `if (w.name)` → red: „Merkliste: Set
 *      nicht im Katalog“ (request to /catalog/sets/10276-1)
 *   C  ownerBadges() again with o.username → red: „Kachelnamen“, „Kontoangaben“
 *   D  `#gallery .scb > .price-badge{order:1}` removed → red: „Preiskasten auf
 *      einer Höhe“ (925 against 943)
 *   E  storage location grid with column-gap:8px → red: „Lagerorte“ (8 px gaps)
 *   F  --header-h fixed 58px → red: „200 % Schrift“ (button 60.5 > header 58)
 *   G  voucher buttons again in .row → red: „Menüseiten“ (save on the left)
 *   H  .alert-item-amount as display:contents → red: „Menüseiten“ (EUR at
 *      320 px below the field)
 *   I  build list not in the :has() list of the banner → red: „Bauliste mit
 *      Schlüsselband“
 *   K  .m-links as display:contents → red: „Set-Detail nutzt die linke Spalte“
 *   L  `.filter-button[aria-expanded="true"]` never applying → red: „Telefon“
 *   M  summary::before with content:none → red: „Telefon“ (no disclosure marker)
 *   N  `.bstat::after { line-height: 1 }` removed → red: „Telefon“ (214/214/212)
 *   O  parts grid again 6.75rem → red: „Telefon“ (not two columns)
 *   P  rootMargin again fixed -64px → red: „Telefon“ (title in the header while
 *      the heading sticks out 6 px below it)
 *
 * Without Chrome (CHROME_BIN, google-chrome, chromium) it is skipped.
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');
const { patternHousehold } = require('./helpers/inventory');

const text = sel => `(document.querySelector(${JSON.stringify(sel)})?.textContent || '').replace(/\\s+/g, ' ').trim()`;
const CLOSE = `document.querySelectorAll('.ovl.open [data-dialog-close]').forEach(x => x.click()); true`;

/** Name and description in the accessibility tree, as a screen reader gets them. */
async function vorgelesen(b, sel) {
  const { root } = await b.tab('DOM.getDocument', { depth: 0 });
  const { nodeId } = await b.tab('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
  assert.ok(nodeId, `${sel} is missing`);
  const { nodes } = await b.tab('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
  return { name: nodes[0].name?.value || '', beschreibung: nodes[0].description?.value || '' };
}

async function groesse(b, breite, hoehe, telefon) {
  await b.tab('Emulation.setDeviceMetricsOverride', {
    width: breite,
    height: hoehe,
    deviceScaleFactor: 1,
    mobile: telefon,
  });
}

async function geh(a, hash, bereit, was) {
  await a.b.auswerten(CLOSE);
  await a.b.auswerten(`location.hash = ${JSON.stringify(hash)}; true`);
  await a.bis(bereit, was, 200);
  await a.ruhig(5000);
}

async function kachelnamen(_t, a, name) {
  const { b } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery [data-arg="21318-1"]')`, 'Sammlung');
  const set = await vorgelesen(b, '#gallery .sc[data-arg="21318-1"]');
  assert.equal(set.name, '21318-1 Tree House');
  assert.match(set.beschreibung, /2019 · Ideas/);
  assert.match(set.beschreibung, /Marktpreis/);
  assert.match(set.beschreibung, new RegExp(`${name} \\(ich\\)`));

  await geh(a, '#/teile', `!!document.querySelector('#tab-parts .part-card')`, 'Teile');
  const teil = await vorgelesen(b, '#tab-parts .part-card');
  assert.match(teil.name, /^\d+ (Brick|Plate) \d x \d \S+$/);
  assert.ok(teil.name.length <= 40, teil.name);
  assert.match(teil.beschreibung, /×12/);

  await geh(a, '#/minifiguren', `!!document.querySelector('#tab-minifigs [role="button"]')`, 'Minifiguren');
  const figur = await vorgelesen(b, '#tab-minifigs [role="button"][data-arg2="fig-000001"]');
  assert.equal(figur.name, 'fig-000001 Marty McFly');

  await geh(a, '#/katalog', `!!document.querySelector('#catalog-grid .sc')`, 'Katalog');
  const katalog = await vorgelesen(b, '#catalog-grid .sc[data-arg="10294-1"]');
  assert.equal(katalog.name, '10294-1 Titanic');
  assert.match(katalog.beschreibung, /Teile/);
}

async function wantedUnknown(_t, a) {
  const { b, bis } = a;
  await geh(a, '#/merkliste', `!!document.querySelector('#mk-list .mk-row')`, 'Merkliste');
  assert.equal((await vorgelesen(b, '#mk-list .mk-row')).name, '10276-1');
  assert.match(await b.auswerten(text('#mk-list .mk-row .mk-sub')), /^Set noch nicht im Katalog · Neuware$/);
  const vorher = b.eventList.length;
  await b.auswerten(`document.querySelector('#mk-list .mk-row').click(); true`);
  await bis(`document.getElementById('mk-detail-modal').classList.contains('open')`, 'Merkposten-Detail');
  await a.ruhig(5000);
  assert.match(await b.auswerten(text('#mk-m-det')), /Katalog ?Set noch nicht im Katalog — Name, Jahr und Thema/);
  assert.doesNotMatch(await b.auswerten(text('#mk-m-det')), /Jahr —/);
  const catalogRequests = b.eventList
    .slice(vorher)
    .filter(e => e.method === 'Network.requestWillBeSent' && /\/catalog\/sets\/10276-1/.test(e.params.request.url));
  assert.equal(catalogRequests.length, 0, 'request to the catalogue that ends with 404');
  await b.auswerten(CLOSE);
}

async function kontoangaben(_t, a, name) {
  const { b, bis } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery [data-arg="21318-1"]')`, 'Sammlung');
  assert.deepEqual(
    await b.auswerten(
      `[...document.querySelectorAll('#gallery .sc[data-arg="21318-1"] .owner-badge')].map(e => e.textContent)`,
    ),
    [`${name} (ich)`, `${name}_kind`],
  );
  await b.auswerten(`document.querySelector('#gallery .sc[data-arg="21318-1"]').click(); true`);
  await bis(`document.querySelectorAll('#m-quantity .quantity-account').length === 2`, 'Set-Detail');
  assert.equal(await b.auswerten(text('#m-subtitle')), `21318-1 · Konten: ${name} (ich), ${name}_kind`);
  const schrift = await b.auswerten(`({ kopf: getComputedStyle(document.getElementById('m-subtitle')).fontFamily,
    nr: getComputedStyle(document.querySelector('#m-subtitle .setnr')).fontFamily,
    mono: getComputedStyle(document.documentElement).getPropertyValue('--mono') })`);
  assert.notEqual(schrift.kopf, schrift.nr, 'accounts in monospace');
  await b.auswerten(CLOSE);
}

async function preiskasten(_t, a) {
  const { b } = a;
  await geh(a, '#/sammlung', `document.querySelectorAll('#gallery .price-badge:not([hidden])').length >= 3`, 'Preise');
  const unten = await b.auswerten(`(() => {
    const k = [...document.querySelectorAll('#gallery .sc')].map(c => ({ oben: Math.round(c.getBoundingClientRect().top),
      p: c.querySelector('.price-badge:not([hidden])')?.getBoundingClientRect().bottom }));
    const zeile = k.filter(x => x.oben === k[0].oben && x.p);
    return zeile.map(x => Math.round(x.p)); })()`);
  assert.ok(unten.length >= 3, `too few tiles in the first row: ${unten}`);
  assert.equal(new Set(unten).size, 1, `price boxes at different heights: ${unten}`);
}

async function lagerorte(_t, a) {
  const { b } = a;
  await geh(a, '#/lagerorte', `document.querySelectorAll('#storage-list .location-input').length > 0`, 'Lagerorte');
  const cells = await b.auswerten(`[...document.querySelector('#storage-list .location-grid > div').children]
    .map(z => { const r = z.getBoundingClientRect(); return [r.left, r.right, getComputedStyle(z).borderBottomWidth]; })`);
  for (let i = 1; i < cells.length; i++)
    assert.ok(Math.abs(cells[i][0] - cells[i - 1][1]) < 1, `gap in the divider: ${JSON.stringify(cells)}`);
  assert.equal(
    await b.auswerten(`document.querySelector('#storage-list .location-input').getAttribute('aria-label')`),
    'Lagerort umbenennen: Regal',
  );
}

async function menueseiten(_t, a) {
  const { b } = a;
  for (const [hash, sel] of [
    ['#/alarme', '#tab-alerts'],
    ['#/lagerorte', '#tab-locations'],
    ['#/gutscheine', '#tab-vouchers'],
    ['#/konto', '#tab-profile'],
  ]) {
    await geh(a, hash, `document.querySelector('${sel}').classList.contains('active')`, hash);
    const ohne = await b.auswerten(`[...document.querySelectorAll('${sel} h2.stit')].filter(h => h.checkVisibility())
      .filter(h => !h.querySelector('svg')).map(h => h.textContent.trim())`);
    assert.deepEqual(ohne, [], `${hash}: card heading without an icon`);
  }
  // The main button stands at the bottom right of the form.
  await geh(a, '#/gutscheine', `!!document.querySelector('[data-click="saveVoucher"]')?.checkVisibility()`, 'Voucher');
  const rechts = await b.auswerten(`(() => { const k = document.querySelector('[data-click="saveVoucher"]');
    const f = document.getElementById('v-number').getBoundingClientRect();
    return [k.getBoundingClientRect().right, document.getElementById('v-number').closest('.sform, .ssec').getBoundingClientRect().right, f.right]; })()`);
  assert.ok(rechts[0] > rechts[2] - 2 || rechts[1] - rechts[0] < 40, `save not on the right: ${rechts}`);
  // Amount and currency of the price alert on one line, even when narrow.
  await groesse(b, 320, 700, true);
  try {
    await geh(a, '#/alarme', `!!document.querySelector('#alerts-list .alert-item-field')`, 'Alarme');
    const situation =
      await b.auswerten(`(() => { const f = document.querySelector('#alerts-list .alert-item-field').getBoundingClientRect(),
      w = document.querySelector('#alerts-list .alert-item-currency').getBoundingClientRect();
      return { fieldTop: f.top, fieldBottom: f.bottom, wMiddle: (w.top + w.bottom) / 2, wLinks: w.left, fieldRight: f.right }; })()`);
    assert.ok(
      situation.wMiddle > situation.fieldTop && situation.wMiddle < situation.fieldBottom,
      `EUR not next to the field: ${JSON.stringify(situation)}`,
    );
    assert.ok(situation.wLinks >= situation.fieldRight, 'EUR not to the right of the field');
  } finally {
    await groesse(b, 1280, 900, false);
  }
}

async function bauliste(_t, a) {
  const { b } = a;
  await b.auswerten(
    `(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('bim_rb_hint_dismissed')) localStorage.removeItem(k); return true; })()`,
  );
  await geh(a, '#/bauliste', `document.getElementById('tab-partslist').classList.contains('active')`, 'Bauliste');
  assert.equal(await b.auswerten(`document.getElementById('rb-hint').checkVisibility()`), true, 'band is missing');
  await geh(a, '#/finanzen', `document.getElementById('tab-finance').classList.contains('active')`, 'Finanzen');
  assert.equal(await b.auswerten(`document.getElementById('rb-hint').checkVisibility()`), false, 'band in finances');
}

async function largeFont(_t, a) {
  const { b } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
  try {
    await b.auswerten(`document.documentElement.style.fontSize = '32px'; true`);
    await a.ruhig(2000);
    const m = await b.auswerten(`(() => { const r = s => document.querySelector(s).getBoundingClientRect();
      return { kopf: r('header').bottom, knopf: r('.ubadge-button').bottom, buttonTop: r('.ubadge-button').top, nav: r('nav').top }; })()`);
    assert.ok(m.knopf <= m.kopf && m.buttonTop >= 0, `account button sticks out of the header: ${JSON.stringify(m)}`);
    assert.ok(Math.abs(m.nav - m.kopf) < 1, `tab bar not below the header: ${JSON.stringify(m)}`);
  } finally {
    await b.auswerten(`document.documentElement.style.fontSize = ''; true`);
  }
}

async function setDetail(_t, a) {
  const { b, bis } = a;
  for (const [breite, telefon] of [
    [1280, false],
    [390, true],
  ]) {
    await groesse(b, breite, telefon ? 844 : 900, telefon);
    await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc[data-arg="21318-1"]')`, 'Sammlung');
    await b.auswerten(`document.querySelector('#gallery .sc[data-arg="21318-1"]').click(); true`);
    await bis(`!!document.querySelector('#m-sparkline-content svg')`, 'Preisverlauf');
    const l = await b.auswerten(`(() => { const r = s => document.querySelector(s).getBoundingClientRect().toJSON();
      const zeilen = [...document.querySelectorAll('#m-det .dr')].map(z => z.getBoundingClientRect().toJSON());
      return { image: r('#m-img'), chart: r('#m-price-chart'), det: r('#m-det .dr'), letzte: zeilen.at(-1) }; })()`);
    if (!telefon) {
      assert.ok(l.chart.right <= l.det.left, `price history not in the left column: ${JSON.stringify(l)}`);
      assert.ok(l.chart.top >= l.image.bottom, 'price history not below the image');
    } else assert.ok(l.chart.top >= l.letzte.bottom, 'phone: price history not at the end');
    await b.auswerten(CLOSE);
  }
  await groesse(b, 1280, 900, false);
}

async function telefon(_t, a) {
  const { b, bis } = a;
  await groesse(b, 390, 844, true);
  try {
    await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
    const knopf = '#tab-gallery .filter-button';
    const zu = await b.auswerten(`getComputedStyle(document.querySelector('${knopf}')).backgroundColor`);
    await b.auswerten(`document.querySelector('${knopf}').click(); true`);
    await bis(`document.querySelector('${knopf}').getAttribute('aria-expanded') === 'true'`, 'Filter offen');
    const open = await b.auswerten(`getComputedStyle(document.querySelector('${knopf}')).backgroundColor`);
    assert.notEqual(open, zu, 'filter button open looks like closed');
    await b.auswerten(`document.querySelector('${knopf}').click(); true`);

    // Number row on one baseline.
    const oben =
      await b.auswerten(`[...document.querySelectorAll('#tab-gallery .bstat')].filter(x => x.checkVisibility())
      .map(x => Math.round(x.querySelector('.bstat-v').getBoundingClientRect().bottom))`);
    assert.equal(new Set(oben).size, 1, `metrics staggered: ${oben}`);

    // Parts and figures in as many columns as the sets.
    await geh(a, '#/teile', `!!document.querySelector('#tab-parts .part-card')`, 'Teile');
    const spalten = await b.auswerten(`new Set([...document.querySelectorAll('#tab-parts .parts-grid')].at(-1)
      .querySelectorAll('.part-card').values().map(k => Math.round(k.getBoundingClientRect().left))).size`);
    assert.equal(spalten, 2, 'parts not in two columns');

    // Background jobs: if the heading only sticks out a few pixels below the header, the
    // title does not additionally stand in the header.
    await geh(a, '#/hintergrund', `!!document.querySelector('#tab-monitor .ptitle')?.checkVisibility()`, 'Hintergrund');
    await b.auswerten(`(() => { const kopf = document.querySelector('header').getBoundingClientRect().bottom;
      const h = document.querySelector('#tab-monitor .ptitle').getBoundingClientRect();
      window.scrollBy(0, h.bottom - kopf - 6); return true; })()`);
    await a.ruhig(1000);
    const doppelt = await b.auswerten(`(() => { const k = document.getElementById('header-view');
      const h = document.querySelector('#tab-monitor .ptitle').getBoundingClientRect();
      return { kopf: k.checkVisibility() && k.textContent, ueberstand: h.bottom - document.querySelector('header').getBoundingClientRect().bottom }; })()`);
    assert.ok(!(doppelt.kopf && doppelt.ueberstand > 0), `title twice: ${JSON.stringify(doppelt)}`);
    await bis(`!!document.querySelector('#jobs-card .mon-single > summary')`, 'Einzelne Aufträge');
    const zeichen =
      await b.auswerten(`(() => { const v = getComputedStyle(document.querySelector('#jobs-card .mon-single > summary'), '::before');
      return { inhalt: v.content, breite: parseFloat(v.width) }; })()`);
    assert.ok(zeichen.inhalt !== 'none' && zeichen.breite > 3, `no expand marker (${JSON.stringify(zeichen)})`);
  } finally {
    await groesse(b, 1280, 900, false);
  }
}

test('tile names, grid, 200 % font, phone', { concurrency: 1, timeout: 400_000 }, async t => {
  const name = `r22_${process.pid}`;
  const a = await startApp(t, {
    name,
    holding: async (db, uid) => {
      await patternHousehold(db, uid);
      await db.run(`INSERT INTO storage_locations (user_id, name) VALUES ($1, 'Regal')`, [uid]);
      // A job, so that „Einzelne Aufträge“ appears as an expandable list.
      await db.run(`INSERT INTO jobs (type, due_at) VALUES ('account_files', NOW() + interval '5 hours')`);
    },
  });
  if (a.reason) {
    t.skip(a.reason);
    return;
  }
  t.after(() => a.db.run(`DELETE FROM jobs WHERE type = 'account_files' AND status = 'pending'`).catch(() => {}));
  await a.ruhig();
  /** @type {[string, (t: import('node:test').TestContext, a: object, name: string) => Promise<void>][]} */
  const pruefungen = [
    ['Kachelnamen', kachelnamen],
    ['Merkliste: Set nicht im Katalog', wantedUnknown],
    ['Kontoangaben', kontoangaben],
    ['Preiskasten auf einer Höhe', preiskasten],
    ['Lagerorte', lagerorte],
    ['Menüseiten', menueseiten],
    ['Bauliste mit Schlüsselband', bauliste],
    ['200 % Schrift', largeFont],
    ['Set-Detail nutzt die linke Spalte', setDetail],
    ['Telefon', telefon],
  ];
  for (const [titel, fn] of pruefungen) await t.test(titel, () => fn(t, a, name));
});
