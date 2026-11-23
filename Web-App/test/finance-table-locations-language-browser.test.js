/**
 * Findings of UI review 16 in the real browser: finances table on the tablet and
 * at 200 % zoom, number format by account, foreign currency and tile, new
 * storage locations when adding, language switch including generated select fields,
 * aria-label and hit count for screen readers, owner in the set detail, buttons in …
 *
 * Counter-checks (measured 05.11.2026, each alone, bundle rebuilt):
 *   A  .tw without position:relative AND the media rule for 641–1100 px
 *      deleted → red: “finances table without sideways scrolling” (page 913,
 *      1034, 1050 px wide at 683, 820, 1024 px). A alone stays green: the
 *      tablet rule already makes the table fit.
 *   B  only the media rule deleted → red: the same check (the table
 *      scrolls in its box, “Stand” lies outside)
 *   C  locale() again with fallback 'de-CH' → red: “number format …”,
 *      “foreign currency …” and “language switch …” (placeholder “z. B. 79.99”)
 *   D  einstandZelle() without the branch for kaufpreis_original → red:
 *      “foreign currency and tile …”
 *   E  loadLocations() fills the select from /v2/storage again → red:
 *      “new storage location …”
 *   F  the listener on languageChanged in konten-orte.js deleted → red:
 *      “language switch …” (afterwards also the two following ones, the page stays
 *      English)
 *   G  data-i18n-aria not evaluated → red: the same three
 *   H  reportHits() deleted in renderGallery → red: “hit count …”
 *   I  the owner line deleted in the set detail → red: “set detail names …”
 *   K  .button-filled back to flex:1 → red: “wishlist item dialog …” (text
 *      wider than the button)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startApp, sleep } = require('./helpers/app-browser');
const { patternHousehold, holdsSet, catalogSet } = require('./helpers/inventory');

const klick = sel => `document.querySelector(${JSON.stringify(sel)})?.click(); true`;
const text = sel => `(document.querySelector(${JSON.stringify(sel)})?.textContent || '').replace(/\\s+/g, ' ').trim()`;

test('finance table, storage locations, number format, screen reader', {
  concurrency: 1,
  timeout: 300_000,
}, async t => {
  const NAME = `r16_${process.pid}`,
    KIND = `${NAME}_kind`;
  const app = await startApp(t, {
    name: NAME,
    holding: async (db, uid) => {
      const kid = await patternHousehold(db, uid);
      // Occupied: Vitrine; empty: Regal Keller (patternCollection). A purchase in ARS with market price: for ARS
      // the ECB publishes no rate, not even in CI with network.
      const vitrine = (
        await db.get(`INSERT INTO storage_locations (user_id, name) VALUES ($1, 'Vitrine Wohnzimmer') RETURNING id`, [
          uid,
        ])
      ).id;
      await db.run(`UPDATE sets SET storage_id = $2 WHERE user_id = $1 AND set_number = '10294-1'`, [uid, vitrine]);
      await catalogSet(db, '10497-1', { name: 'Galaxy Explorer', year: 2022, theme: 'Icons', pieces: 1254 });
      await db.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '10497-1')`, [uid]);
      await db.run(
        `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, currency)
                  VALUES ($1, '10497-1', 1, 99.99, 'N', 'ARS')`,
        [uid],
      );
      await db.run(`INSERT INTO price_cache (set_number, condition, currency_code, min_price, avg_price, max_price, qty_avg_price, total_quantity, fetched_at)
                  VALUES ('10497-1', 'N', 'EUR', 80, 90, 100, 90, 5, NOW()) ON CONFLICT (set_number, condition, currency_code) DO UPDATE SET avg_price = 90`);
      // Only for the sub-account: the set detail should name the owner.
      await catalogSet(db, '75313-1', { name: 'AT-AT', year: 2021, theme: 'Star Wars', pieces: 6785 });
      await holdsSet(db, kid, '75313-1', 1, { price: 700 });
    },
  });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, until, settle } = app;
  // Startup loads settings and prices afterwards; only then is the state fixed.
  await settle();
  const geh = async path => {
    await b.evaluate(`location.hash = '#/${path}'; true`);
    await sleep(400);
  };
  const size = async (w, h = 900) => {
    await b.tab('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
  };
  const receipt = async name => {
    if (!process.env.RECEIPT_DIR) return;
    const { data } = await b.tab('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.mkdirSync(process.env.RECEIPT_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.RECEIPT_DIR, `${name}.png`), Buffer.from(data, 'base64'));
  };
  const language = async l => {
    await b.evaluate(
      `(() => { const s = document.getElementById('lang-select'); s.value = '${l}'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
    );
    await until(`document.documentElement.lang === '${l}'`, `Language ${l}`);
    await settle();
  };

  await geh('finanzen');
  await until(
    `document.querySelectorAll('[data-fin-kind="sets"] tbody tr').length >= 4 && document.getElementById('fin-sum').dataset.loaded === '1'`,
    'Finanztabelle',
  );

  await t.test('finance table without horizontal scrolling at 683, 820, 1024 and 1280 px', async () => {
    const error = [];
    for (const w of [683, 820, 1024, 1280]) {
      await size(w, w === 683 ? 450 : 900);
      await b.evaluate(`document.querySelector('[data-fin-kind="sets"]').scrollIntoView(); true`);
      await receipt(`finanzen-${w}`);
      const m = await b.evaluate(`(() => {
        const tw = document.querySelector('[data-fin-kind="sets"]'), state = [...tw.querySelectorAll('thead th')].filter(th => th.getBoundingClientRect().width > 0).pop();
        const wert = [...tw.querySelectorAll('thead th')].find(th => /Marktwert/.test(th.textContent));
        return { page: document.documentElement.scrollWidth, win: innerWidth, rollt: tw.scrollWidth - tw.clientWidth,
                 state: Math.round(state.getBoundingClientRect().right), wert: Math.round(wert.getBoundingClientRect().right),
                 rand: Math.round(tw.getBoundingClientRect().right) }; })()`);
      if (m.page > m.win) error.push(`${w}: Seite ${m.page} px breit`);
      if (m.rollt > 1) error.push(`${w}: Tabelle rollt ${m.rollt} px`);
      if (m.state > m.rand + 1 || m.wert > m.rand + 1)
        error.push(`${w}: Stand/Marktwert bei ${m.state}/${m.wert}, Rand ${m.rand}`);
    }
    assert.deepEqual(error, []);
    await size(1280);
  });

  await t.test('number format: a German account in EUR writes 1.234,56 €', async () => {
    const entryPrice = await b.evaluate(text('#fin-cost-basis'));
    assert.match(entryPrice.replace(/ /g, ' '), /^\d{1,3}(\.\d{3})*,\d{2} €$/, entryPrice);
    assert.equal(
      await b.evaluate(`navigator.language.startsWith('de-')`),
      false,
      'Precondition: browser without a German region',
    );
  });

  await t.test('foreign currency and tile: purchase price in ARS visible, market value named', async () => {
    const cell =
      await b.evaluate(`(() => { const tr = [...document.querySelectorAll('[data-fin-kind="sets"] tbody tr')].find(r => r.textContent.includes('Galaxy Explorer'));
      return tr.querySelector('td.price-cell').textContent.replace(/\\s+/g, ' ').trim(); })()`);
    assert.match(cell, /99,99\sARS.*nicht umgerechnet/);
    assert.equal(await b.evaluate(text('#fin-value-title')), 'Marktwert (bewertete Positionen)');
    assert.match(await b.evaluate(text('#fin-value-sub')), /^Gesamter Marktwert: .+ €$/);
    // Missing values look the same: dash with screen reader text, nowhere “Preis fehlt” as visible text.
    const visible = await b.evaluate(`[...document.querySelectorAll('#fin-tbl td')].filter(td => {
      const k = td.cloneNode(true); k.querySelectorAll('.vh').forEach(v => v.remove()); return /Preis fehlt/.test(k.textContent); }).length`);
    assert.equal(visible, 0);
  });

  await t.test('a new storage location is available when capturing, the filter only shows occupied ones', async () => {
    await geh('lagerorte');
    await until(
      `!!document.getElementById('storage-new') && !!document.querySelector('#storage-list .location-input')`,
      'Storage locations',
    );
    await b.evaluate(
      `document.getElementById('storage-new').value = 'Dachboden Kiste 3'; ${klick('[data-click="createLocation"]')}`,
    );
    await until(
      `[...document.querySelectorAll('#storage-list .location-input')].some(e => e.value === 'Dachboden Kiste 3')`,
      'new location in the list',
    );
    // Without opening the dialog: opening it loads the stock itself and would hide what the page fills before.
    await geh('sammlung');
    await until(
      `[...document.querySelectorAll('#add-storage-sel option')].some(o => o.value === 'Dachboden Kiste 3')`,
      'new location in the selection',
    );
    const z =
      await b.evaluate(`({ selection: [...document.querySelectorAll('#add-storage-sel option')].map(o => o.value).filter(Boolean),
      filter: [...document.querySelectorAll('#storage-gallery option')].map(o => o.value).filter(Boolean) })`);
    assert.deepEqual(z.selection.slice().sort(), ['Dachboden Kiste 3', 'Regal Keller', 'Vitrine Wohnzimmer']);
    assert.deepEqual(z.filter, ['Vitrine Wohnzimmer']);
  });

  await t.test('a language change rebuilds generated select fields, aria-label and placeholders', async () => {
    const read = `({ konto: document.querySelector('#scope-gallery option[value="all"]')?.textContent,
      place: document.querySelector('#storage-gallery option[value=""]')?.textContent,
      none: document.querySelector('#add-storage-sel option')?.textContent,
      fresh: [...document.querySelectorAll('#add-storage-sel option')].pop()?.textContent,
      aria: document.getElementById('gs').getAttribute('aria-label'),
      price: document.getElementById('add-price').getAttribute('placeholder') })`;
    await language('en');
    assert.deepEqual(await b.evaluate(read), {
      konto: 'All accounts',
      place: 'All locations',
      none: '— no location —',
      fresh: '＋ new location …',
      aria: 'Search sets',
      price: 'e.g. 79.99',
    });
    await language('de');
    assert.deepEqual(await b.evaluate(read), {
      konto: 'Alle Konten',
      place: 'Alle Lagerorte',
      none: '— kein Lagerort —',
      fresh: '＋ neuer Lagerort …',
      aria: 'Sets suchen',
      price: 'z. B. 79,99',
    });
  });

  await t.test('number of hits after the search in a live region', async () => {
    await geh('sammlung');
    const search = async q => {
      // The search is debounced: the wait is for the change of the live region, at most 5 s.
      await b.evaluate(`new Promise(r => { const e = document.getElementById('match-live');
        const mo = new MutationObserver(() => { mo.disconnect(); r(true); });
        mo.observe(e, { childList: true, characterData: true, subtree: true }); setTimeout(() => r(false), 5000);
        const f = document.getElementById('gs'); f.value = ${JSON.stringify(q)}; f.dispatchEvent(new Event('input', { bubbles: true })); })`);
      await settle();
      return b.evaluate(text('#match-live'));
    };
    assert.deepEqual(
      await b.evaluate(
        `(() => { const e = document.getElementById('match-live'); return [e.getAttribute('role'), e.getAttribute('aria-live')]; })()`,
      ),
      ['status', 'polite'],
    );
    assert.equal(await search('Titanic'), '1 Set gefunden');
    assert.equal(await search('qxzqxz'), 'Keine Treffer für „qxzqxz“');
    await search('');
  });

  await t.test('set detail names the account the set belongs to', async () => {
    await geh('sammlung/set/75313-1');
    await until(
      `document.getElementById('set-modal').classList.contains('open') && !document.querySelector('#set-modal .skeleton-row')`,
      'Set-Dialog',
    );
    assert.equal(await b.evaluate(text('#m-subtitle')), `75313-1 · Konto: ${KIND}`);
    await b.evaluate(klick('#set-modal [data-click="closeModal"]'));
  });

  await t.test('wishlist item dialog: button texts fit into their buttons', async () => {
    await geh('merkliste');
    await until(`!!document.querySelector('#mk-list .mk-row')`, 'Wishlist');
    await b.evaluate(klick('#mk-list .mk-row'));
    await until(`document.getElementById('mk-detail-modal').classList.contains('open')`, 'Merkposten-Dialog');
    // The BrickLink button only appears with a catalog response; it is measured even without one.
    await b.evaluate(
      `document.getElementById('mk-m-bricklink').style.display = ''; document.getElementById('mk-m-comparison').style.display = ''; true`,
    );
    await settle();
    const eng = await b.evaluate(
      `[...document.querySelectorAll('#mk-detail-modal .button-filled')].filter(k => k.scrollWidth > k.clientWidth + 1).map(k => k.textContent.trim())`,
    );
    assert.deepEqual(eng, []);
  });
});
