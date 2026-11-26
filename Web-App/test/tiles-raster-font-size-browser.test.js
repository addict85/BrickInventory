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
 *   K  #m-price-chart back inside .m-links → red: „Set-Detail: Preisverlauf
 *      über die volle Breite“ (chart narrower than the fields column again)
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
  return { name: nodes[0].name?.value || '', description: nodes[0].description?.value || '' };
}

async function size(b, width, height, phone) {
  await b.tab('Emulation.setDeviceMetricsOverride', {
    width: width,
    height: height,
    deviceScaleFactor: 1,
    mobile: phone,
  });
}

async function geh(a, hash, ready, was) {
  await a.b.evaluate(CLOSE);
  await a.b.evaluate(`location.hash = ${JSON.stringify(hash)}; true`);
  await a.until(ready, was, 200);
  await a.settle(5000);
}

async function kachelnamen(_t, a, name) {
  const { b } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery [data-arg="21318-1"]')`, 'Sammlung');
  const set = await vorgelesen(b, '#gallery .sc[data-arg="21318-1"]');
  assert.equal(set.name, '21318-1 Tree House');
  assert.match(set.description, /2019 · Ideas/);
  assert.match(set.description, /Marktpreis/);
  assert.match(set.description, new RegExp(`${name} \\(ich\\)`));

  await geh(a, '#/teile', `!!document.querySelector('#tab-parts .part-card')`, 'Teile');
  const part = await vorgelesen(b, '#tab-parts .part-card');
  assert.match(part.name, /^\d+ (Brick|Plate) \d x \d \S+$/);
  assert.ok(part.name.length <= 40, part.name);
  assert.match(part.description, /×12/);

  await geh(a, '#/minifiguren', `!!document.querySelector('#tab-minifigs [role="button"]')`, 'Minifiguren');
  const minifig = await vorgelesen(b, '#tab-minifigs [role="button"][data-arg2="fig-000001"]');
  assert.equal(minifig.name, 'fig-000001 Marty McFly');

  await geh(a, '#/katalog', `!!document.querySelector('#catalog-grid .sc')`, 'Katalog');
  const catalog = await vorgelesen(b, '#catalog-grid .sc[data-arg="10294-1"]');
  assert.equal(catalog.name, '10294-1 Titanic');
  assert.match(catalog.description, /Teile/);
}

async function wantedUnknown(_t, a) {
  const { b, until } = a;
  await geh(a, '#/merkliste', `!!document.querySelector('#mk-list .mk-row')`, 'Merkliste');
  assert.equal((await vorgelesen(b, '#mk-list .mk-row')).name, '10276-1');
  assert.match(await b.evaluate(text('#mk-list .mk-row .mk-sub')), /^Set noch nicht im Katalog · Neuware$/);
  const prior = b.eventList.length;
  await b.evaluate(`document.querySelector('#mk-list .mk-row').click(); true`);
  await until(`document.getElementById('mk-detail-modal').classList.contains('open')`, 'Merkposten-Detail');
  await a.settle(5000);
  assert.match(await b.evaluate(text('#mk-m-det')), /Katalog ?Set noch nicht im Katalog — Name, Jahr und Thema/);
  assert.doesNotMatch(await b.evaluate(text('#mk-m-det')), /Jahr —/);
  const catalogRequests = b.eventList
    .slice(prior)
    .filter(e => e.method === 'Network.requestWillBeSent' && /\/catalog\/sets\/10276-1/.test(e.params.request.url));
  assert.equal(catalogRequests.length, 0, 'request to the catalogue that ends with 404');
  await b.evaluate(CLOSE);
}

async function kontoangaben(_t, a, name) {
  const { b, until } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery [data-arg="21318-1"]')`, 'Sammlung');
  assert.deepEqual(
    await b.evaluate(
      `[...document.querySelectorAll('#gallery .sc[data-arg="21318-1"] .owner-badge')].map(e => e.textContent)`,
    ),
    [`${name} (ich)`, `${name}_kind`],
  );
  await b.evaluate(`document.querySelector('#gallery .sc[data-arg="21318-1"]').click(); true`);
  await until(`document.querySelectorAll('#m-quantity .quantity-account').length === 2`, 'Set-Detail');
  assert.equal(await b.evaluate(text('#m-subtitle')), `21318-1 · Konten: ${name} (ich), ${name}_kind`);
  const font = await b.evaluate(`({ head: getComputedStyle(document.getElementById('m-subtitle')).fontFamily,
    nr: getComputedStyle(document.querySelector('#m-subtitle .setnr')).fontFamily,
    mono: getComputedStyle(document.documentElement).getPropertyValue('--mono') })`);
  assert.notEqual(font.head, font.nr, 'accounts in monospace');
  await b.evaluate(CLOSE);
}

async function preiskasten(_t, a) {
  const { b } = a;
  await geh(a, '#/sammlung', `document.querySelectorAll('#gallery .price-badge:not([hidden])').length >= 3`, 'Preise');
  const lower = await b.evaluate(`(() => {
    const k = [...document.querySelectorAll('#gallery .sc')].map(c => ({ upper: Math.round(c.getBoundingClientRect().top),
      p: c.querySelector('.price-badge:not([hidden])')?.getBoundingClientRect().bottom }));
    const line = k.filter(x => x.upper === k[0].upper && x.p);
    return line.map(x => Math.round(x.p)); })()`);
  assert.ok(lower.length >= 3, `too few tiles in the first row: ${lower}`);
  assert.equal(new Set(lower).size, 1, `price boxes at different heights: ${lower}`);
}

async function storageLocations(_t, a) {
  const { b } = a;
  await geh(a, '#/lagerorte', `document.querySelectorAll('#storage-list .location-input').length > 0`, 'Lagerorte');
  const cells = await b.evaluate(`[...document.querySelector('#storage-list .location-grid > div').children]
    .map(z => { const r = z.getBoundingClientRect(); return [r.left, r.right, getComputedStyle(z).borderBottomWidth]; })`);
  for (let i = 1; i < cells.length; i++)
    assert.ok(Math.abs(cells[i][0] - cells[i - 1][1]) < 1, `gap in the divider: ${JSON.stringify(cells)}`);
  assert.equal(
    await b.evaluate(`document.querySelector('#storage-list .location-input').getAttribute('aria-label')`),
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
    const without = await b.evaluate(`[...document.querySelectorAll('${sel} h2.stit')].filter(h => h.checkVisibility())
      .filter(h => !h.querySelector('svg')).map(h => h.textContent.trim())`);
    assert.deepEqual(without, [], `${hash}: card heading without an icon`);
  }
  // The main button stands at the bottom right of the form.
  await geh(a, '#/gutscheine', `!!document.querySelector('[data-click="saveVoucher"]')?.checkVisibility()`, 'Voucher');
  const right = await b.evaluate(`(() => { const k = document.querySelector('[data-click="saveVoucher"]');
    const f = document.getElementById('v-number').getBoundingClientRect();
    return [k.getBoundingClientRect().right, document.getElementById('v-number').closest('.sform, .ssec').getBoundingClientRect().right, f.right]; })()`);
  assert.ok(right[0] > right[2] - 2 || right[1] - right[0] < 40, `save not on the right: ${right}`);
  // Amount and currency of the price alert on one line, even when narrow.
  await size(b, 320, 700, true);
  try {
    await geh(a, '#/alarme', `!!document.querySelector('#alerts-list .alert-item-field')`, 'Alarme');
    const situation =
      await b.evaluate(`(() => { const f = document.querySelector('#alerts-list .alert-item-field').getBoundingClientRect(),
      w = document.querySelector('#alerts-list .alert-item-currency').getBoundingClientRect();
      return { fieldTop: f.top, fieldBottom: f.bottom, wMiddle: (w.top + w.bottom) / 2, wLinks: w.left, fieldRight: f.right }; })()`);
    assert.ok(
      situation.wMiddle > situation.fieldTop && situation.wMiddle < situation.fieldBottom,
      `EUR not next to the field: ${JSON.stringify(situation)}`,
    );
    assert.ok(situation.wLinks >= situation.fieldRight, 'EUR not to the right of the field');
  } finally {
    await size(b, 1280, 900, false);
  }
}

async function buildList(_t, a) {
  const { b } = a;
  await b.evaluate(
    `(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('bim_rb_hint_dismissed')) localStorage.removeItem(k); return true; })()`,
  );
  await geh(a, '#/bauliste', `document.getElementById('tab-partslist').classList.contains('active')`, 'Bauliste');
  assert.equal(await b.evaluate(`document.getElementById('rb-hint').checkVisibility()`), true, 'band is missing');
  await geh(a, '#/finanzen', `document.getElementById('tab-finance').classList.contains('active')`, 'Finanzen');
  assert.equal(await b.evaluate(`document.getElementById('rb-hint').checkVisibility()`), false, 'band in finances');
}

async function largeFont(_t, a) {
  const { b } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
  try {
    await b.evaluate(`document.documentElement.style.fontSize = '32px'; true`);
    await a.settle(2000);
    const m = await b.evaluate(`(() => { const r = s => document.querySelector(s).getBoundingClientRect();
      return { head: r('header').bottom, button: r('.ubadge-button').bottom, buttonTop: r('.ubadge-button').top, nav: r('nav').top }; })()`);
    assert.ok(m.button <= m.head && m.buttonTop >= 0, `account button sticks out of the header: ${JSON.stringify(m)}`);
    assert.ok(Math.abs(m.nav - m.head) < 1, `tab bar not below the header: ${JSON.stringify(m)}`);
  } finally {
    await b.evaluate(`document.documentElement.style.fontSize = ''; true`);
  }
}

async function setDetail(_t, a) {
  const { b, until } = a;
  for (const [width, phone] of [
    [1280, false],
    [390, true],
  ]) {
    await size(b, width, phone ? 844 : 900, phone);
    await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc[data-arg="21318-1"]')`, 'Sammlung');
    await b.evaluate(`document.querySelector('#gallery .sc[data-arg="21318-1"]').click(); true`);
    await until(
      `!!document.querySelector('#m-det .dr') && !!document.querySelector('#m-sparkline-content svg')`,
      'Preisverlauf',
    );
    const l = await b.evaluate(`(() => { const r = s => document.querySelector(s).getBoundingClientRect().toJSON();
      const lines = [...document.querySelectorAll('#m-det .dr')].map(z => z.getBoundingClientRect().toJSON());
      return { image: r('#m-img'), chart: r('#m-price-chart'), det: r('#m-det .dr'), last: lines.at(-1) }; })()`);
    assert.ok(
      l.chart.top >= l.image.bottom && l.chart.top >= l.last.bottom,
      `price history not below image and fields: ${JSON.stringify(l)}`,
    );
    if (!phone)
      assert.ok(
        l.chart.left <= l.image.left + 1 && l.chart.right >= l.det.right - 1,
        `price history not full width: ${JSON.stringify(l)}`,
      );
    await b.evaluate(CLOSE);
  }
  await size(b, 1280, 900, false);
}

async function phone(_t, a) {
  const { b, until } = a;
  await size(b, 390, 844, true);
  try {
    await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
    const button = '#tab-gallery .filter-button';
    const closed = await b.evaluate(`getComputedStyle(document.querySelector('${button}')).backgroundColor`);
    await b.evaluate(`document.querySelector('${button}').click(); true`);
    await until(`document.querySelector('${button}').getAttribute('aria-expanded') === 'true'`, 'Filter offen');
    const open = await b.evaluate(`getComputedStyle(document.querySelector('${button}')).backgroundColor`);
    assert.notEqual(open, closed, 'filter button open looks like closed');
    await b.evaluate(`document.querySelector('${button}').click(); true`);

    // Number row on one baseline.
    const upper =
      await b.evaluate(`[...document.querySelectorAll('#tab-gallery .bstat')].filter(x => x.checkVisibility())
      .map(x => Math.round(x.querySelector('.bstat-v').getBoundingClientRect().bottom))`);
    assert.equal(new Set(upper).size, 1, `metrics staggered: ${upper}`);

    // Parts and figures in as many columns as the sets.
    await geh(a, '#/teile', `!!document.querySelector('#tab-parts .part-card')`, 'Teile');
    const columns = await b.evaluate(`new Set([...document.querySelectorAll('#tab-parts .parts-grid')].at(-1)
      .querySelectorAll('.part-card').values().map(k => Math.round(k.getBoundingClientRect().left))).size`);
    assert.equal(columns, 2, 'parts not in two columns');

    // Background jobs: if the heading only sticks out a few pixels below the header, the
    // title does not additionally stand in the header.
    await geh(a, '#/hintergrund', `!!document.querySelector('#tab-monitor .ptitle')?.checkVisibility()`, 'Hintergrund');
    await b.evaluate(`(() => { const head = document.querySelector('header').getBoundingClientRect().bottom;
      const h = document.querySelector('#tab-monitor .ptitle').getBoundingClientRect();
      window.scrollBy(0, h.bottom - head - 6); return true; })()`);
    await a.settle(1000);
    const twice = await b.evaluate(`(() => { const k = document.getElementById('header-view');
      const h = document.querySelector('#tab-monitor .ptitle').getBoundingClientRect();
      return { head: k.checkVisibility() && k.textContent, ueberstand: h.bottom - document.querySelector('header').getBoundingClientRect().bottom }; })()`);
    assert.ok(!(twice.head && twice.ueberstand > 0), `title twice: ${JSON.stringify(twice)}`);
    await until(`!!document.querySelector('#jobs-card .mon-single > summary')`, 'Einzelne Aufträge');
    const chars =
      await b.evaluate(`(() => { const v = getComputedStyle(document.querySelector('#jobs-card .mon-single > summary'), '::before');
      return { content: v.content, width: parseFloat(v.width) }; })()`);
    assert.ok(chars.content !== 'none' && chars.width > 3, `no expand marker (${JSON.stringify(chars)})`);
  } finally {
    await size(b, 1280, 900, false);
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
  await a.settle();
  /** @type {[string, (t: import('node:test').TestContext, a: object, name: string) => Promise<void>][]} */
  const pruefungen = [
    ['Kachelnamen', kachelnamen],
    ['Merkliste: Set nicht im Katalog', wantedUnknown],
    ['Kontoangaben', kontoangaben],
    ['Preiskasten auf einer Höhe', preiskasten],
    ['Lagerorte', storageLocations],
    ['Menüseiten', menueseiten],
    ['Bauliste mit Schlüsselband', buildList],
    ['200 % Schrift', largeFont],
    ['Set-Detail: Preisverlauf über die volle Breite', setDetail],
    ['Telefon', phone],
  ];
  for (const [title, fn] of pruefungen) await t.test(title, () => fn(t, a, name));
});
