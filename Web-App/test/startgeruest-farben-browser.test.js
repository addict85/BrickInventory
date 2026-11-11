/**
 * Das Startgerüst malt in den Farben, die die Seite danach hat: Es folgt dem Attribut data-dunkel
 * (gesetzt von theme-boot.js nach der Geräte-Einstellung „bim_dunkel“), nicht dem System allein.
 * Dasselbe gilt für <meta name="theme-color"> (Browserleiste). Gemessen in Chrome mit dem Design
 * „Stein (Blau)“; alle Skripte und Stile außer dem Boot-Skript werden festgehalten, damit nur das Gerüst malt.
 *
 * Gegenproben (am 08.11.2026 gemessen):
 *   A  im Startstil wieder `@media (prefers-color-scheme:dark)` statt [data-dunkel]
 *      → rot: „System hell, immer dunkel: Gerüst dunkel“ und „System dunkel, nie dunkel: Gerüst hell“
 *   B  die Regel `[data-theme=brick][data-dunkel] .sg-kopf` entfernt
 *      → rot: „Stein dunkel: Kopf im dunklen Blau“
 *   C  die Regel `[data-theme=brick] .sg-kopf` entfernt → rot: „Stein hell: Kopf im Stein-Blau“
 *   D  in theme-boot.js die Zeilen zu `theme-color` entfernt
 *      → rot: alle vier Fälle (Farbe der Browserleiste)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL, Chrome.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp } = require('./helpers/app-browser');

const FAELLE = [
  { name: 'System hell, immer dunkel: Gerüst dunkel', system: 'light', wahl: 'immer', dunkel: true },
  { name: 'System dunkel, nie dunkel: Gerüst hell', system: 'dark', wahl: 'server', dunkel: false },
  { name: 'System dunkel, Vorgabe: Gerüst dunkel', system: 'dark', wahl: null, dunkel: true },
  { name: 'System hell, Vorgabe: Gerüst hell', system: 'light', wahl: null, dunkel: false },
];
const KOPF = { hell: 'rgb(61, 90, 128)', dunkel: 'rgb(39, 56, 73)' };

test('Startgerüst folgt der Geräte-Einstellung und dem Design', async t => {
  const app = await starteApp(t, {
    bestand: db =>
      db.run(`INSERT INTO global_settings (key, value) VALUES ('app_theme', 'brick')
                             ON CONFLICT (key) DO UPDATE SET value = 'brick'`),
  });
  if (app.grund) return t.skip(app.grund);
  const { b } = app;
  // Nur das Boot-Skript und das Dokument laufen; alles andere bleibt hängen, das Gerüst bleibt stehen.
  await b.tab('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  b.hoerer.push(d => {
    if (d.method !== 'Fetch.requestPaused') return;
    const u = d.params.request.url;
    if (d.params.resourceType === 'Document' || u.includes('theme-boot.js'))
      b.tab('Fetch.continueRequest', { requestId: d.params.requestId }).catch(() => {});
  });
  const messen = `(() => { const sg = document.getElementById('startgeruest'); if (!sg) return null;
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const f = getComputedStyle(sg).backgroundColor.match(/\\d+/g).map(Number);
    return { hell: 0.2126 * lin(f[0]) + 0.7152 * lin(f[1]) + 0.0722 * lin(f[2]),
      kopf: getComputedStyle(sg.querySelector('.sg-kopf')).backgroundColor,
      dunkel: document.documentElement.hasAttribute('data-dunkel'),
      leiste: [...document.querySelectorAll('meta[name=theme-color]')].map(m => m.content) }; })()`;

  for (const fall of FAELLE) {
    await t.test(fall.name, async () => {
      await b.tab('Emulation.setEmulatedMedia', {
        features: [
          { name: 'prefers-color-scheme', value: fall.system },
          { name: 'prefers-reduced-motion', value: 'reduce' },
        ],
      });
      await b.auswerten(
        fall.wahl ? `localStorage.setItem('bim_dunkel', '${fall.wahl}')` : `localStorage.removeItem('bim_dunkel')`,
      );
      await b.tab('Page.navigate', { url: `http://127.0.0.1:${app.port}/` });
      await app.bis(
        `!!document.getElementById('startgeruest') && document.documentElement.dataset.theme === 'brick'`,
        'Gerüst steht',
      );
      const m = await b.auswerten(messen);
      assert.equal(m.dunkel, fall.dunkel, 'data-dunkel am <html>');
      assert.ok(
        fall.dunkel ? m.hell < 0.05 : m.hell > 0.3,
        `Grund ${fall.dunkel ? 'dunkel' : 'hell'}, Helligkeit ${m.hell.toFixed(3)}`,
      );
      assert.deepEqual(
        m.leiste,
        fall.dunkel ? ['#14181d', '#14181d'] : ['#f8fafc', '#f8fafc'],
        'Farbe der Browserleiste (theme-color)',
      );
      assert.equal(
        m.kopf,
        fall.dunkel ? KOPF.dunkel : KOPF.hell,
        fall.dunkel ? 'Stein dunkel: Kopf im dunklen Blau' : 'Stein hell: Kopf im Stein-Blau',
      );
    });
  }
});
