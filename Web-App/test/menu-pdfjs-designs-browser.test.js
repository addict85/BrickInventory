/**
 * UX check 12.11.2026 in Chrome with a real server: menu groups without an axe finding;
 * PDF.js only with the first PDF; only the active theme loads, a switch loads afterwards
 * and only then switches, the server releases it in the HTML; finances without
 * positions without a search field; wishlist collapsed only title height; login with
 * exactly one h1 that is not the logo.
 *
 * Counter-checks (measured 12.11.2026, each on its own, bundle rebuilt):
 *   A  .umenu-group-title with color:#ddd → red: “menu” (axe color-contrast)
 *   B  <template id="pdfjs-source"> again as <script type="module"> → red:
 *      “PDF.js only with the first PDF” (pdf.min.mjs already at the start)
 *   C  in index.html the theme links again outside of the template → red:
 *      “themes” (all files at the start); releaseThemeStyles() not called in
 *      startPageHtml → red: same place (not released after reloading);
 *      in theme-boot.js applier without waiting → red: same place (switched
 *      before the stylesheets were there)
 *   D  .fin-search-row removed from the rule for #tab-finance.finanzen-leer →
 *      red: “finances without positions”
 *   E  `.wanted-box:not([open]){padding-block:.5rem}` removed → red:
 *      “wishlist on the phone” (86 px with a 44 px title)
 *   F  the logo of the login again as <h1> → red: “login” (two h1)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startApp } = require('./helpers/app-browser');
const { patternCollection } = require('./helpers/inventory');
const { AXE } = require('./helpers/layout-measurement');

const PDF =
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 400]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';
const LEER = { success: true, currency: 'EUR', total_value: '0', sets: [], parts: [], figs: [], total: 0 };
const geladen =
  teil => `performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes(${JSON.stringify(teil)}))
  .map(n => new URL(n).pathname)`;

test('menu, PDF.js, themes, empty states, login', { timeout: 300_000 }, async t => {
  const a = await startApp(t, {
    name: `uxr_${process.pid}`,
    bestand: patternCollection,
    intercept: [
      { muster: '*finance/*valuation*', contains: '/finance/valuation', antwort: { ...LEER, totals: {} } },
      { muster: '*finance/*valuation*', contains: '/finance/parts-valuation', antwort: LEER },
      { muster: '*finance/*valuation*', contains: '/finance/minifigs-valuation', antwort: LEER },
    ],
  });
  if (a.grund) {
    t.skip(a.grund);
    return;
  }
  const { b, bis, ruhig } = a;
  t.after(() =>
    fs.rmSync(path.join(__dirname, '..', 'data', 'uploads', String(a.uid)), { recursive: true, force: true }),
  );
  await ruhig();
  await b.auswerten(`document.querySelector('#setup-modal.open [data-click="setupLater"]')?.click(); true`);

  await t.test('menu: groups without an axe finding', async () => {
    await b.auswerten(`document.getElementById('btn-umenu').click(); true`);
    await bis(`document.getElementById('umenu-pop').style.display === 'block'`, 'Menü offen');
    const funde = await b.auswerten(`(async () => {
      if (!window.axe) (0, eval)(${JSON.stringify(AXE)});
      const r = await axe.run(document.getElementById('umenu-pop'), { resultTypes: ['violations'] });
      return r.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).join(', ')); })()`);
    assert.deepEqual(funde, []);
    const titel = await b.auswerten(
      `[...document.querySelectorAll('#umenu-pop .umenu-group-title')].filter(e => e.getClientRects().length).map(e => e.textContent.trim())`,
    );
    assert.equal(titel.length, 3, JSON.stringify(titel));
    await b.auswerten(`document.getElementById('btn-umenu').click(); true`);
  });

  await t.test('PDF.js only with the first PDF', async () => {
    assert.deepEqual(await b.auswerten(geladen('/vendor/pdfjs/')), [], 'beim Start geladen');
    await b.auswerten(
      `document.querySelector('.ntab[data-tab="gallery"]').click(); document.querySelector('#gallery [data-click="openModal"]').click(); true`,
    );
    await bis(`!!document.getElementById('instr-file')`, 'Set-Detail');
    await b.auswerten(`(() => { const f = document.getElementById('instr-file');
      const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(PDF)}], 'anleitung.pdf', { type: 'application/pdf' }));
      f.files = dt.files; f.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await bis(`!!document.querySelector('#set-modal [data-click="openPdfViewerLink"]')`, 'Anleitung hochgeladen');
    await b.auswerten(`document.querySelector('#set-modal [data-click="openPdfViewerLink"]').click(); true`);
    await bis(`document.querySelectorAll('#pdf-viewer-pages [role="img"]').length === 1`, 'Seite gezeichnet', 200);
    assert.deepEqual((await b.auswerten(geladen('/vendor/pdfjs/pdf.min.mjs'))).length, 1);
    await b.auswerten(`document.querySelector('#pdf-viewer-modal [data-click="closePdfViewer"]')?.click();
      document.querySelector('#set-modal [data-click="closeModal"]')?.click(); true`);
  });

  await t.test('finances without positions: no search field', async () => {
    await b.auswerten(`document.querySelector('.ntab[data-tab="finance"]').click(); true`);
    await bis(`document.getElementById('tab-finance').classList.contains('finances-empty')`, 'Finanzen leer');
    assert.equal(await b.auswerten(`document.getElementById('fin-search').getClientRects().length`), 0);
  });

  await t.test('wishlist on the phone: collapsed not taller than the title', async () => {
    await b.tab('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await b.auswerten(
      `document.querySelector('.ntab[data-tab="wanted"]').click(); document.getElementById('mk-box').open = false; true`,
    );
    await bis(`document.getElementById('tab-wanted').classList.contains('active')`, 'Merkliste');
    const m = await b.auswerten(`(() => { const k = document.getElementById('mk-box'), s = k.querySelector('summary');
      return { kasten: k.getBoundingClientRect().height, titel: s.getBoundingClientRect().height }; })()`);
    assert.ok(m.kasten <= m.titel + 20, `zugeklappt ${m.kasten} px bei ${m.titel} px Titel`);
    await b.tab('Emulation.clearDeviceMetricsOverride');
  });

  await t.test('themes: only the active one, switching without reloading', async () => {
    const dateien = d => ({ classic: [], hochglanz: ['noppe', 'hochglanz'] })[d] ?? [d];
    const start = await b.auswerten(`document.documentElement.dataset.theme`);
    const erwartet = dateien(start).map(d => `/themes/${d}.css`);
    assert.deepEqual((await b.auswerten(geladen('/themes/'))).sort(), erwartet.sort(), `Design ${start}`);

    await b.auswerten(
      `window.__keinNeuladen = 1; document.querySelector('[data-click="openView"][data-arg="profile"]').click(); true`,
    );
    await bis(`!!document.getElementById('design-choice')?.options.length`, 'Designwahl');
    // When switching, the stylesheet must already carry rules.
    await b.auswerten(`window.__beimUmschalten = null;
      new MutationObserver((_, mo) => { if (document.documentElement.dataset.theme !== 'hochglanz') return;
        window.__beimUmschalten = [...document.styleSheets].filter(s => /themes\\/(noppe|hochglanz)\\.css/.test(s.href || '') && s.cssRules.length).length;
        mo.disconnect(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      const s = document.getElementById('design-choice'); s.value = 'hochglanz'; s.dispatchEvent(new Event('change', { bubbles: true })); true`);
    await bis(`document.documentElement.dataset.theme === 'hochglanz'`, 'umgeschaltet');
    assert.equal(await b.auswerten(`window.__keinNeuladen`), 1, 'neu geladen');
    assert.equal(await b.auswerten(`window.__beimUmschalten`), 2, 'umgeschaltet, bevor die Stylesheets da waren');

    await b.tab('Page.reload');
    await bis(`document.getElementById('app')?.style.display === 'block'`, 'neu geladen', 300);
    assert.equal(await b.auswerten(`document.documentElement.dataset.theme`), 'hochglanz');
    assert.deepEqual((await b.auswerten(geladen('/themes/'))).sort(), ['/themes/hochglanz.css', '/themes/noppe.css']);
    // Released in the HTML, not only by the script: this way the stylesheet holds the first image like any other.
    const html = await b.auswerten(`fetch('/', { credentials: 'same-origin' }).then(r => r.text())`);
    const vorlage = html.indexOf('<template id="design-stile">');
    const place = d => html.indexOf(`href="/themes/${d}.css`);
    assert.ok(vorlage > 0, 'keine Vorlage');
    for (const d of ['noppe', 'hochglanz']) assert.ok(place(d) > 0 && place(d) < vorlage, `${d} nicht frei`);
    for (const d of ['brick', 'werkbank', 'farbfaecher']) assert.ok(place(d) > vorlage, `${d} frei`);
  });

  await t.test('login: one h1, not the logo', async () => {
    // Logging out reloads the page; the form then speaks the language of the browser.
    await b.tab('Network.setUserAgentOverride', {
      userAgent: await b.auswerten('navigator.userAgent'),
      acceptLanguage: 'de-DE',
    });
    await b.auswerten(`window.__alt = true; document.getElementById('btn-logout').click(); true`);
    await bis(
      `!window.__alt && getComputedStyle(document.getElementById('login-screen')).display !== 'none'`,
      'Anmeldemaske',
    );
    const h1 = await b.auswerten(
      `[...document.querySelectorAll('h1')].filter(h => h.getClientRects().length).map(h => h.textContent.trim())`,
    );
    assert.deepEqual(h1, ['Anmelden']);
    assert.equal(await b.auswerten(`document.querySelector('.llogo h1')`), null);
  });
});
