/**
 * The whole UI in Chrome, for one design and one device (desktop
 * 1280 × 900 or phone 390 × 844), light and dark: every tab, all
 * sections of the settings, the pages behind the menu and the
 * most important dialogs. Per state: axe-core without violation at any level, layout, keyboard …
 *
 * Counter-checks (30.10.2026, applied together; which file was red is noted
 * in its header):
 *   A  .v-btn out of the 44 px rule in mobile.css → “view gutscheine” (26×26)
 *   B  farbfaecher --mut back to #8a8a8a → almost every view light (3.45:1)
 *   C  ::placeholder rule removed → “collection”, “parts” dark (3.55:1)
 *   D  trash of the set tile back to <button tabindex="-1"> → “collection”
 *      (axe nested-interactive)
 *   E  phone rule of the import menu removed → “import menu” (overflow)
 * Counter-checks (01.11.2026, each alone, measured on classic/desktop):
 *   F  `summary` out of FOKUSSIERBAR (dialoge.js) → “set detail” (“more
 *      actions” not reachable via Tab)
 *   G  file field of the instructions back to display:none → “set detail” (button without keyboard)
 *   H  --field-border back to var(--bdr) → almost every view (field border 1.18:1)
 *   I  .btn without min-height 24px → “background jobs”, “set detail” and others (21–23 px)
 * Counter-checks (02.11.2026, each alone):
 *   K  .bs again border var(--bdr) → classic/desktop “collection”, “parts”,
 *      “settings”, views and others (button border, e.g. “Schliessen”)
 *   L  .vb.active without border-color → classic/desktop “collection”, “parts”,
 *      “minifigures”, “user menu”, “import menu” (active state “Karten”)
 *   M  noppe dark .ntab.active without light border → noppe/desktop “collection”,
 *      “parts list”, “finances” and others (active state 1.13:1)
 * Counter-checks (04.11.2026, applied together, classic/phone and narrow):
 *   N  wishlist row without its own row for label and price → “wishlist”
 *      (narrow 0 px, 7 lines: .mk-title)
 *   O  page title of the collection without min-height 44px → “parts” (obscured:
 *      subtitle under “Importieren”)
 *   P  (alone, 320 px page font 200 %) finance row without the
 *      container query 17rem → “finances” (narrow 0 px: .fin-name)
 * Counter-checks (04.11.2026, stock with sub-account, patternHousehold):
 *   Q  .toast-action back to --b500, .pl-chip-name back to --mut →
 *      classic/desktop “toast with action” (3.67:1) and “build list with sets” (4.37:1)
 *   R  .household-list again max-content max-content without wrapping the button
 *      → 390 px page font 200 % “view haushalt” (overflow 432 px);
 *      with patternCollection instead of patternHousehold the same check stayed green —
 *      the gap through which the finding of UI review 12 slipped.
 * Counter-checks (04.11.2026, each alone; word break, canvas, select field):
 *   S  period buttons again in a 2×2 grid without nowrap, chart card with
 *      full padding → 320 px page font 200 % “finances” (word break
 *      “Woch|e”, “Mona|t”); only grid and nowrap back stayed green because the
 *      narrower padding alone already makes room
 *   T  axesSituation always outside → 320 px page font 200 % “finances”
 *      (narrow (chart) -2 px curve) and “set detail” (101 px)
 *   U  wishlist filters again half a row each → 320 px EN “wishlist”
 *      (selection shortened “All conditions”)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, sleep } = require('./app-browser');
const { patternHousehold } = require('./inventory');
const { AXE_RUN, LAYOUT, tabCheck } = require('./layout-measurement');

const DEVICES = { calculator: [1280, 900, false], phone: [390, 844, true] };

const klick = sel => `document.querySelector(${JSON.stringify(sel)})?.click(); true`;
/** Put a file into a hidden file field and trigger `change`. */
const file = (
  sel,
  name,
  kind,
  content,
) => `(() => { const f = document.querySelector(${JSON.stringify(sel)}); if (!f) return true;
  const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(content)}], ${JSON.stringify(name)}, { type: ${JSON.stringify(kind)} }));
  f.files = dt.files; f.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
const WANTED_XML = `<INVENTORY>
<ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>3001</ITEMID><COLOR>11</COLOR><MINQTY>4</MINQTY><MAXPRICE>0.25</MAXPRICE></ITEM>
<ITEM><ITEMTYPE>S</ITEMTYPE><ITEMID>10294-1</ITEMID><MINQTY>1</MINQTY></ITEM>
<ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>99999zz</ITEMID><COLOR>5</COLOR><MINQTY>2</MINQTY></ITEM>
</INVENTORY>`;
/** Smallest valid PDF with one page; PDF.js builds the cross references itself. */
const PDF =
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 400]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';
const switchTab = r => klick(`.ntab[data-tab="${r}"]`);
/** @type {[string, string[]][]} */
const VIEWS = [
  ['Sammlung', [switchTab('gallery')]],
  ['Teile', [switchTab('parts')]],
  ['Minifiguren', [switchTab('minifigs')]],
  ['Teileliste', [switchTab('partslist')]],
  ['Finanzen', [switchTab('finance')]],
  ['Merkliste', [switchTab('wanted')]],
  ['Katalog', [switchTab('catalog')]],
  ['Hintergrundarbeiten', [switchTab('monitor')]],
  // All sections at once: otherwise they stand alone, the same is measured.
  [
    'Einstellungen',
    [
      switchTab('settings'),
      `document.querySelectorAll('#global-settings-grid > .ssec').forEach(a => a.classList.add('settings-active')); true`,
    ],
  ],
  ...['profile', 'vouchers', 'alerts', 'locations', 'household', 'data', 'app'].map(
    s => /** @type {[string, string[]]} */ ([`Sicht ${s}`, [klick(`.umenu-item[data-arg="${s}"]`)]]),
  ),
  ['Benutzermenü', [switchTab('gallery'), klick('#btn-umenu')]],
  [
    'Import-Menü',
    [switchTab('gallery'), `document.querySelector('#tab-gallery details.import-menu').open = true; true`],
  ],
  ['Set hinzufügen', [switchTab('gallery'), klick('button[data-click="openCapture"][data-arg="set"]')]],
  ['Set-Detail', [switchTab('gallery'), klick('#gallery [data-click="openModal"]')]],
  [
    'Kaufpreise',
    [switchTab('gallery'), klick('#gallery [data-click="openModal"]'), klick('#set-modal [data-click="openAcqModal"]')],
  ],
  ['Teil hinzufügen', [switchTab('parts'), klick('button[data-click="openCapture"][data-arg="part"]')]],
  ['Minifigur hinzufügen', [switchTab('minifigs'), klick('button[data-click="openCapture"][data-arg="fig"]')]],
  ['Teil-Detail', [switchTab('parts'), klick('.man-tile[data-click="openManDetail"]')]],
  ['Teil aus Set', [switchTab('parts'), klick('.part-card[data-click="openSetItemDetail"]')]],
  ['Merkposten-Detail', [switchTab('wanted'), klick('.mk-row[data-click="openWantedDetail"]')]],
  [
    'Löschen bestätigen',
    [
      switchTab('gallery'),
      klick('#gallery [data-click="openModal"]'),
      klick('#set-modal [data-click="openAcqModal"]'),
      klick('#acq-modal [data-click="acqDelete"]'),
    ],
  ],
  // A toast with a button and the build list with chips, among them one the catalog does not know.
  ['Toast mit Aktion', [switchTab('gallery'), `location.hash = '#/sammlung/set/99999-9'; true`]],
  [
    'Bauliste mit Sets',
    [
      switchTab('partslist'),
      `(() => { document.getElementById('pl-setnr').value = '10294-1, 99999-1';
    document.querySelector('[data-click="plAddSet"]').click(); return true; })()`,
      klick('#btn-pl-gen'),
    ],
  ],
  // File dialogs without a file on disk: DataTransfer slips it to the field, like a choice in the dialog.
  ['Wanted-XML', [switchTab('parts'), file('#wanted-xml-part', 'wanted.xml', 'text/xml', WANTED_XML)]],
  [
    'CSV-Fortschritt',
    [
      switchTab('gallery'),
      file('#csv-file', 'sets.csv', 'text/csv', 'set_number,quantity\n75192-1,1\n99999-1,abc\n'),
      `new Promise(r => { const t0 = Date.now(); (function w() { const c = document.getElementById('confirm-modal');
      if (c && c.style.display === 'flex') { document.getElementById('cd-confirm').click(); r(true); }
      else if (document.getElementById('progress-overlay').classList.contains('open') || Date.now() - t0 > 5000) r(true); else setTimeout(w, 100); })(); })`,
      `new Promise(r => { const t0 = Date.now(); (function w() { const f = document.getElementById('prog-footer');
      if (/fertig|abgeschlossen|Fehler|done|finished/i.test(f?.textContent || '') || Date.now() - t0 > 8000) r(true); else setTimeout(w, 200); })(); })`,
    ],
  ],
  [
    'PDF-Betrachter',
    [
      switchTab('gallery'),
      klick('#gallery [data-click="openModal"]'),
      `document.getElementById('instr-file') ? true : new Promise(r => setTimeout(() => r(true), 800))`,
      file('#instr-file', 'anleitung.pdf', 'application/pdf', PDF),
      `new Promise(r => { const t0 = Date.now(); (function w() { if (document.querySelector('#set-modal [data-click="openPdfViewerLink"]') || Date.now() - t0 > 8000) r(true); else setTimeout(w, 200); })(); })`,
      klick('#set-modal [data-click="openPdfViewerLink"]'),
      `new Promise(r => { const t0 = Date.now(); (function w() { if (document.querySelector('#pdf-viewer-pages [role="img"]') || Date.now() - t0 > 8000) r(true); else setTimeout(w, 200); })(); })`,
    ],
  ],
];

const CLOSE = `(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  document.querySelectorAll('.ovl.open').forEach(o => o.querySelector('[data-click^="close"], [data-click^="close"], .mx')?.click());
  document.querySelectorAll('.ovl.open').forEach(o => o.classList.remove('open'));
  document.querySelectorAll('details[open]:not(#mk-box):not(#pl-options)').forEach(d => { d.open = false; });
  document.querySelectorAll('#toasts .toast').forEach(x => x.remove());
  const pop = document.getElementById('umenu-pop'); if (pop) pop.style.display = 'none';
  return true; })()`;

/** Registers the test for one design and one device. */
function checkUi(design, device) {
  test(`UI ${design}, ${device}: axe and layout`, { concurrency: 1, timeout: 300_000 }, async t => {
    const app = await startApp(t, {
      name: `ofl_${design}_${device}_${process.pid}`,
      holding: patternHousehold,
      allDesigns: true,
    });
    if (app.reason) {
      t.skip(app.reason);
      return;
    }
    const { b } = app;
    const [w, h, mobileView] = DEVICES[device];
    await b.tab('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: 1,
      mobile: mobileView,
    });
    // Without a Rebrickable key the setup wizard opens after startup.
    await sleep(1000);
    await b.evaluate(klick('#setup-modal.open [data-click="setupLater"]'));
    const image = () =>
      b.evaluate(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`);
    // Instead of fixed pauses: wait until no request runs anymore, then two frames.
    await b.evaluate(`(() => { if (window.__offen === undefined) { window.__offen = 0; const f = window.fetch;
      window.fetch = (...a) => { window.__offen++; return f(...a).finally(() => setTimeout(() => window.__offen--, 60)); }; } return true; })()`);
    const settle = async () => {
      await sleep(60);
      await app.until('window.__offen === 0', 'Anfragen fertig', 60);
      await image();
    };

    for (const [viewName, steps] of VIEWS) {
      const findings = [];
      // If the login mask is shown, the rest only measures it; then better name the cause.
      if (await b.evaluate(`getComputedStyle(document.getElementById('app')).display === 'none'`))
        assert.fail(`session lost before „${viewName}“; 401 on: ${app.rejected.join(', ') || 'none'}`);
      await b.evaluate(CLOSE);
      await b.evaluate(
        `document.documentElement.setAttribute('data-theme', '${design}'); document.documentElement.removeAttribute('data-dark'); true`,
      );
      for (const s of steps) {
        await b.evaluate(s);
        await settle();
      }
      for (const dark of [false, true]) {
        await b.evaluate(`document.documentElement.toggleAttribute('data-dark', ${dark}); true`);
        await image();
        const where = dark ? 'dark' : 'hell';
        for (const f of await b.evaluate(LAYOUT(mobileView))) findings.push(`${where}: ${f}`);
        for (const f of await b.evaluate(AXE_RUN)) findings.push(`${where}: axe ${f}`);
      }
      for (const f of await tabCheck(b)) findings.push(`Tastatur: ${f}`);
      await t.test(viewName, () => assert.deepEqual(findings, []));
    }
    await b.evaluate(CLOSE);
  });
}

/** Findings that concern large font: overflow, cut-off, overlap, tap target, bar, narrow or obscured text, word break.
 * A shortened select field only counts at normal font: at 200 % not every entry fits into 320 px. */
const GROSS = /^(Überlauf|abgeschnitten|Überlappung|Tippziel|Leiste|schmal|verdeckt|Wortbruch)/;
const BAR = `[...document.querySelectorAll('nav .ntab')].filter(t => t.checkVisibility()).map(t => t.querySelector('.tab-label'))
  .filter(l => l.getBoundingClientRect().width <= 1 || l.scrollWidth > l.clientWidth + 1).map(l => 'Leiste: „' + l.textContent.trim() + '“ abgeschnitten')`;

/**
 * All views at 320 px (or `width`) and 200 % font, in all six designs light
 * and dark. Above 640 px the page counts as a desktop (24 px tap targets, no phone emulation). `modus` 'browser' enlarges like the browser setting
 * (Page.setFontSizes), 'seite' sets the page's base font to 200 %,
 * 'schmal' measures 320 px at normal font in English.
 */
function checkLargeFont(mode, width = 320) {
  test(`UI ${width} px (${mode}): all views`, { concurrency: 1, timeout: 300_000 }, async t => {
    // Narrow in English: the longer labels are the tight case there.
    const app = await startApp(t, {
      name: `ofl_gross_${mode}_${process.pid}`,
      holding: patternHousehold,
      language: mode === 'schmal' ? 'en' : 'de',
      allDesigns: true,
    });
    if (app.reason) {
      t.skip(app.reason);
      return;
    }
    const { b } = app;
    const mobileView = width <= 640;
    await b.tab('Emulation.setDeviceMetricsOverride', {
      width: width,
      height: mobileView ? 640 : 900,
      deviceScaleFactor: 1,
      mobile: mobileView,
    });
    await sleep(1000);
    await b.evaluate(klick('#setup-modal.open [data-click="setupLater"]'));
    if (mode === 'browser') await b.tab('Page.setFontSizes', { fontSizes: { standard: 32, fixed: 26 } });
    else if (mode === 'page')
      await b.evaluate(`document.documentElement.style.setProperty('font-size', '200%', 'important'); true`);
    const designs =
      mode === 'browser'
        ? ['classic', 'brick', 'noppe', 'werkbank', 'farbfaecher', 'hochglanz']
        : mode === 'schmal'
          ? ['classic', 'noppe']
          : ['classic'];
    for (const [viewName, steps] of VIEWS) {
      const findings = [];
      await b.evaluate(CLOSE);
      for (const s of steps) {
        await b.evaluate(s);
        await sleep(250);
      }
      await sleep(400);
      // What is measured is the loaded content, not the skeleton before it (market price in the set dialog).
      await app
        .until(`!document.querySelector('.ovl.open .skeleton-row, .tab.active .skeleton-row')`, 'Inhalt geladen', 40)
        .catch(() => {});
      for (const design of designs)
        for (const dark of [false, true]) {
          await b.evaluate(
            `document.documentElement.setAttribute('data-theme', '${design}'); document.documentElement.toggleAttribute('data-dark', ${dark}); true`,
          );
          await b.evaluate(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`);
          const where = `${design} ${dark ? 'dark' : 'hell'}`;
          for (const f of [...(await b.evaluate(LAYOUT(mobileView))), ...(await b.evaluate(BAR))])
            if (GROSS.test(f) || (mode === 'schmal' && f.startsWith('Auswahl'))) findings.push(`${where}: ${f}`);
        }
      await t.test(viewName, () => assert.deepEqual(findings, []));
    }
    await b.evaluate(CLOSE);
  });
}

module.exports = { checkUi, checkLargeFont };
