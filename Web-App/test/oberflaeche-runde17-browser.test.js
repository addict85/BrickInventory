/**
 * UI-Prüfung 17 im echten Chrome: was die Ansichtsprüfung (oberflaeche-*)
 * nicht misst, weil es Tastenwege oder ein zweites Fenster braucht.
 *   - PDF-Betrachter (Barrierefreiheit H1): Die Seiten nehmen den Fokus,
 *     PageDown rollt, jede Seite heisst „Seite n von m“.
 *   - CSV-Fortschritt (H3): Nach der Dateiwahl liegt der Fokus im Overlay,
 *     zehnmal Tab verlässt es nicht, der Fortschritt steht in role=status.
 *   - Protokollfenster (M4): axe ohne Fund, Stufenknöpfe mit aria-pressed
 *     passend zu .active.
 *   - Fokusring (H4): In Kopf- und Reiterleiste hebt sich der Ring jedes
 *     Bedienelements in allen elf Designzuständen ≥ 3:1 vom Grund ab.
 *   - Abläufe M19, M20, N23: Set-Nummern der Listenansicht einzeilig bei
 *     1440 px; bei 720 × 450 (200 % Zoom) steht der Wert im Set-Detail ohne
 *     Rollen im Bild; bei 360 px ist der schwebende Knopf nach dem Rollen
 *     höchstens 56 px breit.
 *
 * Gegenproben (05.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  #pdf-viewer-pages ohne tabindex → rot: „PDF-Betrachter“ (Fokus nicht
 *      in den Seiten, scrollTop 0)
 *   B  in noppe.css --fokus-kopf entfernt → rot: „Fokusring“ (noppe hell,
 *      Kopf 1,0:1)
 *   C  im Protokollfenster aria-pressed am Info-Knopf entfernt → rot:
 *      „Protokollfenster“
 *   D  in mobile.css die Regel `.kopf-weg .knopf-schwebend` entfernt → rot:
 *      „Masse“ (Knopf breiter als 56 px)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp, warte } = require('./helpers/app-browser');
const { musterHaushalt } = require('./helpers/bestand');
const { AXE_LAUF } = require('./helpers/layout-messung');

const TAB = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 };
const taste = async (b, t) => {
  await b.tab('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...t });
  await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', ...t });
};
const datei = (sel, name, typ, inhalt) => `(() => { const f = document.querySelector(${JSON.stringify(sel)});
  const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(inhalt)}], ${JSON.stringify(name)}, { type: ${JSON.stringify(typ)} }));
  f.files = dt.files; f.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
const PDF = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R 4 0 R]/Count 2>>endobj\n'
  + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 400]>>endobj\n4 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 400]>>endobj\n'
  + 'trailer<</Root 1 0 R>>\n%%EOF\n';

const SCHLIESSEN = `(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  document.querySelectorAll('.ovl.open').forEach(o => o.classList.remove('open'));
  const p = document.getElementById('pdf-viewer-modal'); if (p) p.style.display = 'none'; return true; })()`;

async function pdfBetrachter(t, a) {
  const { b, bis } = a;
  await b.auswerten(`document.querySelector('.ntab[data-tab="gallery"]').click(); document.querySelector('#gallery [data-click="openModal"]').click(); true`);
  await bis(`!!document.getElementById('instr-file')`, 'Set-Detail');
  await b.auswerten(datei('#instr-file', 'anleitung.pdf', 'application/pdf', PDF));
  await bis(`!!document.querySelector('#set-modal [data-click="openPdfViewerLink"]')`, 'Anleitung hochgeladen');
  await b.auswerten(`document.querySelector('#set-modal [data-click="openPdfViewerLink"]').click(); true`);
  await bis(`document.querySelectorAll('#pdf-viewer-pages [role="img"]').length === 2`, 'zwei Seiten');
  await warte(300);
  const namen = await b.auswerten(`[...document.querySelectorAll('#pdf-viewer-pages [role="img"]')].map(s => s.getAttribute('aria-label'))`);
  assert.deepEqual(namen, ['Seite 1 von 2', 'Seite 2 von 2']);
  assert.ok(await b.auswerten(`document.activeElement?.id === 'pdf-viewer-pages'`), 'Fokus nicht in den Seiten');
  await taste(b, { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 });
  // Unter Last kommt der Bildlauf später an; gewartet wird bis 3 s.
  for (let i = 0; i < 30 && !await b.auswerten(`document.getElementById('pdf-viewer-pages').scrollTop > 0`); i++) await warte(100);
  assert.ok(await b.auswerten(`document.getElementById('pdf-viewer-pages').scrollTop > 0`),
    'PageDown rollt nicht: ' + await b.auswerten(`(() => { const p = document.getElementById('pdf-viewer-pages'); return [p.scrollHeight, p.clientHeight, document.activeElement?.id].join(' '); })()`));
  assert.deepEqual(await b.auswerten(AXE_LAUF), []);
}

async function csvFortschritt(t, a) {
  const { b, bis } = a;
  await b.auswerten(`document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
  await b.auswerten(datei('#csv-file', 'sets.csv', 'text/csv', 'set_number,quantity\n75192-1,1\n99999-1,abc\n'));
  // Steht ein Set schon im Bestand, fragt die Oberfläche erst nach.
  await b.auswerten(`new Promise(r => { const t0 = Date.now(); (function w() { const c = document.getElementById('confirm-modal');
      if (c && c.style.display === 'flex') { document.getElementById('cd-confirm').click(); r(true); }
      else if (document.getElementById('progress-overlay').classList.contains('open') || Date.now() - t0 > 5000) r(true); else setTimeout(w, 100); })(); })`);
  await bis(`document.getElementById('progress-overlay').classList.contains('open')`, 'Overlay offen');
  await warte(300);
  assert.ok(await b.auswerten(`document.getElementById('progress-overlay').contains(document.activeElement)`),
    `Fokus auf ${await b.auswerten('document.activeElement?.outerHTML?.slice(0, 80)')}`);
  for (let i = 0; i < 10; i++) {
    await taste(b, TAB);
    assert.ok(await b.auswerten(`document.getElementById('progress-overlay').contains(document.activeElement)`), `Tab ${i + 1} verlässt das Overlay`);
  }
  assert.ok(await b.auswerten(`!!document.getElementById('prog-footer').closest('[role="status"],[aria-live]')`), 'Fortschritt nicht angesagt');
  assert.deepEqual(await b.auswerten(AXE_LAUF), []);
}

async function protokollfenster(t, a) {
  const { b, bis } = a;
  await b.auswerten(`document.querySelector('.ntab[data-tab="monitor"]').click(); true`);
  await bis(`!!document.querySelector('[data-click="openLogViewer"]')`, 'Hintergrundarbeiten');
  // Das Fenster schreibt sein Markup in window.open(); hier ist es dieselbe Seite, damit axe sie misst.
  await b.auswerten(`window.open = () => window; document.querySelector('[data-click="openLogViewer"]').click(); true`);
  await bis(`!!document.getElementById('log-wrap') && !!document.getElementById('btn-info')`, 'Protokollfenster');
  await warte(800);
  assert.deepEqual(await b.auswerten(AXE_LAUF), []);
  const stufen = await b.auswerten(`[...document.querySelectorAll('.lvbtn')].map(k => [k.id, k.classList.contains('active'), k.getAttribute('aria-pressed')])`);
  for (const [id, aktiv, gedrueckt] of stufen) assert.equal(gedrueckt, String(aktiv), id);
  await b.auswerten(`document.getElementById('btn-info').click(); true`);
  assert.equal(await b.auswerten(`document.getElementById('btn-info').getAttribute('aria-pressed')`), 'true');
  assert.equal(await b.auswerten(`document.getElementById('status').getAttribute('role')`), 'status');
}

async function masse(t, a) {
  const { b, bis } = a;
  const groesse = (w, h, mobil) => b.tab('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: mobil });
  try {
    await groesse(1440, 900, false);
    await b.auswerten(`document.querySelector('.ntab[data-tab="gallery"]').click(); document.getElementById('vl').click(); true`);
    await bis(`!!document.querySelector('#gallery table tbody tr')`, 'Listenansicht');
    const nummern = await b.auswerten(`[...document.querySelectorAll('#gallery table tbody tr')].map(z => z.cells[1]).filter(Boolean)
      .map(c => { const lh = parseFloat(getComputedStyle(c).lineHeight) || 20; return [c.innerText.trim(), c.querySelector('*')?.getBoundingClientRect().height ?? c.getBoundingClientRect().height, lh]; })`);
    assert.ok(nummern.length >= 3, `nur ${nummern.length} Zeilen`);
    for (const [text, hoehe, lh] of nummern) assert.ok(!text.includes('\n') && hoehe <= 1.5 * lh + 24, `Nummer „${text}“ ${hoehe}px`);

    await groesse(720, 450, false);
    await b.auswerten(`document.getElementById('vg').click(); document.querySelector('#gallery [data-click="openModal"]').click(); true`);
    await bis(`!!document.querySelector('#m-market-rows') && !document.querySelector('#m-market-rows .skelett-zeile')`, 'Set-Detail');
    const oben = await b.auswerten(`document.getElementById('m-market-rows').getBoundingClientRect().top`);
    assert.ok(oben < 450 - 40, `Wertkasten erst bei ${oben}px`);
    await b.auswerten(SCHLIESSEN);

    await groesse(360, 740, true);
    await b.auswerten(`window.scrollTo(0, 0); true`);
    await warte(200);
    for (const y of [120, 300, 600]) { await b.auswerten(`window.scrollTo(0, ${y}); true`); await warte(150); }
    const breite = await b.auswerten(`document.querySelector('#tab-gallery .knopf-schwebend').getBoundingClientRect().width`);
    assert.ok(breite <= 56.5, `schwebender Knopf ${breite}px breit`);
  } finally { await groesse(1280, 900, false); await b.auswerten(`window.scrollTo(0, 0); true`); }
}

const RING = `(() => {
  const rgba = (s) => { const m = String(s).match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const hell = (f) => 0.2126 * lin(f.r) + 0.7152 * lin(f.g) + 0.0722 * lin(f.b);
  const kontrast = (v, h) => { const [a, b] = [hell(v), hell(h)].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05); };
  const grund = (e) => { for (let x = e; x; x = x.parentElement) { const f = rgba(getComputedStyle(x).backgroundColor); if (f && f.a >= 1) return f; } return { r: 255, g: 255, b: 255 }; };
  const funde = [];
  for (const e of document.querySelectorAll('header :is(a,button,summary,select,input), nav:not(.einst-nav) :is(a,button)')) {
    const r = e.getBoundingClientRect(); if (r.width < 1 || !e.checkVisibility()) continue;
    e.focus(); if (!e.matches(':focus-visible')) continue;
    const s = getComputedStyle(e), farbe = rgba(s.outlineColor);
    const wert = s.outlineStyle === 'none' || !farbe ? 0 : kontrast(farbe, grund(e.parentElement));
    if (wert < 3) funde.push((e.id || e.className || e.tagName) + ' ' + wert.toFixed(2) + ':1');
  }
  document.activeElement?.blur(); return funde; })()`;

async function fokusring(t, a) {
  const { b } = a;
  // Eine echte Taste zuerst: Danach zeigt Chrome den Ring auch für focus() (:focus-visible).
  await taste(b, { key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
  const funde = [];
  for (const design of ['classic', 'brick', 'noppe', 'werkbank', 'farbfaecher', 'hochglanz']) for (const dunkel of [false, true]) {
    if (design === 'werkbank' && !dunkel) continue;
    await b.auswerten(`document.documentElement.setAttribute('data-theme', '${design}'); document.documentElement.toggleAttribute('data-dunkel', ${dunkel}); true`);
    await warte(50);
    for (const f of await b.auswerten(RING)) funde.push(`${design} ${dunkel ? 'dunkel' : 'hell'}: ${f}`);
  }
  assert.deepEqual(funde, []);
}

test('UI-Prüfung 17 im Browser', { concurrency: 1, timeout: 300_000 }, async (t) => {
  const a = await starteApp(t, { name: `r17_${process.pid}`, bestand: musterHaushalt });
  if (a.grund) { t.skip(a.grund); return; }
  await warte(800);
  await a.b.auswerten(`document.querySelector('#einrichtung-modal.open [data-click="einrichtungSpaeter"]')?.click(); true`);
  // Das Protokollfenster ersetzt die Seite; es kommt darum zuletzt.
  for (const [name, fn] of [['Fokusring', fokusring], ['Masse', masse], ['PDF-Betrachter', pdfBetrachter], ['CSV-Fortschritt', csvFortschritt],
    ['Protokollfenster', protokollfenster]]) {
    await a.b.auswerten(SCHLIESSEN);
    await t.test(name, () => fn(t, a));
  }
});
