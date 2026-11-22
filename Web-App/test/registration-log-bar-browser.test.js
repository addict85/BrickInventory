/**
 * Dimensions in real Chrome: a long theme wraps on the tile; the log window has buttons from
 * 24 px, a 3 px focus ring, follows light/dark of the app and translates the levels; in the theme brick the bottom
 * bar is at least 44 px high at 200 % zoom (640 × 450); the registration does not overflow at 320 px in any
 * of the six themes.
 *
 * Counter-checks (measured 16.11.2026, each on its own, bundle rebuilt):
 *   A  .smeta-text again nowrap with ellipsis → red: „Thema ganz“ (scrollWidth > clientWidth)
 *   B  logviewer.css without min-height:24px on the button → red: „Protokollfenster“ (button 22 px)
 *   C  monitor.js without data-dark in the window → red: „Protokollfenster“ (dark app, background 250)
 *   D  min-height:44px deleted on the brick .ntab in mobile.css → red: „untere Leiste“ (34 px)
 *   E  name row again data-style="display:flex;gap:10px" instead of .reg-names → red: „Registrierung“
 *      (classic, noppe, werkbank … 332 > 320)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');
const { catalogSet, holdsSet } = require('./helpers/inventory');

const DESIGNS = ['classic', 'brick', 'noppe', 'werkbank', 'hochglanz', 'farbfaecher'];
const THEMA = 'Star Wars / Ultimate Collector Series';

test('theme, log window, bottom bar and registration', { timeout: 300_000 }, async t => {
  const app = await startApp(t, {
    name: `masse_${process.pid}`,
    allDesigns: true,
    holding: async (db, uid) => {
      await catalogSet(db, '75192-1', { name: 'Millennium Falcon', year: 2017, theme: THEMA, pieces: 7541 });
      await holdsSet(db, uid, '75192-1');
    },
  });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, bis } = app;
  const groesse = (w, h, mobil) =>
    b.tab('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: mobil });

  await t.test('theme fully on the tile', async () => {
    await groesse(1280, 900, false);
    await bis(`!!document.querySelector('#gallery .sc[data-arg="75192-1"] .smeta-text')`, 'Kachel');
    const m =
      await b.auswerten(`(() => { const e = document.querySelector('#gallery .sc[data-arg="75192-1"] .smeta-text');
      return { text: e.textContent, sw: e.scrollWidth, cw: e.clientWidth, sh: e.scrollHeight, ch: e.clientHeight }; })()`);
    assert.ok(m.text.includes(THEMA), JSON.stringify(m));
    assert.ok(m.sw <= m.cw + 1 && m.sh <= m.ch + 1, `abgeschnitten: ${JSON.stringify(m)}`);
  });

  await t.test('log window', async () => {
    const im = (/** @type {string} */ a) =>
      `(() => { const document = window.document.getElementById('lv-rahmen')?.contentDocument; return !!document && (${a}); })()`;
    for (const dunkel of [false, true]) {
      await b.auswerten(`document.documentElement.toggleAttribute('data-dark', ${dunkel});
        document.querySelector('.ntab[data-tab="monitor"]').click(); true`);
      await bis(`!!document.querySelector('[data-click="openLogViewer"]')`, 'Hintergrundarbeiten');
      await b.auswerten(`window.open = () => { const f = document.createElement('iframe'); f.id = 'lv-rahmen';
        f.title = 'Protokoll'; f.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:2147483647';
        document.body.append(f); return f.contentWindow; };
        document.querySelector('[data-click="openLogViewer"]').click(); true`);
      await bis(im(`/^\\d+ \\/ \\d+/.test(document.getElementById('status')?.textContent || '')`), 'Protokoll geladen');
      const m = await b.auswerten(
        im(`(() => { const k = [...document.querySelectorAll('button, select, input')];
        const b = document.getElementById('btn-info'); b.focus();
        const grund = getComputedStyle(document.body).backgroundColor.match(/\\d+/g).slice(0, 3).map(Number);
        return { heights: k.map(x => Math.round(x.getBoundingClientRect().height)), ring: getComputedStyle(b).outlineWidth,
          hell: grund.reduce((s, x) => s + x, 0) / 3, stufen: [...document.querySelectorAll('.lvbtn')].map(x => x.textContent.trim()) }; })()`),
      );
      assert.ok(Math.min(...m.heights) >= 24, `Knöpfe ${m.heights.join(', ')} px`);
      assert.equal(m.ring, '3px');
      assert.ok(dunkel ? m.hell < 80 : m.hell > 200, `Grund ${m.hell} bei dunkel=${dunkel}`);
      assert.deepEqual(
        m.stufen.map(s => s.replace(/^\W+\s*/, '')),
        ['Hinweise', 'Warnungen', 'Fehler'],
      );
      await b.auswerten(`document.getElementById('lv-rahmen').remove(); true`);
    }
    await b.auswerten(`document.documentElement.removeAttribute('data-dark'); true`);
  });

  await t.test('bottom bar in the brick design at 200 % zoom', async () => {
    try {
      await b.auswerten(`document.documentElement.dataset.theme = 'brick'; true`);
      await groesse(640, 450, false);
      await bis(`getComputedStyle(document.querySelector('nav')).position === 'fixed'`, 'Leiste unten');
      const heights = await b.auswerten(
        `[...document.querySelectorAll('.ntab')].filter(n => n.offsetParent).map(n => Math.round(n.getBoundingClientRect().height))`,
      );
      assert.ok(heights.length >= 4 && Math.min(...heights) >= 44, `Leiste ${heights.join(', ')} px`);
    } finally {
      await groesse(1280, 900, false);
    }
  });

  await t.test('registration at 320 px without overflow', async () => {
    await b.auswerten(`window.__alt = true; document.getElementById('btn-logout').click(); true`);
    await bis(
      `!window.__alt && getComputedStyle(document.getElementById('login-screen')).display !== 'none'`,
      'Anmeldung',
    );
    await b.auswerten(`(() => { const v = document.getElementById('theme-styles');
      return !v || Promise.all([...v.content.querySelectorAll('link')].map(l => new Promise(r => {
        l.onload = l.onerror = r; v.before(document.adoptNode(l)); }))).then(() => true); })()`);
    await groesse(320, 700, true);
    const ueber = [];
    for (const d of DESIGNS) {
      const m = await b.auswerten(`(async () => { document.documentElement.dataset.theme = ${JSON.stringify(d)};
        document.getElementById('link-register').click();
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const de = document.documentElement;
        return { sw: de.scrollWidth, cw: de.clientWidth, sichtbar: getComputedStyle(document.getElementById('panel-register')).display };
        })()`);
      assert.equal(m.sichtbar, 'block', d);
      if (m.sw > m.cw) ueber.push(`${d}: ${m.sw} > ${m.cw}`);
    }
    assert.deepEqual(ueber, []);
  });
});
