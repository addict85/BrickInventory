/**
 * UX-Prüfung 24 im echten Chrome, im Haushalt mit Unterkonto: M1–M3, N4–N16 und die beiden offenen Punkte
 * aus Runde 23 (Fokus nach „Rückgängig“, „Abbrechen“ in den einzelnen Aufträgen).
 *
 * Gegenproben (14.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  Set-Formular ohne data-submit → rot: „Enter aus jedem Feld“ (add-qty schickt nicht ab)
 *   B  schliesseErfassen() ohne form.reset() → rot: „Esc verwirft den Entwurf“ (Preis „12“)
 *   C  loadFinance zeigt den Fehler wieder in #fin-tbl → rot: „Finanzen bei Serverfehler“ (kein Fehler oben)
 *   D  Katalog wieder ohne .filterleiste → rot: „Filter hinter dem Knopf“ (Katalog: Suche und vier Felder)
 *   E  ohne das Etikett .delbtn[data-taste]::before → rot: „Entf löscht“; hover:none-Regel wieder ohne
 *      :not(:focus-visible) → rot: ebenda (Papierkorb unsichtbar)
 *   F  SET_SORTS ohne name_desc → rot: „Tabelle der Sets“ (absteigend nicht sortiert); Aktionsknöpfe
 *      wieder ohne Setnamen → rot: ebenda
 *   G  erfassungsPreis() ohne den Geschenk-Zweig → rot: „Geschenk und Figurenzahl“ („0,00 €“)
 *   H  die Figurenzahl wieder aus /v1/minifigs?source=set → rot: ebenda (Detail 1, Tabelle 4)
 *   I  Brick .ntab wieder 6px 2px → rot: „Brick bei 320 px“ (Reiter zweizeilig); #app wieder 16 px Rand →
 *      rot: ebenda (Sammlungswahl zweireihig); .hinweis-zu wieder im Fluss → rot: ebenda (× eigene Zeile)
 *   K  .preis-mit-waehrung ohne flex-wrap → rot: „Grosse Schrift: Set hinzufügen“ (Preisfeld 95 px)
 *   L  ohne @container ovl → rot: „Grosse Schrift: Set-Detail“ (250 px Inhalt)
 *   M  rb-hinweis offline wieder sichtbar → rot: „Offline-Band allein“
 *   N  --chart-wert wieder var(--chart-new) → rot: „Wertlinie in der Farbe der Beträge“ (Hochglanz blau)
 *   O  Rückgängig ohne Fokusziel → rot: „Fokus nach Rückgängig“
 *   P  #tab-monitor .mon-knoepfe .btn ohne hyphens:manual → rot: „Abbrechen in einer Zeile“ (42 > 33 px)
 *   Q  Telefontext wieder „neben dem Titel“ → rot: „Leere Sammlung am Telefon“
 *
 * N16 (Datumsfeld 11/14/2026): Das native Feld formatiert nach der Sprache des Browsers, nicht nach `lang`;
 * geprüft wird nur, dass die Seite ihre Sprache richtig setzt.
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp } = require('./helpers/app-browser');
const { musterHaushalt } = require('./helpers/bestand');

const text = sel => `(document.querySelector(${JSON.stringify(sel)})?.textContent || '').replace(/\\s+/g, ' ').trim()`;
const SCHLIESSEN = `document.querySelectorAll('.ovl.open [data-dialog-zu]').forEach(x => x.click()); true`;

async function groesse(b, breite, telefon, hoehe) {
  await b.tab('Emulation.setDeviceMetricsOverride', {
    width: breite,
    height: hoehe || (telefon ? 844 : 900),
    deviceScaleFactor: 1,
    mobile: telefon,
  });
}

async function geh(a, hash, bereit, was) {
  await a.b.auswerten(SCHLIESSEN);
  await a.b.auswerten(`location.hash = ${JSON.stringify(hash)}; true`);
  await a.bis(bereit, was, 200);
  await a.ruhig(5000);
}

/** Eine echte Taste über das DevTools-Protokoll: Nur sie löst das implizite Absenden eines Formulars aus. */
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

const oeffneSetErfassen = `(() => { document.querySelector('#tab-gallery [data-click="oeffneErfassen"][data-arg="set"]').click(); return true; })()`;

async function enterAusJedemFeld(_t, a) {
  const { b, bis } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
  const anfragen = () =>
    b.ereignisse.filter(
      e =>
        e.method === 'Network.requestWillBeSent' &&
        e.params.request.method === 'GET' &&
        /\/api\/v1\/sets\/21318-1$/.test(e.params.request.url),
    ).length;
  for (const feld of ['add-num', 'add-qty', 'add-price', 'add-date']) {
    await b.auswerten(SCHLIESSEN);
    await b.auswerten(oeffneSetErfassen);
    await bis(`document.getElementById('add-set-modal').classList.contains('open')`, 'Dialog offen');
    await b.auswerten(`(() => { document.getElementById('add-num').value = '21318-1';
      document.getElementById('${feld}').focus(); return true; })()`);
    const vorher = anfragen();
    await taste(b, 'Enter', 13);
    await bis(`!document.getElementById('add-unbekannt').hidden`, `Enter aus ${feld} schickt nicht ab`, 50);
    await a.ruhig(2000);
    assert.equal(anfragen() - vorher, 1, `Enter aus ${feld}: Abfragen`);
    assert.match(await b.auswerten(text('#add-unbekannt')), /schon in deiner Sammlung/);
  }
  // Teil und Figur: ohne Nummer meldet der Dialog es am Ergebnis, aus dem Preisfeld abgeschickt.
  for (const [hash, art, feld, ergebnis, meldung] of [
    ['#/teile', 'part', 'ap-price-inline', 'ap-inline-result', 'Teilenummer erforderlich'],
    ['#/minifiguren', 'fig', 'af-price-inline', 'af-inline-result', 'Figur-Nummer erforderlich'],
  ]) {
    await geh(a, hash, `document.querySelector('.tab.active [data-arg="${art}"][data-click="oeffneErfassen"]')`, art);
    await b.auswerten(`(() => { document.querySelector('.tab.active [data-click="oeffneErfassen"][data-arg="${art}"]').click();
      document.getElementById('${ergebnis}').textContent = ''; document.getElementById('${feld}').focus(); return true; })()`);
    await taste(b, 'Enter', 13);
    await bis(`/erforderlich/.test(${text(`#${ergebnis}`)})`, `Enter aus ${feld}`, 50);
    assert.equal(await b.auswerten(text(`#${ergebnis}`)), meldung);
  }
  await b.auswerten(SCHLIESSEN);
}

async function entwurfVerworfen(_t, a) {
  const { b, bis } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
  await b.auswerten(oeffneSetErfassen);
  await bis(`document.getElementById('add-set-modal').classList.contains('open')`, 'Dialog offen');
  await b.auswerten(`(() => { document.getElementById('add-num').value = '10276-1';
    const p = document.getElementById('add-price'); p.value = '12'; p.focus(); return true; })()`);
  await taste(b, 'Escape', 27);
  await bis(`!document.getElementById('add-set-modal').classList.contains('open')`, 'Esc schliesst');
  await b.auswerten(oeffneSetErfassen);
  const m =
    await b.auswerten(`({ preis: document.getElementById('add-price').value, nr: document.getElementById('add-num').value,
    datum: document.getElementById('add-date').value,
    abbrechen: [...document.querySelectorAll('#add-set-modal .erfassen-fuss .btn')].map(k => k.textContent.trim()) })`);
  assert.deepEqual([m.preis, m.nr], ['', ''], `Esc verwirft den Entwurf nicht: ${JSON.stringify(m)}`);
  assert.match(m.datum, /^\d{4}-\d{2}-\d{2}$/, 'Kaufdatum steht wieder auf heute');
  assert.deepEqual(m.abbrechen, ['Abbrechen', 'Hinzufügen']);
  await b.auswerten(`document.querySelector('#add-set-modal .erfassen-fuss .btn.bs').click(); true`);
  await bis(`!document.getElementById('add-set-modal').classList.contains('open')`, '„Abbrechen“ schliesst');
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
      `!window.__alt && !!document.querySelector('#portfolio-chart .fehler-zustand button, #fin-tbl .fehler-zustand button')`,
      'Fehler',
      300,
    );
    await a.ruhig();
    const m = await b.auswerten(`(() => { const k = document.querySelector('.tab.active .fehler-zustand button');
      return { imKasten: !!k?.closest('#portfolio-chart'), unten: k?.getBoundingClientRect().bottom, hoehe: innerHeight,
        karten: document.getElementById('fin-sum').checkVisibility(), strich: [...document.querySelectorAll('#fin-sum .fval')].filter(f => f.checkVisibility() && f.textContent.trim() === '—').length }; })()`);
    assert.ok(m.imKasten, `Fehler nicht im Diagrammkasten: ${JSON.stringify(m)}`);
    assert.ok(m.unten <= m.hoehe, `„Erneut versuchen“ nicht im ersten Bildschirm: ${JSON.stringify(m)}`);
    assert.equal(m.karten, false, 'Karten ohne Zahl stehen über dem Fehler');
    await b.auswerten(
      `window.__fehler = false; document.querySelector('#portfolio-chart .fehler-zustand button').click(); true`,
    );
    await bis(
      `document.getElementById('fin-sum').checkVisibility() && /€/.test(${text('#fin-einstand')})`,
      'nach „Erneut versuchen“',
    );
  } finally {
    await b.tab('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    await groesse(b, 1280, false);
  }
}

async function filterKnopf(_t, a) {
  const { b, bis } = a;
  const reihe = sel =>
    b.auswerten(`[...document.querySelector('${sel} .filterleiste').children].filter(e => e.checkVisibility() && e.getBoundingClientRect().width > 2)
      .map(e => e.matches('.filter-knopf') ? 'Filter' + Math.round(e.getBoundingClientRect().width) : e.matches('.suchfeld') ? 'Suche' : e.tagName)`);
  try {
    for (const breite of [390, 320]) {
      await groesse(b, breite, true);
      await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
      const muster = await reihe('#tab-gallery');
      for (const [hash, tab, bereit] of [
        ['#/katalog', '#tab-catalog', '#catalog-grid .sc'],
        ['#/merkliste', '#tab-wanted', '#mk-list .mk-zeile'],
      ]) {
        await geh(a, hash, `!!document.querySelector('${bereit}')`, tab);
        assert.deepEqual(await reihe(tab), muster, `${tab} bei ${breite} px`);
        await b.auswerten(`document.querySelector('${tab} .filter-knopf').click(); true`);
        await bis(
          `document.querySelector('${tab} .filterleiste > select').checkVisibility()`,
          `${tab}: Filter aufgeklappt`,
        );
        await b.auswerten(`document.querySelector('${tab} .filter-knopf').click(); true`);
      }
    }
  } finally {
    await groesse(b, 1280, false);
  }
}

async function entfLoescht(_t, a) {
  const { b, bis } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
  await b.auswerten(`document.getElementById('gs').focus(); true`);
  for (let i = 0; i < 12; i++) {
    await taste(b, 'Tab', 9);
    if (await b.auswerten(`document.activeElement.matches('#gallery .sc')`)) break;
  }
  await bis(`document.activeElement.matches('#gallery .sc')`, 'Karte mit Tab erreicht', 5);
  const m =
    await b.auswerten(`(() => { const d = document.activeElement.querySelector('.delbtn'), r = d.getBoundingClientRect();
    return { breite: r.width, deckend: getComputedStyle(d.parentElement).opacity, etikett: getComputedStyle(d, '::before').content }; })()`);
  assert.ok(m.breite > 0 && m.deckend === '1', `Papierkorb unsichtbar: ${JSON.stringify(m)}`);
  assert.equal(m.etikett, '"Entf löscht"');
}

async function setsTabelle(_t, a) {
  const { b, bis } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
  await b.auswerten(`document.getElementById('vl').click(); true`);
  await bis(`!!document.querySelector('#gallery table')`, 'Tabelle');
  try {
    const t = await b.auswerten(`(() => { const kopf = [...document.querySelectorAll('#gallery thead th')];
      const z = document.querySelector('#gallery tr[data-arg="10294-1"]');
      return { koepfe: kopf.map(k => k.textContent.trim()), zellen: z.children.length,
        datum: z.children[kopf.findIndex(k => k.textContent.trim() === 'Gekauft am')]?.textContent.trim(),
        namen: [...z.querySelectorAll('.zeilen-aktionen button')].map(k => k.getAttribute('aria-label')),
        bunt: !!z.querySelector('.zeilen-aktionen [fill^="#"]') }; })()`);
    assert.equal(t.koepfe.length, t.zellen, 'Spalten ohne Kopf');
    assert.deepEqual(
      t.koepfe.filter(k => !k),
      [],
      `leere Spaltenköpfe: ${JSON.stringify(t.koepfe)}`,
    );
    assert.ok(!t.koepfe.includes('In der App eingetragen'), 'Aufnahmedatum statt Kaufdatum');
    assert.equal(t.datum, '01.06.2026', 'Kaufdatum');
    assert.deepEqual(t.namen, ['Teile von Titanic neu importieren', 'Titanic löschen']);
    assert.equal(t.bunt, false, 'buntes Sinnbild in der Zeile');

    const folge = `[...document.querySelectorAll('#gallery tbody tr')].map(z => z.children[2].textContent.trim())`;
    const stand = `document.querySelector('#gallery [data-arg="name"]').closest('th').getAttribute('aria-sort')`;
    await b.auswerten(`document.querySelector('#gallery [data-click="setsSortieren"][data-arg="name"]').click(); true`);
    await bis(`${stand} === 'ascending'`, 'Name aufsteigend');
    const auf = await b.auswerten(folge);
    assert.deepEqual(
      auf,
      [...auf].sort((x, y) => x.localeCompare(y, 'de')),
    );
    await b.auswerten(`document.querySelector('#gallery [data-click="setsSortieren"][data-arg="name"]').click(); true`);
    await bis(`${stand} === 'descending'`, 'Name absteigend');
    await a.ruhig();
    assert.deepEqual(await b.auswerten(folge), [...auf].reverse(), 'absteigend nicht sortiert');
    assert.equal(
      await b.auswerten(`document.activeElement.dataset.arg`),
      'name',
      'Fokus nach dem Sortieren nicht am Kopf',
    );
  } finally {
    await b.auswerten(`(() => { const s = document.getElementById('gsort'); s.value = 'added_desc';
      s.dispatchEvent(new Event('change')); document.getElementById('vg').click(); return true; })()`);
    await a.ruhig();
  }
}

async function geschenkUndFiguren(_t, a) {
  const { b, bis } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
  await b.auswerten(`document.getElementById('vl').click(); true`);
  await bis(`!!document.querySelector('#gallery tr[data-arg="10300-1"]')`, 'Tabelle');
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
  assert.equal(tabelle, '4', 'Testdaten: Katalog kennt 4 Figuren');
  assert.equal(d.figuren, tabelle, 'Tabelle und Detail zählen verschieden');
  await b.auswerten(SCHLIESSEN);
}

async function brick320(_t, a) {
  const { b, bis } = a;
  const alt = await b.auswerten(`document.documentElement.getAttribute('data-theme')`);
  await b.auswerten(`(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('bim_rb_hinweis_weg')) localStorage.removeItem(k);
    document.documentElement.setAttribute('data-theme', 'brick'); return true; })()`);
  await groesse(b, 320, true);
  try {
    await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
    await bis(`document.getElementById('rb-hinweis').checkVisibility()`, 'Rebrickable-Hinweis');
    const m =
      await b.auswerten(`(() => { const l = document.querySelector('nav .ntab.gruppe-aktiv .tab-label, nav .ntab.active .tab-label');
      const r = s => document.querySelector(s).getBoundingClientRect();
      return { zeilen: Math.round(l.getBoundingClientRect().height / parseFloat(getComputedStyle(l).lineHeight)),
        reihen: new Set([...document.querySelectorAll('#tab-gallery .sammlung-wahl button')].map(k => Math.round(k.getBoundingClientRect().top))).size,
        zu: r('#rb-hinweis .hinweis-zu').top, knopf: r('#rb-hinweis .btn.bp').top, band: r('#rb-hinweis').height,
        breit: document.documentElement.scrollWidth }; })()`);
    assert.equal(m.zeilen, 1, `aktiver Reiter bricht um: ${JSON.stringify(m)}`);
    assert.equal(m.reihen, 1, `Sammlungswahl zweireihig: ${JSON.stringify(m)}`);
    assert.ok(Math.abs(m.zu - m.knopf) < 2 && m.band < 70, `× in eigener Zeile: ${JSON.stringify(m)}`);
    assert.ok(m.breit <= 320, `Seite breiter als das Fenster: ${m.breit}`);
  } finally {
    await b.auswerten(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(alt || 'classic')}); true`);
    await groesse(b, 1280, false);
  }
}

async function grosseSchriftErfassen(_t, a) {
  const { b, bis } = a;
  await groesse(b, 320, true);
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
  try {
    await b.auswerten(`document.documentElement.style.fontSize = '32px'; true`);
    await b.auswerten(oeffneSetErfassen);
    await bis(`document.getElementById('add-set-modal').classList.contains('open')`, 'Dialog');
    await a.ruhig(1000);
    const m = await b.auswerten(`(() => { const r = id => document.getElementById(id).getBoundingClientRect();
      return { preis: r('add-price').width, oben: r('add-price').top, waehrung: r('add-currency').top }; })()`);
    assert.ok(m.preis >= 200, `Preisfeld zu schmal: ${JSON.stringify(m)}`);
    assert.ok(m.waehrung > m.oben, `Währung nicht unter dem Preis: ${JSON.stringify(m)}`);
  } finally {
    await b.auswerten(`${SCHLIESSEN}; document.documentElement.style.fontSize = ''; true`);
    await groesse(b, 1280, false);
  }
}

async function grosseSchriftDetail(_t, a) {
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
    assert.ok(m.inhalt >= 400, `Kopf und Fuss lassen dem Inhalt zu wenig: ${JSON.stringify(m)}`);
  } finally {
    await b.auswerten(`${SCHLIESSEN}; document.documentElement.style.fontSize = ''; true`);
    await groesse(b, 1280, false);
  }
}

async function offlineBand(_t, a) {
  const { b, bis } = a;
  await groesse(b, 390, true);
  await b.auswerten(
    `(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('bim_rb_hinweis_weg')) localStorage.removeItem(k); return true; })()`,
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
    const m = await b.auswerten(`({ rb: document.getElementById('rb-hinweis').checkVisibility(),
      band: document.getElementById('offline-band').getBoundingClientRect().height })`);
    assert.equal(m.rb, false, 'Rebrickable-Hinweis neben dem Offline-Band');
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
  await bis(`document.getElementById('offline-band').hidden`, 'wieder verbunden', 300).catch(() => {});
}

async function wertlinie(_t, a) {
  const { b } = a;
  await geh(a, '#/finanzen', `!!document.querySelector('#portfolio-chart svg polyline')`, 'Wertdiagramm');
  const alt = await b.auswerten(`document.documentElement.getAttribute('data-theme')`);
  try {
    // Werkbank zeichnet die Linie bewusst in Messing (Runde 11).
    for (const design of ['classic', 'brick', 'farbfaecher', 'noppe', 'hochglanz']) {
      const m = await b.auswerten(`(() => { document.documentElement.setAttribute('data-theme', '${design}');
        return { linie: getComputedStyle(document.querySelector('#portfolio-chart svg polyline')).stroke,
          betrag: getComputedStyle(document.getElementById('portfolio-current')).color,
          leiste: getComputedStyle(document.querySelector('#fin-sum .fstat.hi')).borderTopColor }; })()`);
      assert.equal(m.linie, m.betrag, `${design}: Wertlinie nicht in der Farbe der Beträge`);
      if (design === 'noppe' || design === 'hochglanz') assert.equal(m.leiste, m.linie, `${design}: Marktwert-Leiste`);
    }
  } finally {
    await b.auswerten(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(alt || 'classic')}); true`);
  }
}

async function sprache(_t, a) {
  const m = await a.b.auswerten(`({ lang: document.documentElement.lang,
    eigen: document.getElementById('add-date').closest('[lang]')?.tagName })`);
  assert.deepEqual(m, { lang: 'de', eigen: 'HTML' });
}

async function rueckgaengig(_t, a) {
  const { b, bis } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc[data-arg="75192-1"]')`, 'Sammlung');
  await b.auswerten(`(() => { const k = document.querySelector('#gallery .sc[data-arg="75192-1"]'); k.focus();
    k.querySelector('.delbtn').click(); return true; })()`);
  await bis(`document.getElementById('confirm-modal').style.display === 'flex'`, 'Rückfrage');
  await a.ruhig(2000);
  await b.auswerten(`document.getElementById('cd-confirm').click(); true`);
  await bis(`!document.querySelector('#gallery .sc[data-arg="75192-1"]')`, 'gelöscht');
  await a.ruhig();
  await b.auswerten(
    `(() => { const k = [...document.querySelectorAll('#toasts .toast-aktion')].at(-1); k.focus(); k.click(); return true; })()`,
  );
  await bis(`!!document.querySelector('#gallery .sc[data-arg="75192-1"]')`, 'zurückgeholt');
  await bis(`document.activeElement?.dataset?.arg === '75192-1'`, 'Fokus auf der zurückgeholten Karte', 60);
}

async function abbrechenEinzeilig(_t, a) {
  const { b, bis } = a;
  await geh(a, '#/hintergrund', `!!document.querySelector('#auftraege-karte .mon-einzeln')`, 'Hintergrund');
  await b.auswerten(`document.querySelectorAll('#tab-monitor details').forEach(d => { d.open = true; }); true`);
  await bis(
    `[...document.querySelectorAll('#auftraege-karte .mon-knoepfe .btn')].some(k => k.textContent.trim() === 'Abbrechen')`,
    'Abbrechen',
  );
  const h = await b.auswerten(`(() => { const k = [...document.querySelectorAll('#auftraege-karte .mon-knoepfe .btn')];
    const hoehe = t => Math.max(...k.filter(x => x.textContent.trim() === t).map(x => x.getBoundingClientRect().height));
    return { abbrechen: hoehe('Abbrechen'), jetzt: hoehe('Jetzt starten') }; })()`);
  assert.ok(h.abbrechen <= h.jetzt + 1, `„Abbrechen“ bricht um: ${JSON.stringify(h)}`);
}

async function leereSammlung(_t, a, kid) {
  const { b } = a;
  await a.db.run('DELETE FROM set_acquisitions WHERE user_id = ANY($1)', [[a.uid, kid]]);
  await a.db.run('DELETE FROM sets WHERE user_id = ANY($1)', [[a.uid, kid]]);
  await groesse(b, 390, true);
  try {
    await geh(a, '#/finanzen', `document.getElementById('tab-finance').classList.contains('active')`, 'Finanzen');
    await geh(a, '#/sammlung', `!!document.querySelector('#gallery .empty p')`, 'leere Sammlung');
    const m =
      await b.auswerten(`(() => { const s = document.querySelector('#tab-gallery .import-menue > summary').getBoundingClientRect();
      const w = document.querySelector('#tab-gallery .sammlung-wahl').getBoundingClientRect();
      return { text: ${text('#gallery .empty p')}, rechts: innerWidth - s.right, oben: s.top - w.top,
        titel: getComputedStyle(document.querySelector('#tab-gallery .ph h1')).opacity }; })()`);
    assert.equal(m.titel, '0', 'Testdaten: Titel am Telefon unsichtbar');
    assert.match(m.text, /••• oben rechts/);
    assert.ok(m.rechts < 40 && Math.abs(m.oben) < 20, `••• nicht oben rechts: ${JSON.stringify(m)}`);
  } finally {
    await groesse(b, 1280, false);
  }
}

test('UX-Prüfung 24 im Browser', { concurrency: 1, timeout: 600_000 }, async t => {
  const name = `r24_${process.pid}`;
  let kid = 0;
  const a = await starteApp(t, {
    name,
    alleDesigns: true,
    bestand: async (db, uid) => {
      kid = await musterHaushalt(db, uid);
      await db.run(`INSERT INTO auftraege (art, faellig_ab) VALUES ('wechselkurse', NOW() + interval '6 hours')`);
    },
  });
  if (a.grund) {
    t.skip(a.grund);
    return;
  }
  t.after(() => a.db.run(`DELETE FROM auftraege WHERE art = 'wechselkurse' AND status = 'offen'`).catch(() => {}));
  await a.ruhig();
  /** @type {[string, (t: import('node:test').TestContext, a: object, kid: number) => Promise<void>][]} */
  const pruefungen = [
    ['Enter aus jedem Feld', enterAusJedemFeld],
    ['Esc verwirft den Entwurf, „Abbrechen“', entwurfVerworfen],
    ['Filter hinter dem Knopf', filterKnopf],
    ['Entf löscht', entfLoescht],
    ['Tabelle der Sets', setsTabelle],
    ['Geschenk und Figurenzahl', geschenkUndFiguren],
    ['Brick bei 320 px', brick320],
    ['Grosse Schrift: Set hinzufügen', grosseSchriftErfassen],
    ['Grosse Schrift: Set-Detail', grosseSchriftDetail],
    ['Offline-Band allein', offlineBand],
    ['Wertlinie in der Farbe der Beträge', wertlinie],
    ['Sprache der Seite', sprache],
    ['Fokus nach Rückgängig', rueckgaengig],
    ['Abbrechen in einer Zeile', abbrechenEinzeilig],
    // Lädt die Seite neu und verliert damit die übrigen Design-Stylesheets: nach den Designprüfungen.
    ['Finanzen bei Serverfehler', finanzenFehler],
    ['Leere Sammlung am Telefon', leereSammlung],
  ];
  for (const [titel, fn] of pruefungen) await t.test(titel, () => fn(t, a, kid));
});
