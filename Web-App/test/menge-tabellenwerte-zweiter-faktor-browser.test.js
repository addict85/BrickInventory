/**
 * UX-Prüfung 25 im echten Chrome, im Haushalt mit Unterkonto: N1–N8, Bilder verschiedener Form (B1),
 * Finanzbegriffe (B2) und die Sprache des Datumsfelds auf Englisch (B3).
 *
 * Gegenproben (14.11.2026 gemessen, je einzeln, Bündel bzw. dist neu gebaut):
 *   A  mQtyDec() ohne `if (n <= 1) return` → rot: „„−“ bei einem Exemplar“ (Feld zeigt 0); setzeMengenfeld()
 *      ohne aria-disabled → rot: ebenda (nicht gesperrt)
 *   B  .ladepunkt wieder height:1px → rot: „Schwebender Knopf verdeckt nichts“ (Teile 390 px: Abschlusszeile
 *      751 > Knopf 716)
 *   C  updateGalleryPrices() ohne [data-tabwert-for] → rot: „Tabellenansicht …“ (Marktwert „—“)
 *   D  Spalte „Stückpreis“ samt Zellen zurück → rot: „Finanzen ohne leere Spalte“; Teile/Figuren wieder mit
 *      leerer Stand-Zelle → rot: ebenda
 *   E  finance.stat.purchase_basis wieder „Kaufpreis der Positionen mit Marktpreis“ → rot: „Finanzbegriffe“;
 *      finance.basis.gerechnet wieder mit dem zweiten Satz → rot: ebenda (390 px: 5 statt 3 Zeilen)
 *   F  verstaendlicherGrund() ohne den Zweig für Verwalter → rot: „Serverfehler für Verwalter“
 *   G  Balken wieder bei jedem Dienst mit total > 0 → rot: „Aufträge und Fortschritt“ (auch „idle“, „done“);
 *      .mon-zusatz ohne display:block → rot: ebenda (Zahl 123 px links vom Rand, Zusatz daneben)
 *   H  zfNeueCodes() liest wieder #zf-code → rot: „Zweiter Faktor: Code im Dialog“ (kein Dialog)
 *   I  seitennameAktualisieren() ohne beobachteSetDetail() → rot: „Seitentitel im Set-Detail“
 *   K  .pl-leiste ohne align-self:stretch → rot: „Bauliste: breites Feld“ (1280 px: 205 px);
 *      mobile.css ohne .pl-setnr { flex-basis: 100% } → rot: ebenda (390 px: 209 von 358 px)
 *   L  .merk-kasten-kopf ohne display:flex/align-items:center → rot: „Merkliste zugeklappt“ (oben 9, unten 32 px)
 *   M  thumbs.ts wieder fit: 'cover' (dist neu) → rot: „Bilder verschiedener Form“ (r25breit-1: Vorschau 1:1
 *      statt 8:1)
 *   N  (16.11.2026) in zfAbschalten() `mitCode: true` gestrichen → rot: „Zweiter Faktor: Code im Dialog“
 *      (Neu einrichten ohne Codefeld)
 *
 * B3: Das native Datumsfeld formatiert nach der Sprache des Browsers, nicht nach `lang` (Runde 24, N16);
 * geprüft wird, dass die Seite nach dem Sprachwechsel `lang="en"` trägt und das Feld sie erbt.
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { starteApp } = require('./helpers/app-browser');
const { musterHaushalt, katalogSet, haeltSet } = require('./helpers/bestand');

const text = sel => `(document.querySelector(${JSON.stringify(sel)})?.textContent || '').replace(/\\s+/g, ' ').trim()`;
const SCHLIESSEN = `document.querySelectorAll('.ovl.open [data-dialog-zu]').forEach(x => x.click()); true`;
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
  await a.b.auswerten(SCHLIESSEN);
  await a.b.auswerten(`location.hash = ${JSON.stringify(hash)}; true`);
  await a.bis(bereit, was, 200);
  await a.ruhig(5000);
}

async function sprache(a, lang) {
  await a.b.auswerten(`(() => { const s = document.getElementById('lang-select'); s.value = '${lang}';
    s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await a.bis(`document.documentElement.lang === '${lang}'`, `Sprache ${lang}`);
  await a.ruhig();
}

/** Ein PNG mit Alphakanal; `farbe(x, y, rand)` gibt [r, g, b, a]. Der rote Rand zeigt, ob etwas abgeschnitten ist. */
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
const durchsichtig = (x, y, rand) => (rand ? [255, 0, 0, 255] : (x + y) % 2 ? [0, 0, 0, 0] : [200, 40, 40, 255]);
/** Nummer, Breite, Höhe, Muster: quer, hoch, quadratisch, sehr breit, klein mit Transparenz. */
const BILDER = [
  ['r25quer-1', 400, 200, voll],
  ['r25hoch-1', 200, 400, voll],
  ['r25quadrat-1', 300, 300, voll],
  ['r25breit-1', 800, 100, voll],
  ['r25klein-1', 32, 32, durchsichtig],
];

/** Wie die App ihre Set-Bilder ablegt: <nr>.jpg unter data/images/sets, die Vorschau daneben (vorschauErzeugenAus). */
async function legeBilder(t, db, uid, req) {
  const ordner = path.join(ROOT, 'data', 'images', 'sets');
  fs.mkdirSync(ordner, { recursive: true });
  const weg = () => {
    for (const [nr] of BILDER)
      for (const datei of [`${nr}.jpg`, `${nr}_thumb.jpg`]) fs.rmSync(path.join(ordner, datei), { force: true });
  };
  weg();
  t.after(weg);
  for (const [nr, w, h, f] of BILDER) {
    fs.writeFileSync(path.join(ordner, `${nr}.jpg`), png(w, h, f));
    assert.ok(await req('src/bilder/thumbs.js').vorschauErzeugenAus(`/images/sets/${nr}.jpg`), `Vorschau ${nr}`);
    await katalogSet(db, nr, { name: `Bildprobe ${nr}`, year: 2020, theme: 'Bildprobe', pieces: 100 });
    await db.run('UPDATE set_catalog SET image_local = $2 WHERE set_number = set_nummer_mit_version($1)', [
      nr,
      `/images/sets/${nr}.jpg`,
    ]);
    await haeltSet(db, uid, nr, 1, { preis: 10, am: '2026-06-03T10:00:00Z' });
  }
}

/** Je sichtbarem Bild: Seitenverhältnis der Datei und des gemalten Bilds (object-fit), Lage im Rahmen. */
const BILDMASS = sel => `(() => [...document.querySelectorAll(${JSON.stringify(sel)})]
  .filter(i => i.checkVisibility() && /r25/.test(i.currentSrc || i.src)).map(i => {
    const r = i.getBoundingClientRect(), s = getComputedStyle(i);
    const bw = r.width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) - parseFloat(s.borderLeftWidth) - parseFloat(s.borderRightWidth);
    const bh = r.height - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom) - parseFloat(s.borderTopWidth) - parseFloat(s.borderBottomWidth);
    const datei = i.naturalWidth / i.naturalHeight;
    let gw = bw, gh = bh;
    if (s.objectFit === 'contain' || s.objectFit === 'scale-down') { if (bw / bh > datei) gw = bh * datei; else gh = bw / datei; }
    const rahmen = i.closest('.sci, td, .m-kopfteil, .modal').getBoundingClientRect();
    return { nr: (i.currentSrc || i.src).replace(/.*sets\\/|(_thumb)?\\.jpg.*/g, ''), geladen: i.complete && i.naturalWidth > 0,
      datei: +datei.toFixed(3), gemalt: +(gw / gh).toFixed(3), fit: s.objectFit,
      raus: r.left < rahmen.left - 0.5 || r.right > rahmen.right + 0.5 || r.top < rahmen.top - 0.5 || r.bottom > rahmen.bottom + 0.5 };
  }))()`;

function pruefeBilder(m, wo, anzahl) {
  assert.equal(m.length, anzahl, `${wo}: ${m.length} Bilder statt ${anzahl}`);
  for (const x of m) {
    const soll = BILDER.find(([nr]) => nr === x.nr);
    assert.ok(soll && x.geladen, `${wo}: ${x.nr} nicht geladen`);
    const quelle = Number(soll[1]) / Number(soll[2]);
    // Eine Vorschau darf kleiner sein, aber nicht anders geformt: eine quadratische hiesse „zugeschnitten“.
    assert.ok(Math.abs(x.datei / quelle - 1) < 0.05, `${wo}: ${x.nr} Datei ${x.datei} statt ${quelle} (zugeschnitten)`);
    assert.ok(Math.abs(x.gemalt / quelle - 1) < 0.05, `${wo}: ${x.nr} gemalt ${x.gemalt} statt ${quelle} (gestreckt)`);
    assert.ok(!x.raus, `${wo}: ${x.nr} ragt aus seinem Rahmen`);
  }
}

async function bilder(_t, a) {
  const { b, bis } = a;
  try {
    for (const dunkel of [false, true]) {
      await b.auswerten(`document.documentElement.toggleAttribute('data-dunkel', ${dunkel}); true`);
      for (const [breite, telefon] of [
        [1280, false],
        [390, true],
        [320, true],
      ]) {
        const wo = `${breite} px ${dunkel ? 'dunkel' : 'hell'}`;
        await groesse(b, breite, telefon);
        await geh(a, '#/sammlung', `document.querySelectorAll('#gallery .sc').length >= 9`, 'Sammlung');
        await b.auswerten(`document.getElementById('vg').click(); true`);
        await bis(`!!document.querySelector('#gallery .sgrid')`, 'Kacheln');
        await b.auswerten(`document.querySelectorAll('#gallery img').forEach(i => { i.loading = 'eager'; }); true`);
        await bis(
          `[...document.querySelectorAll('#gallery .sci img')].filter(i => /r25/.test(i.src)).every(i => i.complete && i.naturalWidth)`,
          `${wo}: Kachelbilder`,
        );
        pruefeBilder(await b.auswerten(BILDMASS('#gallery .sci img')), `Kacheln ${wo}`, BILDER.length);
        // Ruhiges Raster: In einer Reihe sind alle Bildflächen gleich gross.
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
          pruefeBilder(await b.auswerten(BILDMASS('#gallery table img')), `Tabelle ${wo}`, BILDER.length);
          await b.auswerten(`document.getElementById('vg').click(); true`);
        }
        for (const [nr] of BILDER) {
          await b.auswerten(
            `document.querySelector('#gallery [data-click="openModal"][data-arg="${nr}"]').click(); true`,
          );
          await bis(
            `(i => document.getElementById('set-modal').classList.contains('open') && /${nr}\\.jpg/.test(i.src) && i.complete && i.naturalWidth)(document.getElementById('m-img'))`,
            `${wo}: Detail ${nr}`,
          );
          pruefeBilder(await b.auswerten(BILDMASS('#m-img')), `Detail ${wo}`, 1);
          await b.auswerten(SCHLIESSEN);
        }
      }
    }
  } finally {
    await b.auswerten(`document.documentElement.removeAttribute('data-dunkel'); true`);
    await groesse(b, 1280, false);
  }
}

async function minusBeiEinem(_t, a) {
  const { b, bis } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc[data-arg="10300-1"]')`, 'Sammlung');
  await b.auswerten(`document.querySelector('#gallery .sc[data-arg="10300-1"]').click(); true`);
  await bis(`document.getElementById('m-qty')?.value === '1' && !!document.getElementById('m-qty-dec')`, 'Detail');
  const schreibend = () =>
    b.ereignisse.filter(
      e =>
        e.method === 'Network.requestWillBeSent' &&
        e.params.request.method !== 'GET' &&
        /\/api\/v1\/sets\/10300-1/.test(e.params.request.url),
    ).length;
  const stand = () =>
    b.auswerten(`(() => { const k = document.getElementById('m-qty-dec');
      return { wert: document.getElementById('m-qty').value, gesperrt: k.getAttribute('aria-disabled'), titel: k.title,
        beschreibung: document.getElementById(k.getAttribute('aria-describedby') || '-')?.textContent || '' }; })()`);
  const vorher = schreibend();
  const m = await stand();
  assert.equal(m.gesperrt, 'true', `„−“ bei einem Exemplar nicht gesperrt: ${JSON.stringify(m)}`);
  assert.equal(m.titel, 'Zum Entfernen: „Set löschen“ unter „Weitere Aktionen“');
  assert.equal(m.beschreibung, m.titel, 'Vorleser hören den Hinweis nicht');
  await b.auswerten(`document.getElementById('m-qty-dec').click(); true`);
  await a.warte(700);
  assert.deepEqual([(await stand()).wert, schreibend() - vorher], ['1', 0], '„−“ bei 1 hat etwas getan');
  await b.auswerten(`document.querySelector('[data-click="mQtyInc"]').click(); true`);
  await bis(`document.getElementById('m-qty-dec').getAttribute('aria-disabled') === 'false'`, '„−“ frei bei 2');
  assert.equal((await stand()).titel, '', 'Hinweis bleibt bei 2 stehen');
  await bis(`document.querySelector('#m-menge .feld-status')?.textContent.trim() !== ''`, 'gespeichert');
  await a.ruhig();
  await b.auswerten(`document.getElementById('m-qty-dec').click(); true`);
  await bis(`document.getElementById('m-qty-dec').getAttribute('aria-disabled') === 'true'`, 'zurück auf 1');
  // Gespeichert wird 400 ms später; vorher geschlossen, bliebe die 2 stehen.
  await a.warte(700);
  await a.ruhig();
  await b.auswerten(SCHLIESSEN);
}

async function schwebenderKnopf(_t, a) {
  const { b } = a;
  await sprache(a, 'en');
  try {
    // B3: Das Datumsfeld erbt die Sprache der Seite.
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
          await b.auswerten(`(() => { const f = document.querySelector('#tab-${tab} .knopf-schwebend').getBoundingClientRect();
          const blaetter = [...document.querySelectorAll('#tab-${tab} *')].filter(e => !e.closest('.knopf-schwebend') && !e.children.length
            && (e.textContent.trim() || e.matches('img, svg')) && e.checkVisibility());
          const unten = blaetter.map(e => ({ e, r: e.getBoundingClientRect() })).filter(x => x.r.height > 0 && x.r.bottom > 0)
            .sort((x, y) => y.r.bottom - x.r.bottom)[0];
          const ueber = blaetter.filter(e => { const r = e.getBoundingClientRect();
            return r.height > 0 && r.bottom > f.top && r.top < f.bottom && r.right > f.left && r.left < f.right; });
          return { knopfOben: Math.round(f.top), letzte: unten && { text: unten.e.textContent.trim().slice(0, 40), unten: Math.round(unten.r.bottom) },
            ueber: ueber.map(e => e.textContent.trim().slice(0, 30) || e.tagName) }; })()`);
        assert.ok(m.letzte, `${tab} ${breite} px: keine letzte Zeile gefunden`);
        assert.deepEqual(m.ueber, [], `${tab} ${breite} px: vom Knopf verdeckt: ${JSON.stringify(m)}`);
        assert.ok(
          m.letzte.unten <= m.knopfOben,
          `${tab} ${breite} px: letzte Zeile unter dem Knopf: ${JSON.stringify(m)}`,
        );
      }
    }
  } finally {
    await groesse(b, 1280, false);
    await sprache(a, 'de');
  }
}

async function tabellenansicht(_t, a) {
  const { b, bis } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc')`, 'Sammlung');
  await b.auswerten(`document.getElementById('vl').click(); true`);
  await bis(`!!document.querySelector('#gallery table')`, 'Tabelle');
  // Neu sortiert lädt die Liste neu: Die Tabelle steht vor den Preisen da, der Marktwert kommt nach.
  await b.auswerten(
    `document.querySelector('#gallery thead [data-click="setsSortieren"][data-arg="num"]').click(); true`,
  );
  await bis(
    `/€/.test(document.querySelector('#gallery tr[data-arg="75192-1"] [data-tabwert-for]')?.textContent || '')`,
    'Marktwert in der Tabelle',
  );
  await a.ruhig();
  const m =
    await b.auswerten(`(() => { const kopf = [...document.querySelectorAll('#gallery thead th')].map(k => k.textContent.trim());
    const zelle = (nr, k) => { const z = document.querySelector('#gallery tr[data-arg="' + nr + '"]').children[kopf.indexOf(k)].cloneNode(true);
      z.querySelectorAll('.vh').forEach(v => v.remove()); return z.textContent.replace(/\\s+/g, ' ').trim(); };
    return { kopf, untertitel: ${text('#tab-gallery .ptitle-unter')},
      falke: [zelle('75192-1', 'Kaufpreis'), zelle('75192-1', 'Marktwert')], geschenk: zelle('10300-1', 'Kaufpreis') }; })()`);
  await b.auswerten(`document.getElementById('vg').click(); true`);
  assert.match(m.untertitel, /Kaufpreis und Marktwert|Kaufpreis, Marktwert/, 'Testdaten: Untertitel verspricht beides');
  assert.ok(m.kopf.includes('Kaufpreis') && m.kopf.includes('Marktwert'), `Spalten fehlen: ${m.kopf.join(' | ')}`);
  assert.match(m.falke[0], /^650,00\s€$/);
  assert.match(m.falke[1], /^801,50\s€\s*\+23,3\s%$/, `Marktwert mit Entwicklung: ${m.falke[1]}`);
  assert.equal(m.geschenk, 'Geschenk');
}

async function finanzSpalten(_t, a) {
  const { b } = a;
  await geh(a, '#/finanzen', `!!document.querySelector('#fin-tbl [data-fin-art="parts"] tbody tr')`, 'Finanzen');
  const m =
    await b.auswerten(`(() => { const sichtbar = z => { const k = z.cloneNode(true); k.querySelectorAll('.vh').forEach(v => v.remove());
      return k.textContent.trim() || (k.querySelector('img, svg') ? 'Bild' : ''); };
    const leer = [...document.querySelectorAll('#fin-tbl [data-fin-art] table')].flatMap(t => {
      const kopf = [...t.querySelectorAll('thead th')].map(k => k.textContent.trim());
      const zeilen = [...t.querySelectorAll('tbody tr')];
      return kopf.filter((k, i) => zeilen.length && zeilen.every(z => !sichtbar(z.children[i] || z))).map(k => t.getAttribute('aria-label') + ': ' + (k || '(ohne Kopf)'));
    });
    const teil = [...document.querySelectorAll('[data-fin-art="parts"] tbody tr')].find(z => /250/.test(z.textContent) && /0,12/.test(z.textContent));
    return { leer, koepfe: [...document.querySelectorAll('[data-fin-art="sets"] thead th')].map(k => k.textContent.trim()),
      teil: teil && [...teil.children].map(sichtbar).filter(x => /0,12/.test(x)) }; })()`);
  assert.ok(!m.koepfe.includes('Stückpreis'), `Spalte „Stückpreis“ steht noch da: ${m.koepfe.join(' | ')}`);
  assert.deepEqual(m.leer, [], 'Spalte ohne einen Wert');
  assert.ok(m.teil, 'Testdaten: Teil zu 0,12 € je Stück');
  assert.equal(m.teil.length, 1, `Stückpreis doppelt: ${JSON.stringify(m.teil)}`);
  assert.match(m.teil[0], /^30,00\s€\s*je 0,12\s€$/);
}

async function finanzBegriffe(_t, a) {
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
    await b.auswerten(`({ titel: ${text('#fin-einstand-titel')}, hilfe: document.getElementById('fin-einstand-titel').title,
    unter: ${text('#fin-einstand-sub')}, zeilen: ${zeilen}, basis: ${text('#fin-basis')} })`);
  assert.equal(m.titel, 'Kaufpreis (bewertete Positionen)');
  assert.match(m.hilfe, /Kauf- und Marktpreis/, 'Erklärung im Tooltip fehlt');
  assert.match(m.unter, /^Insgesamt bezahlt: [\d.]+,\d\d €$/);
  assert.ok(m.zeilen <= 1, `Erklärzeile über ${m.zeilen} Zeilen: ${m.basis}`);
  assert.match(m.basis, /je Kauf und Konto/, 'Testdaten: mehrere Zeilen je Position, die Erklärung steht im Tooltip');
}

/** Lädt die Seite neu (wie Runde 24): Der Fehler soll beim ersten Laden kommen, nicht über einem alten Stand. */
async function serverfehlerVerwalter(_t, a) {
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
    await bis(`!window.__alt && !!document.querySelector('.tab.active .fehler-zustand')`, 'Fehler', 300);
    const m = await b.auswerten(text('.tab.active .fehler-zustand'));
    assert.match(m, /Hintergrundarbeiten → „Protokoll anzeigen“/, m);
    assert.doesNotMatch(m, /hilft der Administrator/, 'Verwalter wird an sich selbst verwiesen');
  } finally {
    await b.tab('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    await b.auswerten(`location.reload(); true`);
    await bis(`!!document.querySelector('#gallery .sc, .tab.active')`, 'neu geladen', 300);
    await a.ruhig();
  }
}

async function auftraege(_t, a) {
  const { b } = a;
  // Ein Dienst wartet mit Arbeit (total > 0), einer läuft: Nur der laufende zeigt den Balken.
  await b.auswerten(`window.__echt = window.fetch; window.fetch = async (u, o) => { const r = await window.__echt(u, o);
    if (!/v1\\/admin\\/jobs$/.test(String(u))) return r;
    const d = await r.clone().json(); const [x, y] = Object.keys(d.jobs);
    d.jobs[x] = { ...d.jobs[x], status: 'idle', total: 10, progress: 3 }; d.jobs[y] = { ...d.jobs[y], status: 'running', total: 10, progress: 5 };
    window.__dienste = [x, y]; return new Response(JSON.stringify(d), { status: 200, headers: { 'Content-Type': 'application/json' } }); }; true`);
  try {
    await geh(
      a,
      '#/hintergrund',
      `!!window.__dienste && !!document.querySelector('.mon-dienste tbody tr') && !!document.querySelector('.mon-arten .mon-zusatz')`,
      'Hintergrund',
    );
    const m = await b.auswerten(`(() => { const zeilen = [...document.querySelectorAll('.mon-dienste tbody tr')];
      const balken = zeilen.filter(z => z.querySelector('.mon-balken')).map(z => z.querySelector('.mon-zustand').className);
      const leerlauf = zeilen.some(z => z.querySelector('.mon-balken') && z.querySelector('.mon-idle'));
      const z = [...document.querySelectorAll('.mon-arten tbody tr')].find(r => r.querySelector('.mon-zusatz'));
      const td = z.querySelector('.mon-zusatz').closest('td'), zahl = td.querySelector('.mon-ziffer').getBoundingClientRect();
      const zusatz = td.querySelector('.mon-zusatz').getBoundingClientRect(), zelle = td.getBoundingClientRect();
      return { balken, leerlauf, rechts: Math.round(zelle.right - parseFloat(getComputedStyle(td).paddingRight) - zahl.right),
        darunter: zusatz.top >= zahl.bottom - 1, text: td.textContent.replace(/\\s+/g, ' ').trim() }; })()`);
    assert.ok(m.balken.length > 0, 'Testdaten: ein laufender Dienst mit Balken');
    assert.ok(
      m.balken.every(k => /mon-running/.test(k)) && !m.leerlauf,
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
  await geh(a, '#/konto', `!!document.querySelector('#zf-flaeche [data-click="zfNeueCodes"]')`, 'Konto');
  assert.equal(await b.auswerten(`!!document.querySelector('#zf-flaeche input')`), false, 'Codefeld für zwei Aktionen');
  const dialog = `({ offen: document.getElementById('confirm-modal').style.display === 'flex', titel: ${text('#cd-title')},
    code: !document.getElementById('cd-code-wrap').hidden, pw: !document.getElementById('cd-pw-wrap').hidden })`;
  // Neue Codes: der Code im eigenen Dialog.
  await b.auswerten(`document.querySelector('#zf-flaeche [data-click="zfNeueCodes"]').click(); true`);
  await bis(`document.getElementById('confirm-modal').style.display === 'flex'`, 'Dialog „Neue Codes“');
  const neu = await b.auswerten(dialog);
  assert.deepEqual([neu.code, neu.pw], [true, false], JSON.stringify(neu));
  assert.match(neu.titel.replace(/­/g, ''), /Neue Wiederherstellungscodes/);
  await b.auswerten(`document.getElementById('cd-code').value = ${JSON.stringify(a.weitereCodes[0])};
    document.getElementById('cd-confirm').click(); true`);
  await bis(`!!document.getElementById('zf-codes')`, 'neue Codes');
  await b.auswerten(`document.getElementById('zf-gespeichert').click(); true`);
  await bis(`!!document.querySelector('#zf-flaeche [data-click="zfAbschalten"]')`, 'zurück');
  // Abschalten heisst für Verwalter „Neu einrichten“: ein Dialog mit Passwort und Code, abgebrochen.
  await b.auswerten(`document.querySelector('#zf-flaeche [data-click="zfAbschalten"]').click(); true`);
  await bis(`document.getElementById('confirm-modal').style.display === 'flex'`, 'Rückfrage Neu einrichten');
  const ab = await b.auswerten(dialog);
  assert.deepEqual([ab.code, ab.pw], [true, true], JSON.stringify(ab));
  assert.match(ab.titel, /Neu einrichten/);
  await b.auswerten(`document.getElementById('cd-cancel').click(); true`);
  await bis(`document.getElementById('confirm-modal').style.display !== 'flex'`, 'abgebrochen');
}

async function seitentitel(_t, a) {
  const { b, bis } = a;
  await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc[data-arg="10300-1"]')`, 'Sammlung');
  const vorher = await b.auswerten('document.title');
  await b.auswerten(`document.querySelector('#gallery .sc[data-arg="10300-1"]').click(); true`);
  await bis(`document.title === 'Back to the Future Time Machine – BrickInventory'`, 'Titel mit Setnamen', 50);
  await b.auswerten(`document.querySelector('#set-modal [data-dialog-zu]').click(); true`);
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
      const m = await b.auswerten(`({ feld: document.getElementById('pl-setnr').getBoundingClientRect().width,
        karte: document.querySelector('#tab-partslist .ph').getBoundingClientRect().width })`);
      if (telefon)
        assert.ok(m.feld >= m.karte - 1, `${breite} px: Feld nicht über die ganze Breite: ${JSON.stringify(m)}`);
      else assert.ok(m.feld >= 480, `${breite} px: Feld für mehrere Setnummern zu schmal: ${JSON.stringify(m)}`);
    }
  } finally {
    await groesse(b, 1280, false);
  }
}

async function merklisteZu(_t, a) {
  const { b } = a;
  await groesse(b, 390, true);
  try {
    await geh(a, '#/merkliste', `!!document.querySelector('#mk-list .mk-zeile')`, 'Merkliste');
    const m =
      await b.auswerten(`(() => { const d = document.getElementById('mk-kasten'), h = d.querySelector('summary h2');
      const kd = d.getBoundingClientRect(), kh = h.getBoundingClientRect();
      return { offen: d.open, oben: Math.round(kh.top - kd.top), unten: Math.round(kd.bottom - kh.bottom) }; })()`);
    assert.equal(m.offen, false, 'Testdaten: am Telefon zugeklappt');
    assert.ok(Math.abs(m.oben - m.unten) <= 2, `Leerraum unter der zugeklappten Karte: ${JSON.stringify(m)}`);
  } finally {
    await groesse(b, 1280, false);
  }
}

test('Menge, Tabellenwerte, zweiter Faktor, Bauliste', { concurrency: 1, timeout: 900_000 }, async t => {
  const name = `r25_${process.pid}`;
  const req = require('./helpers/sources').buildAndRequire();
  const a = await starteApp(t, {
    name,
    alleDesigns: true,
    bestand: async (db, uid) => {
      await musterHaushalt(db, uid);
      await legeBilder(t, db, uid, req);
      await db.run(`INSERT INTO auftraege (art, faellig_ab, versuche, max_versuche, fehler)
        VALUES ('wechselkurse', NOW() + interval '5 hours', 4, 6, 'Zeitüberschreitung')`);
    },
  });
  if (a.grund) {
    t.skip(a.grund);
    return;
  }
  t.after(() => a.db.run(`DELETE FROM auftraege WHERE art = 'wechselkurse' AND status = 'offen'`).catch(() => {}));
  await a.ruhig();
  /** @type {[string, (t: import('node:test').TestContext, a: object) => Promise<void>][]} */
  const pruefungen = [
    ['„−“ bei einem Exemplar', minusBeiEinem],
    ['Schwebender Knopf verdeckt nichts', schwebenderKnopf],
    ['Tabellenansicht mit Kaufpreis und Marktwert', tabellenansicht],
    ['Finanzen ohne leere Spalte', finanzSpalten],
    ['Finanzbegriffe', finanzBegriffe],
    ['Aufträge und Fortschritt', auftraege],
    ['Seitentitel im Set-Detail', seitentitel],
    ['Bauliste: breites Feld', bauliste],
    ['Merkliste zugeklappt', merklisteZu],
    ['Bilder verschiedener Form', bilder],
    // Lädt die Seite neu.
    ['Serverfehler für Verwalter', serverfehlerVerwalter],
    // Ersetzt die Wiederherstellungscodes: zuletzt.
    ['Zweiter Faktor: Code im Dialog', zweiterFaktor],
  ];
  for (const [titel, fn] of pruefungen) await t.test(titel, () => fn(t, a));
});
