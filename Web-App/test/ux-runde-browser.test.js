/**
 * UX-Prüfung 12.11.2026 in Chrome mit echtem Server: Menügruppen ohne axe-Fund;
 * PDF.js erst mit dem ersten PDF; nur das aktive Design lädt, ein Wechsel lädt nach
 * und schaltet erst danach um, der Server gibt es im HTML frei; Finanzen ohne
 * Positionen ohne Suchfeld; Merkliste zugeklappt nur Titelhöhe; Anmeldung mit
 * genau einer h1, die nicht das Logo ist.
 *
 * Gegenproben (12.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  .umenu-gruppe-titel mit color:#ddd → rot: „Menü“ (axe color-contrast)
 *   B  <template id="pdfjs-quelle"> wieder als <script type="module"> → rot:
 *      „PDF.js erst mit dem ersten PDF“ (pdf.min.mjs schon beim Start)
 *   C  in index.html die Design-Links wieder ausserhalb der Vorlage → rot:
 *      „Designs“ (alle Dateien beim Start); designStileFreigeben() in
 *      renderIndexHtml nicht gerufen → rot: ebenda (nach dem Neuladen nicht
 *      frei); in theme-boot.js applier ohne Warten → rot: ebenda (umgeschaltet,
 *      bevor die Stylesheets da waren)
 *   D  .fin-suche-zeile aus der Regel für #tab-finance.finanzen-leer entfernt →
 *      rot: „Finanzen ohne Positionen“
 *   E  `.merk-kasten:not([open]){padding-block:.5rem}` entfernt → rot:
 *      „Merkliste am Telefon“ (86 px bei 44 px Titel)
 *   F  das Logo der Anmeldung wieder als <h1> → rot: „Anmeldung“ (zwei h1)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { starteApp } = require('./helpers/app-browser');
const { musterSammlung } = require('./helpers/bestand');
const { AXE } = require('./helpers/layout-messung');

const PDF =
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 400]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';
const LEER = { success: true, currency: 'EUR', total_value: '0', sets: [], parts: [], figs: [], total: 0 };
const geladen =
  teil => `performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes(${JSON.stringify(teil)}))
  .map(n => new URL(n).pathname)`;

test('UX-Prüfung 12.11.: Menü, PDF.js, Designs, Leerzustände, Anmeldung', { timeout: 300_000 }, async t => {
  const a = await starteApp(t, {
    name: `uxr_${process.pid}`,
    bestand: musterSammlung,
    abfangen: [
      { muster: '*finance/*valuation*', enthaelt: '/finance/valuation', antwort: { ...LEER, totals: {} } },
      { muster: '*finance/*valuation*', enthaelt: '/finance/parts-valuation', antwort: LEER },
      { muster: '*finance/*valuation*', enthaelt: '/finance/minifigs-valuation', antwort: LEER },
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
  await b.auswerten(
    `document.querySelector('#einrichtung-modal.open [data-click="einrichtungSpaeter"]')?.click(); true`,
  );

  await t.test('Menü: Gruppen ohne axe-Fund', async () => {
    await b.auswerten(`document.getElementById('btn-umenu').click(); true`);
    await bis(`document.getElementById('umenu-pop').style.display === 'block'`, 'Menü offen');
    const funde = await b.auswerten(`(async () => {
      if (!window.axe) (0, eval)(${JSON.stringify(AXE)});
      const r = await axe.run(document.getElementById('umenu-pop'), { resultTypes: ['violations'] });
      return r.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).join(', ')); })()`);
    assert.deepEqual(funde, []);
    const titel = await b.auswerten(
      `[...document.querySelectorAll('#umenu-pop .umenu-gruppe-titel')].filter(e => e.getClientRects().length).map(e => e.textContent.trim())`,
    );
    assert.equal(titel.length, 3, JSON.stringify(titel));
    await b.auswerten(`document.getElementById('btn-umenu').click(); true`);
  });

  await t.test('PDF.js erst mit dem ersten PDF', async () => {
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

  await t.test('Finanzen ohne Positionen: kein Suchfeld', async () => {
    await b.auswerten(`document.querySelector('.ntab[data-tab="finance"]').click(); true`);
    await bis(`document.getElementById('tab-finance').classList.contains('finanzen-leer')`, 'Finanzen leer');
    assert.equal(await b.auswerten(`document.getElementById('fin-suche').getClientRects().length`), 0);
  });

  await t.test('Merkliste am Telefon: zugeklappt nicht höher als der Titel', async () => {
    await b.tab('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await b.auswerten(
      `document.querySelector('.ntab[data-tab="wanted"]').click(); document.getElementById('mk-kasten').open = false; true`,
    );
    await bis(`document.getElementById('tab-wanted').classList.contains('active')`, 'Merkliste');
    const m =
      await b.auswerten(`(() => { const k = document.getElementById('mk-kasten'), s = k.querySelector('summary');
      return { kasten: k.getBoundingClientRect().height, titel: s.getBoundingClientRect().height }; })()`);
    assert.ok(m.kasten <= m.titel + 20, `zugeklappt ${m.kasten} px bei ${m.titel} px Titel`);
    await b.tab('Emulation.clearDeviceMetricsOverride');
  });

  await t.test('Designs: nur das aktive, Wechsel ohne Neuladen', async () => {
    const dateien = d => ({ classic: [], hochglanz: ['noppe', 'hochglanz'] })[d] ?? [d];
    const start = await b.auswerten(`document.documentElement.dataset.theme`);
    const erwartet = dateien(start).map(d => `/themes/${d}.css`);
    assert.deepEqual((await b.auswerten(geladen('/themes/'))).sort(), erwartet.sort(), `Design ${start}`);

    await b.auswerten(
      `window.__keinNeuladen = 1; document.querySelector('[data-click="oeffneSicht"][data-arg="profil"]').click(); true`,
    );
    await bis(`!!document.getElementById('design-wahl')?.options.length`, 'Designwahl');
    // Beim Umschalten muss das Stylesheet schon Regeln tragen.
    await b.auswerten(`window.__beimUmschalten = null;
      new MutationObserver((_, mo) => { if (document.documentElement.dataset.theme !== 'hochglanz') return;
        window.__beimUmschalten = [...document.styleSheets].filter(s => /themes\\/(noppe|hochglanz)\\.css/.test(s.href || '') && s.cssRules.length).length;
        mo.disconnect(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      const s = document.getElementById('design-wahl'); s.value = 'hochglanz'; s.dispatchEvent(new Event('change', { bubbles: true })); true`);
    await bis(`document.documentElement.dataset.theme === 'hochglanz'`, 'umgeschaltet');
    assert.equal(await b.auswerten(`window.__keinNeuladen`), 1, 'neu geladen');
    assert.equal(await b.auswerten(`window.__beimUmschalten`), 2, 'umgeschaltet, bevor die Stylesheets da waren');

    await b.tab('Page.reload');
    await bis(`document.getElementById('app')?.style.display === 'block'`, 'neu geladen', 300);
    assert.equal(await b.auswerten(`document.documentElement.dataset.theme`), 'hochglanz');
    assert.deepEqual((await b.auswerten(geladen('/themes/'))).sort(), ['/themes/hochglanz.css', '/themes/noppe.css']);
    // Im HTML frei, nicht erst vom Skript: So hält das Stylesheet das erste Bild an wie jedes andere.
    const html = await b.auswerten(`fetch('/', { credentials: 'same-origin' }).then(r => r.text())`);
    const vorlage = html.indexOf('<template id="design-stile">');
    const stelle = d => html.indexOf(`href="/themes/${d}.css`);
    assert.ok(vorlage > 0, 'keine Vorlage');
    for (const d of ['noppe', 'hochglanz']) assert.ok(stelle(d) > 0 && stelle(d) < vorlage, `${d} nicht frei`);
    for (const d of ['brick', 'werkbank', 'farbfaecher']) assert.ok(stelle(d) > vorlage, `${d} frei`);
  });

  await t.test('Anmeldung: eine h1, nicht das Logo', async () => {
    // Abmelden lädt die Seite neu; die Maske spricht dann die Sprache des Browsers.
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
