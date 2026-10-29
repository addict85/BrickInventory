/**
 * Die App am Telefon (390 × 844, mobile) — gemessen in Chrome am echten
 * Server mit den echten Stylesheets.
 *
 *   - Erster Tab-Halt (Dokumentreihenfolge) ist der Sprunglink „Zum Inhalt“, mit Fokus sichtbar;
 *     Enter setzt den Fokus auf <main>. Je Reiter ist genau eine h1 sichtbar
 *     (der Seitentitel; vorher war die einzige h1 der Markenname).
 *   - In jedem Reiter ist jedes sichtbare Bedienelement mindestens 44 × 44 px
 *     und jeder Text mindestens 12 px groß.
 *   - Teile und Minifiguren: Am Telefon nennt „Sammlung“ in der Leiste die
 *     offene Ansicht („Teile“); am Rechner haben beide eigene Reiter.
 *   - Teile: zwölf Teile in zwölf Farben stehen in einem Raster (höchstens
 *     zehn Zeilen statt 24); die Filter liegen hinter dem Knopf „Filter“ und
 *     sind geöffnet gleich breit.
 *   - Merkliste: Nummer, Zustand, „Auf die Merkliste“ und CSV sind gleich
 *     hoch und stehen am Rechner auf einer Linie.
 *   - Set-Detail: „Löschen“ steht hinter „Weitere Aktionen“; die drei Felder
 *     des Preisalarms stehen unter der Beschriftung in einer Zeile über
 *     (fast) die volle Breite, jedes mindestens 44 px hoch.
 *   - Während die Teile laden, steht ein Skelett aus zwölf Kacheln
 *     (role="status") da; Dialoge und Reiter blenden ein, ausser bei
 *     prefers-reduced-motion: reduce.
 *   - Diagramme: Jede Beschriftung im Wertdiagramm (Finanzen) und im
 *     Preisverlauf (Set-Ansicht) ist mindestens 11 px groß, und jedes
 *     Diagramm hat role="img" mit einer Zusammenfassung als aria-label.
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  diagrammBreite() liefert immer 700 → rot: „Diagrammschrift
 *      Finanzen“ (5,6 px) und die Set-Ansicht (6,2 px)
 *   B  (29.10.) Marke in der Kopfleiste wieder <h1> → rot: „Sprunglink und genau eine
 *      h1 je Reiter“ (je Reiter zwei h1)
 *   C  (29.10.) Sprunglink aus index.html entfernt → rot: dieselbe Prüfung (erster
 *      Tab-Halt war .ubadge-knopf)
 *   D  (29.10.) --fs-0 wieder .6875rem → rot: „Tippziele und Schrift je
 *      Reiter“ (span.tab-label 11 px); .delbtn wieder 36 px → rot (36×36)
 *   E  (29.10.) in markiereGruppe die Zeilen für .tab-unter entfernt → rot:
 *      „Teile und Minifiguren in der Leiste auffindbar“ („Sammlung“);
 *      .ntab-sammlung wieder .ntab-unter → rot (am Rechner nicht sichtbar)
 *   F  (29.10.) .parts-list{display:grid…} aus styles.css entfernt → rot: „Teile:
 *      ein Raster, Filter als Blatt“ (24 Zeilen); Klasse filterleiste an der
 *      Teile-Filterzeile entfernt → rot („Die Auswahlfelder stehen offen da“)
 *   G  (29.10.) .merk-erfassen > .btn{height:38px…} entfernt → rot:
 *      „Merkliste: Erfassen-Zeile bündig“ (Knopf 34 px, CSV 39 px, versetzt)
 *   H  (29.10.) <details class="mehr-menue"> um #btn-md entfernt → rot:
 *      „Set-Ansicht: Diagramm, Löschen, Preisalarm“ („Löschen steht offen im
 *      Fuss“); die drei .alarm-zeile-Regeln aus mobile.css entfernt → rot
 *      (Felder neben der Beschriftung)
 *   I  (29.10.) in loadPartsData wieder ladeAnzeige() → rot: „Skelett beim
 *      Laden der Teile“; die prefers-reduced-motion-Regel entfernt → rot:
 *      „weniger Bewegung“ (Dialog 0,2 s); die Animation an .tab.active
 *      entfernt → rot (ohne Einstellung keine Übergänge)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp, warte } = require('./helpers/app-browser');
const { haeltSet } = require('./helpers/bestand');

/** Kleinste Schrift in px über alle Beschriftungen der Diagramme unter `wurzel`. */
const DIAGRAMMSCHRIFT = (wurzel) => `(() => {
  const svgs = [...document.querySelectorAll(${JSON.stringify(wurzel)} + ' svg.diagramm')];
  return svgs.map(svg => {
    const massstab = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    const groessen = [...svg.querySelectorAll('text')].map(x => parseFloat(getComputedStyle(x).fontSize) * massstab);
    return { rolle: svg.getAttribute('role'), name: svg.getAttribute('aria-label') || '',
             kleinste: Math.min(...groessen), anzahl: groessen.length };
  });
})()`;

/** Sichtbare Bedienelemente unter 44 × 44 px und Text unter 12 px. */
const KLEINES = `(() => {
  const sichtbar = e => { const q = e.getBoundingClientRect(); return q.width > 0 && q.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const klein = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, [role=button], label.btn')]
    .filter(sichtbar).filter(e => !e.closest('.vh'))
    .map(e => { const q = e.getBoundingClientRect(); return [e, Math.round(q.width), Math.round(q.height)]; })
    .filter(([, w, h]) => w < 44 || h < 44)
    .map(([e, w, h]) => e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).trim().replace(/\\s+/g, '.') : '') + ' ' + w + '×' + h);
  const schrift = [...document.querySelectorAll('body *')]
    .filter(e => !e.closest('svg') && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
    .filter(sichtbar)
    .map(e => [e, parseFloat(getComputedStyle(e).fontSize)]).filter(([, px]) => px < 12)
    .map(([e, px]) => e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).trim().replace(/\\s+/g, '.') : '') + ' ' + px + ' px');
  return { klein, schrift };
})()`;

test('Telefon', { concurrency: 1, timeout: 240_000 }, async (t) => {
  const app = await starteApp(t, {
    name: `telefon_${process.pid}`, telefon: true,
    // Zwölf Teile in zwölf Farben — der Fall, der vorher zwölf fast leere Zeilen ergab.
    // Die Teile kommen 1,5 s später, damit das Skelett davor zu sehen ist.
    abfangen: [{ muster: '*/api/v1/parts?*', enthaelt: '/api/v1/parts?', verzoegerung: 1500, antwort: { success: true, total: 12,
      parts: ['Red', 'Blue', 'Yellow', 'Green', 'Black', 'White', 'Orange', 'Tan', 'Lime', 'Pink', 'Brown', 'Purple']
        .map((farbe, i) => ({ part_number: `300${i}`, part_name: `Stein ${i}`, color_name: farbe, color_hex: '777777',
                             color_id: i + 1, total_quantity: 2 })) } }],
    bestand: async (db, uid) => {
      await haeltSet(db, uid, '10300-1', 1, { preis: 199 });
      await db.run(`DELETE FROM price_history WHERE set_number = '10300-1'`);
      for (const [tage, preis] of [[90, 210], [60, 230], [30, 250], [1, 260]])
        await db.run(`INSERT INTO price_history (set_number, condition, currency_code, avg_price, qty_avg_price, recorded_at)
                      VALUES ('10300-1', 'N', 'EUR', $1, $1, NOW() - ($2 || ' days')::interval)`, [preis, String(tage)]);
    },
  });
  if (app.grund) { t.skip(app.grund); return; }
  const { b, bis } = app;
  const reiter = async (name) => { await b.auswerten(`document.querySelector('.ntab[data-tab="${name}"]').click(); true`); await warte(400); };

  await t.test('Skelett beim Laden der Teile', async () => {
    await b.auswerten(`document.querySelector('.ntab[data-tab="parts"]').click(); true`);
    await warte(100);
    const s = await b.auswerten(`(() => { const r = document.querySelector('#parts-main .skelett-raster');
      return r && { kacheln: r.querySelectorAll('.part-card.skelett').length, rolle: r.getAttribute('role'), text: r.textContent.trim() }; })()`);
    assert.deepEqual(s, { kacheln: 12, rolle: 'status', text: 'Lade Teile…' });
    await bis(`!document.querySelector('#parts-main .skelett-raster') && document.querySelectorAll('#parts-main .part-card').length === 12`, 'Teile statt Skelett');
  });

  await t.test('Tippziele und Schrift je Reiter', async () => {
    const reiterListe = await b.auswerten(`[...document.querySelectorAll('.ntab[data-tab]')].map(x => x.dataset.tab)`);
    const klein = [], schrift = [];
    for (const r of reiterListe) {
      await reiter(r);
      const m = await b.auswerten(KLEINES);
      klein.push(...m.klein.map(k => `${r}: ${k}`));
      schrift.push(...m.schrift.map(k => `${r}: ${k}`));
    }
    assert.deepEqual([...new Set(klein)], [], 'Tippziele unter 44 × 44 px');
    assert.deepEqual([...new Set(schrift)], [], 'Text unter 12 px');
  });

  await t.test('Sprunglink und genau eine h1 je Reiter', async () => {
    const reiterListe = await b.auswerten(`[...document.querySelectorAll('.ntab[data-tab]')].map(x => x.dataset.tab)`);
    assert.ok(reiterListe.length >= 8, `nur ${reiterListe.length} Reiter`);
    const falsch = [];
    for (const r of reiterListe) {
      await reiter(r);
      const h1 = await b.auswerten(`[...document.querySelectorAll('h1')].filter(h => h.getClientRects().length > 0).map(h => h.textContent.trim())`);
      if (h1.length !== 1) falsch.push(`${r}: ${JSON.stringify(h1)}`);
    }
    assert.deepEqual(falsch, []);
    await reiter('gallery');
    // Der erste Tab-Halt in Dokumentreihenfolge — so springt Tab nach dem Laden hin.
    const fokus = await b.auswerten(`(() => {
      const e = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')]
        .find(x => x.tabIndex >= 0 && !x.disabled && x.getClientRects().length > 0);
      e.focus(); const r = e.getBoundingClientRect();
      return { klasse: e.className, text: e.textContent.trim(), oben: r.top, hoehe: r.height }; })()`);
    assert.equal(fokus.klasse, 'sprunglink', `Erster Tab-Halt: ${JSON.stringify(fokus)}`);
    assert.equal(fokus.text, 'Zum Inhalt');
    assert.ok(fokus.oben >= 0 && fokus.hoehe >= 24, `Der Sprunglink ist mit Fokus nicht sichtbar: ${JSON.stringify(fokus)}`);
    await b.tab('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await warte(100);
    assert.equal(await b.auswerten(`document.activeElement.id`), 'inhalt');
  });

  await t.test('Teile und Minifiguren in der Leiste auffindbar', async () => {
    await reiter('gallery');
    await b.auswerten(`document.querySelector('#tab-gallery .sammlung-wahl [data-arg="parts"]').click(); true`);
    await warte(300);
    const telefon = await b.auswerten(`(() => { const s = document.querySelector('.ntab[data-tab="gallery"]');
      return { text: s.innerText.trim(), aktuell: s.getAttribute('aria-current'),
               teileSichtbar: document.querySelector('.ntab[data-tab="parts"]').getClientRects().length > 0 }; })()`);
    assert.equal(telefon.text, 'Teile', 'Die Leiste nennt die offene Ansicht nicht');
    assert.equal(telefon.aktuell, 'page');
    assert.equal(telefon.teileSichtbar, false, 'Am Telefon passen nur fünf Ziele in die Leiste');
    // Am Rechner haben Teile und Minifiguren eigene Reiter in der Leiste.
    await b.tab('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await warte(200);
    const rechner = await b.auswerten(`(() => { const r = n => document.querySelector('.ntab[data-tab="' + n + '"]');
      return { teile: r('parts').getClientRects().length > 0, figuren: r('minifigs').getClientRects().length > 0,
               sammlung: r('gallery').innerText.trim(), teileAktuell: r('parts').getAttribute('aria-current') }; })()`);
    await b.tab('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await warte(200);
    assert.deepEqual(rechner, { teile: true, figuren: true, sammlung: 'Sammlung', teileAktuell: 'page' });
    await reiter('gallery');
    assert.equal(await b.auswerten(`document.querySelector('.ntab[data-tab="gallery"]').innerText.trim()`), 'Sammlung');
  });

  await t.test('Teile: ein Raster, Filter als Blatt', async () => {
    await reiter('parts');
    await bis(`document.querySelectorAll('#parts-main .part-card:not(.skelett)').length === 12`, 'zwölf Teile');
    const raster = await b.auswerten(`(() => {
      const kacheln = [...document.querySelectorAll('#parts-main .group-hd, #parts-main .part-card')];
      const zeilen = new Set(kacheln.map(k => Math.round(k.getBoundingClientRect().top)));
      return { kacheln: kacheln.length, zeilen: zeilen.size };
    })()`);
    assert.equal(raster.kacheln, 24);
    assert.ok(raster.zeilen <= 10, `${raster.zeilen} Zeilen für 12 Teile in 12 Farben`);
    const sichtbar = (id) => `document.getElementById('${id}').getClientRects().length > 0`;
    assert.equal(await b.auswerten(sichtbar('parts-spare')), false, 'Die Auswahlfelder stehen offen da');
    await b.auswerten(`document.querySelector('#tab-parts .filter-knopf').click(); true`);
    const offen = await b.auswerten(`(() => ({
      erweitert: document.querySelector('#tab-parts .filter-knopf').getAttribute('aria-expanded'),
      sichtbar: ${sichtbar('parts-spare')},
      breiten: [...document.querySelectorAll('#tab-parts .filterleiste > select:not(.vh)')].filter(x => x.getClientRects().length)
        .map(x => Math.round(x.getBoundingClientRect().width)) }))()`);
    assert.equal(offen.erweitert, 'true');
    assert.equal(offen.sichtbar, true);
    assert.equal(new Set(offen.breiten).size, 1, `ungleich breite Felder: ${offen.breiten}`);
    await b.auswerten(`document.querySelector('#tab-parts .filter-knopf').click(); true`);
  });

  await t.test('Merkliste: Erfassen-Zeile bündig', async () => {
    await reiter('wanted');
    const messen = () => b.auswerten(`['mk-num', 'mk-cond', 'mk-add', 'mk-csv-file'].map(id => {
      const e = document.getElementById(id); const z = (id === 'mk-csv-file' ? e.closest('label') : e).getBoundingClientRect();
      return { id, oben: Math.round(z.top), hoehe: Math.round(z.height) };
    })`);
    for (const [breite, hoehe, mobil] of [[1280, 900, false], [390, 844, true]]) {
      await b.tab('Emulation.setDeviceMetricsOverride', { width: breite, height: hoehe, deviceScaleFactor: mobil ? 2 : 1, mobile: mobil });
      await warte(200);
      const m = await messen();
      // Am Telefon brechen die Felder um; dort zählt nur die gleiche Höhe.
      const zeile = mobil ? m : m.filter(x => x.oben === m[0].oben);
      assert.equal(zeile.length, m.length, `${breite} px: nicht in einer Zeile ${JSON.stringify(m)}`);
      assert.equal(new Set(m.map(x => x.hoehe)).size, 1, `${breite} px: Höhen ${JSON.stringify(m)}`);
    }
  });

  await t.test('Diagrammschrift Finanzen', async () => {
    await reiter('finance');
    await bis(`!!document.querySelector('#portfolio-chart svg.diagramm')`, 'Wertdiagramm');
    const [d] = await b.auswerten(DIAGRAMMSCHRIFT('#portfolio-chart'));
    assert.ok(d.anzahl >= 4, `nur ${d.anzahl} Beschriftungen`);
    assert.ok(d.kleinste >= 11, `kleinste Beschriftung ${d.kleinste.toFixed(1)} px`);
    assert.equal(d.rolle, 'img');
    assert.match(d.name, /Wertentwicklung Portfolio, .+ bis .+: von .+ auf .+/);
  });

  await t.test('Set-Ansicht: Diagramm, Löschen, Preisalarm', async () => {
    await reiter('gallery');
    await bis(`!!document.querySelector('[data-click="openModal"]')`, 'Set-Karte');
    await b.auswerten(`document.querySelector('[data-click="openModal"]').click(); true`);
    await bis(`!!document.querySelector('#m-sparkline-content svg.diagramm')`, 'Preisverlauf');
    const [d] = await b.auswerten(DIAGRAMMSCHRIFT('#m-sparkline-content'));
    assert.ok(d.kleinste >= 11, `kleinste Beschriftung ${d.kleinste.toFixed(1)} px`);
    assert.equal(d.rolle, 'img');
    assert.match(d.name, /Preisverlauf, .+ bis .+: Neu zuletzt/);
    // Set-Detail: Löschen steht hinter „Weitere Aktionen“, der Preisalarm in
    // einer eigenen Zeile über die volle Breite.
    const sichtbar = (sel) => `!!document.querySelector('${sel}')?.checkVisibility({ contentVisibilityAuto: true })`;
    assert.equal(await b.auswerten(sichtbar('#btn-md')), false, 'Löschen steht offen im Fuss');
    await b.auswerten(`document.querySelector('#set-modal .mehr-menue > summary').click(); true`);
    await warte(150);
    assert.equal(await b.auswerten(sichtbar('#btn-md')), true, 'Löschen ist hinter „Weitere Aktionen“ nicht zu finden');
    const alarm = await b.auswerten(`(() => {
      const zeile = document.querySelector('#set-modal .alarm-zeile');
      const titel = zeile.querySelector('.dl').getBoundingClientRect();
      const felder = [...zeile.querySelectorAll('.alarm-feld')].map(f => f.getBoundingClientRect());
      const z = zeile.getBoundingClientRect();
      return { unterTitel: felder.every(f => f.top >= titel.bottom - 1), eineZeile: new Set(felder.map(f => Math.round(f.top))).size,
               hoehe: Math.min(...felder.map(f => f.height)), breite: Math.round((felder.at(-1).right - felder[0].left) / z.width * 100) };
    })()`);
    assert.deepEqual({ ...alarm, breite: alarm.breite >= 90 }, { unterTitel: true, eineZeile: 1, hoehe: alarm.hoehe, breite: true },
      `Preisalarm: ${JSON.stringify(alarm)}`);
    assert.ok(alarm.hoehe >= 44, `Preisalarm-Felder ${alarm.hoehe} px hoch`);
    await b.auswerten(`document.querySelector('#set-modal [data-click="closeModal"]')?.click(); true`);
  });
  await t.test('weniger Bewegung: Dialog und Reiter ohne Animation', async () => {
    // Ein Probe-Dialog ohne role="dialog", damit die Fokusführung der echten
    // Dialoge (js/01-dialoge.js) nicht anspringt.
    const dauer = () => b.auswerten(`(() => { const o = document.createElement('div');
      o.className = 'ovl open'; o.innerHTML = '<div class="modal"></div>'; document.body.append(o);
      const d = getComputedStyle(o.firstElementChild).animationDuration; o.remove();
      return { dialog: parseFloat(d), reiter: parseFloat(getComputedStyle(document.querySelector('.tab.active')).animationDuration) }; })()`);
    const ruhig = await dauer();
    await b.tab('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    const bewegt = await dauer();
    await b.tab('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert.ok(bewegt.dialog >= 0.15 && bewegt.reiter >= 0.15, `ohne Einstellung keine Übergänge: ${JSON.stringify(bewegt)}`);
    assert.ok(ruhig.dialog < 0.001 && ruhig.reiter < 0.001, `mit „weniger Bewegung“ trotzdem Animation: ${JSON.stringify(ruhig)}`);
  });

});
