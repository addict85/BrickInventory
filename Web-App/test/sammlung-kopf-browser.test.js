/**
 * Ein Kopf für Sets, Teile und Minifiguren, an derselben Stelle, und vom
 * ersten sichtbaren Bild an springt darin nichts mehr (Band, Kontoauswahl,
 * Kennzahlen, Filterfelder). Im Haushalt, mit Lagerort, ohne Schlüssel und
 * mit verzögerten Antworten, damit alles Nachgeladene vorkommt.
 *
 * Gegenproben (am 13.11.2026 gemessen):
 *   A  in showApp() startgeruestWeg() wieder sofort statt nach Band und
 *      Kontofilter → rot: alle drei „Laden ohne Sprung“ (der Kopf rutscht
 *      45 px tiefer, sobald das Band kommt)
 *   B  `.bstat .bstat-s:empty::before` ohne Inhalt → rot: „Sets: Laden ohne
 *      Sprung“ (Kennzahlen 77 → 95 px hoch, sobald „4 verschiedene“ kommt)
 *   C  Pfad und Untertitel der Minifiguren entfernt → rot: „Gleicher Kopf“
 *      (Titel bei y 184 statt 205)
 *   D  `#gtheme` und `#parts-color` ohne feste Breite → rot: „Sets“ und
 *      „Teile: Laden ohne Sprung“ (das Suchfeld schrumpft, sobald die
 *      Optionen kommen)
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp } = require('./helpers/app-browser');
const { musterHaushalt } = require('./helpers/bestand');

/** Zeichnet jedes Bild die Lage der Kopfteile auf, sobald das Startgerüst weg ist. */
const AUFZEICHNEN = `(() => {
  window.__kopf = [];
  const teile = ['.brotkrume', 'h1', '.ptitle-unter', '.sammlung-wahl', '.brick-stats', '.erfassen-leiste', '.suchfeld'];
  const bild = () => {
    const tab = document.querySelector('.tab.active');
    const app = document.getElementById('app');
    if (tab && app && app.style.display === 'block' && !document.getElementById('startgeruest')) {
      const lage = teile.map(s => {
        const e = tab.querySelector(s);
        if (!e || !e.getClientRects().length) return s + ': –';
        const b = e.getBoundingClientRect();
        return s + ': ' + [b.x, b.y, b.width, b.height].map(Math.round).join('/');
      });
      const z = lage.join(' | ');
      if (window.__kopf.at(-1) !== z) window.__kopf.push(z);
    }
    requestAnimationFrame(bild);
  };
  requestAnimationFrame(bild);
})()`;

test('Kopf der Sammlung: gleich und ohne Sprung', { concurrency: 1, timeout: 300_000 }, async t => {
  const app = await starteApp(t, {
    name: `kopf_${process.pid}`,
    bestand: async (db, uid) => {
      await musterHaushalt(db, uid);
      await db.run(`INSERT INTO storage_locations (user_id, name) VALUES ($1, 'Regal')`, [uid]);
    },
    abfangen: [
      { muster: '*household-members*', enthaelt: '/household-members', verzoegerung: 600 },
      { muster: '*settings/raw*', enthaelt: '/settings/raw', verzoegerung: 300 },
      { muster: '*/v1/stats*', enthaelt: '/v1/stats', verzoegerung: 900 },
      // Liste und Teilefilter kommen erst nach dem Gerüst: Dann füllen sich die Auswahlfelder sichtbar.
      { muster: '*/v1/sets?*', enthaelt: '/v1/sets?', verzoegerung: 1200 },
      { muster: '*/v1/parts/colors*', enthaelt: '/v1/parts/colors', verzoegerung: 1200 },
    ],
  });
  if (app.grund) {
    t.skip(app.grund);
    return;
  }
  const { b, bis, ruhig } = app;
  await ruhig(15_000);
  await b.tab('Page.addScriptToEvaluateOnNewDocument', { source: AUFZEICHNEN });

  /** @type {Record<string, string>} */
  const endlage = {};
  for (const [name, hash, fertig] of [
    [
      'Sets',
      '#/sammlung',
      `!!document.querySelector('#gallery .sc') && document.getElementById('bstat-sets').textContent !== '—'`,
    ],
    ['Teile', '#/teile', `document.getElementById('ps-total').textContent !== '—'`],
    ['Minifiguren', '#/minifiguren', `document.getElementById('mf-total').textContent !== '—'`],
  ]) {
    await t.test(`${name}: Laden ohne Sprung`, async () => {
      await b.auswerten(`location.hash = ${JSON.stringify(hash)}; true`);
      await b.tab('Page.reload');
      await bis(`!!window.__kopf && ${fertig}`, `${name} geladen`, 300);
      await ruhig(4000);
      const bilder = await b.auswerten('window.__kopf');
      assert.ok(bilder.length >= 1, 'kein Bild aufgezeichnet');
      assert.deepEqual(bilder, [bilder.at(-1)], 'der Kopf veränderte sich nach dem ersten Bild');
      assert.equal(await b.auswerten(`document.getElementById('rb-hinweis').hidden`), false, 'Band fehlt');
      endlage[name] = bilder.at(-1);
    });
  }

  await t.test('Gleicher Kopf in allen drei Ansichten', () => {
    // Bis zur Erfassen-Leiste stimmt alles überein; Breiten von Pfad und Untertitel hängen am Text.
    const kopf = z =>
      z
        .split(' | ')
        .slice(0, 6)
        .map(s => s.replace(/^(\.brotkrume|\.ptitle-unter|h1): (\d+)\/(\d+)\/\d+/, '$1: $2/$3'));
    assert.deepEqual(kopf(endlage.Teile), kopf(endlage.Sets));
    assert.deepEqual(kopf(endlage.Minifiguren), kopf(endlage.Sets));
  });
});
