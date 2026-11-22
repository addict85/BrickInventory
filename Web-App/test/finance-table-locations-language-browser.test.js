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
 *   E  loadLocations() fills the select from /v1/storage again → red:
 *      “new storage location …”
 *   F  the listener on spracheGewechselt in konten-orte.js deleted → red:
 *      “language switch …” (afterwards also the two following ones, the page stays
 *      English)
 *   G  data-i18n-aria not evaluated → red: the same three
 *   H  reportHits() deleted in renderGallery → red: “hit count …”
 *   I  the owner line deleted in the set detail → red: “set detail names …”
 *   K  .knopf-fuellend back to flex:1 → red: “wishlist item dialog …” (text
 *      wider than the button)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startApp, warte } = require('./helpers/app-browser');
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
    bestand: async (db, uid) => {
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
      await holdsSet(db, kid, '75313-1', 1, { preis: 700 });
    },
  });
  if (app.grund) {
    t.skip(app.grund);
    return;
  }
  const { b, bis, ruhig } = app;
  // Startup loads settings and prices afterwards; only then is the state fixed.
  await ruhig();
  const geh = async pfad => {
    await b.auswerten(`location.hash = '#/${pfad}'; true`);
    await warte(400);
  };
  const groesse = async (w, h = 900) => {
    await b.tab('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await warte(400);
  };
  const receipt = async name => {
    if (!process.env.BELEG_ORDNER) return;
    const { data } = await b.tab('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.mkdirSync(process.env.BELEG_ORDNER, { recursive: true });
    fs.writeFileSync(path.join(process.env.BELEG_ORDNER, `${name}.png`), Buffer.from(data, 'base64'));
  };
  const sprache = async l => {
    await b.auswerten(
      `(() => { const s = document.getElementById('lang-select'); s.value = '${l}'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
    );
    await bis(`document.documentElement.lang === '${l}'`, `Sprache ${l}`);
    await ruhig();
  };

  await geh('finanzen');
  await bis(
    `document.querySelectorAll('[data-fin-art="sets"] tbody tr').length >= 4 && document.getElementById('fin-sum').dataset.geladen === '1'`,
    'Finanztabelle',
  );

  await t.test('finance table without horizontal scrolling at 683, 820, 1024 and 1280 px', async () => {
    const fehler = [];
    for (const w of [683, 820, 1024, 1280]) {
      await groesse(w, w === 683 ? 450 : 900);
      await b.auswerten(`document.querySelector('[data-fin-art="sets"]').scrollIntoView(); true`);
      await receipt(`finanzen-${w}`);
      const m = await b.auswerten(`(() => {
        const tw = document.querySelector('[data-fin-art="sets"]'), stand = [...tw.querySelectorAll('thead th')].filter(th => th.getBoundingClientRect().width > 0).pop();
        const wert = [...tw.querySelectorAll('thead th')].find(th => /Marktwert/.test(th.textContent));
        return { seite: document.documentElement.scrollWidth, fenster: innerWidth, rollt: tw.scrollWidth - tw.clientWidth,
                 stand: Math.round(stand.getBoundingClientRect().right), wert: Math.round(wert.getBoundingClientRect().right),
                 rand: Math.round(tw.getBoundingClientRect().right) }; })()`);
      if (m.seite > m.fenster) fehler.push(`${w}: Seite ${m.seite} px breit`);
      if (m.rollt > 1) fehler.push(`${w}: Tabelle rollt ${m.rollt} px`);
      if (m.stand > m.rand + 1 || m.wert > m.rand + 1)
        fehler.push(`${w}: Stand/Marktwert bei ${m.stand}/${m.wert}, Rand ${m.rand}`);
    }
    assert.deepEqual(fehler, []);
    await groesse(1280);
  });

  await t.test('number format: a German account in EUR writes 1.234,56 €', async () => {
    const einstand = await b.auswerten(text('#fin-einstand'));
    assert.match(einstand.replace(/ /g, ' '), /^\d{1,3}(\.\d{3})*,\d{2} €$/, einstand);
    assert.equal(
      await b.auswerten(`navigator.language.startsWith('de-')`),
      false,
      'Vorbedingung: Browser ohne deutsche Region',
    );
  });

  await t.test('foreign currency and tile: purchase price in ARS visible, market value named', async () => {
    const zelle =
      await b.auswerten(`(() => { const tr = [...document.querySelectorAll('[data-fin-art="sets"] tbody tr')].find(r => r.textContent.includes('Galaxy Explorer'));
      return tr.querySelector('td.price-cell').textContent.replace(/\\s+/g, ' ').trim(); })()`);
    assert.match(zelle, /99,99\sARS.*nicht umgerechnet/);
    assert.equal(await b.auswerten(text('#fin-wert-titel')), 'Marktwert (bewertete Positionen)');
    assert.match(await b.auswerten(text('#fin-wert-sub')), /^Gesamter Marktwert: .+ €$/);
    // Missing values look the same: dash with screen reader text, nowhere “Preis fehlt” as visible text.
    const sichtbar = await b.auswerten(`[...document.querySelectorAll('#fin-tbl td')].filter(td => {
      const k = td.cloneNode(true); k.querySelectorAll('.vh').forEach(v => v.remove()); return /Preis fehlt/.test(k.textContent); }).length`);
    assert.equal(sichtbar, 0);
  });

  await t.test('a new storage location is available when capturing, the filter only shows occupied ones', async () => {
    await geh('lagerorte');
    await bis(
      `!!document.getElementById('storage-new') && !!document.querySelector('#storage-list .lager-eingabe')`,
      'Lagerorte',
    );
    await b.auswerten(
      `document.getElementById('storage-new').value = 'Dachboden Kiste 3'; ${klick('[data-click="legeLagerortAn"]')}`,
    );
    await bis(
      `[...document.querySelectorAll('#storage-list .lager-eingabe')].some(e => e.value === 'Dachboden Kiste 3')`,
      'neuer Ort in der Liste',
    );
    // Without opening the dialog: opening it loads the stock itself and would hide what the page fills before.
    await geh('sammlung');
    await bis(
      `[...document.querySelectorAll('#add-storage-sel option')].some(o => o.value === 'Dachboden Kiste 3')`,
      'neuer Ort in der Auswahl',
    );
    const z =
      await b.auswerten(`({ auswahl: [...document.querySelectorAll('#add-storage-sel option')].map(o => o.value).filter(Boolean),
      filter: [...document.querySelectorAll('#storage-gallery option')].map(o => o.value).filter(Boolean) })`);
    assert.deepEqual(z.auswahl.slice().sort(), ['Dachboden Kiste 3', 'Regal Keller', 'Vitrine Wohnzimmer']);
    assert.deepEqual(z.filter, ['Vitrine Wohnzimmer']);
  });

  await t.test('a language change rebuilds generated select fields, aria-label and placeholders', async () => {
    const lies = `({ konto: document.querySelector('#scope-gallery option[value="all"]')?.textContent,
      ort: document.querySelector('#storage-gallery option[value=""]')?.textContent,
      kein: document.querySelector('#add-storage-sel option')?.textContent,
      neu: [...document.querySelectorAll('#add-storage-sel option')].pop()?.textContent,
      aria: document.getElementById('gs').getAttribute('aria-label'),
      preis: document.getElementById('add-price').getAttribute('placeholder') })`;
    await sprache('en');
    assert.deepEqual(await b.auswerten(lies), {
      konto: 'All accounts',
      ort: 'All locations',
      kein: '— no location —',
      neu: '＋ new location …',
      aria: 'Search sets',
      preis: 'e.g. 79.99',
    });
    await sprache('de');
    assert.deepEqual(await b.auswerten(lies), {
      konto: 'Alle Konten',
      ort: 'Alle Lagerorte',
      kein: '— kein Lagerort —',
      neu: '＋ neuer Lagerort …',
      aria: 'Sets suchen',
      preis: 'z. B. 79,99',
    });
  });

  await t.test('number of hits after the search in a live region', async () => {
    await geh('sammlung');
    const suche = async q => {
      // The search is debounced: the wait is for the change of the live region, at most 5 s.
      await b.auswerten(`new Promise(r => { const e = document.getElementById('treffer-live');
        const mo = new MutationObserver(() => { mo.disconnect(); r(true); });
        mo.observe(e, { childList: true, characterData: true, subtree: true }); setTimeout(() => r(false), 5000);
        const f = document.getElementById('gs'); f.value = ${JSON.stringify(q)}; f.dispatchEvent(new Event('input', { bubbles: true })); })`);
      await ruhig();
      return b.auswerten(text('#treffer-live'));
    };
    assert.deepEqual(
      await b.auswerten(
        `(() => { const e = document.getElementById('treffer-live'); return [e.getAttribute('role'), e.getAttribute('aria-live')]; })()`,
      ),
      ['status', 'polite'],
    );
    assert.equal(await suche('Titanic'), '1 Set gefunden');
    assert.equal(await suche('qxzqxz'), 'Keine Treffer für „qxzqxz“');
    await suche('');
  });

  await t.test('set detail names the account the set belongs to', async () => {
    await geh('sammlung/set/75313-1');
    await bis(
      `document.getElementById('set-modal').classList.contains('open') && !document.querySelector('#set-modal .skelett-zeile')`,
      'Set-Dialog',
    );
    assert.equal(await b.auswerten(text('#m-untertit')), `75313-1 · Konto: ${KIND}`);
    await b.auswerten(klick('#set-modal [data-click="closeModal"]'));
  });

  await t.test('wishlist item dialog: button texts fit into their buttons', async () => {
    await geh('merkliste');
    await bis(`!!document.querySelector('#mk-list .mk-zeile')`, 'Merkliste');
    await b.auswerten(klick('#mk-list .mk-zeile'));
    await bis(`document.getElementById('mk-detail-modal').classList.contains('open')`, 'Merkposten-Dialog');
    // The BrickLink button only appears with a catalog response; it is measured even without one.
    await b.auswerten(
      `document.getElementById('mk-m-bricklink').style.display = ''; document.getElementById('mk-m-vergleich').style.display = ''; true`,
    );
    await ruhig();
    const eng = await b.auswerten(
      `[...document.querySelectorAll('#mk-detail-modal .knopf-fuellend')].filter(k => k.scrollWidth > k.clientWidth + 1).map(k => k.textContent.trim())`,
    );
    assert.deepEqual(eng, []);
  });
});
