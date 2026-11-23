/**
 * Dimensions of the UI, measured in Chrome on the real app.
 *
 * Counter-checks (measured on 29.10.2026):
 *   A  .fval again `overflow-wrap: anywhere` instead of nowrap/clamp and the
 *      420 px rule removed → red: „Telefon: Beträge in einer Zeile“
 *   B  the two space rules (.man-tile:has(> .ca), .mk-row) removed from
 *      mobile.css → red: „Telefon: Löschknopf verdeckt nichts“
 *   C  the phone rule again `grid-template-columns: 1fr` → red: „Stein:
 *      Kennzahlen kompakt“ (4 rows; 30.10.2026)
 *   D  noppe nav .ntab again var(--b100) → red: „Noppe: untere Leiste“ (3.74:1)
 *   E  .ntab:focus-visible removed → red: „Rechner: Fokusring innen“
 *   F  `.dt-fin .number{text-align:right}` removed → red: „Rechner: Zahlen
 *      rechtsbündig“
 *   G  .capture-grid removed → red: „Rechner: Set hinzufügen bündig“
 *
 * Without Chrome (CHROME_BIN, google-chrome, chromium) it is skipped.
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, sleep } = require('./helpers/app-browser');
const { holdsSet, holdsPart } = require('./helpers/inventory');

/** Contrast of two CSS colors (rgb[a]) in the browser. */
const CONTRAST = `(front, back) => { const f = s => (s.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
  const l = ([r, g, b]) => { const c = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b); };
  const [a, b] = [l(f(front)), l(f(back))].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05); }`;

test('UI dimensions', { concurrency: 1, timeout: 300_000 }, async t => {
  const app = await startApp(t, {
    name: `mass_${process.pid}`,
    allDesigns: true,
    phone: true,
    holding: async (db, uid) => {
      await holdsSet(db, uid, '10294-1', 1, { price: 4894.77 });
      await db
        .run(`INSERT INTO price_cache (set_number, condition, currency_code, min_price, avg_price, max_price, qty_avg_price, total_quantity, fetched_at)
                    VALUES ('10294-1', 'N', 'EUR', 4005.5, 5002.2, 6295.5, 5000, 10, NOW())
                    ON CONFLICT DO NOTHING`)
        .catch(() => {});
      await holdsPart(db, uid, '3001', { colorId: 4, quantity: 250, price: 0.12 });
      await db.run(
        `INSERT INTO wanted (user_id, set_number, condition) VALUES ($1, '10276-1', 'N') ON CONFLICT DO NOTHING`,
        [uid],
      );
    },
  });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, until, settle } = app;
  const switchTab = async name => {
    await b.evaluate(`document.querySelector('.ntab[data-tab="${name}"]').click(); true`);
    await sleep(500);
  };
  const size = async (w, h, mobileView) => {
    await b.tab('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: mobileView ? 2 : 1,
      mobile: mobileView,
    });
    await until(`innerWidth === ${w}`, 'Fensterbreite');
    await settle();
  };

  // Without a Rebrickable key the app jumps into the settings shortly after the start;
  // only switch the tab afterwards.
  await settle();

  await t.test('phone: amounts in one line', async () => {
    await switchTab('finance');
    const visible = await b.evaluate(
      `[...document.querySelectorAll('#fin-sum .fval')].filter(e => e.getClientRects().length && e.getBoundingClientRect().width > 0).length`,
    );
    assert.ok(visible >= 2, `only ${visible} tiles visible`);
    await until(
      `!document.getElementById('fin-sum').hasAttribute('aria-busy') && /\\d/.test(document.getElementById('fin-cost-basis').textContent)`,
      'Finanzkacheln',
    );
    const error =
      await b.evaluate(`[...document.querySelectorAll('#fin-sum .fval')].filter(e => e.getClientRects().length).map(e => {
      const r = document.createRange(); r.selectNodeContents(e);
      const lines = new Set([...r.getClientRects()].map(q => Math.round(q.top))).size;
      const tile = e.closest('.fstat').getBoundingClientRect(), text = r.getBoundingClientRect();
      return (lines > 1 || text.right > tile.right + 0.5) ? e.id + ': ' + lines + ' Zeilen, „' + e.textContent.trim() + '“' : null; }).filter(Boolean)`);
    assert.deepEqual(error, []);
  });

  await t.test('phone: delete button covers nothing', async () => {
    const over = (a, b) => `(() => { const k = ${a}, z = ${b}; if (!k || !z) return 'fehlt';
      const p = k.getBoundingClientRect(), q = z.getBoundingClientRect();
      const x = Math.max(0, Math.min(p.right, q.right) - Math.max(p.left, q.left)), y = Math.max(0, Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top));
      return Math.round(x * y); })()`;
    await switchTab('parts');
    await until(
      `!!document.querySelector('#manual-parts-list .man-tile .delbtn, .man-tile .delbtn')`,
      'manuelle Kachel',
    );
    const part = await b.evaluate(
      over(`document.querySelector('.man-tile .delbtn')`, `document.querySelector('.man-tile .man-tile-img')`),
    );
    await switchTab('wanted');
    await until(`!!document.querySelector('.mk-row .delbtn')`, 'Merklistenzeile');
    const wish = await b.evaluate(
      over(`document.querySelector('.mk-row .delbtn')`, `document.querySelector('.mk-row .mk-price')`),
    );
    assert.deepEqual({ teil: part, wish }, { teil: 0, wish: 0 }, 'covered area in px²');
  });

  await t.test('Stein: key figures compact', async () => {
    await b.evaluate(`document.documentElement.setAttribute('data-theme', 'brick'); true`);
    await switchTab('gallery');
    const m = await b.evaluate(`(() => {
      const k = [...document.querySelectorAll('#tab-gallery .bstat')].map(e => Math.round(e.getBoundingClientRect().top));
      const r = document.querySelector('#tab-gallery .brick-stats');
      return { rows: new Set(k).size, height: Math.round(r.getBoundingClientRect().height), rollt: r.scrollWidth > r.clientWidth + 1 }; })()`);
    await b.evaluate(`document.documentElement.setAttribute('data-theme', 'classic'); true`);
    assert.ok(m.rows <= 2, `metrics in ${m.rows} rows`);
    assert.equal(m.rollt, false, 'metrics scroll horizontally');
    assert.ok(m.height <= 140, `metrics ${m.height} px high`);
  });

  await t.test('Noppe: bottom bar at least 4.5:1', async () => {
    await b.evaluate(`document.documentElement.setAttribute('data-theme', 'noppe'); true`);
    await settle();
    const values = await b.evaluate(`(() => { const k = ${CONTRAST};
      const nav = getComputedStyle(document.querySelector('nav')).backgroundColor;
      return [...document.querySelectorAll('nav .ntab:not(.active)')].filter(e => e.getClientRects().length)
        .map(e => Math.round(k(getComputedStyle(e).color, nav) * 100) / 100); })()`);
    await b.evaluate(`document.documentElement.setAttribute('data-theme', 'classic'); true`);
    assert.ok(values.length >= 3, `nur ${values.length} Reiter`);
    assert.ok(Math.min(...values) >= 4.5, `Kontraste: ${values}`);
  });

  await size(1280, 900, false);

  await t.test('desktop: focus ring inside', async () => {
    await switchTab('gallery');
    // The setup wizard of the new admin would hold on to the focus.
    await b.evaluate(`document.querySelector('#setup-modal.open [data-click="setupLater"]')?.click(); true`);
    await settle();
    // With the keyboard to the first tab: only then does :focus-visible apply.
    await b.evaluate(`document.activeElement?.blur(); document.querySelector('.skip-link').focus(); true`);
    const route = [];
    for (let i = 0; i < 25; i++) {
      route.push(
        await b.evaluate(`(document.activeElement?.tagName || '') + '.' + (document.activeElement?.className || '')`),
      );
      if (await b.evaluate(`!!document.activeElement?.classList.contains('ntab')`)) break;
      await b.tab('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    }
    const ring = await b.evaluate(`(() => { const e = document.activeElement, s = getComputedStyle(e);
      return { switchTab: e.classList.contains('ntab'), width: parseFloat(s.outlineWidth), abstand: parseFloat(s.outlineOffset), style: s.outlineStyle }; })()`);
    assert.equal(ring.switchTab, true, `Tab reaches no tab: ${route.join(' → ')}`);
    assert.ok(ring.style !== 'none' && ring.width >= 2, `no ring: ${JSON.stringify(ring)}`);
    assert.ok(ring.abstand + ring.width <= 0, `the ring sticks out ${ring.abstand + ring.width} px and is clipped`);
  });

  await t.test('desktop: numbers right-aligned', async () => {
    await switchTab('finance');
    await until(`!!document.querySelector('#fin-tbl .dt-fin td.price-total')`, 'Finanztabelle');
    const links =
      await b.evaluate(`[...document.querySelectorAll('#fin-tbl .dt-fin')][0].querySelectorAll('th.number, td.number').length === 0 ? ['keine Zahlenspalten'] :
      [...document.querySelector('#fin-tbl .dt-fin').querySelectorAll('th.number, td.number')]
        .filter(e => getComputedStyle(e).textAlign !== 'right').map(e => e.tagName + ' ' + e.textContent.trim().slice(0, 15))`);
    assert.deepEqual(links, []);
  });

  await t.test('desktop: add set aligned', async () => {
    await switchTab('gallery');
    await b.evaluate(`document.querySelector('button[data-click="openCapture"][data-arg="set"]').click(); true`);
    await settle();
    const m = await b.evaluate(`(() => { const r = e => e.getBoundingClientRect();
      const fields = ['add-num', 'add-qty', 'add-price', 'add-condition'].map(id => document.getElementById(id));
      const labels = fields.map(f => document.querySelector('label[for="' + f.id + '"]'));
      const raster = r(document.querySelector('#add-set-modal .capture-grid') || document.getElementById('add-num').closest('.frow'));
      const button = r(document.getElementById('btn-add'));
      return { zeile1: Math.abs(r(labels[0]).top - r(labels[1]).top) < 1, zeile2: Math.abs(r(labels[2]).top - r(labels[3]).top) < 1,
               buendig: fields.every((f, i) => Math.abs(r(f).left - r(labels[i]).left) < 1),
               columns: Math.abs(r(fields[0]).left - r(fields[2]).left) < 1 && Math.abs(r(fields[1]).left - r(fields[3]).left) < 1,
               buttonRight: Math.abs(button.right - raster.right) < 1 }; })()`);
    await b.evaluate(`document.querySelector('#add-set-modal [data-click="closeCapture"]').click(); true`);
    assert.deepEqual(m, { zeile1: true, zeile2: true, buendig: true, columns: true, buttonRight: true });
  });

  await t.test('desktop: account with limited width', async () => {
    await b.evaluate(`document.querySelector('.umenu-item[data-arg="profile"]').click(); true`);
    await settle();
    const width = await b.evaluate(
      `Math.round(document.getElementById('profile-settings-card').getBoundingClientRect().width)`,
    );
    assert.ok(width > 300 && width <= 52 * 16, `Konto-Karte ${width} px breit`);
  });
});
