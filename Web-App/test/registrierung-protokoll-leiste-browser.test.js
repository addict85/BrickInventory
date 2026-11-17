/**
 * Masse im echten Chrome: Ein langes Thema bricht auf der Kachel um; das Protokollfenster hat Knöpfe ab
 * 24 px, 3 px Fokusring, folgt Hell/Dunkel der App und übersetzt die Stufen; im Design brick ist die untere
 * Leiste bei 200 % Zoom (640 × 450) mindestens 44 px hoch; die Registrierung läuft bei 320 px in keinem
 * der sechs Designs über.
 *
 * Gegenproben (16.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  .smeta-text wieder nowrap mit Ellipse → rot: „Thema ganz“ (scrollWidth > clientWidth)
 *   B  logviewer.css ohne min-height:24px am button → rot: „Protokollfenster“ (Knopf 22 px)
 *   C  monitor.js ohne data-dunkel im Fenster → rot: „Protokollfenster“ (dunkle App, Grund 250)
 *   D  in mobile.css am brick-.ntab min-height:44px gestrichen → rot: „untere Leiste“ (34 px)
 *   E  Namenszeile wieder data-stil="display:flex;gap:10px" statt .reg-namen → rot: „Registrierung“
 *      (classic, noppe, werkbank … 332 > 320)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp } = require('./helpers/app-browser');
const { katalogSet, haeltSet } = require('./helpers/bestand');

const DESIGNS = ['classic', 'brick', 'noppe', 'werkbank', 'hochglanz', 'farbfaecher'];
const THEMA = 'Star Wars / Ultimate Collector Series';

test('Thema, Protokollfenster, untere Leiste und Registrierung', { timeout: 300_000 }, async t => {
  const app = await starteApp(t, {
    name: `masse_${process.pid}`,
    alleDesigns: true,
    bestand: async (db, uid) => {
      await katalogSet(db, '75192-1', { name: 'Millennium Falcon', year: 2017, theme: THEMA, pieces: 7541 });
      await haeltSet(db, uid, '75192-1');
    },
  });
  if (app.grund) {
    t.skip(app.grund);
    return;
  }
  const { b, bis } = app;
  const groesse = (w, h, mobil) =>
    b.tab('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: mobil });

  await t.test('Thema ganz auf der Kachel', async () => {
    await groesse(1280, 900, false);
    await bis(`!!document.querySelector('#gallery .sc[data-arg="75192-1"] .smeta-text')`, 'Kachel');
    const m =
      await b.auswerten(`(() => { const e = document.querySelector('#gallery .sc[data-arg="75192-1"] .smeta-text');
      return { text: e.textContent, sw: e.scrollWidth, cw: e.clientWidth, sh: e.scrollHeight, ch: e.clientHeight }; })()`);
    assert.ok(m.text.includes(THEMA), JSON.stringify(m));
    assert.ok(m.sw <= m.cw + 1 && m.sh <= m.ch + 1, `abgeschnitten: ${JSON.stringify(m)}`);
  });

  await t.test('Protokollfenster', async () => {
    const im = (/** @type {string} */ a) =>
      `(() => { const document = window.document.getElementById('lv-rahmen')?.contentDocument; return !!document && (${a}); })()`;
    for (const dunkel of [false, true]) {
      await b.auswerten(`document.documentElement.toggleAttribute('data-dunkel', ${dunkel});
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
        return { hoehen: k.map(x => Math.round(x.getBoundingClientRect().height)), ring: getComputedStyle(b).outlineWidth,
          hell: grund.reduce((s, x) => s + x, 0) / 3, stufen: [...document.querySelectorAll('.lvbtn')].map(x => x.textContent.trim()) }; })()`),
      );
      assert.ok(Math.min(...m.hoehen) >= 24, `Knöpfe ${m.hoehen.join(', ')} px`);
      assert.equal(m.ring, '3px');
      assert.ok(dunkel ? m.hell < 80 : m.hell > 200, `Grund ${m.hell} bei dunkel=${dunkel}`);
      assert.deepEqual(
        m.stufen.map(s => s.replace(/^\W+\s*/, '')),
        ['Hinweise', 'Warnungen', 'Fehler'],
      );
      await b.auswerten(`document.getElementById('lv-rahmen').remove(); true`);
    }
    await b.auswerten(`document.documentElement.removeAttribute('data-dunkel'); true`);
  });

  await t.test('untere Leiste im Design brick bei 200 % Zoom', async () => {
    try {
      await b.auswerten(`document.documentElement.dataset.theme = 'brick'; true`);
      await groesse(640, 450, false);
      await bis(`getComputedStyle(document.querySelector('nav')).position === 'fixed'`, 'Leiste unten');
      const hoehen = await b.auswerten(
        `[...document.querySelectorAll('.ntab')].filter(n => n.offsetParent).map(n => Math.round(n.getBoundingClientRect().height))`,
      );
      assert.ok(hoehen.length >= 4 && Math.min(...hoehen) >= 44, `Leiste ${hoehen.join(', ')} px`);
    } finally {
      await groesse(1280, 900, false);
    }
  });

  await t.test('Registrierung bei 320 px ohne Überlauf', async () => {
    await b.auswerten(`window.__alt = true; document.getElementById('btn-logout').click(); true`);
    await bis(
      `!window.__alt && getComputedStyle(document.getElementById('login-screen')).display !== 'none'`,
      'Anmeldung',
    );
    await b.auswerten(`(() => { const v = document.getElementById('design-stile');
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
