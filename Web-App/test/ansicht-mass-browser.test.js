/**
 * Masse der Oberfläche, gemessen in Chrome an der echten App.
 *
 * Telefon (390 × 844):
 *   - Kein Betrag in den Finanzkacheln bricht um oder ragt über die Kachel.
 *   - Der Löschknopf (44 × 44) überdeckt weder das Bild einer manuellen
 *     Teilekachel noch den Preis einer Merklistenzeile.
 *   - Stein: Die drei Kennzahlen stehen in EINER Reihe (waagrecht rollend)
 *     statt untereinander den ersten Bildschirm zu füllen.
 *   - Noppe: Die Reiter der unteren Leiste haben mindestens 4,5:1.
 * Rechner (1280 × 900):
 *   - Der Fokusring der Reiter liegt innen und wird von der rollenden Leiste
 *     nicht abgeschnitten.
 *   - Die Zahlenspalten der Finanztabelle sind samt Kopf rechtsbündig.
 *   - „Set hinzufügen“: Beschriftungen einer Zeile auf einer Höhe, Felder
 *     bündig unter ihnen, der Knopf schliesst rechts mit dem Raster ab.
 *   - Konto: Die Karte ist höchstens 52 rem breit.
 *
 * Gegenproben (am 29.10.2026 gemessen):
 *   A  .fval wieder `overflow-wrap: anywhere` statt nowrap/clamp und die
 *      420-px-Regel entfernt → rot: „Telefon: Beträge in einer Zeile“
 *   B  die beiden Platzregeln (.man-tile:has(> .ca), .mk-zeile) aus
 *      mobile.css entfernt → rot: „Telefon: Löschknopf verdeckt nichts“
 *   C  die Stein-Reihe wieder `grid-template-columns: 1fr` → rot: „Stein:
 *      Kennzahlen in einer Reihe“ (3 Reihen)
 *   D  noppe nav .ntab wieder var(--b100) → rot: „Noppe: untere Leiste“ (3,74:1)
 *   E  .ntab:focus-visible entfernt → rot: „Rechner: Fokusring innen“
 *   F  `.dt-fin .zahl{text-align:right}` entfernt → rot: „Rechner: Zahlen
 *      rechtsbündig“
 *   G  .erfassen-raster entfernt → rot: „Rechner: Set hinzufügen bündig“
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp, warte } = require('./helpers/app-browser');
const { haeltSet, haeltTeil } = require('./helpers/bestand');

/** Kontrast zweier CSS-Farben (rgb[a]) im Browser. */
const KONTRAST = `(vorne, hinten) => { const f = s => (s.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
  const l = ([r, g, b]) => { const c = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b); };
  const [a, b] = [l(f(vorne)), l(f(hinten))].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05); }`;

test('Masse der Oberfläche', { concurrency: 1, timeout: 300_000 }, async (t) => {
  const app = await starteApp(t, {
    name: `mass_${process.pid}`, telefon: true,
    bestand: async (db, uid) => {
      await haeltSet(db, uid, '10294-1', 1, { preis: 4894.77 });
      await db.run(`INSERT INTO price_cache (set_number, condition, currency_code, min_price, avg_price, max_price, qty_avg_price, total_quantity, fetched_at)
                    VALUES ('10294-1', 'N', 'EUR', 4005.5, 5002.2, 6295.5, 5000, 10, NOW())
                    ON CONFLICT DO NOTHING`).catch(() => {});
      await haeltTeil(db, uid, '3001', { colorId: 4, menge: 250, preis: 0.12 });
      await db.run(`INSERT INTO wanted (user_id, set_number, condition) VALUES ($1, '10276-1', 'N') ON CONFLICT DO NOTHING`, [uid]);
    },
  });
  if (app.grund) { t.skip(app.grund); return; }
  const { b, bis } = app;
  const reiter = async (name) => { await b.auswerten(`document.querySelector('.ntab[data-tab="${name}"]').click(); true`); await warte(500); };
  const groesse = async (w, h, mobil) => {
    await b.tab('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobil ? 2 : 1, mobile: mobil });
    await warte(250);
  };

  // Ohne Rebrickable-Schlüssel springt die App kurz nach dem Start in die
  // Einstellungen; erst danach den Reiter wechseln.
  await warte(1200);

  await t.test('Telefon: Beträge in einer Zeile', async () => {
    await reiter('finance');
    const sichtbar = await b.auswerten(`[...document.querySelectorAll('#fin-sum .fval')].filter(e => e.getClientRects().length && e.getBoundingClientRect().width > 0).length`);
    assert.ok(sichtbar >= 2, `nur ${sichtbar} Kacheln sichtbar`);
    await bis(`!document.getElementById('fin-sum').hasAttribute('aria-busy') && /\\d/.test(document.getElementById('fin-einstand').textContent)`, 'Finanzkacheln');
    const fehler = await b.auswerten(`[...document.querySelectorAll('#fin-sum .fval')].filter(e => e.getClientRects().length).map(e => {
      const r = document.createRange(); r.selectNodeContents(e);
      const zeilen = new Set([...r.getClientRects()].map(q => Math.round(q.top))).size;
      const kachel = e.closest('.fstat').getBoundingClientRect(), text = r.getBoundingClientRect();
      return (zeilen > 1 || text.right > kachel.right + 0.5) ? e.id + ': ' + zeilen + ' Zeilen, „' + e.textContent.trim() + '“' : null; }).filter(Boolean)`);
    assert.deepEqual(fehler, []);
  });

  await t.test('Telefon: Löschknopf verdeckt nichts', async () => {
    const ueber = (a, b) => `(() => { const k = ${a}, z = ${b}; if (!k || !z) return 'fehlt';
      const p = k.getBoundingClientRect(), q = z.getBoundingClientRect();
      const x = Math.max(0, Math.min(p.right, q.right) - Math.max(p.left, q.left)), y = Math.max(0, Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top));
      return Math.round(x * y); })()`;
    await reiter('parts');
    await bis(`!!document.querySelector('#manual-parts-list .man-tile .delbtn, .man-tile .delbtn')`, 'manuelle Kachel');
    const teil = await b.auswerten(ueber(`document.querySelector('.man-tile .delbtn')`, `document.querySelector('.man-tile .man-tile-img')`));
    await reiter('wanted');
    await bis(`!!document.querySelector('.mk-zeile .delbtn')`, 'Merklistenzeile');
    const merk = await b.auswerten(ueber(`document.querySelector('.mk-zeile .delbtn')`, `document.querySelector('.mk-zeile .mk-preis')`));
    assert.deepEqual({ teil, merk }, { teil: 0, merk: 0 }, 'überdeckte Fläche in px²');
  });

  await t.test('Stein: Kennzahlen in einer Reihe', async () => {
    await b.auswerten(`document.documentElement.setAttribute('data-theme', 'brick'); true`);
    await reiter('gallery');
    const m = await b.auswerten(`(() => {
      const k = [...document.querySelectorAll('#tab-gallery .bstat')].map(e => Math.round(e.getBoundingClientRect().top));
      return { reihen: new Set(k).size, hoehe: Math.round(document.querySelector('#tab-gallery .brick-stats').getBoundingClientRect().height) }; })()`);
    await b.auswerten(`document.documentElement.setAttribute('data-theme', 'classic'); true`);
    assert.equal(m.reihen, 1, `Kennzahlen in ${m.reihen} Reihen`);
    assert.ok(m.hoehe <= 140, `Kennzahlen ${m.hoehe} px hoch`);
  });

  await t.test('Noppe: untere Leiste mindestens 4,5:1', async () => {
    await b.auswerten(`document.documentElement.setAttribute('data-theme', 'noppe'); true`);
    await warte(200);
    const werte = await b.auswerten(`(() => { const k = ${KONTRAST};
      const nav = getComputedStyle(document.querySelector('nav')).backgroundColor;
      return [...document.querySelectorAll('nav .ntab:not(.active)')].filter(e => e.getClientRects().length)
        .map(e => Math.round(k(getComputedStyle(e).color, nav) * 100) / 100); })()`);
    await b.auswerten(`document.documentElement.setAttribute('data-theme', 'classic'); true`);
    assert.ok(werte.length >= 3, `nur ${werte.length} Reiter`);
    assert.ok(Math.min(...werte) >= 4.5, `Kontraste: ${werte}`);
  });

  await groesse(1280, 900, false);

  await t.test('Rechner: Fokusring innen', async () => {
    await reiter('gallery');
    // Der Einrichtungsassistent des neuen Verwalters hielte den Fokus fest.
    await b.auswerten(`document.querySelector('#einrichtung-modal.open [data-click="einrichtungSpaeter"]')?.click(); true`);
    await warte(200);
    // Mit der Tastatur bis zum ersten Reiter: Erst dann gilt :focus-visible.
    await b.auswerten(`document.activeElement?.blur(); document.querySelector('.sprunglink').focus(); true`);
    const weg = [];
    for (let i = 0; i < 25; i++) {
      weg.push(await b.auswerten(`(document.activeElement?.tagName || '') + '.' + (document.activeElement?.className || '')`));
      if (await b.auswerten(`!!document.activeElement?.classList.contains('ntab')`)) break;
      await b.tab('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    }
    const ring = await b.auswerten(`(() => { const e = document.activeElement, s = getComputedStyle(e);
      return { reiter: e.classList.contains('ntab'), breite: parseFloat(s.outlineWidth), abstand: parseFloat(s.outlineOffset), stil: s.outlineStyle }; })()`);
    assert.equal(ring.reiter, true, `Tab erreicht keinen Reiter: ${weg.join(' → ')}`);
    assert.ok(ring.stil !== 'none' && ring.breite >= 2, `kein Ring: ${JSON.stringify(ring)}`);
    assert.ok(ring.abstand + ring.breite <= 0, `der Ring ragt ${ring.abstand + ring.breite} px hinaus und wird abgeschnitten`);
  });

  await t.test('Rechner: Zahlen rechtsbündig', async () => {
    await reiter('finance');
    await bis(`!!document.querySelector('#fin-tbl .dt-fin td.price-total')`, 'Finanztabelle');
    const links = await b.auswerten(`[...document.querySelectorAll('#fin-tbl .dt-fin')][0].querySelectorAll('th.zahl, td.zahl').length === 0 ? ['keine Zahlenspalten'] :
      [...document.querySelector('#fin-tbl .dt-fin').querySelectorAll('th.zahl, td.zahl')]
        .filter(e => getComputedStyle(e).textAlign !== 'right').map(e => e.tagName + ' ' + e.textContent.trim().slice(0, 15))`);
    assert.deepEqual(links, []);
  });

  await t.test('Rechner: Set hinzufügen bündig', async () => {
    await reiter('gallery');
    await b.auswerten(`document.querySelector('button[data-click="oeffneErfassen"][data-arg="set"]').click(); true`);
    await warte(300);
    const m = await b.auswerten(`(() => { const r = e => e.getBoundingClientRect();
      const felder = ['add-num', 'add-qty', 'add-price', 'add-condition'].map(id => document.getElementById(id));
      const labels = felder.map(f => document.querySelector('label[for="' + f.id + '"]'));
      const raster = r(document.querySelector('#add-set-modal .erfassen-raster') || document.getElementById('add-num').closest('.frow'));
      const knopf = r(document.getElementById('btn-add'));
      return { zeile1: Math.abs(r(labels[0]).top - r(labels[1]).top) < 1, zeile2: Math.abs(r(labels[2]).top - r(labels[3]).top) < 1,
               buendig: felder.every((f, i) => Math.abs(r(f).left - r(labels[i]).left) < 1),
               spalten: Math.abs(r(felder[0]).left - r(felder[2]).left) < 1 && Math.abs(r(felder[1]).left - r(felder[3]).left) < 1,
               knopfRechts: Math.abs(knopf.right - raster.right) < 1 }; })()`);
    await b.auswerten(`document.querySelector('#add-set-modal [data-click="schliesseErfassen"]').click(); true`);
    assert.deepEqual(m, { zeile1: true, zeile2: true, buendig: true, spalten: true, knopfRechts: true });
  });

  await t.test('Rechner: Konto mit begrenzter Breite', async () => {
    await b.auswerten(`document.querySelector('.umenu-item[data-arg="profil"]').click(); true`);
    await warte(400);
    const breite = await b.auswerten(`Math.round(document.getElementById('profile-settings-card').getBoundingClientRect().width)`);
    assert.ok(breite > 300 && breite <= 52 * 16, `Konto-Karte ${breite} px breit`);
  });
});
