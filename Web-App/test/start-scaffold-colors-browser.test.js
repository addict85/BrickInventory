/**
 * The start skeleton paints in the colors the page has afterwards: it follows the attribute data-dark
 * (set by theme-boot.js according to the device setting „bim_dark“), not the system alone.
 * The same applies to <meta name="theme-color"> (browser bar). Measured in Chrome with the theme
 * „Stein (Blau)“; all scripts and styles except the boot script are held back so that only the skeleton paints.
 *
 * Counter-checks (measured on 08.11.2026):
 *   A  in the start style again `@media (prefers-color-scheme:dark)` instead of [data-dark]
 *      → red: „System hell, immer dunkel: Gerüst dunkel“ and „System dunkel, nie dunkel: Gerüst hell“
 *   B  the rule `[data-theme=brick][data-dark] .sg-header` removed
 *      → red: „Stein dunkel: Kopf im dunklen Blau“
 *   C  the rule `[data-theme=brick] .sg-header` removed → red: „Stein hell: Kopf im Stein-Blau“
 *   D  the lines on `theme-color` removed in theme-boot.js
 *      → red: all four cases (color of the browser bar)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL, Chrome.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');

const CASES = [
  { name: 'System hell, immer dunkel: Gerüst dunkel', system: 'light', choice: 'always', dark: true },
  { name: 'System dunkel, nie dunkel: Gerüst hell', system: 'dark', choice: 'server', dark: false },
  { name: 'System dunkel, Vorgabe: Gerüst dunkel', system: 'dark', choice: null, dark: true },
  { name: 'System hell, Vorgabe: Gerüst hell', system: 'light', choice: null, dark: false },
];
const HEADER = { hell: 'rgb(61, 90, 128)', dark: 'rgb(39, 56, 73)' };

test('startup skeleton follows the device setting and the design', async t => {
  const app = await startApp(t, {
    holding: db =>
      db.run(`INSERT INTO global_settings (key, value) VALUES ('app_theme', 'brick')
                             ON CONFLICT (key) DO UPDATE SET value = 'brick'`),
  });
  if (app.reason) return t.skip(app.reason);
  const { b } = app;
  // Only the boot script and the document run; everything else stays hanging, the skeleton stays standing.
  await b.tab('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  b.listener.push(d => {
    if (d.method !== 'Fetch.requestPaused') return;
    const u = d.params.request.url;
    if (d.params.resourceType === 'Document' || u.includes('theme-boot.js'))
      b.tab('Fetch.continueRequest', { requestId: d.params.requestId }).catch(() => {});
  });
  const messen = `(() => { const sg = document.getElementById('start-skeleton'); if (!sg) return null;
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const f = getComputedStyle(sg).backgroundColor.match(/\\d+/g).map(Number);
    return { hell: 0.2126 * lin(f[0]) + 0.7152 * lin(f[1]) + 0.0722 * lin(f[2]),
      head: getComputedStyle(sg.querySelector('.sg-header')).backgroundColor,
      dark: document.documentElement.hasAttribute('data-dark'),
      bar: [...document.querySelectorAll('meta[name=theme-color]')].map(m => m.content) }; })()`;

  for (const fall of CASES) {
    await t.test(fall.name, async () => {
      await b.tab('Emulation.setEmulatedMedia', {
        features: [
          { name: 'prefers-color-scheme', value: fall.system },
          { name: 'prefers-reduced-motion', value: 'reduce' },
        ],
      });
      await b.evaluate(
        fall.choice ? `localStorage.setItem('bim_dark', '${fall.choice}')` : `localStorage.removeItem('bim_dark')`,
      );
      await b.tab('Page.navigate', { url: `http://127.0.0.1:${app.port}/` });
      await app.until(
        `!!document.getElementById('start-skeleton') && document.documentElement.dataset.theme === 'brick'`,
        'Gerüst steht',
      );
      const m = await b.evaluate(messen);
      assert.equal(m.dark, fall.dark, 'data-dark am <html>');
      assert.ok(
        fall.dark ? m.hell < 0.05 : m.hell > 0.3,
        `background ${fall.dark ? 'dark' : 'light'}, lightness ${m.hell.toFixed(3)}`,
      );
      assert.deepEqual(
        m.bar,
        fall.dark ? ['#14181d', '#14181d'] : ['#f8fafc', '#f8fafc'],
        'colour of the browser bar (theme-color)',
      );
      assert.equal(
        m.head,
        fall.dark ? HEADER.dark : HEADER.hell,
        fall.dark ? 'Stein dunkel: Kopf im dunklen Blau' : 'Stein hell: Kopf im Stein-Blau',
      );
    });
  }
});
