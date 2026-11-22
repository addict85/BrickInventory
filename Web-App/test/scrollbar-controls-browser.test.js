/**
 * The own scrollbar (js/scrollbar.js) for mouse users and in contrast mode, measured in Chrome.
 * It stays because Marco asked for an own bar and it scrolls the page (no scroll box); the
 * check records that it is visible and usable while doing so.
 *
 * Counter-checks (measured 08.11.2026, each on its own):
 *   A  the thumb in styles.css again `background:var(--s400)` → red: “thumb stands out in every
 *      design (3:1)” (classic light 2.45:1, brick light 1.72:1)
 *   B  the forced-colors rules removed in styles.css (hiding the browser bar unconditional
 *      again) → red: “contrast mode: the browser's bar stays” (own build visible,
 *      browser bar 0 px)
 *   C  the `mousedown` listening removed in rollbalken.js → red: “dragging the thumb scrolls the page”
 *
 * Without Chrome (CHROME_BIN, google-chrome, chromium) it is skipped.
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');
const { holdsSet } = require('./helpers/inventory');

const DESIGNS = ['classic', 'brick', 'werkbank', 'farbfaecher', 'noppe', 'hochglanz'];

test('scrollbars: visible and usable', { concurrency: 1, timeout: 300_000 }, async t => {
  const app = await startApp(t, {
    name: `scrollbalken_${process.pid}`,
    allDesigns: true,
    // Enough tiles that the page is taller than the window.
    holding: async (db, uid) => {
      for (let i = 0; i < 40; i++) await holdsSet(db, uid, `${10000 + i}-1`, 1, { preis: 10 });
    },
  });
  if (app.reason) {
    t.skip(app.reason);
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

  await t.test('thumb stands out in every design (3:1)', async () => {
    const values = [];
    for (const design of DESIGNS)
      for (const dunkel of design === 'werkbank' ? [true] : [false, true]) {
        await b.auswerten(
          `document.documentElement.setAttribute('data-theme', '${design}'); document.documentElement.${dunkel ? `setAttribute('data-dark', '')` : `removeAttribute('data-dark')`}; true`,
        );
        const k = await b.auswerten(`(() => { const f = s => (s.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
        const l = ([r, g, b]) => { const c = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
          return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b); };
        const [x, y] = [l(f(getComputedStyle(document.getElementById('app-scrollbar-thumb')).backgroundColor)),
                        l(f(getComputedStyle(document.body).backgroundColor))].sort((p, q) => q - p);
        return Math.round((x + 0.05) / (y + 0.05) * 100) / 100; })()`);
        values.push({ design: `${design} ${dunkel ? 'dark' : 'hell'}`, kontrast: k });
      }
    await b.auswerten(
      `document.documentElement.setAttribute('data-theme', 'classic'); document.documentElement.removeAttribute('data-dark'); true`,
    );
    assert.equal(values.length, 11);
    assert.deepEqual(
      values.filter(w => w.kontrast < 3),
      [],
      'Griff zu blass gegen den Seitengrund',
    );
  });

  await t.test('dragging the thumb scrolls the page', async () => {
    await b.auswerten(`scrollTo(0, 0); true`);
    const g =
      await b.auswerten(`(() => { const r = document.getElementById('app-scrollbar-thumb').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const mouse = (type, y) =>
      b.tab('Input.dispatchMouseEvent', {
        type,
        x: g.x,
        y,
        button: 'left',
        buttons: type === 'mouseReleased' ? 0 : 1,
        clickCount: 1,
      });
    await mouse('mouseMoved', g.y);
    await mouse('mousePressed', g.y);
    await mouse('mouseMoved', g.y + 150);
    const during = await b.auswerten(
      `({ y: scrollY, zieht: document.getElementById('app-scrollbar').classList.contains('dragging') })`,
    );
    await mouse('mouseReleased', g.y + 150);
    const danach = await b.auswerten(`({ zieht: document.getElementById('app-scrollbar').classList.contains('dragging'),
      etikett: getComputedStyle(document.getElementById('app-scrollbar-label')).display })`);
    assert.ok(during.y > 300, `Seite nur um ${during.y} px gerollt`);
    assert.equal(during.zieht, true);
    assert.equal(danach.zieht, false, 'der Balken bleibt im Ziehzustand');
    assert.equal(danach.etikett, 'none', 'das Etikett bleibt nach dem Loslassen stehen');
  });

  await t.test("contrast mode: the browser's bar stays", async () => {
    const state = () =>
      b.auswerten(`({ eigen: getComputedStyle(document.getElementById('app-scrollbar')).display,
      browserBar: innerWidth - document.documentElement.clientWidth })`);
    const normal = await state();
    assert.equal(normal.eigen, 'block', 'Vorbedingung: der Eigenbau steht');
    assert.equal(normal.browserBar, 0, 'Vorbedingung: die Leiste des Browsers ist versteckt');
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
    const kontrast = await state();
    await b.tab('Emulation.setEmulatedMedia', {
      features: [
        { name: 'forced-colors', value: 'none' },
        { name: 'prefers-reduced-motion', value: 'reduce' },
      ],
    });
    assert.equal(kontrast.eigen, 'none', 'der Eigenbau bleibt sichtbar, obwohl das System die Farben setzt');
    assert.ok(kontrast.browserBar > 0, `die Leiste des Browsers fehlt (${kontrast.browserBar} px)`);
  });
});
