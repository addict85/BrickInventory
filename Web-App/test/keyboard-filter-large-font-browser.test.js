/**
 * UX review 24 in real Chrome, in the household with a sub-account: M1–M3, N4–N16 and the two open points
 * from round 23 (focus after “undo”, “cancel” in the individual jobs).
 *
 * Counter-checks (measured 14.11.2026, each alone, bundle rebuilt):
 *   A  set form without data-submit → red: “Enter from every field” (add-qty does not submit)
 *   B  closeCapture() without form.reset() → red: “Esc discards the draft” (price “12”) and
 *      “Enter from every field” (the hint “schon da” stays, Enter opens the set)
 *   C  loadFinance shows the error in #fin-tbl again → red: “finances on server error” (no error at the top)
 *   D  catalog again without .filter-bar → red: “filters behind the button” (catalog: search and four fields)
 *   E  without the label .delbtn[data-key-hint]::before → red: “Delete deletes”; hover:none rule again without
 *      :not(:focus-visible) → red: same place (trash invisible)
 *   F  SET_SORTS without name_desc → red: “table of the sets” (not sorted descending); action buttons
 *      again without set names → red: same place
 *   G  acquisitionPrice() without the gift branch → red: “gift and minifigure count” (“0,00 €”)
 *   H  the minifigure count again from /v2/minifigs?source=set → red: same place (detail 1, table 4)
 *   I  Brick .ntab back to 6px 2px → red: “Brick at 320 px” (tabs two lines); #app back to 16 px margin →
 *      red: same place (collection choice in two rows); .hint-close back in the flow → red: same place (× own line)
 *   K  .price-with-currency without flex-wrap → red: “large font: add set” (price field 95 px)
 *   L  without @container ovl → red: “large font: set detail” (250 px content)
 *   M  rb-hint visible offline again → red: “offline banner alone”
 *   N  --chart-value back to var(--chart-new) → red: “value line in the color of the amounts” (hochglanz blue)
 *   O  focusIfDa() without el.focus() → red: “focus after undo” (stays on the heading)
 *   P  #tab-monitor .mon-buttons .btn without hyphens:manual → red: “cancel in one line” (42 > 33 px)
 *   Q  phone text back to “neben dem Titel” → red: “empty collection on the phone”
 *
 * N16 (date field 11/14/2026): the native field formats by the browser's language, not by `lang`;
 * what is checked is only that the page sets its language correctly.
 *
 * Skipped without Chrome (CHROME_BIN, google-chrome, chromium).
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');
const { patternHousehold } = require('./helpers/inventory');

const text = sel => `(document.querySelector(${JSON.stringify(sel)})?.textContent || '').replace(/\\s+/g, ' ').trim()`;
const CLOSE = `document.querySelectorAll('.ovl.open [data-dialog-close]').forEach(x => x.click()); true`;

async function groesse(b, breite, telefon, hoehe) {
  await b.tab('Emulation.setDeviceMetricsOverride', {
    width: breite,
    height: hoehe || (telefon ? 844 : 900),
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

/** A real key via the DevTools protocol: only it triggers the implicit submission of a form. */
async function taste(b, key, vk) {
  await b.tab('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code: key,
    windowsVirtualKeyCode: vk,
    ...(key === 'Enter' ? { text: '\r' } : {}),
  });
  await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: vk });
}

const addOpenSet = `(() => { document.querySelector('#tab-gallery [data-click="openCapture"][data-arg="set"]').click(); return true; })()`;

async function enterFromEachField(_t, a) {
  const { b, bis } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
  const anfragen = () =>
    b.eventList.filter(
      e =>
        e.method === 'Network.requestWillBeSent' &&
        e.params.request.method === 'GET' &&
        /\/api\/v2\/sets\/21318-1$/.test(e.params.request.url),
    ).length;
  for (const field of ['add-num', 'add-qty', 'add-price', 'add-date']) {
    await b.auswerten(CLOSE);
    await b.auswerten(addOpenSet);
    await bis(`document.getElementById('add-set-modal').classList.contains('open')`, 'Dialog open');
    await b.auswerten(`(() => { document.getElementById('add-num').value = '21318-1';
      document.getElementById('${field}').focus(); return true; })()`);
    const vorher = anfragen();
    await taste(b, 'Enter', 13);
    await bis(`!document.getElementById('add-unknown').hidden`, `Enter from ${field} does not submit`, 50);
    await a.ruhig(2000);
    assert.equal(anfragen() - vorher, 1, `Enter from ${field}: queries`);
    assert.match(await b.auswerten(text('#add-unknown')), /schon in deiner Sammlung/);
  }
  // Part and minifigure: without a number the dialog reports it at the result, submitted from the price field.
  for (const [hash, type, field, result, meldung] of [
    ['#/teile', 'part', 'ap-price-inline', 'ap-inline-result', 'Teilenummer erforderlich'],
    ['#/minifiguren', 'fig', 'af-price-inline', 'af-inline-result', 'Figur-Nummer erforderlich'],
  ]) {
    await geh(a, hash, `document.querySelector('.tab.active [data-arg="${type}"][data-click="openCapture"]')`, type);
    await b.auswerten(`(() => { document.querySelector('.tab.active [data-click="openCapture"][data-arg="${type}"]').click();
      document.getElementById('${result}').textContent = ''; document.getElementById('${field}').focus(); return true; })()`);
    await taste(b, 'Enter', 13);
    await bis(`/erforderlich/.test(${text(`#${result}`)})`, `Enter from ${field}`, 50);
    assert.equal(await b.auswerten(text(`#${result}`)), meldung);
  }
  await b.auswerten(CLOSE);
}

async function draftDiscarded(_t, a) {
  const { b, bis } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
  await b.auswerten(addOpenSet);
  await bis(`document.getElementById('add-set-modal').classList.contains('open')`, 'Dialog open');
  await b.auswerten(`(() => { document.getElementById('add-num').value = '10276-1';
    const p = document.getElementById('add-price'); p.value = '12'; p.focus(); return true; })()`);
  await taste(b, 'Escape', 27);
  await bis(`!document.getElementById('add-set-modal').classList.contains('open')`, 'Esc closes');
  await b.auswerten(addOpenSet);
  const m =
    await b.auswerten(`({ preis: document.getElementById('add-price').value, nr: document.getElementById('add-num').value,
    datum: document.getElementById('add-date').value,
    abbrechen: [...document.querySelectorAll('#add-set-modal .capture-footer .btn')].map(k => k.textContent.trim()) })`);
  assert.deepEqual([m.preis, m.nr], ['', ''], `Esc does not discard the draft: ${JSON.stringify(m)}`);
  assert.match(m.datum, /^\d{4}-\d{2}-\d{2}$/, 'Purchase date is back to today');
  assert.deepEqual(m.abbrechen, ['Abbrechen', 'Hinzufügen']);
  await b.auswerten(`document.querySelector('#add-set-modal .capture-footer .btn.bs').click(); true`);
  await bis(`!document.getElementById('add-set-modal').classList.contains('open')`, '„Abbrechen“ closes');
}

async function finanzenFehler(_t, a) {
  const { b, bis } = a;
  await groesse(b, 390, true);
  const { identifier } = await b.tab('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__echt = window.fetch; window.__fehler = true;
      window.fetch = (u, o) => window.__fehler && /finance\\/valuation/.test(String(u))
        ? Promise.resolve(new Response(JSON.stringify({ success: false, error: 'Interner Fehler' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }))
        : window.__echt(u, o);`,
  });
  try {
    await b.auswerten(`location.hash = '#/finanzen'; window.__alt = true; location.reload(); true`);
    await bis(
      `!window.__alt && !!document.querySelector('#portfolio-chart .error-state button, #fin-tbl .error-state button')`,
      'Error',
      300,
    );
    await a.ruhig();
    const m = await b.auswerten(`(() => { const k = document.querySelector('.tab.active .error-state button');
      return { inBox: !!k?.closest('#portfolio-chart'), unten: k?.getBoundingClientRect().bottom, hoehe: innerHeight,
        karten: document.getElementById('fin-sum').checkVisibility(), strich: [...document.querySelectorAll('#fin-sum .fval')].filter(f => f.checkVisibility() && f.textContent.trim() === '—').length }; })()`);
    assert.ok(m.inBox, `Error not in the chart box: ${JSON.stringify(m)}`);
    assert.ok(m.unten <= m.hoehe, `„Erneut versuchen“ not in the first screen: ${JSON.stringify(m)}`);
    assert.equal(m.karten, false, 'Cards without a number are above the error');
    await b.auswerten(
      `window.__fehler = false; document.querySelector('#portfolio-chart .error-state button').click(); true`,
    );
    await bis(
      `document.getElementById('fin-sum').checkVisibility() && /€/.test(${text('#fin-cost-basis')})`,
      'after „Erneut versuchen“',
    );
  } finally {
    await b.tab('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    await groesse(b, 1280, false);
  }
}

async function filterKnopf(_t, a) {
  const { b, bis } = a;
  const rowList = sel =>
    b.auswerten(`[...document.querySelector('${sel} .filter-bar').children].filter(e => e.checkVisibility() && e.getBoundingClientRect().width > 2)
      .map(e => e.matches('.filter-button') ? 'Filter' + Math.round(e.getBoundingClientRect().width) : e.matches('.search-field') ? 'Suche' : e.tagName)`);
  try {
    for (const breite of [390, 320]) {
      await groesse(b, breite, true);
      await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
      const muster = await rowList('#tab-gallery');
      for (const [hash, tab, bereit] of [
        ['#/katalog', '#tab-catalog', '#catalog-grid .sc'],
        ['#/merkliste', '#tab-wanted', '#mk-list .mk-row'],
      ]) {
        await geh(a, hash, `!!document.querySelector('${bereit}')`, tab);
        assert.deepEqual(await rowList(tab), muster, `${tab} at ${breite} px`);
        await b.auswerten(`document.querySelector('${tab} .filter-button').click(); true`);
        await bis(
          `document.querySelector('${tab} .filter-bar > select').checkVisibility()`,
          `${tab}: Filter aufgeklappt`,
        );
        await b.auswerten(`document.querySelector('${tab} .filter-button').click(); true`);
      }
    }
  } finally {
    await groesse(b, 1280, false);
  }
}

async function entfDeletes(_t, a) {
  const { b, bis } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
  await b.auswerten(`document.getElementById('gs').focus(); true`);
  for (let i = 0; i < 12; i++) {
    await taste(b, 'Tab', 9);
    if (await b.auswerten(`document.activeElement.matches('#gallery .sc')`)) break;
  }
  await bis(`document.activeElement.matches('#gallery .sc')`, 'Card reached with Tab', 5);
  const m =
    await b.auswerten(`(() => { const d = document.activeElement.querySelector('.delbtn'), r = d.getBoundingClientRect();
    return { breite: r.width, deckend: getComputedStyle(d.parentElement).opacity, etikett: getComputedStyle(d, '::before').content }; })()`);
  assert.ok(m.breite > 0 && m.deckend === '1', `Trash button invisible: ${JSON.stringify(m)}`);
  assert.equal(m.etikett, '"Entf löscht"');
}

async function setsTabelle(_t, a) {
  const { b, bis } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
  await b.auswerten(`document.getElementById('vl').click(); true`);
  await bis(`!!document.querySelector('#gallery table')`, 'Table');
  try {
    const t = await b.auswerten(`(() => { const kopf = [...document.querySelectorAll('#gallery thead th')];
      const z = document.querySelector('#gallery tr[data-arg="10294-1"]');
      return { headers: kopf.map(k => k.textContent.trim()), cells: z.children.length,
        datum: z.children[kopf.findIndex(k => k.textContent.trim() === 'Gekauft am')]?.textContent.trim(),
        namen: [...z.querySelectorAll('.rows-actions button')].map(k => k.getAttribute('aria-label')),
        bunt: !!z.querySelector('.rows-actions [fill^="#"]') }; })()`);
    assert.equal(t.headers.length, t.cells, 'Columns without a header');
    assert.deepEqual(
      t.headers.filter(k => !k),
      [],
      `empty column headers: ${JSON.stringify(t.headers)}`,
    );
    assert.ok(!t.headers.includes('In der App eingetragen'), 'Recording date instead of purchase date');
    assert.equal(t.datum, '01.06.2026', 'Kaufdatum');
    assert.deepEqual(t.namen, ['Teile von Titanic neu importieren', 'Titanic löschen']);
    assert.equal(t.bunt, false, 'colorful symbol in the row');

    const sequence = `[...document.querySelectorAll('#gallery tbody tr')].map(z => z.children[2].textContent.trim())`;
    const state = `document.querySelector('#gallery [data-arg="name"]').closest('th').getAttribute('aria-sort')`;
    await b.auswerten(`document.querySelector('#gallery [data-click="sortSets"][data-arg="name"]').click(); true`);
    await bis(`${state} === 'ascending'`, 'Name aufsteigend');
    const auf = await b.auswerten(sequence);
    assert.deepEqual(
      auf,
      [...auf].sort((x, y) => x.localeCompare(y, 'de')),
    );
    await b.auswerten(`document.querySelector('#gallery [data-click="sortSets"][data-arg="name"]').click(); true`);
    await bis(`${state} === 'descending'`, 'Name descending');
    await a.ruhig();
    assert.deepEqual(await b.auswerten(sequence), [...auf].reverse(), 'not sorted descending');
    assert.equal(
      await b.auswerten(`document.activeElement.dataset.arg`),
      'name',
      'Focus not on the header after sorting',
    );
  } finally {
    await b.auswerten(`(() => { const s = document.getElementById('gsort'); s.value = 'added_desc';
      s.dispatchEvent(new Event('change')); document.getElementById('vg').click(); return true; })()`);
    await a.ruhig();
  }
}

async function giftAndMinifigs(_t, a) {
  const { b, bis } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
  await b.auswerten(`document.getElementById('vl').click(); true`);
  await bis(`!!document.querySelector('#gallery tr[data-arg="10300-1"]')`, 'Table');
  const tabelle =
    await b.auswerten(`(() => { const i = [...document.querySelectorAll('#gallery thead th')].findIndex(k => k.textContent.trim() === 'Minifiguren');
    return document.querySelector('#gallery tr[data-arg="10300-1"]').children[i].textContent.trim(); })()`);
  await b.auswerten(`document.getElementById('vg').click(); true`);
  await bis(`!!document.querySelector('#gallery .sc[data-arg="10300-1"]')`, 'Karten');
  await b.auswerten(`document.querySelector('#gallery .sc[data-arg="10300-1"]').click(); true`);
  await bis(`!!document.querySelector('#m-sparkline-content svg')`, 'Set-Detail');
  await a.ruhig();
  const d = await b.auswerten(`({ kauf: ${text('#m-acq-summary')}, figuren: ${text('#m-minifigs-val')} })`);
  assert.match(d.kauf, /Geschenk/);
  assert.doesNotMatch(d.kauf, /0,00/, 'Kaufpreis 0 als Betrag');
  assert.equal(tabelle, '4', 'Test data: catalog knows 4 minifigs');
  assert.equal(d.figuren, tabelle, 'Table and detail count differently');
  await b.auswerten(CLOSE);
}

async function brick320(_t, a) {
  const { b, bis } = a;
  const alt = await b.auswerten(`document.documentElement.getAttribute('data-theme')`);
  await b.auswerten(`(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('bim_rb_hint_dismissed')) localStorage.removeItem(k);
    document.documentElement.setAttribute('data-theme', 'brick'); return true; })()`);
  await groesse(b, 320, true);
  try {
    await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
    await bis(`document.getElementById('rb-hint').checkVisibility()`, 'Rebrickable-Hinweis');
    const m =
      await b.auswerten(`(() => { const l = document.querySelector('nav .ntab.group-active .tab-label, nav .ntab.active .tab-label');
      const r = s => document.querySelector(s).getBoundingClientRect();
      return { zeilen: Math.round(l.getBoundingClientRect().height / parseFloat(getComputedStyle(l).lineHeight)),
        reihen: new Set([...document.querySelectorAll('#tab-gallery .collection-choice button')].map(k => Math.round(k.getBoundingClientRect().top))).size,
        zu: r('#rb-hint .hint-close').top, knopf: r('#rb-hint .btn.bp').top, band: r('#rb-hint').height,
        breit: document.documentElement.scrollWidth }; })()`);
    assert.equal(m.zeilen, 1, `aktiver Reiter bricht um: ${JSON.stringify(m)}`);
    assert.equal(m.reihen, 1, `Sammlungswahl zweireihig: ${JSON.stringify(m)}`);
    assert.ok(Math.abs(m.zu - m.knopf) < 2 && m.band < 70, `× in its own row: ${JSON.stringify(m)}`);
    assert.ok(m.breit <= 320, `Page wider than the window: ${m.breit}`);
  } finally {
    await b.auswerten(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(alt || 'classic')}); true`);
    await groesse(b, 1280, false);
  }
}

async function addLargeFont(_t, a) {
  const { b, bis } = a;
  await groesse(b, 320, true);
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
  try {
    await b.auswerten(`document.documentElement.style.fontSize = '32px'; true`);
    await b.auswerten(addOpenSet);
    await bis(`document.getElementById('add-set-modal').classList.contains('open')`, 'Dialog');
    await a.ruhig(1000);
    const m = await b.auswerten(`(() => { const r = id => document.getElementById(id).getBoundingClientRect();
      return { preis: r('add-price').width, oben: r('add-price').top, waehrung: r('add-currency').top }; })()`);
    assert.ok(m.preis >= 200, `Preisfeld zu schmal: ${JSON.stringify(m)}`);
    assert.ok(m.waehrung > m.oben, `Currency not below the price: ${JSON.stringify(m)}`);
  } finally {
    await b.auswerten(`${CLOSE}; document.documentElement.style.fontSize = ''; true`);
    await groesse(b, 1280, false);
  }
}

async function largeFontDetail(_t, a) {
  const { b, bis } = a;
  await groesse(b, 320, true, 700);
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc[data-arg="21318-1"]')`, 'Sammlung');
  try {
    await b.auswerten(`document.documentElement.style.fontSize = '32px'; true`);
    await b.auswerten(`document.querySelector('#gallery .sc[data-arg="21318-1"]').click(); true`);
    await bis(`!!document.querySelector('#m-sparkline-content svg')`, 'Set-Detail');
    await a.ruhig(1000);
    const m = await b.auswerten(`(() => { const m = document.querySelector('#set-modal .modal').getBoundingClientRect();
      const k = document.querySelector('#set-modal .mhd').getBoundingClientRect(), f = document.querySelector('#set-modal .mfooter').getBoundingClientRect();
      return { inhalt: Math.round(Math.min(f.top, m.bottom) - k.bottom), modal: Math.round(m.height) }; })()`);
    assert.ok(m.inhalt >= 400, `Header and footer leave too little to the content: ${JSON.stringify(m)}`);
  } finally {
    await b.auswerten(`${CLOSE}; document.documentElement.style.fontSize = ''; true`);
    await groesse(b, 1280, false);
  }
}

async function offlineBand(_t, a) {
  const { b, bis } = a;
  await groesse(b, 390, true);
  await b.auswerten(
    `(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('bim_rb_hint_dismissed')) localStorage.removeItem(k); return true; })()`,
  );
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
  await b.tab('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  try {
    await b.auswerten(`document.getElementById('gsort').dispatchEvent(new Event('change')); true`);
    await bis(`!document.getElementById('offline-band').hidden`, 'Offline-Band');
    const m = await b.auswerten(`({ rb: document.getElementById('rb-hint').checkVisibility(),
      band: document.getElementById('offline-band').getBoundingClientRect().height })`);
    assert.equal(m.rb, false, 'Rebrickable hint next to the offline band');
    assert.ok(m.band < 60, `Offline-Band ${m.band} px`);
  } finally {
    await b.tab('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await groesse(b, 1280, false);
  }
  await b.auswerten(`document.getElementById('gsort').dispatchEvent(new Event('change')); true`);
  await bis(`document.getElementById('offline-band').hidden`, 'connected again', 300).catch(() => {});
}

async function wertlinie(_t, a) {
  const { b } = a;
  await geh(a, '#/finanzen', `!!document.querySelector('#portfolio-chart svg polyline')`, 'Wertdiagramm');
  const alt = await b.auswerten(`document.documentElement.getAttribute('data-theme')`);
  try {
    // Werkbank deliberately draws the line in brass (round 11).
    for (const design of ['classic', 'brick', 'farbfaecher', 'noppe', 'hochglanz']) {
      const m = await b.auswerten(`(() => { document.documentElement.setAttribute('data-theme', '${design}');
        return { linie: getComputedStyle(document.querySelector('#portfolio-chart svg polyline')).stroke,
          betrag: getComputedStyle(document.getElementById('portfolio-current')).color,
          leiste: getComputedStyle(document.querySelector('#fin-sum .fstat.hi')).borderTopColor }; })()`);
      assert.equal(m.linie, m.betrag, `${design}: value line not in the color of the amounts`);
      if (design === 'noppe' || design === 'hochglanz') assert.equal(m.leiste, m.linie, `${design}: Marktwert-Leiste`);
    }
  } finally {
    await b.auswerten(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(alt || 'classic')}); true`);
  }
}

async function language(_t, a) {
  const m = await a.b.auswerten(`({ lang: document.documentElement.lang,
    eigen: document.getElementById('add-date').closest('[lang]')?.tagName })`);
  assert.deepEqual(m, { lang: 'de', eigen: 'HTML' });
}

async function rueckgaengig(_t, a) {
  const { b, bis } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc[data-arg="75192-1"]')`, 'Sammlung');
  await b.auswerten(`(() => { const k = document.querySelector('#gallery .sc[data-arg="75192-1"]'); k.focus();
    k.querySelector('.delbtn').click(); return true; })()`);
  // Restorable: no question (js/deletion.js).
  await bis(`!document.querySelector('#gallery .sc[data-arg="75192-1"]')`, 'deleted');
  await a.ruhig();
  await b.auswerten(
    `(() => { const k = [...document.querySelectorAll('#toasts .toast-action')].at(-1); k.focus(); k.click(); return true; })()`,
  );
  await bis(`!!document.querySelector('#gallery .sc[data-arg="75192-1"]')`, 'restored');
  await bis(`document.activeElement?.dataset?.arg === '75192-1'`, 'Focus on the restored card', 60);
}

async function cancelSingleLine(_t, a) {
  const { b, bis } = a;
  await geh(a, '#/hintergrund', `!!document.querySelector('#jobs-card .mon-single')`, 'Hintergrund');
  await b.auswerten(`document.querySelectorAll('#tab-monitor details').forEach(d => { d.open = true; }); true`);
  await bis(
    `[...document.querySelectorAll('#jobs-card .mon-buttons .btn')].some(k => k.textContent.trim() === 'Abbrechen')`,
    'Cancel',
  );
  const h = await b.auswerten(`(() => { const k = [...document.querySelectorAll('#jobs-card .mon-buttons .btn')];
    const hoehe = t => Math.max(...k.filter(x => x.textContent.trim() === t).map(x => x.getBoundingClientRect().height));
    return { abbrechen: hoehe('Abbrechen'), jetzt: hoehe('Jetzt starten') }; })()`);
  assert.ok(h.abbrechen <= h.jetzt + 1, `„Abbrechen“ bricht um: ${JSON.stringify(h)}`);
}

async function emptyCollection(_t, a, kid) {
  const { b } = a;
  await a.db.run('DELETE FROM set_acquisitions WHERE user_id = ANY($1)', [[a.uid, kid]]);
  await a.db.run('DELETE FROM sets WHERE user_id = ANY($1)', [[a.uid, kid]]);
  await groesse(b, 390, true);
  try {
    await geh(a, '#/finanzen', `document.getElementById('tab-finance').classList.contains('active')`, 'Finanzen');
    await geh(a, '#/sammlung', `!!document.querySelector('#gallery .empty p')`, 'leere Sammlung');
    const m =
      await b.auswerten(`(() => { const s = document.querySelector('#tab-gallery .import-menu > summary').getBoundingClientRect();
      const w = document.querySelector('#tab-gallery .collection-choice').getBoundingClientRect();
      return { text: ${text('#gallery .empty p')}, rechts: innerWidth - s.right, oben: s.top - w.top,
        titel: getComputedStyle(document.querySelector('#tab-gallery .ph h1')).opacity }; })()`);
    assert.equal(m.titel, '0', 'Test data: title invisible on the phone');
    assert.match(m.text, /••• oben rechts/);
    assert.ok(m.rechts < 40 && Math.abs(m.oben) < 20, `••• not at the top right: ${JSON.stringify(m)}`);
  } finally {
    await groesse(b, 1280, false);
  }
}

test('keyboard in forms, filter bar, large font', { concurrency: 1, timeout: 600_000 }, async t => {
  const name = `r24_${process.pid}`;
  let kid = 0;
  const a = await startApp(t, {
    name,
    allDesigns: true,
    holding: async (db, uid) => {
      kid = await patternHousehold(db, uid);
      await db.run(`INSERT INTO jobs (type, due_at) VALUES ('exchange_rates', NOW() + interval '6 hours')`);
    },
  });
  if (a.reason) {
    t.skip(a.reason);
    return;
  }
  t.after(() => a.db.run(`DELETE FROM jobs WHERE type = 'exchange_rates' AND status = 'pending'`).catch(() => {}));
  await a.ruhig();
  /** @type {[string, (t: import('node:test').TestContext, a: object, kid: number) => Promise<void>][]} */
  const pruefungen = [
    ['Enter aus jedem Feld', enterFromEachField],
    ['Esc verwirft den Entwurf, „Abbrechen“', draftDiscarded],
    ['Filter hinter dem Knopf', filterKnopf],
    ['Entf löscht', entfDeletes],
    ['Tabelle der Sets', setsTabelle],
    ['Geschenk und Figurenzahl', giftAndMinifigs],
    ['Brick bei 320 px', brick320],
    ['Grosse Schrift: Set hinzufügen', addLargeFont],
    ['Grosse Schrift: Set-Detail', largeFontDetail],
    ['Offline-Band allein', offlineBand],
    ['Wertlinie in der Farbe der Beträge', wertlinie],
    ['Sprache der Seite', language],
    ['Fokus nach Rückgängig', rueckgaengig],
    ['Abbrechen in einer Zeile', cancelSingleLine],
    // Reloads the page and thereby loses the other design stylesheets: after the design checks.
    ['Finanzen bei Serverfehler', finanzenFehler],
    ['Leere Sammlung am Telefon', emptyCollection],
  ];
  for (const [titel, fn] of pruefungen) await t.test(titel, () => fn(t, a, kid));
});
