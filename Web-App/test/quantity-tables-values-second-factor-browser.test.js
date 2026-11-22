/**
 * UX check 25 in real Chrome, in the household with a sub-account: N1–N8, images of different shapes (B1),
 * finance terms (B2) and the language of the date field in English (B3).
 *
 * Counter-checks (measured 14.11.2026, each on its own, bundle or dist rebuilt):
 *   A  mQtyDec() without `if (n <= 1) return` → red: „„−“ bei einem Exemplar“ (field shows 0); setQuantitiesField()
 *      without aria-disabled → red: same place (not locked)
 *   B  .load-dot again height:1px → red: „Schwebender Knopf verdeckt nichts“ (parts 390 px: closing line
 *      751 > button 716)
 *   C  updateGalleryPrices() without [data-tabwert-for] → red: „Tabellenansicht …“ (market value „—“)
 *   D  column „Stückpreis“ including cells back → red: „Finanzen ohne leere Spalte“; parts/figures again with
 *      an empty state cell → red: same place
 *   E  finance.stat.purchase_basis again „Kaufpreis der Positionen mit Marktpreis“ → red: „Finanzbegriffe“;
 *      finance.basis.computed again with the second sentence → red: same place (390 px: 5 instead of 3 lines)
 *   F  clearerReason() without the branch for admins → red: „Serverfehler für Verwalter“
 *   G  bar again for every service with total > 0 → red: „Aufträge und Fortschritt“ (also „idle“, „done“);
 *      .mon-extra without display:block → red: same place (number 123 px left of the edge, addition next to it)
 *   H  newRecoveryCodes() reads #zf-code again → red: „Zweiter Faktor: Code im Dialog“ (no dialog)
 *   I  refreshPageName() without observeSetDetail() → red: „Seitentitel im Set-Detail“
 *   K  .pl-bar without align-self:stretch → red: „Bauliste: breites Feld“ (1280 px: 205 px);
 *      mobile.css without .pl-setnr { flex-basis: 100% } → red: same place (390 px: 209 of 358 px)
 *   L  .wanted-box-header without display:flex/align-items:center → red: „Merkliste zugeklappt“ (top 9, bottom 32 px)
 *   M  thumbs.ts again fit: 'cover' (dist rebuilt) → red: „Bilder verschiedener Form“ (r25breit-1: preview 1:1
 *      instead of 8:1)
 *   N  (16.11.2026) `withCode: true` deleted in disableSecondFactor() → red: „Zweiter Faktor: Code im Dialog“
 *      (set up anew without a code field)
 *
 * B3: the native date field formats by the language of the browser, not by `lang` (round 24, N16);
 * what is checked is that the page carries `lang="en"` after the language switch and the field inherits it.
 *
 * Without Chrome (CHROME_BIN, google-chrome, chromium) it is skipped.
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { startApp } = require('./helpers/app-browser');
const { patternHousehold, catalogSet, holdsSet } = require('./helpers/inventory');

const text = sel => `(document.querySelector(${JSON.stringify(sel)})?.textContent || '').replace(/\\s+/g, ' ').trim()`;
const CLOSE = `document.querySelectorAll('.ovl.open [data-dialog-close]').forEach(x => x.click()); true`;
const ROOT = path.join(__dirname, '..');

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

async function language(a, lang) {
  await a.b.auswerten(`(() => { const s = document.getElementById('lang-select'); s.value = '${lang}';
    s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await a.bis(`document.documentElement.lang === '${lang}'`, `Sprache ${lang}`);
  await a.ruhig();
}

/** A PNG with an alpha channel; `farbe(x, y, border)` returns [r, g, b, a]. The red border shows whether something is cut off. */
function png(w, h, farbe) {
  const block = (typ, daten) => {
    const laenge = Buffer.alloc(4);
    laenge.writeUInt32BE(daten.length);
    const inhalt = Buffer.concat([Buffer.from(typ), daten]);
    const pruef = Buffer.alloc(4);
    pruef.writeUInt32BE(zlib.crc32(inhalt));
    return Buffer.concat([laenge, inhalt, pruef]);
  };
  const kopf = Buffer.alloc(13);
  kopf.writeUInt32BE(w, 0);
  kopf.writeUInt32BE(h, 4);
  kopf[8] = 8;
  kopf[9] = 6;
  const roh = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      roh.set(farbe(x, y, x < 2 || y < 2 || x >= w - 2 || y >= h - 2), y * (w * 4 + 1) + 1 + x * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    block('IHDR', kopf),
    block('IDAT', zlib.deflateSync(roh)),
    block('IEND', Buffer.alloc(0)),
  ]);
}
const voll = (_x, _y, rand) => (rand ? [255, 0, 0, 255] : [40, 120, 200, 255]);
const transparent = (x, y, rand) => (rand ? [255, 0, 0, 255] : (x + y) % 2 ? [0, 0, 0, 0] : [200, 40, 40, 255]);
/** Number, width, height, pattern: landscape, portrait, square, very wide, small with transparency. */
const IMAGES = [
  ['r25quer-1', 400, 200, voll],
  ['r25hoch-1', 200, 400, voll],
  ['r25quadrat-1', 300, 300, voll],
  ['r25breit-1', 800, 100, voll],
  ['r25klein-1', 32, 32, transparent],
];

/** How the app stores its set images: <nr>.jpg under data/images/sets, the preview next to it (vorschauErzeugenAus). */
async function putImages(t, db, uid, req) {
  const ordner = path.join(ROOT, 'data', 'images', 'sets');
  fs.mkdirSync(ordner, { recursive: true });
  const weg = () => {
    for (const [nr] of IMAGES)
      for (const datei of [`${nr}.jpg`, `${nr}_thumb.jpg`]) fs.rmSync(path.join(ordner, datei), { force: true });
  };
  weg();
  t.after(weg);
  for (const [nr, w, h, f] of IMAGES) {
    fs.writeFileSync(path.join(ordner, `${nr}.jpg`), png(w, h, f));
    assert.ok(await req('src/images/thumbs.js').previewFrom(`/images/sets/${nr}.jpg`), `Vorschau ${nr}`);
    await catalogSet(db, nr, { name: `Bildprobe ${nr}`, year: 2020, theme: 'Bildprobe', pieces: 100 });
    await db.run('UPDATE set_catalog SET image_local = $2 WHERE set_number = set_number_with_version($1)', [
      nr,
      `/images/sets/${nr}.jpg`,
    ]);
    await holdsSet(db, uid, nr, 1, { preis: 10, am: '2026-06-03T10:00:00Z' });
  }
}

/** Per visible image: aspect ratio of the file and of the painted image (object-fit), position in the frame. */
const IMAGE_SIZE = sel => `(() => [...document.querySelectorAll(${JSON.stringify(sel)})]
  .filter(i => i.checkVisibility() && /r25/.test(i.currentSrc || i.src)).map(i => {
    const r = i.getBoundingClientRect(), s = getComputedStyle(i);
    const bw = r.width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) - parseFloat(s.borderLeftWidth) - parseFloat(s.borderRightWidth);
    const bh = r.height - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom) - parseFloat(s.borderTopWidth) - parseFloat(s.borderBottomWidth);
    const datei = i.naturalWidth / i.naturalHeight;
    let gw = bw, gh = bh;
    if (s.objectFit === 'contain' || s.objectFit === 'scale-down') { if (bw / bh > datei) gw = bh * datei; else gh = bw / datei; }
    const rahmen = i.closest('.sci, td, .m-header, .modal').getBoundingClientRect();
    return { nr: (i.currentSrc || i.src).replace(/.*sets\\/|(_thumb)?\\.jpg.*/g, ''), geladen: i.complete && i.naturalWidth > 0,
      datei: +datei.toFixed(3), painted: +(gw / gh).toFixed(3), fit: s.objectFit,
      raus: r.left < rahmen.left - 0.5 || r.right > rahmen.right + 0.5 || r.top < rahmen.top - 0.5 || r.bottom > rahmen.bottom + 0.5 };
  }))()`;

function checkImages(m, wo, count) {
  assert.equal(m.length, count, `${wo}: ${m.length} Bilder statt ${count}`);
  for (const x of m) {
    const soll = IMAGES.find(([nr]) => nr === x.nr);
    assert.ok(soll && x.geladen, `${wo}: ${x.nr} nicht geladen`);
    const source = Number(soll[1]) / Number(soll[2]);
    // A preview may be smaller, but not shaped differently: a square one would mean „zugeschnitten“.
    assert.ok(Math.abs(x.datei / source - 1) < 0.05, `${wo}: ${x.nr} Datei ${x.datei} statt ${source} (zugeschnitten)`);
    assert.ok(
      Math.abs(x.painted / source - 1) < 0.05,
      `${wo}: ${x.nr} gemalt ${x.painted} statt ${source} (gestreckt)`,
    );
    assert.ok(!x.raus, `${wo}: ${x.nr} ragt aus seinem Rahmen`);
  }
}

async function bilder(_t, a) {
  const { b, bis } = a;
  try {
    for (const dunkel of [false, true]) {
      await b.auswerten(`document.documentElement.toggleAttribute('data-dark', ${dunkel}); true`);
      for (const [breite, telefon] of [
        [1280, false],
        [390, true],
        [320, true],
      ]) {
        const wo = `${breite} px ${dunkel ? 'dark' : 'hell'}`;
        await groesse(b, breite, telefon);
        await geh(a, '#/sammlung', `document.querySelectorAll('#gallery .sc').length >= 9`, 'Sammlung');
        await b.auswerten(`document.getElementById('vg').click(); true`);
        await bis(`!!document.querySelector('#gallery .sgrid')`, 'Kacheln');
        await b.auswerten(`document.querySelectorAll('#gallery img').forEach(i => { i.loading = 'eager'; }); true`);
        await bis(
          `[...document.querySelectorAll('#gallery .sci img')].filter(i => /r25/.test(i.src)).every(i => i.complete && i.naturalWidth)`,
          `${wo}: Kachelbilder`,
        );
        checkImages(await b.auswerten(IMAGE_SIZE('#gallery .sci img')), `Kacheln ${wo}`, IMAGES.length);
        // Calm grid: in one row all image areas are the same size.
        const reihen = await b.auswerten(`(() => { const m = {};
          for (const k of document.querySelectorAll('#gallery .sc')) { const r = k.getBoundingClientRect(), s = k.querySelector('.sci').getBoundingClientRect();
            (m[Math.round(r.top)] ||= new Set()).add(Math.round(s.width) + 'x' + Math.round(s.height)); }
          return Object.values(m).map(s => [...s]); })()`);
        assert.ok(
          reihen.every(r => r.length === 1),
          `${wo}: Bildflächen einer Reihe verschieden: ${JSON.stringify(reihen)}`,
        );
        if (!telefon) {
          await b.auswerten(`document.getElementById('vl').click(); true`);
          await bis(`!!document.querySelector('#gallery table')`, 'Tabelle');
          await b.auswerten(`document.querySelectorAll('#gallery img').forEach(i => { i.loading = 'eager'; }); true`);
          await bis(
            `[...document.querySelectorAll('#gallery table img')].filter(i => /r25/.test(i.src)).every(i => i.complete && i.naturalWidth)`,
            `${wo}: Tabellenbilder`,
          );
          checkImages(await b.auswerten(IMAGE_SIZE('#gallery table img')), `Tabelle ${wo}`, IMAGES.length);
          await b.auswerten(`document.getElementById('vg').click(); true`);
        }
        for (const [nr] of IMAGES) {
          await b.auswerten(
            `document.querySelector('#gallery [data-click="openModal"][data-arg="${nr}"]').click(); true`,
          );
          await bis(
            `(i => document.getElementById('set-modal').classList.contains('open') && /${nr}\\.jpg/.test(i.src) && i.complete && i.naturalWidth)(document.getElementById('m-img'))`,
            `${wo}: Detail ${nr}`,
          );
          checkImages(await b.auswerten(IMAGE_SIZE('#m-img')), `Detail ${wo}`, 1);
          await b.auswerten(CLOSE);
        }
      }
    }
  } finally {
    await b.auswerten(`document.documentElement.removeAttribute('data-dark'); true`);
    await groesse(b, 1280, false);
  }
}

async function minusAtOne(_t, a) {
  const { b, bis } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc[data-arg="10300-1"]')`, 'Sammlung');
  await b.auswerten(`document.querySelector('#gallery .sc[data-arg="10300-1"]').click(); true`);
  await bis(`document.getElementById('m-qty')?.value === '1' && !!document.getElementById('m-qty-dec')`, 'Detail');
  const writing = () =>
    b.eventList.filter(
      e =>
        e.method === 'Network.requestWillBeSent' &&
        e.params.request.method !== 'GET' &&
        /\/api\/v2\/sets\/10300-1/.test(e.params.request.url),
    ).length;
  const state = () =>
    b.auswerten(`(() => { const k = document.getElementById('m-qty-dec');
      return { wert: document.getElementById('m-qty').value, gesperrt: k.getAttribute('aria-disabled'), titel: k.title,
        beschreibung: document.getElementById(k.getAttribute('aria-describedby') || '-')?.textContent || '' }; })()`);
  const vorher = writing();
  const m = await state();
  assert.equal(m.gesperrt, 'true', `„−“ bei einem Exemplar nicht gesperrt: ${JSON.stringify(m)}`);
  assert.equal(m.titel, 'Zum Entfernen: „Set löschen“ unter „Weitere Aktionen“');
  assert.equal(m.beschreibung, m.titel, 'Vorleser hören den Hinweis nicht');
  await b.auswerten(`document.getElementById('m-qty-dec').click(); true`);
  await a.warte(700);
  assert.deepEqual([(await state()).wert, writing() - vorher], ['1', 0], '„−“ bei 1 hat etwas getan');
  await b.auswerten(`document.querySelector('[data-click="mQtyInc"]').click(); true`);
  await bis(`document.getElementById('m-qty-dec').getAttribute('aria-disabled') === 'false'`, '„−“ frei bei 2');
  assert.equal((await state()).titel, '', 'Hinweis bleibt bei 2 stehen');
  await bis(`document.querySelector('#m-quantity .field-status')?.textContent.trim() !== ''`, 'saved');
  await a.ruhig();
  await b.auswerten(`document.getElementById('m-qty-dec').click(); true`);
  await bis(`document.getElementById('m-qty-dec').getAttribute('aria-disabled') === 'true'`, 'zurück auf 1');
  // Saving happens 400 ms later; closed before that, the 2 would remain.
  await a.warte(700);
  await a.ruhig();
  await b.auswerten(CLOSE);
}

async function floatingButton(_t, a) {
  const { b } = a;
  await language(a, 'en');
  try {
    // B3: the date field inherits the language of the page.
    assert.deepEqual(
      await b.auswerten(
        `({ lang: document.documentElement.lang, eigen: document.getElementById('add-date').closest('[lang]')?.tagName })`,
      ),
      { lang: 'en', eigen: 'HTML' },
    );
    for (const breite of [390, 320]) {
      await groesse(b, breite, true);
      for (const [hash, tab] of [
        ['#/teile', 'parts'],
        ['#/sammlung', 'gallery'],
        ['#/minifiguren', 'minifigs'],
      ]) {
        await geh(a, hash, `document.getElementById('tab-${tab}').classList.contains('active')`, tab);
        await a.warte(300);
        await b.auswerten(`scrollTo(0, document.documentElement.scrollHeight); true`);
        await a.ruhig();
        const m =
          await b.auswerten(`(() => { const f = document.querySelector('#tab-${tab} .button-floating').getBoundingClientRect();
          const blaetter = [...document.querySelectorAll('#tab-${tab} *')].filter(e => !e.closest('.button-floating') && !e.children.length
            && (e.textContent.trim() || e.matches('img, svg')) && e.checkVisibility());
          const unten = blaetter.map(e => ({ e, r: e.getBoundingClientRect() })).filter(x => x.r.height > 0 && x.r.bottom > 0)
            .sort((x, y) => y.r.bottom - x.r.bottom)[0];
          const ueber = blaetter.filter(e => { const r = e.getBoundingClientRect();
            return r.height > 0 && r.bottom > f.top && r.top < f.bottom && r.right > f.left && r.left < f.right; });
          return { buttonTop: Math.round(f.top), letzte: unten && { text: unten.e.textContent.trim().slice(0, 40), unten: Math.round(unten.r.bottom) },
            ueber: ueber.map(e => e.textContent.trim().slice(0, 30) || e.tagName) }; })()`);
        assert.ok(m.letzte, `${tab} ${breite} px: keine letzte Zeile gefunden`);
        assert.deepEqual(m.ueber, [], `${tab} ${breite} px: vom Knopf verdeckt: ${JSON.stringify(m)}`);
        assert.ok(
          m.letzte.unten <= m.buttonTop,
          `${tab} ${breite} px: letzte Zeile unter dem Knopf: ${JSON.stringify(m)}`,
        );
      }
    }
  } finally {
    await groesse(b, 1280, false);
    await language(a, 'de');
  }
}

async function tabellenansicht(_t, a) {
  const { b, bis } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
  await b.auswerten(`document.getElementById('vl').click(); true`);
  await bis(`!!document.querySelector('#gallery table')`, 'Tabelle');
  // Re-sorted, the list reloads: the table stands there before the prices, the market value comes afterwards.
  await b.auswerten(`document.querySelector('#gallery thead [data-click="sortSets"][data-arg="num"]').click(); true`);
  // Wait for the market value column itself: a later redraw briefly resets it to „—“.
  await a.ruhig();
  await bis(
    `(() => { const kopf = [...document.querySelectorAll('#gallery thead th')].map(k => k.textContent.trim());
      const z = document.querySelector('#gallery tr[data-arg="75192-1"]')?.children[kopf.indexOf('Marktwert')];
      return /€.*%/.test(z?.textContent || ''); })()`,
    'Marktwert mit Entwicklung in der Tabelle',
  );
  const m =
    await b.auswerten(`(() => { const kopf = [...document.querySelectorAll('#gallery thead th')].map(k => k.textContent.trim());
    const zelle = (nr, k) => { const z = document.querySelector('#gallery tr[data-arg="' + nr + '"]').children[kopf.indexOf(k)].cloneNode(true);
      z.querySelectorAll('.vh').forEach(v => v.remove()); return z.textContent.replace(/\\s+/g, ' ').trim(); };
    return { kopf, untertitel: ${text('#tab-gallery .ptitle-sub')},
      falcon: [zelle('75192-1', 'Kaufpreis'), zelle('75192-1', 'Marktwert')], geschenk: zelle('10300-1', 'Kaufpreis') }; })()`);
  await b.auswerten(`document.getElementById('vg').click(); true`);
  assert.match(m.untertitel, /Kaufpreis und Marktwert|Kaufpreis, Marktwert/, 'Testdaten: Untertitel verspricht beides');
  assert.ok(m.kopf.includes('Kaufpreis') && m.kopf.includes('Marktwert'), `Spalten fehlen: ${m.kopf.join(' | ')}`);
  assert.match(m.falcon[0], /^650,00\s€$/);
  assert.match(m.falcon[1], /^801,50\s€\s*\+23,3\s%$/, `Marktwert mit Entwicklung: ${m.falcon[1]}`);
  assert.equal(m.geschenk, 'Geschenk');
}

async function financeColumns(_t, a) {
  const { b } = a;
  await geh(a, '#/finanzen', `!!document.querySelector('#fin-tbl [data-fin-kind="parts"] tbody tr')`, 'Finanzen');
  const m =
    await b.auswerten(`(() => { const sichtbar = z => { const k = z.cloneNode(true); k.querySelectorAll('.vh').forEach(v => v.remove());
      return k.textContent.trim() || (k.querySelector('img, svg') ? 'Bild' : ''); };
    const leer = [...document.querySelectorAll('#fin-tbl [data-fin-kind] table')].flatMap(t => {
      const kopf = [...t.querySelectorAll('thead th')].map(k => k.textContent.trim());
      const zeilen = [...t.querySelectorAll('tbody tr')];
      return kopf.filter((k, i) => zeilen.length && zeilen.every(z => !sichtbar(z.children[i] || z))).map(k => t.getAttribute('aria-label') + ': ' + (k || '(ohne Kopf)'));
    });
    const teil = [...document.querySelectorAll('[data-fin-kind="parts"] tbody tr')].find(z => /250/.test(z.textContent) && /0,12/.test(z.textContent));
    return { leer, headers: [...document.querySelectorAll('[data-fin-kind="sets"] thead th')].map(k => k.textContent.trim()),
      teil: teil && [...teil.children].map(sichtbar).filter(x => /0,12/.test(x)) }; })()`);
  assert.ok(!m.headers.includes('Stückpreis'), `Spalte „Stückpreis“ steht noch da: ${m.headers.join(' | ')}`);
  assert.deepEqual(m.leer, [], 'Spalte ohne einen Wert');
  assert.ok(m.teil, 'Testdaten: Teil zu 0,12 € je Stück');
  assert.equal(m.teil.length, 1, `Stückpreis doppelt: ${JSON.stringify(m.teil)}`);
  assert.match(m.teil[0], /^30,00\s€\s*je 0,12\s€$/);
}

async function financeTerms(_t, a) {
  const { b } = a;
  const zeilen = `(z => Math.round(z.getBoundingClientRect().height / parseFloat(getComputedStyle(z).lineHeight)))(document.querySelector('#fin-basis > span'))`;
  await groesse(b, 390, true);
  try {
    await geh(a, '#/finanzen', `!document.getElementById('fin-basis').hidden`, 'Finanzen');
    const telefon = await b.auswerten(zeilen);
    assert.ok(telefon <= 3, `Erklärzeile am Telefon über ${telefon} Zeilen`);
  } finally {
    await groesse(b, 1280, false);
  }
  await geh(a, '#/finanzen', `!document.getElementById('fin-basis').hidden`, 'Finanzen');
  const m =
    await b.auswerten(`({ titel: ${text('#fin-cost-basis-title')}, help: document.getElementById('fin-cost-basis-title').title,
    unter: ${text('#fin-cost-basis-sub')}, zeilen: ${zeilen}, basis: ${text('#fin-basis')} })`);
  assert.equal(m.titel, 'Kaufpreis (bewertete Positionen)');
  assert.match(m.help, /Kauf- und Marktpreis/, 'Erklärung im Tooltip fehlt');
  assert.match(m.unter, /^Insgesamt bezahlt: [\d.]+,\d\d €$/);
  assert.ok(m.zeilen <= 1, `Erklärzeile über ${m.zeilen} Zeilen: ${m.basis}`);
  assert.match(m.basis, /je Kauf und Konto/, 'Testdaten: mehrere Zeilen je Position, die Erklärung steht im Tooltip');
}

/** Reloads the page (like round 24): the error should come on the first load, not over an old state. */
async function serverErrorAdmin(_t, a) {
  const { b, bis } = a;
  const { identifier } = await b.tab('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__echt = window.fetch;
      window.fetch = (u, o) => /finance\\/valuation/.test(String(u))
        ? Promise.resolve(new Response(JSON.stringify({ success: false, error: 'Interner Fehler' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }))
        : window.__echt(u, o);`,
  });
  try {
    await b.auswerten(`location.hash = '#/finanzen'; window.__alt = true; location.reload(); true`);
    await bis(`!window.__alt && !!document.querySelector('.tab.active .error-state')`, 'Error', 300);
    const m = await b.auswerten(text('.tab.active .error-state'));
    assert.match(m, /Hintergrundarbeiten → „Protokoll anzeigen“/, m);
    assert.doesNotMatch(m, /hilft der Administrator/, 'Verwalter wird an sich selbst verwiesen');
  } finally {
    await b.tab('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    await b.auswerten(`location.reload(); true`);
    await bis(`!!document.querySelector('#gallery .sc, .tab.active')`, 'neu geladen', 300);
    await a.ruhig();
  }
}

async function jobs(_t, a) {
  const { b } = a;
  // One service waiting with work (total > 0), one running: only the running one shows the bar.
  await b.auswerten(`window.__echt = window.fetch; window.fetch = async (u, o) => { const r = await window.__echt(u, o);
    if (!/v2\\/admin\\/jobs$/.test(String(u))) return r;
    const d = await r.clone().json(); const [x, y] = Object.keys(d.jobs);
    d.jobs[x] = { ...d.jobs[x], status: 'idle', total: 10, progress: 3 }; d.jobs[y] = { ...d.jobs[y], status: 'running', total: 10, progress: 5 };
    window.__dienste = [x, y]; return new Response(JSON.stringify(d), { status: 200, headers: { 'Content-Type': 'application/json' } }); }; true`);
  try {
    await geh(
      a,
      '#/hintergrund',
      `!!window.__dienste && !!document.querySelector('.mon-services tbody tr') && !!document.querySelector('.mon-kinds .mon-extra')`,
      'Hintergrund',
    );
    const m = await b.auswerten(`(() => { const zeilen = [...document.querySelectorAll('.mon-services tbody tr')];
      const balken = zeilen.filter(z => z.querySelector('.mon-bar')).map(z => z.querySelector('.mon-state').className);
      const idle = zeilen.some(z => z.querySelector('.mon-bar') && z.querySelector('.mon-idle'));
      const z = [...document.querySelectorAll('.mon-kinds tbody tr')].find(r => r.querySelector('.mon-extra'));
      const td = z.querySelector('.mon-extra').closest('td'), zahl = td.querySelector('.mon-digit').getBoundingClientRect();
      const zusatz = td.querySelector('.mon-extra').getBoundingClientRect(), zelle = td.getBoundingClientRect();
      return { balken, idle, rechts: Math.round(zelle.right - parseFloat(getComputedStyle(td).paddingRight) - zahl.right),
        darunter: zusatz.top >= zahl.bottom - 1, text: td.textContent.replace(/\\s+/g, ' ').trim() }; })()`);
    assert.ok(m.balken.length > 0, 'Testdaten: ein laufender Dienst mit Balken');
    assert.ok(
      m.balken.every(k => /mon-running/.test(k)) && !m.idle,
      `Balken nicht nur beim laufenden Dienst: ${JSON.stringify(m)}`,
    );
    assert.ok(Math.abs(m.rechts) <= 1, `Zahl „Offen“ nicht rechtsbündig: ${JSON.stringify(m)}`);
    assert.ok(m.darunter, `„davon … nach Fehler“ nicht unter der Zahl: ${JSON.stringify(m)}`);
    assert.match(m.text, /^\d+\s*davon \d+ nach Fehler$/);
  } finally {
    await b.auswerten(`window.fetch = window.__echt; true`);
  }
}

async function zweiterFaktor(_t, a) {
  const { b, bis } = a;
  await geh(a, '#/konto', `!!document.querySelector('#sf-surface [data-click="newRecoveryCodes"]')`, 'Konto');
  assert.equal(await b.auswerten(`!!document.querySelector('#sf-surface input')`), false, 'Codefeld für zwei Aktionen');
  const dialog = `({ offen: document.getElementById('confirm-modal').style.display === 'flex', titel: ${text('#cd-title')},
    code: !document.getElementById('cd-code-wrap').hidden, pw: !document.getElementById('cd-pw-wrap').hidden })`;
  // New codes: the code in its own dialog.
  await b.auswerten(`document.querySelector('#sf-surface [data-click="newRecoveryCodes"]').click(); true`);
  await bis(`document.getElementById('confirm-modal').style.display === 'flex'`, 'Dialog „Neue Codes“');
  const neu = await b.auswerten(dialog);
  assert.deepEqual([neu.code, neu.pw], [true, false], JSON.stringify(neu));
  assert.match(neu.titel.replace(/­/g, ''), /Neue Wiederherstellungscodes/);
  await b.auswerten(`document.getElementById('cd-code').value = ${JSON.stringify(a.furtherCodes[0])};
    document.getElementById('cd-confirm').click(); true`);
  await bis(`!!document.getElementById('sf-codes')`, 'neue Codes');
  await b.auswerten(`document.getElementById('sf-saved').click(); true`);
  await bis(`!!document.querySelector('#sf-surface [data-click="disableSecondFactor"]')`, 'zurück');
  // For admins switching off means „Neu einrichten“: a dialog with password and code, cancelled.
  await b.auswerten(`document.querySelector('#sf-surface [data-click="disableSecondFactor"]').click(); true`);
  await bis(`document.getElementById('confirm-modal').style.display === 'flex'`, 'Rückfrage Neu einrichten');
  const ab = await b.auswerten(dialog);
  assert.deepEqual([ab.code, ab.pw], [true, true], JSON.stringify(ab));
  assert.match(ab.titel, /Neu einrichten/);
  await b.auswerten(`document.getElementById('cd-cancel').click(); true`);
  await bis(`document.getElementById('confirm-modal').style.display !== 'flex'`, 'abgebrochen');
}

async function pageTitle(_t, a) {
  const { b, bis } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc[data-arg="10300-1"]')`, 'Sammlung');
  const vorher = await b.auswerten('document.title');
  await b.auswerten(`document.querySelector('#gallery .sc[data-arg="10300-1"]').click(); true`);
  await bis(`document.title === 'Back to the Future Time Machine – BrickInventory'`, 'Titel mit Setnamen', 50);
  await b.auswerten(`document.querySelector('#set-modal [data-dialog-close]').click(); true`);
  await bis(`document.title === ${JSON.stringify(vorher)}`, `Titel nach dem Schliessen: ${vorher}`, 50);
}

async function bauliste(_t, a) {
  const { b } = a;
  try {
    for (const [breite, telefon] of [
      [1280, false],
      [390, true],
    ]) {
      await groesse(b, breite, telefon);
      await geh(a, '#/bauliste', `document.getElementById('tab-partslist').classList.contains('active')`, 'Bauliste');
      const m = await b.auswerten(`({ field: document.getElementById('pl-setnr').getBoundingClientRect().width,
        karte: document.querySelector('#tab-partslist .ph').getBoundingClientRect().width })`);
      if (telefon)
        assert.ok(m.field >= m.karte - 1, `${breite} px: Feld nicht über die ganze Breite: ${JSON.stringify(m)}`);
      else assert.ok(m.field >= 480, `${breite} px: Feld für mehrere Setnummern zu schmal: ${JSON.stringify(m)}`);
    }
  } finally {
    await groesse(b, 1280, false);
  }
}

async function wantedTo(_t, a) {
  const { b } = a;
  await groesse(b, 390, true);
  try {
    await geh(a, '#/merkliste', `!!document.querySelector('#mk-list .mk-row')`, 'Merkliste');
    const m =
      await b.auswerten(`(() => { const d = document.getElementById('mk-box'), h = d.querySelector('summary h2');
      const kd = d.getBoundingClientRect(), kh = h.getBoundingClientRect();
      return { offen: d.open, oben: Math.round(kh.top - kd.top), unten: Math.round(kd.bottom - kh.bottom) }; })()`);
    assert.equal(m.offen, false, 'Testdaten: am Telefon zugeklappt');
    assert.ok(Math.abs(m.oben - m.unten) <= 2, `Leerraum unter der zugeklappten Karte: ${JSON.stringify(m)}`);
  } finally {
    await groesse(b, 1280, false);
  }
}

test('quantity, table values, second factor, build list', { concurrency: 1, timeout: 900_000 }, async t => {
  const name = `r25_${process.pid}`;
  const req = require('./helpers/sources').buildAndRequire();
  const a = await startApp(t, {
    name,
    allDesigns: true,
    holding: async (db, uid) => {
      await patternHousehold(db, uid);
      await putImages(t, db, uid, req);
      await db.run(`INSERT INTO jobs (type, due_at, attempts, max_attempts, error_message)
        VALUES ('exchange_rates', NOW() + interval '5 hours', 4, 6, 'Zeitüberschreitung')`);
    },
  });
  if (a.reason) {
    t.skip(a.reason);
    return;
  }
  t.after(() => a.db.run(`DELETE FROM jobs WHERE type = 'exchange_rates' AND status = 'pending'`).catch(() => {}));
  await a.ruhig();
  /** @type {[string, (t: import('node:test').TestContext, a: object) => Promise<void>][]} */
  const pruefungen = [
    ['„−“ bei einem Exemplar', minusAtOne],
    ['Schwebender Knopf verdeckt nichts', floatingButton],
    ['Tabellenansicht mit Kaufpreis und Marktwert', tabellenansicht],
    ['Finanzen ohne leere Spalte', financeColumns],
    ['Finanzbegriffe', financeTerms],
    ['Aufträge und Fortschritt', jobs],
    ['Seitentitel im Set-Detail', pageTitle],
    ['Bauliste: breites Feld', bauliste],
    ['Merkliste zugeklappt', wantedTo],
    ['Bilder verschiedener Form', bilder],
    // Reloads the page.
    ['Serverfehler für Verwalter', serverErrorAdmin],
    // Replaces the recovery codes: last.
    ['Zweiter Faktor: Code im Dialog', zweiterFaktor],
  ];
  for (const [titel, fn] of pruefungen) await t.test(titel, () => fn(t, a));
});
