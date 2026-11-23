/**
 * UX check 23 in real Chrome, in the household with a sub-account: H1, H2, M1–M6
 * and N1–N10. Finally the admin logs out and an English account logs in.
 *
 * Counter-checks (measured 14.11.2026, each on its own, bundle rebuilt):
 *   A  logout without reloading (only showLogin) → red: „Abmelden verwirft das
 *      vorige Konto“ (r23_…_kind, „199,99“, „Alle Themen“, „Sets im Katalog“)
 *   B  bim_lang kept on logout → red: same place („Anmeldemaske nicht in
 *      der Browsersprache“)
 *   C  .mon-table td again a flex row without wrapping → red: „Alle Ansichten
 *      bei 390 px“ and „Hintergrundarbeiten“ (407 > 390)
 *   D  loeschWahl() without the household case → red: „Löschen im Haushalt“ (accounts missing)
 *   E  fokusVerloren() returns immediately → red: same place (focus not on the set)
 *   F  .offline-band again top:0;z-index:120 → red: „Offline-Band“ (menu covered)
 *   G  without the 429 branch in clearerReason() → red: „Drossel“ (text);
 *      .toast-close without position:absolute → red: same place (✕ 65 px below the top edge)
 *   H  again loadGallery() and loadStats() on tab change → red: „Drossel“
 *      (twice /v2/stats)
 *   I  alsKarten() without phoneWidth() → red: „Telefon nur Karten …“ (as a consequence
 *      also „Drossel“ and „Kontrastmodus“: the table stays)
 *   K  „Ø Kaufpreis“ never chosen → red: „Set-Detail“
 *   L  .btn.bp in contrast mode without a border → red: „Kontrastmodus“ (0px)
 *   M  theme-boot.js does not set data-rb-band → red: „Startgerüst“
 *   N  (14.11.2026, since UX check 25 without the column „Stückpreis“) wertMitStueck() also at quantity 1 with
 *      „je …“ → red: „Finanzen“
 *   O  zoom button without data-i18n-aria → red: „Abmelden …“ (aria-label German)
 *   P  „davon N nach Fehler“ never shown → red: „Hintergrundarbeiten“
 *   Q  pl.first_set again without a reason → red: „Bauliste“ (lock without a reason); since round 24 without
 *      button: btn-pl-gen not hidden → red: „Bauliste“ (visible without a set)
 *   R  atPhoneSwitch() does not redraw the collection → red: „Telefon nur
 *      Karten …“ (timeout), as a consequence „Drossel“, „Kontrastmodus“, „Abmelden …“
 *   S  (16.11.2026) in loeschWahl() „aus allen Konten“ again as the first (preselected) option →
 *      red: „Löschen im Haushalt“
 *
 * Without Chrome (CHROME_BIN, google-chrome, chromium) it is skipped.
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startApp } = require('./helpers/app-browser');
const { patternHousehold } = require('./helpers/inventory');

const text = sel => `(document.querySelector(${JSON.stringify(sel)})?.textContent || '').replace(/\\s+/g, ' ').trim()`;
const CLOSE = `document.querySelectorAll('.ovl.open [data-dialog-close]').forEach(x => x.click()); true`;
const EN_PASS = 'en-Passwort-1';

async function size(b, width, phone) {
  await b.tab('Emulation.setDeviceMetricsOverride', {
    width: width,
    height: phone ? 844 : 900,
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

async function setDetail(_t, a) {
  const { b, until } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc[data-arg="21318-1"]')`, 'Sammlung');
  await b.evaluate(`document.querySelector('#gallery .sc[data-arg="21318-1"]').click(); true`);
  await until(`!!document.querySelector('#m-sparkline-content svg')`, 'Preisverlauf');
  assert.match(await b.evaluate(text('#m-sparkline-content')), /Ø Kaufpreis 205,00/, 'mean of two purchases');
  await b.evaluate(`(() => { const f = document.getElementById('m-alert-val'); f.value = '150';
    f.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await until(`/aktiv/.test(${text('#m-alert-state')})`, 'Alarm gespeichert');
  const situation =
    await b.evaluate(`(() => { const s = document.getElementById('m-alert-state'), l = s.parentElement.querySelector('.close-view');
    return { mark: s.classList.contains('alert-badge'), lower: s.getBoundingClientRect().bottom, link: l.getBoundingClientRect().top }; })()`);
  assert.ok(situation.mark, 'condition as a badge');
  assert.ok(
    situation.link >= situation.lower - 1,
    `„Alle Preisalarme“ not on a row of its own: ${JSON.stringify(situation)}`,
  );
  const field = await b.evaluate(`(() => { const f = document.getElementById('instr-desc');
    return { style: f.getAttribute('style'), height: f.getBoundingClientRect().height, balken: getComputedStyle(document.querySelector('#set-modal .modal')).scrollbarWidth }; })()`);
  assert.equal(field.style, null, 'Inline-Stil am Beschreibungsfeld');
  assert.ok(field.height >= 36, `description field ${field.height} px high`);
  assert.equal(field.balken, 'thin', 'scrollbar in the dialog like the one of the page');
  await b.evaluate(`(() => { const f = document.getElementById('m-alert-val'); f.value = '';
    f.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await a.settle(3000);
  await b.evaluate(CLOSE);
}

/** Every view at 390 px, all drawers open: the page is never wider than the window. The general
 * check (helpers/ui-check.js) measures with closed „Einzelne Aufträge“ and without a
 * failed job; that is how the overflow of the background jobs slipped through. */
async function allViews(_t, a) {
  const { b } = a;
  const findings = [];
  await size(b, 390, true);
  try {
    for (const path of [
      'sammlung',
      'teile',
      'minifiguren',
      'bauliste',
      'finanzen',
      'merkliste',
      'katalog',
      'hintergrund',
      'einstellungen',
      'konto',
      'gutscheine',
      'alarme',
      'lagerorte',
      'haushalt',
      'daten',
      'app',
    ]) {
      await b.evaluate(CLOSE);
      await b.evaluate(`location.hash = '#/${path}'; true`);
      await a.settle(5000);
      await b.evaluate(`(() => { const t = document.querySelector('.tab.active');
        t?.querySelectorAll('details').forEach(d => { d.open = true; });
        t?.querySelectorAll('#global-settings-grid > .ssec').forEach(x => x.classList.add('settings-active')); return true; })()`);
      await a.settle(3000);
      const m = await b.evaluate(
        `({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })`,
      );
      if (m.sw > m.cw) findings.push(`${path}: ${m.sw} > ${m.cw}`);
    }
  } finally {
    await size(b, 1280, false);
  }
  assert.deepEqual(findings, []);
}

async function background(_t, a) {
  const { b, until } = a;
  await size(b, 390, true);
  try {
    await geh(a, '#/hintergrund', `!!document.querySelector('#jobs-card .mon-single')`, 'Hintergrund');
    await b.evaluate(`document.querySelectorAll('#tab-monitor details').forEach(d => { d.open = true; }); true`);
    await a.settle(1000);
    const m = await b.evaluate(`({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
      role: !!document.querySelector('#jobs-card .mon-role')?.checkVisibility() })`);
    assert.ok(m.role, 'test data: label „Wiederholung nach Fehler“');
    assert.ok(m.sw <= m.cw, `page wider than the window: ${m.sw} > ${m.cw}`);
  } finally {
    await size(b, 1280, false);
  }
  await geh(a, '#/hintergrund', `!!document.querySelector('.mon-services .mon-name')`, 'Dienste');
  const bunt = await b.evaluate(
    `[...document.querySelectorAll('.mon-services .mon-name')].filter(n => !n.querySelector('svg.mon-icon > use') || n.querySelector('[fill^="#"]')).length`,
  );
  assert.equal(bunt, 0, 'coloured pictograms instead of line icons');
  await until(`!!document.querySelector('.mon-kinds')`, 'Auftragsarten');
  const row = await b.evaluate(
    `[...document.querySelectorAll('.mon-kinds tbody tr')].find(z => /Wechselkurse/.test(z.textContent))?.textContent.replace(/\\s+/g, ' ')`,
  );
  assert.match(row, /davon \d+ nach Fehler/, 'failed attempt is missing in the overview');
  assert.notEqual(
    await b.evaluate(text('#settings-background h2')),
    await b.evaluate(text('#tab-monitor h1')),
    'section is named like the page',
  );
}

async function finances(_t, a) {
  const { b } = a;
  await geh(a, '#/finanzen', `!!document.querySelector('#fin-tbl [data-fin-kind="sets"] tbody tr')`, 'Finanzen');
  // Since UX check 25 the unit price stands below the market value („je …“), only for more than one piece.
  const f = await b.evaluate(`(() => {
    const lines = [...document.querySelectorAll('[data-fin-kind="sets"] tbody tr')].map(z => ({
      menge: z.querySelector('.qbadge')?.textContent, per: z.querySelector('.fin-value .fin-per')?.textContent || '' }));
    return { lines, card: document.getElementById('fin-cost-basis-sub').textContent, line: ${text('#portfolio-chart')} }; })()`);
  const single = f.lines.filter(z => z.menge === '×1');
  assert.ok(single.length >= 2, 'test data: rows with quantity 1');
  assert.deepEqual(
    single.filter(z => z.per),
    [],
    'at quantity 1 the unit price is still next to the market value',
  );
  assert.doesNotMatch(f.card, /Verglichen wird nur/, 'explanation in the card twice');
  assert.doesNotMatch(f.line, /der Positionen mit Marktpreis/, 'explanation at the chart twice');
}

/** Since round 24 (N11) „Neu berechnen“ is missing entirely without a set; the empty state says once what to do. */
async function buildList(_t, a) {
  await geh(a, '#/bauliste', `document.getElementById('tab-partslist').classList.contains('active')`, 'Bauliste');
  const k = await a.b.evaluate(`({ button: document.getElementById('btn-pl-gen').checkVisibility(),
    empty: document.getElementById('pl-sets').textContent.replace(/\\s+/g, ' ') })`);
  assert.equal(k.button, false, '„Neu berechnen“ visible without a set');
  assert.match(k.empty, /entsteht sofort/, 'empty state without instructions');
}

async function bars(_t, a) {
  const { b, until } = a;
  // Table chosen on the computer, then narrow: the collection shows cards without reloading.
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
  await b.evaluate(`document.getElementById('vl').click(); true`);
  await until(`!!document.querySelector('#gallery table')`, 'Tabelle');
  await size(b, 390, true);
  try {
    await until(
      `!!document.querySelector('#gallery .sgrid') && !document.querySelector('#gallery table')`,
      'Karten am Telefon',
    );
    const rowList = {};
    for (const [hash, tab, ready] of [
      ['#/sammlung', 'gallery', '#gallery .sc'],
      ['#/teile', 'parts', '#tab-parts .part-card'],
    ]) {
      await geh(a, hash, `!!document.querySelector('${ready}')`, tab);
      rowList[tab] =
        await b.evaluate(`[...document.querySelector('#tab-${tab} .filter-bar').children].filter(e => e.checkVisibility() && e.getBoundingClientRect().width > 2)
        .sort((x, y) => x.getBoundingClientRect().left - y.getBoundingClientRect().left).map(e => e.matches('.filter-button') ? 'Filter' + Math.round(e.getBoundingClientRect().width) : e.matches('.search-field') ? 'Suche' : e.className)`);
    }
    assert.deepEqual(rowList.gallery, ['Filter44', 'Suche']);
    // Parts additionally have cards/list (UX check 28, N8); filters and search stand the same.
    assert.deepEqual(rowList.parts, [...rowList.gallery, 'vtgl'], 'Werkzeugleisten uneinheitlich');
  } finally {
    await size(b, 1280, false);
  }
  await until(`!!document.querySelector('#tab-parts .part-card')`, 'Teile am Rechner');
  const upper =
    await b.evaluate(`(() => { const r = s => Math.round(document.querySelector(s).getBoundingClientRect().top);
    return [r('#parts-search'), r('#tab-parts .filter-bar > .vtgl')]; })()`);
  assert.ok(Math.abs(upper[0] - upper[1]) < 4, `view toggle alone on the second line: ${upper}`);
  await b.evaluate(`document.getElementById('vg').click(); true`);
}

async function throttle(_t, a) {
  const { b, until } = a;
  for (const [width, phone] of [
    [1280, false],
    [390, true],
  ]) {
    await size(b, width, phone);
    await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
    await b.evaluate(`(() => { window.__echt = window.fetch;
      window.fetch = (u, o) => /\\/api\\/v2\\/sets\\?/.test(String(u))
        ? Promise.resolve(new Response(JSON.stringify({ success: false, code: 'too_many_requests', error: 'Zu viele Anfragen' }),
            { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '200' } }))
        : window.__echt(u, o); return true; })()`);
    try {
      await b.evaluate(`document.getElementById('gsort').dispatchEvent(new Event('change')); true`);
      await until(`/Zu viele Anfragen/.test(document.getElementById('toasts').textContent)`, 'Hinweis 429');
    } finally {
      await b.evaluate(`window.fetch = window.__echt; true`);
    }
    const t =
      await b.evaluate(`(() => { const t = [...document.querySelectorAll('#toasts .toast')].find(x => /Zu viele/.test(x.textContent));
      const r = t.getBoundingClientRect(), z = t.querySelector('.toast-close').getBoundingClientRect();
      return { text: t.querySelector('.toast-text').textContent, upper: z.top - r.top, right: r.right - z.right }; })()`);
    assert.match(t.text, /^Zu viele Anfragen – in 4 Min\. wieder möglich\./);
    assert.ok(t.upper < 12 && t.right < 12, `✕ not at the top right (${width} px): ${JSON.stringify(t)}`);
    await b.evaluate(`document.querySelectorAll('#toasts .toast').forEach(x => x.remove()); true`);
  }
  await size(b, 1280, false);
  // A switch to the collection asks list and metrics once each; the catalog the years only the first time.
  await geh(a, '#/katalog', `!!document.querySelector('#catalog-grid .sc')`, 'Katalog');
  await geh(a, '#/teile', `!!document.querySelector('#tab-parts .part-card')`, 'Teile');
  const prior = b.eventList.length;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
  await geh(a, '#/katalog', `!!document.querySelector('#catalog-grid .sc')`, 'Katalog');
  const paths = b.eventList
    .slice(prior)
    .filter(e => e.method === 'Network.requestWillBeSent' && /\/api\/v2\//.test(e.params.request.url))
    .map(e => e.params.request.url.replace(/^.*\/api/, '').replace(/\?.*/, ''));
  const num = p => paths.filter(x => x === p).length;
  assert.deepEqual(
    [num('/v2/sets'), num('/v2/stats'), num('/v2/catalog/year-distribution')],
    [1, 1, 0],
    paths.join(' '),
  );
}

async function offlineBand(_t, a) {
  const { b, until } = a;
  await geh(a, '#/finanzen', `!!document.querySelector('#fin-tbl tbody tr')`, 'Finanzen');
  await b.tab('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  try {
    await b.evaluate(`document.querySelector('.ntab[data-tab="finance"]').click(); true`);
    await until(`!document.getElementById('offline-band').hidden`, 'Offline-Band');
    await b.evaluate(`window.scrollTo(0, 600); true`);
    await until('window.scrollY > 300', 'gerollt');
    const m = await b.evaluate(`(() => { const band = document.getElementById('offline-band').getBoundingClientRect();
      const k = document.getElementById('btn-umenu').getBoundingClientRect();
      const upper = document.elementFromPoint(k.left + k.width / 2, k.top + k.height / 2);
      return { band: band.top, bar: document.querySelector('nav').getBoundingClientRect().bottom, menu: !!upper?.closest('#btn-umenu') }; })()`);
    assert.ok(m.menu, 'user menu covered');
    assert.ok(m.band >= m.bar - 1, `band above the bar: ${JSON.stringify(m)}`);
  } finally {
    await b.tab('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await b.evaluate(`window.scrollTo(0, 0); true`);
  }
  await until(`document.getElementById('offline-band').hidden`, 'wieder verbunden', 300).catch(() => {});
}

async function kontrast(_t, a) {
  const { b } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
  await b.tab('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
  try {
    const rand = await b.evaluate(`getComputedStyle(document.querySelector('#tab-gallery .btn.bp')).borderTopWidth`);
    assert.ok(parseFloat(rand) >= 1, `main button without border: ${rand}`);
  } finally {
    await b.tab('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  }
}

async function startupScaffold(_t, a) {
  const { b, until } = a;
  // The scaffold measures itself before the app removes it; it is compared with the finished page.
  const { identifier } = await b.tab('Page.addScriptToEvaluateOnNewDocument', {
    source: `document.addEventListener('DOMContentLoaded', () => { const r = s => document.querySelector(s)?.getBoundingClientRect().top;
      window.__sg = { tile: r('#start-skeleton .sg-tiles i'), band: document.documentElement.hasAttribute('data-rb-band'),
        extra: getComputedStyle(document.querySelector('#start-skeleton .sg-extra')).display }; });`,
  });
  try {
    await b.evaluate(
      `localStorage.removeItem('bim_rb_hint_dismissed:' + ${a.uid}); window.__alt = true; location.reload(); true`,
    );
    await until(
      `!window.__alt && !!document.querySelector('#gallery .sc') && !document.getElementById('start-skeleton')`,
      'App nach Neuladen',
      300,
    );
    await a.settle();
    const m =
      await b.evaluate(`({ sg: window.__sg, card: document.querySelector('#gallery .sc').getBoundingClientRect().top,
      band: !document.getElementById('rb-hint').hidden })`);
    assert.ok(m.band, 'test data: band without a Rebrickable key');
    assert.ok(m.sg.band, 'scaffold without room for the band');
    assert.notEqual(m.sg.extra, 'none', '„Manager“ is missing in the scaffold');
    assert.ok(Math.abs(m.sg.tile - m.card) < 30, `Kacheln springen um ${Math.round(m.card - m.sg.tile)} px`);
  } finally {
    await b.tab('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
}

async function remove(_t, a, name) {
  const { b, until } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc[data-arg="21318-1"]')`, 'Sammlung');
  const removeIt = async (nr, question = true) => {
    await b.evaluate(`(() => { const k = document.querySelector('#gallery .sc[data-arg="${nr}"]'); k.focus();
      k.querySelector('.delbtn').click(); return true; })()`);
    if (question) await until(`document.getElementById('confirm-modal').style.display === 'flex'`, 'Rückfrage');
    await a.settle(3000);
  };
  await removeIt('21318-1');
  const question = await b.evaluate(
    `({ text: ${text('#cd-msg')}, choice: [...document.querySelectorAll('#cd-choice label')].map(l => l.textContent.trim()),
      chosen: document.querySelector('#cd-choice input:checked')?.closest('label')?.textContent.trim() })`,
  );
  assert.match(
    question.text,
    new RegExp(`${name} \\(ich\\) ×1, ${name}_kind ×1`),
    'accounts and piece counts are missing',
  );
  assert.equal(question.choice.length, 3, `no choice: ${JSON.stringify(question)}`);
  assert.match(
    question.chosen || '',
    /\(ich\)/,
    `the preselected one is not the own copy: ${JSON.stringify(question)}`,
  );
  const prior = b.eventList.length;
  await b.evaluate(
    `[...document.querySelectorAll('#cd-choice label')].find(l => l.textContent.includes('_kind')).querySelector('input').click();
    document.getElementById('cd-confirm').click(); true`,
  );
  await until(`!document.querySelector('#gallery .sc[data-arg="21318-1"] .owner-badge')`, 'nur noch eigenes Exemplar');
  await a.settle();
  const target = b.eventList
    .slice(prior)
    .find(e => e.method === 'Network.requestWillBeSent' && e.params.request.method === 'DELETE')?.params.request.url;
  assert.match(target, /\/v2\/sets\/21318-1\?accounts=\d+$/, 'only the sub-account selected');
  const active = `(() => { const e = document.activeElement; return e.tagName + ' ' + (e.dataset.arg || e.textContent.trim().slice(0, 20)); })()`;
  assert.equal(await b.evaluate(active), 'DIV 21318-1', 'focus not on the remaining set');

  const rowList = await b.evaluate(`[...document.querySelectorAll('#gallery .sc')].map(k => k.dataset.arg)`);
  const nr = rowList[1];
  // Only the own copy: restorable, so no question (js/deletion.js), the toast offers undo.
  await removeIt(nr, false);
  await until(`!document.querySelector('#gallery .sc[data-arg="${nr}"]')`, 'Set gelöscht');
  assert.notEqual(
    await b.evaluate(`document.getElementById('confirm-modal').style.display`),
    'flex',
    'confirmation prompt before the own set',
  );
  await a.settle();
  assert.equal(await b.evaluate(active), `DIV ${rowList[2]}`, 'focus after deleting not on the next card');
  await b.evaluate(
    `(() => { const k = [...document.querySelectorAll('#toasts .toast-action')].at(-1); k.focus(); k.click(); return true; })()`,
  );
  await until(`!!document.querySelector('#gallery .sc[data-arg="${nr}"]')`, 'zurückgeholt');
  await a.settle();
  await until(`document.activeElement?.dataset?.arg === '${nr}'`, 'Fokus auf der zurückgeholten Karte (Runde 24)');
}

async function signOut(_t, a, name) {
  const { b, until } = a;
  // State of the admin: users, background, set dialog with purchase prices, catalog, finances.
  await geh(a, '#/einstellungen', `!!document.querySelector('#users-tbl .user-name')`, 'Benutzerverwaltung');
  await geh(a, '#/hintergrund', `!!document.querySelector('#monitor-content .mon-services')`, 'Hintergrund');
  await geh(a, '#/katalog', `!!document.querySelector('#catalog-grid .sc')`, 'Katalog');
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc[data-arg="21318-1"]')`, 'Sammlung');
  await b.evaluate(`document.querySelector('#gallery .sc[data-arg="21318-1"]').click(); true`);
  await until(`/199,99/.test(document.getElementById('m-det').textContent)`, 'Set-Dialog');
  await b.evaluate(CLOSE);
  await geh(a, '#/finanzen', `document.getElementById('tab-finance').classList.contains('active')`, 'Finanzen');

  await b.evaluate(`window.__alt = true; document.getElementById('btn-logout').click(); true`);
  await until(
    `!window.__alt && typeof document.getElementById('btn-login')?.onclick === 'function' && getComputedStyle(document.getElementById('login-screen')).display !== 'none'`,
    'Anmeldemaske',
    300,
  );
  // The browser speaks English (Chrome without a language choice: en-US), the account before it German.
  const mask = { title: await b.evaluate(`document.title`), button: await b.evaluate(text('#btn-login')) };

  await b.evaluate(`document.getElementById('lu').value = ${JSON.stringify(`${name}_en`)};
    document.getElementById('lp').value = ${JSON.stringify(EN_PASS)}; document.getElementById('btn-login').click(); true`);
  await until(`getComputedStyle(document.getElementById('app')).display !== 'none'`, 'englisch angemeldet', 300);
  await until(
    `document.documentElement.lang === 'en' && !!document.querySelector('#gallery .empty')`,
    'leere Sammlung',
  );
  await a.settle();
  const dom = await b.evaluate(`({ html: document.body.innerHTML, title: document.title,
    live: document.getElementById('match-live').textContent, theme: document.querySelector('#gtheme option[value=""]').textContent,
    zoom: document.getElementById('pdf-viewer-zoom').getAttribute('aria-label') })`);
  const fremd = [`${name}_kind`, '199,99', 'Alle Themen', 'Sets im Katalog', 'Finanzen'].filter(s =>
    dom.html.includes(s),
  );
  assert.deepEqual(fremd, [], "the previous account's state in the document");
  assert.deepEqual(
    mask,
    { title: 'Sign in – BrickInventory', button: 'Sign in' },
    'login form not in the browser language',
  );
  assert.equal(dom.title, 'Sets – BrickInventory');
  assert.equal(dom.live, '');
  assert.equal(dom.theme, 'All themes');
  assert.equal(dom.zoom, '100% – reset zoom (key 0)');

  // Empty collection: the hint names the menu only on the phone, also after changing the width.
  const hint = () => b.evaluate(text('#gallery .empty p'));
  assert.doesNotMatch(await hint(), /•••/);
  await size(b, 390, true);
  try {
    await until(`/•••/.test(${text('#gallery .empty p')})`, 'Hinweis am Telefon');
  } finally {
    await size(b, 1280, false);
  }
  await until(`!/•••/.test(${text('#gallery .empty p')})`, 'Hinweis am Rechner');
}

test('logout, deleting in the household, offline banner, contrast mode', {
  concurrency: 1,
  timeout: 600_000,
}, async t => {
  const name = `r23_${process.pid}`;
  const a = await startApp(t, {
    name,
    holding: async (db, uid) => {
      await patternHousehold(db, uid);
      // Two open runs of one kind, one after errors: label and long hint on the phone.
      await db.run(`INSERT INTO jobs (type, due_at, attempts, max_attempts, error_message)
        VALUES ('exchange_rates', NOW() + interval '5 hours', 4, 6, 'getaddrinfo ENOTFOUND www.ecb.europa.eu https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip')`);
      await db.run(`INSERT INTO jobs (type, due_at) VALUES ('exchange_rates', NOW() + interval '6 hours')`);
      const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));
      const en = await db.get(
        `INSERT INTO users (username, email, password_hash, is_active, email_verified, is_admin)
         VALUES ($1, $2, $3, true, true, false) RETURNING id`,
        [`${name}_en`, `${name}_en@example.org`, await bcrypt.hash(EN_PASS, 4)],
      );
      await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'language', 'en')`, [en.id]);
    },
  });
  if (a.reason) {
    t.skip(a.reason);
    return;
  }
  t.after(() => a.db.run(`DELETE FROM jobs WHERE type = 'exchange_rates' AND status = 'pending'`).catch(() => {}));
  await a.settle();
  /** @type {[string, (t: import('node:test').TestContext, a: object, name: string) => Promise<void>][]} */
  const pruefungen = [
    ['Set-Detail', setDetail],
    ['Alle Ansichten bei 390 px', allViews],
    ['Hintergrundarbeiten', background],
    ['Finanzen', finances],
    ['Bauliste', buildList],
    ['Telefon nur Karten, gleiche Werkzeugleisten', bars],
    ['Drossel', throttle],
    ['Offline-Band', offlineBand],
    ['Kontrastmodus', kontrast],
    ['Startgerüst', startupScaffold],
    ['Löschen im Haushalt', remove],
    ['Abmelden verwirft das vorige Konto', signOut],
  ];
  for (const [title, fn] of pruefungen) await t.test(title, () => fn(t, a, name));
});
