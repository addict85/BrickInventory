/**
 * Der eigene Scrollbalken (js/15-scrollbar.js) für Maus-Nutzer und im Kontrastmodus, gemessen in Chrome.
 * Er bleibt, weil Marco einen eigenen Balken verlangt hat und er die Seite rollt (kein Scrollkasten); die
 * Prüfung hält fest, dass er dabei sichtbar und bedienbar ist.
 *
 * Gegenproben (08.11.2026 gemessen, je einzeln):
 *   A  den Griff in styles.css wieder `background:var(--s400)` → rot: „Griff hebt sich in jedem
 *      Design ab (3:1)“ (classic hell 2,45:1, brick hell 1,72:1)
 *   B  die forced-colors-Regeln in styles.css entfernt (Verstecken der Browser-Leiste wieder
 *      unbedingt) → rot: „Kontrastmodus: die Leiste des Browsers bleibt“ (Eigenbau sichtbar,
 *      Browser-Leiste 0 px)
 *   C  in 15-scrollbar.js das `mousedown`-Hören entfernt → rot: „Ziehen am Griff rollt die Seite“
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp } = require('./helpers/app-browser');
const { haeltSet } = require('./helpers/bestand');

const DESIGNS = ['classic', 'brick', 'werkbank', 'farbfaecher', 'noppe', 'hochglanz'];

test('Scrollbalken: sichtbar und bedienbar', { concurrency: 1, timeout: 300_000 }, async t => {
  const app = await starteApp(t, {
    name: `scrollbalken_${process.pid}`,
    // Genug Kacheln, dass die Seite höher ist als das Fenster.
    bestand: async (db, uid) => {
      for (let i = 0; i < 40; i++) await haeltSet(db, uid, `${10000 + i}-1`, 1, { preis: 10 });
    },
  });
  if (app.grund) {
    t.skip(app.grund);
    return;
  }
  const { b, bis, ruhig } = app;
  await b.tab('Emulation.setDeviceMetricsOverride', { width: 1280, height: 600, deviceScaleFactor: 1, mobile: false });
  await b.auswerten(
    `(() => { const s = document.createElement('style'); s.textContent = '*{transition:none!important}'; document.head.append(s); return true; })()`,
  );
  await ruhig();
  await bis(
    `document.documentElement.scrollHeight > innerHeight + 500 && getComputedStyle(document.getElementById('app-scrollbar')).display !== 'none'`,
    'Balken sichtbar',
  );

  await t.test('Griff hebt sich in jedem Design ab (3:1)', async () => {
    const werte = [];
    for (const design of DESIGNS)
      for (const dunkel of design === 'werkbank' ? [true] : [false, true]) {
        await b.auswerten(
          `document.documentElement.setAttribute('data-theme', '${design}'); document.documentElement.${dunkel ? `setAttribute('data-dunkel', '')` : `removeAttribute('data-dunkel')`}; true`,
        );
        const k = await b.auswerten(`(() => { const f = s => (s.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
        const l = ([r, g, b]) => { const c = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
          return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b); };
        const [x, y] = [l(f(getComputedStyle(document.getElementById('app-scrollbar-thumb')).backgroundColor)),
                        l(f(getComputedStyle(document.body).backgroundColor))].sort((p, q) => q - p);
        return Math.round((x + 0.05) / (y + 0.05) * 100) / 100; })()`);
        werte.push({ design: `${design} ${dunkel ? 'dunkel' : 'hell'}`, kontrast: k });
      }
    await b.auswerten(
      `document.documentElement.setAttribute('data-theme', 'classic'); document.documentElement.removeAttribute('data-dunkel'); true`,
    );
    assert.equal(werte.length, 11);
    assert.deepEqual(
      werte.filter(w => w.kontrast < 3),
      [],
      'Griff zu blass gegen den Seitengrund',
    );
  });

  await t.test('Ziehen am Griff rollt die Seite', async () => {
    await b.auswerten(`scrollTo(0, 0); true`);
    const g =
      await b.auswerten(`(() => { const r = document.getElementById('app-scrollbar-thumb').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const maus = (type, y) =>
      b.tab('Input.dispatchMouseEvent', {
        type,
        x: g.x,
        y,
        button: 'left',
        buttons: type === 'mouseReleased' ? 0 : 1,
        clickCount: 1,
      });
    await maus('mouseMoved', g.y);
    await maus('mousePressed', g.y);
    await maus('mouseMoved', g.y + 150);
    const waehrend = await b.auswerten(
      `({ y: scrollY, zieht: document.getElementById('app-scrollbar').classList.contains('dragging') })`,
    );
    await maus('mouseReleased', g.y + 150);
    const danach = await b.auswerten(`({ zieht: document.getElementById('app-scrollbar').classList.contains('dragging'),
      etikett: getComputedStyle(document.getElementById('app-scrollbar-label')).display })`);
    assert.ok(waehrend.y > 300, `Seite nur um ${waehrend.y} px gerollt`);
    assert.equal(waehrend.zieht, true);
    assert.equal(danach.zieht, false, 'der Balken bleibt im Ziehzustand');
    assert.equal(danach.etikett, 'none', 'das Etikett bleibt nach dem Loslassen stehen');
  });

  await t.test('Kontrastmodus: die Leiste des Browsers bleibt', async () => {
    const stand = () =>
      b.auswerten(`({ eigen: getComputedStyle(document.getElementById('app-scrollbar')).display,
      browserLeiste: innerWidth - document.documentElement.clientWidth })`);
    const normal = await stand();
    assert.equal(normal.eigen, 'block', 'Vorbedingung: der Eigenbau steht');
    assert.equal(normal.browserLeiste, 0, 'Vorbedingung: die Leiste des Browsers ist versteckt');
    await b.tab('Emulation.setEmulatedMedia', {
      features: [
        { name: 'forced-colors', value: 'active' },
        { name: 'prefers-reduced-motion', value: 'reduce' },
      ],
    });
    await bis(
      `getComputedStyle(document.getElementById('app-scrollbar')).display === 'none'`,
      'Eigenbau im Kontrastmodus weg',
    );
    const kontrast = await stand();
    await b.tab('Emulation.setEmulatedMedia', {
      features: [
        { name: 'forced-colors', value: 'none' },
        { name: 'prefers-reduced-motion', value: 'reduce' },
      ],
    });
    assert.equal(kontrast.eigen, 'none', 'der Eigenbau bleibt sichtbar, obwohl das System die Farben setzt');
    assert.ok(kontrast.browserLeiste > 0, `die Leiste des Browsers fehlt (${kontrast.browserLeiste} px)`);
  });
});
