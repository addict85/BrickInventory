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
 *      (twice /v1/stats)
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

async function groesse(b, breite, telefon) {
  await b.tab('Emulation.setDeviceMetricsOverride', {
    width: breite,
    height: telefon ? 844 : 900,
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

async function setDetail(_t, a) {
  const { b, bis } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc[data-arg="21318-1"]')`, 'Sammlung');
  await b.auswerten(`document.querySelector('#gallery .sc[data-arg="21318-1"]').click(); true`);
  await bis(`!!document.querySelector('#m-sparkline-content svg')`, 'Preisverlauf');
  assert.match(await b.auswerten(text('#m-sparkline-content')), /Ø Kaufpreis 205,00/, 'Mittel zweier Käufe');
  await b.auswerten(`(() => { const f = document.getElementById('m-alert-val'); f.value = '150';
    f.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await bis(`/aktiv/.test(${text('#m-alert-state')})`, 'Alarm gespeichert');
  const situation =
    await b.auswerten(`(() => { const s = document.getElementById('m-alert-state'), l = s.parentElement.querySelector('.close-view');
    return { marke: s.classList.contains('alert-badge'), unten: s.getBoundingClientRect().bottom, link: l.getBoundingClientRect().top }; })()`);
  assert.ok(situation.marke, 'Zustand als Marke');
  assert.ok(
    situation.link >= situation.unten - 1,
    `„Alle Preisalarme“ nicht in eigener Zeile: ${JSON.stringify(situation)}`,
  );
  const feld = await b.auswerten(`(() => { const f = document.getElementById('instr-desc');
    return { stil: f.getAttribute('style'), hoehe: f.getBoundingClientRect().height, balken: getComputedStyle(document.querySelector('#set-modal .modal')).scrollbarWidth }; })()`);
  assert.equal(feld.stil, null, 'Inline-Stil am Beschreibungsfeld');
  assert.ok(feld.hoehe >= 36, `Beschreibungsfeld ${feld.hoehe} px hoch`);
  assert.equal(feld.balken, 'thin', 'Scrollleiste im Dialog wie die der Seite');
  await b.auswerten(`(() => { const f = document.getElementById('m-alert-val'); f.value = '';
    f.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await a.ruhig(3000);
  await b.auswerten(CLOSE);
}

/** Every view at 390 px, all drawers open: the page is never wider than the window. The general
 * check (helpers/ui-check.js) measures with closed „Einzelne Aufträge“ and without a
 * failed job; that is how the overflow of the background jobs slipped through. */
async function allViews(_t, a) {
  const { b } = a;
  const funde = [];
  await groesse(b, 390, true);
  try {
    for (const pfad of [
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
      await b.auswerten(CLOSE);
      await b.auswerten(`location.hash = '#/${pfad}'; true`);
      await a.ruhig(5000);
      await b.auswerten(`(() => { const t = document.querySelector('.tab.active');
        t?.querySelectorAll('details').forEach(d => { d.open = true; });
        t?.querySelectorAll('#global-settings-grid > .ssec').forEach(x => x.classList.add('settings-active')); return true; })()`);
      await a.ruhig(3000);
      const m = await b.auswerten(
        `({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })`,
      );
      if (m.sw > m.cw) funde.push(`${pfad}: ${m.sw} > ${m.cw}`);
    }
  } finally {
    await groesse(b, 1280, false);
  }
  assert.deepEqual(funde, []);
}

async function hintergrund(_t, a) {
  const { b, bis } = a;
  await groesse(b, 390, true);
  try {
    await geh(a, '#/hintergrund', `!!document.querySelector('#jobs-card .mon-single')`, 'Hintergrund');
    await b.auswerten(`document.querySelectorAll('#tab-monitor details').forEach(d => { d.open = true; }); true`);
    await a.ruhig(1000);
    const m = await b.auswerten(`({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
      rolle: !!document.querySelector('#jobs-card .mon-role')?.checkVisibility() })`);
    assert.ok(m.rolle, 'Testdaten: Etikett „Wiederholung nach Fehler“');
    assert.ok(m.sw <= m.cw, `Seite breiter als das Fenster: ${m.sw} > ${m.cw}`);
  } finally {
    await groesse(b, 1280, false);
  }
  await geh(a, '#/hintergrund', `!!document.querySelector('.mon-services .mon-name')`, 'Dienste');
  const bunt = await b.auswerten(
    `[...document.querySelectorAll('.mon-services .mon-name')].filter(n => !n.querySelector('svg.mon-icon > use') || n.querySelector('[fill^="#"]')).length`,
  );
  assert.equal(bunt, 0, 'farbige Sinnbilder statt Strichsymbolen');
  await bis(`!!document.querySelector('.mon-kinds')`, 'Auftragsarten');
  const zeile = await b.auswerten(
    `[...document.querySelectorAll('.mon-kinds tbody tr')].find(z => /Wechselkurse/.test(z.textContent))?.textContent.replace(/\\s+/g, ' ')`,
  );
  assert.match(zeile, /davon \d+ nach Fehler/, 'gescheiterter Versuch fehlt in der Übersicht');
  assert.notEqual(
    await b.auswerten(text('#settings-background h2')),
    await b.auswerten(text('#tab-monitor h1')),
    'Abschnitt heisst wie die Seite',
  );
}

async function finanzen(_t, a) {
  const { b } = a;
  await geh(a, '#/finanzen', `!!document.querySelector('#fin-tbl [data-fin-kind="sets"] tbody tr')`, 'Finanzen');
  // Since UX check 25 the unit price stands below the market value („je …“), only for more than one piece.
  const f = await b.auswerten(`(() => {
    const zeilen = [...document.querySelectorAll('[data-fin-kind="sets"] tbody tr')].map(z => ({
      menge: z.querySelector('.qbadge')?.textContent, je: z.querySelector('.fin-value .fin-per')?.textContent || '' }));
    return { zeilen, karte: document.getElementById('fin-cost-basis-sub').textContent, linie: ${text('#portfolio-chart')} }; })()`);
  const einzeln = f.zeilen.filter(z => z.menge === '×1');
  assert.ok(einzeln.length >= 2, 'Testdaten: Zeilen mit Menge 1');
  assert.deepEqual(
    einzeln.filter(z => z.je),
    [],
    'bei Menge 1 steht der Stückpreis noch neben dem Marktwert',
  );
  assert.doesNotMatch(f.karte, /Verglichen wird nur/, 'Erklärung in der Karte doppelt');
  assert.doesNotMatch(f.linie, /der Positionen mit Marktpreis/, 'Erklärung am Diagramm doppelt');
}

/** Since round 24 (N11) „Neu berechnen“ is missing entirely without a set; the empty state says once what to do. */
async function bauliste(_t, a) {
  await geh(a, '#/bauliste', `document.getElementById('tab-partslist').classList.contains('active')`, 'Bauliste');
  const k = await a.b.auswerten(`({ knopf: document.getElementById('btn-pl-gen').checkVisibility(),
    leer: document.getElementById('pl-sets').textContent.replace(/\\s+/g, ' ') })`);
  assert.equal(k.knopf, false, '„Neu berechnen“ ohne Set sichtbar');
  assert.match(k.leer, /entsteht sofort/, 'Leerzustand ohne Anleitung');
}

async function bars(_t, a) {
  const { b, bis } = a;
  // Table chosen on the computer, then narrow: the collection shows cards without reloading.
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
  await b.auswerten(`document.getElementById('vl').click(); true`);
  await bis(`!!document.querySelector('#gallery table')`, 'Tabelle');
  await groesse(b, 390, true);
  try {
    await bis(
      `!!document.querySelector('#gallery .sgrid') && !document.querySelector('#gallery table')`,
      'Karten am Telefon',
    );
    const reihe = {};
    for (const [hash, tab, bereit] of [
      ['#/sammlung', 'gallery', '#gallery .sc'],
      ['#/teile', 'parts', '#tab-parts .part-card'],
    ]) {
      await geh(a, hash, `!!document.querySelector('${bereit}')`, tab);
      reihe[tab] =
        await b.auswerten(`[...document.querySelector('#tab-${tab} .filter-bar').children].filter(e => e.checkVisibility() && e.getBoundingClientRect().width > 2)
        .sort((x, y) => x.getBoundingClientRect().left - y.getBoundingClientRect().left).map(e => e.matches('.filter-button') ? 'Filter' + Math.round(e.getBoundingClientRect().width) : e.matches('.search-field') ? 'Suche' : e.className)`);
    }
    assert.deepEqual(reihe.gallery, ['Filter44', 'Suche']);
    // Parts additionally have cards/list (UX check 28, N8); filters and search stand the same.
    assert.deepEqual(reihe.parts, [...reihe.gallery, 'vtgl'], 'Werkzeugleisten uneinheitlich');
  } finally {
    await groesse(b, 1280, false);
  }
  await bis(`!!document.querySelector('#tab-parts .part-card')`, 'Teile am Rechner');
  const oben =
    await b.auswerten(`(() => { const r = s => Math.round(document.querySelector(s).getBoundingClientRect().top);
    return [r('#parts-search'), r('#tab-parts .filter-bar > .vtgl')]; })()`);
  assert.ok(Math.abs(oben[0] - oben[1]) < 4, `Ansichtsumschalter allein in der zweiten Zeile: ${oben}`);
  await b.auswerten(`document.getElementById('vg').click(); true`);
}

async function drossel(_t, a) {
  const { b, bis } = a;
  for (const [breite, telefon] of [
    [1280, false],
    [390, true],
  ]) {
    await groesse(b, breite, telefon);
    await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
    await b.auswerten(`(() => { window.__echt = window.fetch;
      window.fetch = (u, o) => /\\/api\\/v1\\/sets\\?/.test(String(u))
        ? Promise.resolve(new Response(JSON.stringify({ success: false, code: 'zu_viele_anfragen', error: 'Zu viele Anfragen' }),
            { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '200' } }))
        : window.__echt(u, o); return true; })()`);
    try {
      await b.auswerten(`document.getElementById('gsort').dispatchEvent(new Event('change')); true`);
      await bis(`/Zu viele Anfragen/.test(document.getElementById('toasts').textContent)`, 'Hinweis 429');
    } finally {
      await b.auswerten(`window.fetch = window.__echt; true`);
    }
    const t =
      await b.auswerten(`(() => { const t = [...document.querySelectorAll('#toasts .toast')].find(x => /Zu viele/.test(x.textContent));
      const r = t.getBoundingClientRect(), z = t.querySelector('.toast-close').getBoundingClientRect();
      return { text: t.querySelector('.toast-text').textContent, oben: z.top - r.top, rechts: r.right - z.right }; })()`);
    assert.match(t.text, /^Zu viele Anfragen – in 4 Min\. wieder möglich\./);
    assert.ok(t.oben < 12 && t.rechts < 12, `✕ nicht oben rechts (${breite} px): ${JSON.stringify(t)}`);
    await b.auswerten(`document.querySelectorAll('#toasts .toast').forEach(x => x.remove()); true`);
  }
  await groesse(b, 1280, false);
  // A switch to the collection asks list and metrics once each; the catalog the years only the first time.
  await geh(a, '#/katalog', `!!document.querySelector('#catalog-grid .sc')`, 'Katalog');
  await geh(a, '#/teile', `!!document.querySelector('#tab-parts .part-card')`, 'Teile');
  const vorher = b.ereignisse.length;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
  await geh(a, '#/katalog', `!!document.querySelector('#catalog-grid .sc')`, 'Katalog');
  const pfade = b.ereignisse
    .slice(vorher)
    .filter(e => e.method === 'Network.requestWillBeSent' && /\/api\/v1\//.test(e.params.request.url))
    .map(e => e.params.request.url.replace(/^.*\/api/, '').replace(/\?.*/, ''));
  const zahl = p => pfade.filter(x => x === p).length;
  assert.deepEqual(
    [zahl('/v1/sets'), zahl('/v1/stats'), zahl('/v1/catalog/year-verteilung')],
    [1, 1, 0],
    pfade.join(' '),
  );
}

async function offlineBand(_t, a) {
  const { b, bis } = a;
  await geh(a, '#/finanzen', `!!document.querySelector('#fin-tbl tbody tr')`, 'Finanzen');
  await b.tab('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  try {
    await b.auswerten(`document.querySelector('.ntab[data-tab="finance"]').click(); true`);
    await bis(`!document.getElementById('offline-band').hidden`, 'Offline-Band');
    await b.auswerten(`window.scrollTo(0, 600); true`);
    await bis('window.scrollY > 300', 'gerollt');
    const m = await b.auswerten(`(() => { const band = document.getElementById('offline-band').getBoundingClientRect();
      const k = document.getElementById('btn-umenu').getBoundingClientRect();
      const oben = document.elementFromPoint(k.left + k.width / 2, k.top + k.height / 2);
      return { band: band.top, leiste: document.querySelector('nav').getBoundingClientRect().bottom, menue: !!oben?.closest('#btn-umenu') }; })()`);
    assert.ok(m.menue, 'Benutzermenü verdeckt');
    assert.ok(m.band >= m.leiste - 1, `Band über der Leiste: ${JSON.stringify(m)}`);
  } finally {
    await b.tab('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await b.auswerten(`window.scrollTo(0, 0); true`);
  }
  await bis(`document.getElementById('offline-band').hidden`, 'wieder verbunden', 300).catch(() => {});
}

async function kontrast(_t, a) {
  const { b } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
  await b.tab('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
  try {
    const rand = await b.auswerten(`getComputedStyle(document.querySelector('#tab-gallery .btn.bp')).borderTopWidth`);
    assert.ok(parseFloat(rand) >= 1, `Hauptknopf ohne Rand: ${rand}`);
  } finally {
    await b.tab('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  }
}

async function startupScaffold(_t, a) {
  const { b, bis } = a;
  // The scaffold measures itself before the app removes it; it is compared with the finished page.
  const { identifier } = await b.tab('Page.addScriptToEvaluateOnNewDocument', {
    source: `document.addEventListener('DOMContentLoaded', () => { const r = s => document.querySelector(s)?.getBoundingClientRect().top;
      window.__sg = { kachel: r('#start-skeleton .sg-tiles i'), band: document.documentElement.hasAttribute('data-rb-band'),
        zusatz: getComputedStyle(document.querySelector('#start-skeleton .sg-extra')).display }; });`,
  });
  try {
    await b.auswerten(
      `localStorage.removeItem('bim_rb_hint_dismissed:' + ${a.uid}); window.__alt = true; location.reload(); true`,
    );
    await bis(
      `!window.__alt && !!document.querySelector('#gallery .sc') && !document.getElementById('start-skeleton')`,
      'App nach Neuladen',
      300,
    );
    await a.ruhig();
    const m =
      await b.auswerten(`({ sg: window.__sg, karte: document.querySelector('#gallery .sc').getBoundingClientRect().top,
      band: !document.getElementById('rb-hint').hidden })`);
    assert.ok(m.band, 'Testdaten: Band ohne Rebrickable-Schlüssel');
    assert.ok(m.sg.band, 'Gerüst ohne Platz für das Band');
    assert.notEqual(m.sg.zusatz, 'none', '„Manager“ fehlt im Gerüst');
    assert.ok(Math.abs(m.sg.kachel - m.karte) < 30, `Kacheln springen um ${Math.round(m.karte - m.sg.kachel)} px`);
  } finally {
    await b.tab('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
}

async function loeschen(_t, a, name) {
  const { b, bis } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc[data-arg="21318-1"]')`, 'Sammlung');
  const loesche = async (nr, frage = true) => {
    await b.auswerten(`(() => { const k = document.querySelector('#gallery .sc[data-arg="${nr}"]'); k.focus();
      k.querySelector('.delbtn').click(); return true; })()`);
    if (frage) await bis(`document.getElementById('confirm-modal').style.display === 'flex'`, 'Rückfrage');
    await a.ruhig(3000);
  };
  await loesche('21318-1');
  const frage = await b.auswerten(
    `({ text: ${text('#cd-msg')}, wahl: [...document.querySelectorAll('#cd-choice label')].map(l => l.textContent.trim()),
      gewaehlt: document.querySelector('#cd-choice input:checked')?.closest('label')?.textContent.trim() })`,
  );
  assert.match(frage.text, new RegExp(`${name} \\(ich\\) ×1, ${name}_kind ×1`), 'Konten und Stückzahlen fehlen');
  assert.equal(frage.wahl.length, 3, `keine Auswahl: ${JSON.stringify(frage)}`);
  assert.match(frage.gewaehlt || '', /\(ich\)/, `vorgewählt ist nicht das eigene Exemplar: ${JSON.stringify(frage)}`);
  const vorher = b.ereignisse.length;
  await b.auswerten(
    `[...document.querySelectorAll('#cd-choice label')].find(l => l.textContent.includes('_kind')).querySelector('input').click();
    document.getElementById('cd-confirm').click(); true`,
  );
  await bis(`!document.querySelector('#gallery .sc[data-arg="21318-1"] .owner-badge')`, 'nur noch eigenes Exemplar');
  await a.ruhig();
  const ziel = b.ereignisse
    .slice(vorher)
    .find(e => e.method === 'Network.requestWillBeSent' && e.params.request.method === 'DELETE')?.params.request.url;
  assert.match(ziel, /\/v1\/sets\/21318-1\?accounts=\d+$/, 'nur das Unterkonto gewählt');
  const aktiv = `(() => { const e = document.activeElement; return e.tagName + ' ' + (e.dataset.arg || e.textContent.trim().slice(0, 20)); })()`;
  assert.equal(await b.auswerten(aktiv), 'DIV 21318-1', 'Fokus nicht auf dem bleibenden Set');

  const reihe = await b.auswerten(`[...document.querySelectorAll('#gallery .sc')].map(k => k.dataset.arg)`);
  const nr = reihe[1];
  // Only the own copy: restorable, so no question (js/deletion.js), the toast offers undo.
  await loesche(nr, false);
  await bis(`!document.querySelector('#gallery .sc[data-arg="${nr}"]')`, 'Set gelöscht');
  assert.notEqual(
    await b.auswerten(`document.getElementById('confirm-modal').style.display`),
    'flex',
    'Rückfrage vor dem eigenen Set',
  );
  await a.ruhig();
  assert.equal(await b.auswerten(aktiv), `DIV ${reihe[2]}`, 'Fokus nach dem Löschen nicht auf der nächsten Karte');
  await b.auswerten(
    `(() => { const k = [...document.querySelectorAll('#toasts .toast-action')].at(-1); k.focus(); k.click(); return true; })()`,
  );
  await bis(`!!document.querySelector('#gallery .sc[data-arg="${nr}"]')`, 'zurückgeholt');
  await a.ruhig();
  await bis(`document.activeElement?.dataset?.arg === '${nr}'`, 'Fokus auf der zurückgeholten Karte (Runde 24)');
}

async function abmelden(_t, a, name) {
  const { b, bis } = a;
  // State of the admin: users, background, set dialog with purchase prices, catalog, finances.
  await geh(a, '#/einstellungen', `!!document.querySelector('#users-tbl .user-name')`, 'Benutzerverwaltung');
  await geh(a, '#/hintergrund', `!!document.querySelector('#monitor-content .mon-services')`, 'Hintergrund');
  await geh(a, '#/katalog', `!!document.querySelector('#catalog-grid .sc')`, 'Katalog');
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc[data-arg="21318-1"]')`, 'Sammlung');
  await b.auswerten(`document.querySelector('#gallery .sc[data-arg="21318-1"]').click(); true`);
  await bis(`/199,99/.test(document.getElementById('m-det').textContent)`, 'Set-Dialog');
  await b.auswerten(CLOSE);
  await geh(a, '#/finanzen', `document.getElementById('tab-finance').classList.contains('active')`, 'Finanzen');

  await b.auswerten(`window.__alt = true; document.getElementById('btn-logout').click(); true`);
  await bis(
    `!window.__alt && typeof document.getElementById('btn-login')?.onclick === 'function' && getComputedStyle(document.getElementById('login-screen')).display !== 'none'`,
    'Anmeldemaske',
    300,
  );
  // The browser speaks English (Chrome without a language choice: en-US), the account before it German.
  const mask = { titel: await b.auswerten(`document.title`), knopf: await b.auswerten(text('#btn-login')) };

  await b.auswerten(`document.getElementById('lu').value = ${JSON.stringify(`${name}_en`)};
    document.getElementById('lp').value = ${JSON.stringify(EN_PASS)}; document.getElementById('btn-login').click(); true`);
  await bis(`getComputedStyle(document.getElementById('app')).display !== 'none'`, 'englisch angemeldet', 300);
  await bis(`document.documentElement.lang === 'en' && !!document.querySelector('#gallery .empty')`, 'leere Sammlung');
  await a.ruhig();
  const dom = await b.auswerten(`({ html: document.body.innerHTML, title: document.title,
    live: document.getElementById('match-live').textContent, thema: document.querySelector('#gtheme option[value=""]').textContent,
    zoom: document.getElementById('pdf-viewer-zoom').getAttribute('aria-label') })`);
  const fremd = [`${name}_kind`, '199,99', 'Alle Themen', 'Sets im Katalog', 'Finanzen'].filter(s =>
    dom.html.includes(s),
  );
  assert.deepEqual(fremd, [], 'Stand des vorigen Kontos im Dokument');
  assert.deepEqual(
    mask,
    { titel: 'Sign in – BrickInventory', knopf: 'Sign in' },
    'Anmeldemaske nicht in der Browsersprache',
  );
  assert.equal(dom.title, 'Sets – BrickInventory');
  assert.equal(dom.live, '');
  assert.equal(dom.thema, 'All themes');
  assert.equal(dom.zoom, '100% – reset zoom (key 0)');

  // Empty collection: the hint names the menu only on the phone, also after changing the width.
  const hinweis = () => b.auswerten(text('#gallery .empty p'));
  assert.doesNotMatch(await hinweis(), /•••/);
  await groesse(b, 390, true);
  try {
    await bis(`/•••/.test(${text('#gallery .empty p')})`, 'Hinweis am Telefon');
  } finally {
    await groesse(b, 1280, false);
  }
  await bis(`!/•••/.test(${text('#gallery .empty p')})`, 'Hinweis am Rechner');
}

test('logout, deleting in the household, offline banner, contrast mode', {
  concurrency: 1,
  timeout: 600_000,
}, async t => {
  const name = `r23_${process.pid}`;
  const a = await startApp(t, {
    name,
    bestand: async (db, uid) => {
      await patternHousehold(db, uid);
      // Two open runs of one kind, one after errors: label and long hint on the phone.
      await db.run(`INSERT INTO jobs (type, due_at, attempts, max_attempts, error_message)
        VALUES ('wechselkurse', NOW() + interval '5 hours', 4, 6, 'getaddrinfo ENOTFOUND www.ecb.europa.eu https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip')`);
      await db.run(`INSERT INTO jobs (type, due_at) VALUES ('wechselkurse', NOW() + interval '6 hours')`);
      const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));
      const en = await db.get(
        `INSERT INTO users (username, email, password_hash, is_active, email_verified, is_admin)
         VALUES ($1, $2, $3, true, true, false) RETURNING id`,
        [`${name}_en`, `${name}_en@example.org`, await bcrypt.hash(EN_PASS, 4)],
      );
      await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'language', 'en')`, [en.id]);
    },
  });
  if (a.grund) {
    t.skip(a.grund);
    return;
  }
  t.after(() => a.db.run(`DELETE FROM jobs WHERE type = 'wechselkurse' AND status = 'offen'`).catch(() => {}));
  await a.ruhig();
  /** @type {[string, (t: import('node:test').TestContext, a: object, name: string) => Promise<void>][]} */
  const pruefungen = [
    ['Set-Detail', setDetail],
    ['Alle Ansichten bei 390 px', allViews],
    ['Hintergrundarbeiten', hintergrund],
    ['Finanzen', finanzen],
    ['Bauliste', bauliste],
    ['Telefon nur Karten, gleiche Werkzeugleisten', bars],
    ['Drossel', drossel],
    ['Offline-Band', offlineBand],
    ['Kontrastmodus', kontrast],
    ['Startgerüst', startupScaffold],
    ['Löschen im Haushalt', loeschen],
    ['Abmelden verwirft das vorige Konto', abmelden],
  ];
  for (const [titel, fn] of pruefungen) await t.test(titel, () => fn(t, a, name));
});
