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
const EMPTY = { success: true, currency: 'EUR', total_value: '0', sets: [], parts: [], figs: [], total: 0 };
const loaded =
  part => `performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes(${JSON.stringify(part)}))
  .map(n => new URL(n).pathname)`;

test('menu, PDF.js, themes, empty states, login', { timeout: 300_000 }, async t => {
  const a = await startApp(t, {
    name: `uxr_${process.pid}`,
    holding: patternCollection,
    intercept: [
      { pattern: '*finance/*valuation*', contains: '/finance/valuation', response: { ...EMPTY, totals: {} } },
      { pattern: '*finance/*valuation*', contains: '/finance/parts-valuation', response: EMPTY },
      { pattern: '*finance/*valuation*', contains: '/finance/minifigs-valuation', response: EMPTY },
    ],
  });
  if (a.reason) {
    t.skip(a.reason);
    return;
  }
  const { b, until, settle } = a;
  t.after(() =>
    fs.rmSync(path.join(__dirname, '..', 'data', 'uploads', String(a.uid)), { recursive: true, force: true }),
  );
  await settle();
  await b.evaluate(`document.querySelector('#setup-modal.open [data-click="setupLater"]')?.click(); true`);

  await t.test('menu: groups without an axe finding', async () => {
    await b.evaluate(`document.getElementById('btn-umenu').click(); true`);
    await until(`document.getElementById('umenu-pop').style.display === 'block'`, 'Menü offen');
    const findings = await b.evaluate(`(async () => {
      if (!window.axe) (0, eval)(${JSON.stringify(AXE)});
      const r = await axe.run(document.getElementById('umenu-pop'), { resultTypes: ['violations'] });
      return r.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).join(', ')); })()`);
    assert.deepEqual(findings, []);
    const title = await b.evaluate(
      `[...document.querySelectorAll('#umenu-pop .umenu-group-title')].filter(e => e.getClientRects().length).map(e => e.textContent.trim())`,
    );
    assert.equal(title.length, 3, JSON.stringify(title));
    await b.evaluate(`document.getElementById('btn-umenu').click(); true`);
  });

  await t.test('PDF.js only with the first PDF', async () => {
    assert.deepEqual(await b.evaluate(loaded('/vendor/pdfjs/')), [], 'loaded at start');
    await b.evaluate(
      `document.querySelector('.ntab[data-tab="gallery"]').click(); document.querySelector('#gallery [data-click="openModal"]').click(); true`,
    );
    await until(`!!document.getElementById('instr-file')`, 'Set-Detail');
    await b.evaluate(`(() => { const f = document.getElementById('instr-file');
      const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(PDF)}], 'anleitung.pdf', { type: 'application/pdf' }));
      f.files = dt.files; f.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await until(`!!document.querySelector('#set-modal [data-click="openPdfViewerLink"]')`, 'Anleitung hochgeladen');
    await b.evaluate(`document.querySelector('#set-modal [data-click="openPdfViewerLink"]').click(); true`);
    await until(`document.querySelectorAll('#pdf-viewer-pages [role="img"]').length === 1`, 'Seite gezeichnet', 200);
    assert.deepEqual((await b.evaluate(loaded('/vendor/pdfjs/pdf.min.mjs'))).length, 1);
    await b.evaluate(`document.querySelector('#pdf-viewer-modal [data-click="closePdfViewer"]')?.click();
      document.querySelector('#set-modal [data-click="closeModal"]')?.click(); true`);
  });

  await t.test('finances without positions: no search field', async () => {
    await b.evaluate(`document.querySelector('.ntab[data-tab="finance"]').click(); true`);
    await until(`document.getElementById('tab-finance').classList.contains('finances-empty')`, 'Finanzen leer');
    assert.equal(await b.evaluate(`document.getElementById('fin-search').getClientRects().length`), 0);
  });

  await t.test('wishlist on the phone: collapsed not taller than the title', async () => {
    await b.tab('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await b.evaluate(
      `document.querySelector('.ntab[data-tab="wanted"]').click(); document.getElementById('mk-box').open = false; true`,
    );
    await until(`document.getElementById('tab-wanted').classList.contains('active')`, 'Merkliste');
    const m = await b.evaluate(`(() => { const k = document.getElementById('mk-box'), s = k.querySelector('summary');
      return { box: k.getBoundingClientRect().height, title: s.getBoundingClientRect().height }; })()`);
    assert.ok(m.box <= m.title + 20, `collapsed ${m.box} px with ${m.title} px title`);
    await b.tab('Emulation.clearDeviceMetricsOverride');
  });

  await t.test('themes: only the active one, switching without reloading', async () => {
    const files = d => ({ classic: [], hochglanz: ['noppe', 'hochglanz'] })[d] ?? [d];
    const start = await b.evaluate(`document.documentElement.dataset.theme`);
    const expected = files(start).map(d => `/themes/${d}.css`);
    assert.deepEqual((await b.evaluate(loaded('/themes/'))).sort(), expected.sort(), `Design ${start}`);

    await b.evaluate(
      `window.__keinNeuladen = 1; document.querySelector('[data-click="openView"][data-arg="profile"]').click(); true`,
    );
    await until(`!!document.getElementById('design-choice')?.options.length`, 'Designwahl');
    // When switching, the stylesheet must already carry rules.
    await b.evaluate(`window.__beimUmschalten = null;
      new MutationObserver((_, mo) => { if (document.documentElement.dataset.theme !== 'hochglanz') return;
        window.__beimUmschalten = [...document.styleSheets].filter(s => /themes\\/(noppe|hochglanz)\\.css/.test(s.href || '') && s.cssRules.length).length;
        mo.disconnect(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      const s = document.getElementById('design-choice'); s.value = 'hochglanz'; s.dispatchEvent(new Event('change', { bubbles: true })); true`);
    await until(`document.documentElement.dataset.theme === 'hochglanz'`, 'umgeschaltet');
    assert.equal(await b.evaluate(`window.__keinNeuladen`), 1, 'reloaded');
    assert.equal(await b.evaluate(`window.__beimUmschalten`), 2, 'switched before the stylesheets were there');

    await b.tab('Page.reload');
    await until(`document.getElementById('app')?.style.display === 'block'`, 'neu geladen', 300);
    assert.equal(await b.evaluate(`document.documentElement.dataset.theme`), 'hochglanz');
    assert.deepEqual((await b.evaluate(loaded('/themes/'))).sort(), ['/themes/hochglanz.css', '/themes/noppe.css']);
    // Released in the HTML, not only by the script: this way the stylesheet holds the first image like any other.
    const html = await b.evaluate(`fetch('/', { credentials: 'same-origin' }).then(r => r.text())`);
    const template = html.indexOf('<template id="theme-styles">');
    const place = d => html.indexOf(`href="/themes/${d}.css`);
    assert.ok(template > 0, 'no template');
    for (const d of ['noppe', 'hochglanz']) assert.ok(place(d) > 0 && place(d) < template, `${d} not free`);
    for (const d of ['brick', 'werkbank', 'farbfaecher']) assert.ok(place(d) > template, `${d} free`);
  });

  await t.test('login: one h1, not the logo', async () => {
    // Logging out reloads the page; the form then speaks the language of the browser.
    await b.tab('Network.setUserAgentOverride', {
      userAgent: await b.evaluate('navigator.userAgent'),
      acceptLanguage: 'de-DE',
    });
    await b.evaluate(`window.__alt = true; document.getElementById('btn-logout').click(); true`);
    await until(
      `!window.__alt && getComputedStyle(document.getElementById('login-screen')).display !== 'none'`,
      'Anmeldemaske',
    );
    const h1 = await b.evaluate(
      `[...document.querySelectorAll('h1')].filter(h => h.getClientRects().length).map(h => h.textContent.trim())`,
    );
    assert.deepEqual(h1, ['Anmelden']);
    assert.equal(await b.evaluate(`document.querySelector('.llogo h1')`), null);
  });
});
