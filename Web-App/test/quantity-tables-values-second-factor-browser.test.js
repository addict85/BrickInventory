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

async function language(a, lang) {
  await a.b.evaluate(`(() => { const s = document.getElementById('lang-select'); s.value = '${lang}';
    s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await a.until(`document.documentElement.lang === '${lang}'`, `Sprache ${lang}`);
  await a.settle();
}

/** A PNG with an alpha channel; `farbe(x, y, border)` returns [r, g, b, a]. The red border shows whether something is cut off. */
function png(w, h, color) {
  const block = (kind, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const content = Buffer.concat([Buffer.from(kind), data]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(zlib.crc32(content));
    return Buffer.concat([len, content, checksum]);
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head[8] = 8;
  head[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      raw.set(color(x, y, x < 2 || y < 2 || x >= w - 2 || y >= h - 2), y * (w * 4 + 1) + 1 + x * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    block('IHDR', head),
    block('IDAT', zlib.deflateSync(raw)),
    block('IEND', Buffer.alloc(0)),
  ]);
}
const full = (_x, _y, rand) => (rand ? [255, 0, 0, 255] : [40, 120, 200, 255]);
const transparent = (x, y, rand) => (rand ? [255, 0, 0, 255] : (x + y) % 2 ? [0, 0, 0, 0] : [200, 40, 40, 255]);
/** Number, width, height, pattern: landscape, portrait, square, very wide, small with transparency. */
const IMAGES = [
  ['r25quer-1', 400, 200, full],
  ['r25hoch-1', 200, 400, full],
  ['r25quadrat-1', 300, 300, full],
  ['r25breit-1', 800, 100, full],
  ['r25klein-1', 32, 32, transparent],
];

/** How the app stores its set images: <nr>.jpg under data/images/sets, the preview next to it (vorschauErzeugenAus). */
async function putImages(t, db, uid, req) {
  const dir = path.join(ROOT, 'data', 'images', 'sets');
  fs.mkdirSync(dir, { recursive: true });
  const route = () => {
    for (const [nr] of IMAGES)
      for (const file of [`${nr}.jpg`, `${nr}_thumb.jpg`]) fs.rmSync(path.join(dir, file), { force: true });
  };
  route();
  t.after(route);
  for (const [nr, w, h, f] of IMAGES) {
    fs.writeFileSync(path.join(dir, `${nr}.jpg`), png(w, h, f));
    assert.ok(await req('src/images/thumbs.js').previewFrom(`/images/sets/${nr}.jpg`), `preview ${nr}`);
    await catalogSet(db, nr, { name: `Bildprobe ${nr}`, year: 2020, theme: 'Bildprobe', pieces: 100 });
    await db.run('UPDATE set_catalog SET image_local = $2 WHERE set_number = set_number_with_version($1)', [
      nr,
      `/images/sets/${nr}.jpg`,
    ]);
    await holdsSet(db, uid, nr, 1, { price: 10, am: '2026-06-03T10:00:00Z' });
  }
}

/** Per visible image: aspect ratio of the file and of the painted image (object-fit), position in the frame. */
const IMAGE_SIZE = sel => `(() => [...document.querySelectorAll(${JSON.stringify(sel)})]
  .filter(i => i.checkVisibility() && /r25/.test(i.currentSrc || i.src)).map(i => {
    const r = i.getBoundingClientRect(), s = getComputedStyle(i);
    const bw = r.width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) - parseFloat(s.borderLeftWidth) - parseFloat(s.borderRightWidth);
    const bh = r.height - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom) - parseFloat(s.borderTopWidth) - parseFloat(s.borderBottomWidth);
    const file = i.naturalWidth / i.naturalHeight;
    let gw = bw, gh = bh;
    if (s.objectFit === 'contain' || s.objectFit === 'scale-down') { if (bw / bh > file) gw = bh * file; else gh = bw / file; }
    const frame = i.closest('.sci, td, .m-header, .modal').getBoundingClientRect();
    return { nr: (i.currentSrc || i.src).replace(/.*sets\\/|(_thumb)?\\.jpg.*/g, ''), loaded: i.complete && i.naturalWidth > 0,
      file: +file.toFixed(3), painted: +(gw / gh).toFixed(3), fit: s.objectFit,
      result: r.left < frame.left - 0.5 || r.right > frame.right + 0.5 || r.top < frame.top - 0.5 || r.bottom > frame.bottom + 0.5 };
  }))()`;

function checkImages(m, where, count) {
  assert.equal(m.length, count, `${where}: ${m.length} images instead of ${count}`);
  for (const x of m) {
    const want = IMAGES.find(([nr]) => nr === x.nr);
    assert.ok(want && x.loaded, `${where}: ${x.nr} not loaded`);
    const source = Number(want[1]) / Number(want[2]);
    // A preview may be smaller, but not shaped differently: a square one would mean „zugeschnitten“.
    assert.ok(Math.abs(x.file / source - 1) < 0.05, `${where}: ${x.nr} file ${x.file} instead of ${source} (cropped)`);
    assert.ok(
      Math.abs(x.painted / source - 1) < 0.05,
      `${where}: ${x.nr} painted ${x.painted} instead of ${source} (stretched)`,
    );
    assert.ok(!x.result, `${where}: ${x.nr} sticks out of its frame`);
  }
}

async function images(_t, a) {
  const { b, until } = a;
  try {
    for (const dark of [false, true]) {
      await b.evaluate(`document.documentElement.toggleAttribute('data-dark', ${dark}); true`);
      for (const [width, phone] of [
        [1280, false],
        [390, true],
        [320, true],
      ]) {
        const where = `${width} px ${dark ? 'dark' : 'hell'}`;
        await size(b, width, phone);
        await geh(a, '#/sammlung', `document.querySelectorAll('#gallery .sc').length >= 9`, 'Sammlung');
        await b.evaluate(`document.getElementById('vg').click(); true`);
        await until(`!!document.querySelector('#gallery .sgrid')`, 'Kacheln');
        await b.evaluate(`document.querySelectorAll('#gallery img').forEach(i => { i.loading = 'eager'; }); true`);
        await until(
          `[...document.querySelectorAll('#gallery .sci img')].filter(i => /r25/.test(i.src)).every(i => i.complete && i.naturalWidth)`,
          `${where}: Kachelbilder`,
        );
        checkImages(await b.evaluate(IMAGE_SIZE('#gallery .sci img')), `Kacheln ${where}`, IMAGES.length);
        // Calm grid: in one row all image areas are the same size.
        const rows = await b.evaluate(`(() => { const m = {};
          for (const k of document.querySelectorAll('#gallery .sc')) { const r = k.getBoundingClientRect(), s = k.querySelector('.sci').getBoundingClientRect();
            (m[Math.round(r.top)] ||= new Set()).add(Math.round(s.width) + 'x' + Math.round(s.height)); }
          return Object.values(m).map(s => [...s]); })()`);
        assert.ok(
          rows.every(r => r.length === 1),
          `${where}: image areas within a row differ: ${JSON.stringify(rows)}`,
        );
        if (!phone) {
          await b.evaluate(`document.getElementById('vl').click(); true`);
          await until(`!!document.querySelector('#gallery table')`, 'Tabelle');
          await b.evaluate(`document.querySelectorAll('#gallery img').forEach(i => { i.loading = 'eager'; }); true`);
          await until(
            `[...document.querySelectorAll('#gallery table img')].filter(i => /r25/.test(i.src)).every(i => i.complete && i.naturalWidth)`,
            `${where}: Tabellenbilder`,
          );
          checkImages(await b.evaluate(IMAGE_SIZE('#gallery table img')), `Tabelle ${where}`, IMAGES.length);
          await b.evaluate(`document.getElementById('vg').click(); true`);
        }
        for (const [nr] of IMAGES) {
          await b.evaluate(
            `document.querySelector('#gallery [data-click="openModal"][data-arg="${nr}"]').click(); true`,
          );
          await until(
            `(i => document.getElementById('set-modal').classList.contains('open') && /${nr}\\.jpg/.test(i.src) && i.complete && i.naturalWidth)(document.getElementById('m-img'))`,
            `${where}: Detail ${nr}`,
          );
          checkImages(await b.evaluate(IMAGE_SIZE('#m-img')), `Detail ${where}`, 1);
          await b.evaluate(CLOSE);
        }
      }
    }
  } finally {
    await b.evaluate(`document.documentElement.removeAttribute('data-dark'); true`);
    await size(b, 1280, false);
  }
}

async function minusAtOne(_t, a) {
  const { b, until } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc[data-arg="10300-1"]')`, 'Sammlung');
  await b.evaluate(`document.querySelector('#gallery .sc[data-arg="10300-1"]').click(); true`);
  await until(`document.getElementById('m-qty')?.value === '1' && !!document.getElementById('m-qty-dec')`, 'Detail');
  const writing = () =>
    b.eventList.filter(
      e =>
        e.method === 'Network.requestWillBeSent' &&
        e.params.request.method !== 'GET' &&
        /\/api\/v2\/sets\/10300-1/.test(e.params.request.url),
    ).length;
  const state = () =>
    b.evaluate(`(() => { const k = document.getElementById('m-qty-dec');
      return { wert: document.getElementById('m-qty').value, locked: k.getAttribute('aria-disabled'), title: k.title,
        description: document.getElementById(k.getAttribute('aria-describedby') || '-')?.textContent || '' }; })()`);
  const prior = writing();
  const m = await state();
  assert.equal(m.locked, 'true', `„−“ not disabled with one copy: ${JSON.stringify(m)}`);
  assert.equal(m.title, 'Zum Entfernen: „Set löschen“ unter „Weitere Aktionen“');
  assert.equal(m.description, m.title, 'screen readers do not hear the hint');
  await b.evaluate(`document.getElementById('m-qty-dec').click(); true`);
  await a.sleep(700);
  assert.deepEqual([(await state()).wert, writing() - prior], ['1', 0], '„−“ at 1 did something');
  await b.evaluate(`document.querySelector('[data-click="mQtyInc"]').click(); true`);
  await until(`document.getElementById('m-qty-dec').getAttribute('aria-disabled') === 'false'`, '„−“ frei bei 2');
  assert.equal((await state()).title, '', 'hint stays at 2');
  await until(`document.querySelector('#m-quantity .field-status')?.textContent.trim() !== ''`, 'saved');
  await a.settle();
  await b.evaluate(`document.getElementById('m-qty-dec').click(); true`);
  await until(`document.getElementById('m-qty-dec').getAttribute('aria-disabled') === 'true'`, 'zurück auf 1');
  // Saving happens 400 ms later; closed before that, the 2 would remain.
  await a.sleep(700);
  await a.settle();
  await b.evaluate(CLOSE);
}

async function floatingButton(_t, a) {
  const { b } = a;
  await language(a, 'en');
  try {
    // B3: the date field inherits the language of the page.
    assert.deepEqual(
      await b.evaluate(
        `({ lang: document.documentElement.lang, own: document.getElementById('add-date').closest('[lang]')?.tagName })`,
      ),
      { lang: 'en', own: 'HTML' },
    );
    for (const width of [390, 320]) {
      await size(b, width, true);
      for (const [hash, tab] of [
        ['#/teile', 'parts'],
        ['#/sammlung', 'gallery'],
        ['#/minifiguren', 'minifigs'],
      ]) {
        await geh(a, hash, `document.getElementById('tab-${tab}').classList.contains('active')`, tab);
        await a.sleep(300);
        await b.evaluate(`scrollTo(0, document.documentElement.scrollHeight); true`);
        await a.settle();
        const m =
          await b.evaluate(`(() => { const f = document.querySelector('#tab-${tab} .button-floating').getBoundingClientRect();
          const blaetter = [...document.querySelectorAll('#tab-${tab} *')].filter(e => !e.closest('.button-floating') && !e.children.length
            && (e.textContent.trim() || e.matches('img, svg')) && e.checkVisibility());
          const lower = blaetter.map(e => ({ e, r: e.getBoundingClientRect() })).filter(x => x.r.height > 0 && x.r.bottom > 0)
            .sort((x, y) => y.r.bottom - x.r.bottom)[0];
          const over = blaetter.filter(e => { const r = e.getBoundingClientRect();
            return r.height > 0 && r.bottom > f.top && r.top < f.bottom && r.right > f.left && r.left < f.right; });
          return { buttonTop: Math.round(f.top), last: lower && { text: lower.e.textContent.trim().slice(0, 40), lower: Math.round(lower.r.bottom) },
            over: over.map(e => e.textContent.trim().slice(0, 30) || e.tagName) }; })()`);
        assert.ok(m.last, `${tab} ${width} px: no last row found`);
        assert.deepEqual(m.over, [], `${tab} ${width} px: covered by the button: ${JSON.stringify(m)}`);
        assert.ok(m.last.lower <= m.buttonTop, `${tab} ${width} px: last row under the button: ${JSON.stringify(m)}`);
      }
    }
  } finally {
    await size(b, 1280, false);
    await language(a, 'de');
  }
}

async function tabellenansicht(_t, a) {
  const { b, until } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
  await b.evaluate(`document.getElementById('vl').click(); true`);
  await until(`!!document.querySelector('#gallery table')`, 'Tabelle');
  // Re-sorted, the list reloads: the table stands there before the prices, the market value comes afterwards.
  await b.evaluate(`document.querySelector('#gallery thead [data-click="sortSets"][data-arg="num"]').click(); true`);
  // Wait for the market value column itself: a later redraw briefly resets it to „—“.
  await a.settle();
  await until(
    `(() => { const head = [...document.querySelectorAll('#gallery thead th')].map(k => k.textContent.trim());
      const z = document.querySelector('#gallery tr[data-arg="75192-1"]')?.children[head.indexOf('Marktwert')];
      return /€.*%/.test(z?.textContent || ''); })()`,
    'Marktwert mit Entwicklung in der Tabelle',
  );
  const m =
    await b.evaluate(`(() => { const head = [...document.querySelectorAll('#gallery thead th')].map(k => k.textContent.trim());
    const cell = (nr, k) => { const z = document.querySelector('#gallery tr[data-arg="' + nr + '"]').children[head.indexOf(k)].cloneNode(true);
      z.querySelectorAll('.vh').forEach(v => v.remove()); return z.textContent.replace(/\\s+/g, ' ').trim(); };
    return { head, untertitel: ${text('#tab-gallery .ptitle-sub')},
      falcon: [cell('75192-1', 'Kaufpreis'), cell('75192-1', 'Marktwert')], geschenk: cell('10300-1', 'Kaufpreis') }; })()`);
  await b.evaluate(`document.getElementById('vg').click(); true`);
  assert.match(m.untertitel, /Kaufpreis und Marktwert|Kaufpreis, Marktwert/, 'Testdaten: Untertitel verspricht beides');
  assert.ok(m.head.includes('Kaufpreis') && m.head.includes('Marktwert'), `columns missing: ${m.head.join(' | ')}`);
  assert.match(m.falcon[0], /^650,00\s€$/);
  assert.match(m.falcon[1], /^801,50\s€\s*\+23,3\s%$/, `market value with trend: ${m.falcon[1]}`);
  assert.equal(m.geschenk, 'Geschenk');
}

async function financeColumns(_t, a) {
  const { b } = a;
  await geh(a, '#/finanzen', `!!document.querySelector('#fin-tbl [data-fin-kind="parts"] tbody tr')`, 'Finanzen');
  const m =
    await b.evaluate(`(() => { const visible = z => { const k = z.cloneNode(true); k.querySelectorAll('.vh').forEach(v => v.remove());
      return k.textContent.trim() || (k.querySelector('img, svg') ? 'Bild' : ''); };
    const empty = [...document.querySelectorAll('#fin-tbl [data-fin-kind] table')].flatMap(t => {
      const head = [...t.querySelectorAll('thead th')].map(k => k.textContent.trim());
      const lines = [...t.querySelectorAll('tbody tr')];
      return head.filter((k, i) => lines.length && lines.every(z => !visible(z.children[i] || z))).map(k => t.getAttribute('aria-label') + ': ' + (k || '(ohne Kopf)'));
    });
    const teil = [...document.querySelectorAll('[data-fin-kind="parts"] tbody tr')].find(z => /250/.test(z.textContent) && /0,12/.test(z.textContent));
    return { empty, headers: [...document.querySelectorAll('[data-fin-kind="sets"] thead th')].map(k => k.textContent.trim()),
      teil: teil && [...teil.children].map(visible).filter(x => /0,12/.test(x)) }; })()`);
  assert.ok(!m.headers.includes('Stückpreis'), `column „Stückpreis“ is still there: ${m.headers.join(' | ')}`);
  assert.deepEqual(m.empty, [], 'column without a value');
  assert.ok(m.teil, 'test data: part at 0.12 € per piece');
  assert.equal(m.teil.length, 1, `unit price twice: ${JSON.stringify(m.teil)}`);
  assert.match(m.teil[0], /^30,00\s€\s*je 0,12\s€$/);
}

async function financeTerms(_t, a) {
  const { b } = a;
  const lines = `(z => Math.round(z.getBoundingClientRect().height / parseFloat(getComputedStyle(z).lineHeight)))(document.querySelector('#fin-basis > span'))`;
  await size(b, 390, true);
  try {
    await geh(a, '#/finanzen', `!document.getElementById('fin-basis').hidden`, 'Finanzen');
    const phone = await b.evaluate(lines);
    assert.ok(phone <= 3, `explanation row on the phone over ${phone} lines`);
  } finally {
    await size(b, 1280, false);
  }
  await geh(a, '#/finanzen', `!document.getElementById('fin-basis').hidden`, 'Finanzen');
  const m =
    await b.evaluate(`({ title: ${text('#fin-cost-basis-title')}, help: document.getElementById('fin-cost-basis-title').title,
    sub: ${text('#fin-cost-basis-sub')}, lines: ${lines}, basis: ${text('#fin-basis')} })`);
  assert.equal(m.title, 'Kaufpreis (bewertete Positionen)');
  assert.match(m.help, /Kauf- und Marktpreis/, 'explanation in the tooltip is missing');
  assert.match(m.sub, /^Insgesamt bezahlt: [\d.]+,\d\d €$/);
  assert.ok(m.lines <= 1, `explanation row over ${m.lines} lines: ${m.basis}`);
  assert.match(m.basis, /je Kauf und Konto/, 'test data: several rows per item, the explanation is in the tooltip');
}

/** Reloads the page (like round 24): the error should come on the first load, not over an old state. */
async function serverErrorAdmin(_t, a) {
  const { b, until } = a;
  const { identifier } = await b.tab('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__echt = window.fetch;
      window.fetch = (u, o) => /finance\\/valuation/.test(String(u))
        ? Promise.resolve(new Response(JSON.stringify({ success: false, error: 'Interner Fehler' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }))
        : window.__echt(u, o);`,
  });
  try {
    await b.evaluate(`location.hash = '#/finanzen'; window.__alt = true; location.reload(); true`);
    await until(`!window.__alt && !!document.querySelector('.tab.active .error-state')`, 'Error', 300);
    const m = await b.evaluate(text('.tab.active .error-state'));
    assert.match(m, /Hintergrundarbeiten → „Protokoll anzeigen“/, m);
    assert.doesNotMatch(m, /hilft der Administrator/, 'admin is referred to themselves');
  } finally {
    await b.tab('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    await b.evaluate(`location.reload(); true`);
    await until(`!!document.querySelector('#gallery .sc, .tab.active')`, 'neu geladen', 300);
    await a.settle();
  }
}

async function jobs(_t, a) {
  const { b } = a;
  // One service waiting with work (total > 0), one running: only the running one shows the bar.
  await b.evaluate(`window.__echt = window.fetch; window.fetch = async (u, o) => { const r = await window.__echt(u, o);
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
    const m = await b.evaluate(`(() => { const lines = [...document.querySelectorAll('.mon-services tbody tr')];
      const balken = lines.filter(z => z.querySelector('.mon-bar')).map(z => z.querySelector('.mon-state').className);
      const idle = lines.some(z => z.querySelector('.mon-bar') && z.querySelector('.mon-idle'));
      const z = [...document.querySelectorAll('.mon-kinds tbody tr')].find(r => r.querySelector('.mon-extra'));
      const td = z.querySelector('.mon-extra').closest('td'), num = td.querySelector('.mon-digit').getBoundingClientRect();
      const extra = td.querySelector('.mon-extra').getBoundingClientRect(), cell = td.getBoundingClientRect();
      return { balken, idle, right: Math.round(cell.right - parseFloat(getComputedStyle(td).paddingRight) - num.right),
        darunter: extra.top >= num.bottom - 1, text: td.textContent.replace(/\\s+/g, ' ').trim() }; })()`);
    assert.ok(m.balken.length > 0, 'test data: a running service with a bar');
    assert.ok(
      m.balken.every(k => /mon-running/.test(k)) && !m.idle,
      `bar not only for the running service: ${JSON.stringify(m)}`,
    );
    assert.ok(Math.abs(m.right) <= 1, `number „Offen“ not right-aligned: ${JSON.stringify(m)}`);
    assert.ok(m.darunter, `„davon … nach Fehler“ not below the number: ${JSON.stringify(m)}`);
    assert.match(m.text, /^\d+\s*davon \d+ nach Fehler$/);
  } finally {
    await b.evaluate(`window.fetch = window.__echt; true`);
  }
}

async function secondFactor(_t, a) {
  const { b, until } = a;
  await geh(a, '#/konto', `!!document.querySelector('#sf-surface [data-click="newRecoveryCodes"]')`, 'Konto');
  assert.equal(await b.evaluate(`!!document.querySelector('#sf-surface input')`), false, 'code field for two actions');
  const dialog = `({ isOpen: document.getElementById('confirm-modal').style.display === 'flex', title: ${text('#cd-title')},
    code: !document.getElementById('cd-code-wrap').hidden, pw: !document.getElementById('cd-pw-wrap').hidden })`;
  // New codes: the code in its own dialog.
  await b.evaluate(`document.querySelector('#sf-surface [data-click="newRecoveryCodes"]').click(); true`);
  await until(`document.getElementById('confirm-modal').style.display === 'flex'`, 'Dialog „Neue Codes“');
  const fresh = await b.evaluate(dialog);
  assert.deepEqual([fresh.code, fresh.pw], [true, false], JSON.stringify(fresh));
  assert.match(fresh.title.replace(/­/g, ''), /Neue Wiederherstellungscodes/);
  await b.evaluate(`document.getElementById('cd-code').value = ${JSON.stringify(a.furtherCodes[0])};
    document.getElementById('cd-confirm').click(); true`);
  await until(`!!document.getElementById('sf-codes')`, 'neue Codes');
  await b.evaluate(`document.getElementById('sf-saved').click(); true`);
  await until(`!!document.querySelector('#sf-surface [data-click="disableSecondFactor"]')`, 'zurück');
  // For admins switching off means „Neu einrichten“: a dialog with password and code, cancelled.
  await b.evaluate(`document.querySelector('#sf-surface [data-click="disableSecondFactor"]').click(); true`);
  await until(`document.getElementById('confirm-modal').style.display === 'flex'`, 'Rückfrage Neu einrichten');
  const ab = await b.evaluate(dialog);
  assert.deepEqual([ab.code, ab.pw], [true, true], JSON.stringify(ab));
  assert.match(ab.title, /Neu einrichten/);
  await b.evaluate(`document.getElementById('cd-cancel').click(); true`);
  await until(`document.getElementById('confirm-modal').style.display !== 'flex'`, 'abgebrochen');
}

async function pageTitle(_t, a) {
  const { b, until } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc[data-arg="10300-1"]')`, 'Sammlung');
  const prior = await b.evaluate('document.title');
  await b.evaluate(`document.querySelector('#gallery .sc[data-arg="10300-1"]').click(); true`);
  await until(`document.title === 'Back to the Future Time Machine – BrickInventory'`, 'Titel mit Setnamen', 50);
  await b.evaluate(`document.querySelector('#set-modal [data-dialog-close]').click(); true`);
  await until(`document.title === ${JSON.stringify(prior)}`, `Titel nach dem Schliessen: ${prior}`, 50);
}

async function buildList(_t, a) {
  const { b } = a;
  try {
    for (const [width, phone] of [
      [1280, false],
      [390, true],
    ]) {
      await size(b, width, phone);
      await geh(a, '#/bauliste', `document.getElementById('tab-partslist').classList.contains('active')`, 'Bauliste');
      const m = await b.evaluate(`({ field: document.getElementById('pl-setnr').getBoundingClientRect().width,
        card: document.querySelector('#tab-partslist .ph').getBoundingClientRect().width })`);
      if (phone)
        assert.ok(m.field >= m.card - 1, `${width} px: field does not span the full width: ${JSON.stringify(m)}`);
      else assert.ok(m.field >= 480, `${width} px: field too narrow for several set numbers: ${JSON.stringify(m)}`);
    }
  } finally {
    await size(b, 1280, false);
  }
}

async function wantedTo(_t, a) {
  const { b } = a;
  await size(b, 390, true);
  try {
    await geh(a, '#/merkliste', `!!document.querySelector('#mk-list .mk-row')`, 'Merkliste');
    const m = await b.evaluate(`(() => { const d = document.getElementById('mk-box'), h = d.querySelector('summary h2');
      const kd = d.getBoundingClientRect(), kh = h.getBoundingClientRect();
      return { isOpen: d.open, upper: Math.round(kh.top - kd.top), lower: Math.round(kd.bottom - kh.bottom) }; })()`);
    assert.equal(m.isOpen, false, 'test data: collapsed on the phone');
    assert.ok(Math.abs(m.upper - m.lower) <= 2, `empty space below the collapsed card: ${JSON.stringify(m)}`);
  } finally {
    await size(b, 1280, false);
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
  await a.settle();
  /** @type {[string, (t: import('node:test').TestContext, a: object) => Promise<void>][]} */
  const pruefungen = [
    ['„−“ bei einem Exemplar', minusAtOne],
    ['Schwebender Knopf verdeckt nichts', floatingButton],
    ['Tabellenansicht mit Kaufpreis und Marktwert', tabellenansicht],
    ['Finanzen ohne leere Spalte', financeColumns],
    ['Finanzbegriffe', financeTerms],
    ['Aufträge und Fortschritt', jobs],
    ['Seitentitel im Set-Detail', pageTitle],
    ['Bauliste: breites Feld', buildList],
    ['Merkliste zugeklappt', wantedTo],
    ['Bilder verschiedener Form', images],
    // Reloads the page.
    ['Serverfehler für Verwalter', serverErrorAdmin],
    // Replaces the recovery codes: last.
    ['Zweiter Faktor: Code im Dialog', secondFactor],
  ];
  for (const [title, fn] of pruefungen) await t.test(title, () => fn(t, a));
});
