/**
 * UX-Prüfung 28 im echten Chrome: Kennzahlzeile am Telefon (M1), Startkasten im Dunkelmodus (M3), Zeitraum
 * als Segment (N4), gleicher Abstand unter den Feldmeldungen der Anmeldung (N5), Teile am Telefon als Liste
 * (N8) und der Knopf „Set hinzufügen“ bei 200 % Zoom (N9).
 *
 * Gegenproben (15.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  .bstat-hinweis:not(:empty) in mobile.css auf display:none → rot: „M1 …“ (Erklärsatz unsichtbar)
 *   B  die Dunkelregel für #start-offline entfernt → rot: „M3 …“ (Grund rgb(255, 255, 255))
 *   C  Grund, Rand und Knopfform der .zeitraum-wahl entfernt → rot: „N4 …“ („Segment ohne Grund“)
 *   D  .sform .fg > .feld-fehler{contain:none} entfernt → rot: „N5 …“ (27,5 px gegen 8 px)
 *   E  #tab-parts .filterleiste > .vtgl wieder verborgen → rot: „N8 …“ (Umschalter fehlt);
 *      die Listenkarte ohne display:grid → rot: ebenda („Listenzeile 131 px hoch“)
 *   F  die Regel für max-height 500px unwirksam (50px) → rot: „N9 …“ (Knopf über einer Karte)
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp } = require('./helpers/app-browser');
const { musterHaushalt } = require('./helpers/bestand');

async function groesse(b, breite, hoehe, telefon) {
  await b.tab('Emulation.setDeviceMetricsOverride', {
    width: breite,
    height: hoehe,
    deviceScaleFactor: 1,
    mobile: telefon,
  });
}

test('UX-Prüfung 28 im Browser', { concurrency: 1, timeout: 420_000 }, async t => {
  const app = await starteApp(t, { name: `r28_${process.pid}`, bestand: musterHaushalt });
  if (app.grund) {
    t.skip(app.grund);
    return;
  }
  const { b, bis, ruhig, port } = app;
  const zu = async hash => {
    await b.auswerten(`location.hash = ${JSON.stringify(hash)}; scrollTo(0, 0); true`);
    await ruhig();
  };

  await t.test('M1 390 px: „1 Set · 0 Teile · 0 Minifiguren“ in einer Zeile, Erklärsatz darunter', async () => {
    const stats = JSON.stringify({
      success: true,
      stats: {
        total_sets: 1,
        total_quantity: 1,
        total_parts: 0,
        set_parts: 0,
        manual_parts: 0,
        total_minifigs: 0,
        total_instructions: 0,
      },
    });
    const abfang = d => {
      if (d.method !== 'Fetch.requestPaused') return;
      b.tab('Fetch.fulfillRequest', {
        requestId: d.params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(stats).toString('base64'),
      }).catch(() => {});
    };
    await groesse(b, 390, 844, true);
    await zu('#/finanzen');
    b.hoerer.push(abfang);
    await b.tab('Fetch.enable', { patterns: [{ urlPattern: '*/api/v1/stats*', requestStage: 'Request' }] });
    try {
      await zu('#/sammlung');
      await bis(`document.getElementById('bstat-sets').textContent.trim() === '1'`, 'Kennzahlen aus der Antwort');
      await ruhig();
    } finally {
      await b.tab('Fetch.disable');
      b.hoerer.splice(b.hoerer.indexOf(abfang), 1);
    }
    const m = await b.auswerten(`(() => {
      const k = [...document.querySelectorAll('#tab-gallery .brick-stats .bstat')].filter(e => e.checkVisibility());
      const h = document.getElementById('bstat-hinweis');
      return {
        text: k.map(e => e.querySelector('.bstat-v').textContent.trim() + ' ' + e.querySelector('.bstat-l').textContent.trim()),
        punkte: k.map(e => getComputedStyle(e, '::after').content).filter(c => c.includes('·')).length,
        oben: [...new Set(k.map(e => Math.round(e.getBoundingClientRect().top)))],
        unten: Math.max(...k.map(e => e.getBoundingClientRect().bottom)),
        hinweis: h.checkVisibility() ? h.textContent.trim() : '',
        hinweisOben: h.getBoundingClientRect().top,
        sichtbareUnterzeilen: k.filter(e => e.querySelector('.bstat-s')?.checkVisibility()).length,
      };
    })()`);
    assert.deepEqual(m.text, ['1 Set', '0 Teile', '0 Minifiguren']);
    assert.equal(m.punkte, 2, 'Trenner zwischen drei Kennzahlen');
    assert.equal(m.oben.length, 1, `Kennzahlen auf mehreren Zeilen: ${m.oben}`);
    assert.equal(m.sichtbareUnterzeilen, 0);
    assert.equal(m.hinweis, 'Teileliste für das Set fehlt noch');
    assert.ok(m.hinweisOben >= m.unten, 'Erklärsatz unter der ganzen Leiste');
  });

  await t.test('N4 Zeitraum als Segment: ein Grund, der gewählte Knopf gerahmt, aria-pressed', async () => {
    await groesse(b, 390, 844, true);
    await zu('#/finanzen');
    await bis(`!!document.querySelector('.zeitraum-wahl .period-btn')?.checkVisibility()`, 'Zeitraum');
    const m = await b.auswerten(`(() => {
      const g = document.querySelector('.zeitraum-wahl');
      const k = [...g.querySelectorAll('.period-btn')];
      const s = getComputedStyle(g);
      return {
        grund: s.backgroundColor, rand: s.borderTopWidth,
        oben: [...new Set(k.map(e => Math.round(e.getBoundingClientRect().top)))].length,
        runde: k.map(e => parseFloat(getComputedStyle(e).borderTopLeftRadius)),
        gedrueckt: k.map(e => e.getAttribute('aria-pressed')),
        rahmen: k.map(e => getComputedStyle(e).borderTopColor),
        flaeche: k.map(e => getComputedStyle(e).backgroundColor),
      };
    })()`);
    assert.notEqual(m.grund, 'rgba(0, 0, 0, 0)', 'Segment ohne Grund');
    assert.equal(m.rand, '1px');
    assert.equal(m.oben, 1, 'Zeitraum bricht um');
    assert.ok(Math.max(...m.runde) <= 8, `Knöpfe wie Pillen gerundet: ${m.runde}`);
    assert.deepEqual(m.gedrueckt, ['false', 'false', 'false', 'true']);
    assert.deepEqual(m.rahmen.slice(0, 3), Array(3).fill('rgba(0, 0, 0, 0)'), 'ungewählte Knöpfe gerahmt');
    assert.notEqual(m.rahmen[3], 'rgba(0, 0, 0, 0)', 'gewählter Knopf ohne Rahmen');
    assert.deepEqual(m.flaeche.slice(0, 3), Array(3).fill('rgba(0, 0, 0, 0)'), 'ungewählte Knöpfe mit Fläche');
  });

  await t.test('N8 390 px: Teile als kompakte Liste wählbar', async () => {
    await groesse(b, 390, 844, true);
    await zu('#/teile');
    await bis(`!!document.querySelector('#parts-main .part-card')`, 'Teilekarten');
    const hoehe = () =>
      b.auswerten(`Math.round(document.querySelector('#parts-main .part-card').getBoundingClientRect().height)`);
    const karte = await hoehe();
    const knopf = `document.querySelector('#tab-parts [data-click="ansichtWaehlen"][data-arg2="table"]')`;
    assert.equal(await b.auswerten(`!!${knopf}?.checkVisibility()`), true, 'Umschalter Karten/Liste fehlt');
    await b.auswerten(`${knopf}.click(); true`);
    await ruhig();
    await bis(`!!document.querySelector('#parts-main .part-card')`, 'Teile als Liste');
    const zeile = await hoehe();
    const breit =
      await b.auswerten(`(() => { const r = document.querySelector('#parts-main .part-card').getBoundingClientRect();
      return { breite: Math.round(r.width), seite: document.documentElement.scrollWidth > innerWidth,
        gedrueckt: ${knopf}.getAttribute('aria-pressed') }; })()`);
    assert.ok(karte > 120, `Karte nur ${karte} px hoch`);
    assert.ok(zeile <= 72, `Listenzeile ${zeile} px hoch`);
    assert.ok(breit.breite > 300, `Zeile nicht über die Breite: ${breit.breite} px`);
    assert.equal(breit.seite, false, 'Seite breiter als das Fenster');
    assert.equal(breit.gedrueckt, 'true');
    await b.auswerten(
      `document.querySelector('#tab-parts [data-click="ansichtWaehlen"][data-arg2="grid"]').click(); true`,
    );
    await ruhig();
  });

  await t.test('N9 200 % Zoom (640 × 450): „Set hinzufügen“ deckt keine Karte', async () => {
    await groesse(b, 640, 450, false);
    await zu('#/sammlung');
    await bis(`document.querySelectorAll('#gallery .sc').length >= 3`, 'drei Karten');
    for (const y of [0, 200, 350, 500]) {
      await b.auswerten(`scrollTo(0, ${y}); true`);
      await ruhig(300);
      const m = await b.auswerten(`(() => {
        const k = document.querySelector('#tab-gallery .knopf-schwebend').getBoundingClientRect();
        const ueber = [...document.querySelectorAll('#gallery .sc')].map(e => e.getBoundingClientRect())
          .filter(r => r.left < k.right && r.right > k.left && r.top < k.bottom && r.bottom > k.top).length;
        return { ueber, oben: Math.round(k.top), unten: Math.round(k.bottom) };
      })()`);
      assert.equal(m.ueber, 0, `bei ${y} px gerollt liegt der Knopf über einer Karte (${m.oben}–${m.unten})`);
    }
    await b.auswerten(`scrollTo(0, 0); true`);
    assert.equal(
      await b.auswerten(`document.querySelector('#tab-gallery .knopf-schwebend').checkVisibility()`),
      true,
      'Knopf oben nicht sichtbar',
    );
  });

  // Ab hier abgemeldet.
  await t.test('N5 390 px: gleicher Abstand unter beiden Feldmeldungen der Anmeldung', async () => {
    await groesse(b, 390, 844, true);
    await b.tab('Network.clearBrowserCookies');
    // Die alte Seite hat auch einen Anmeldeknopf: erst warten, bis sie weg ist.
    await b.auswerten(`window.__alteSeite = true`);
    await b.tab('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    await bis(
      `!window.__alteSeite && document.getElementById('login-screen')?.style.display === 'flex' && typeof document.getElementById('btn-login')?.onclick === 'function'`,
      'Anmeldemaske',
    );
    await b.auswerten(`document.getElementById('lu').value = ''; document.getElementById('lp').value = '';
      document.getElementById('btn-login').click(); true`);
    await bis(`!!document.getElementById('lp-fehler')?.textContent`, 'Feldmeldungen');
    const m = await b.auswerten(`(() => {
      const r = id => document.getElementById(id).getBoundingClientRect();
      const naechstes = id => document.getElementById(id).closest('.fg').nextElementSibling;
      const folgt = e => { while (e && !e.checkVisibility()) e = e.nextElementSibling; return e?.getBoundingClientRect() ?? { top: NaN }; };
      return { lu: folgt(naechstes('lu-fehler')).top - r('lu-fehler').bottom, lp: folgt(naechstes('lp-fehler')).top - r('lp-fehler').bottom };
    })()`);
    assert.ok(Math.abs(m.lu - m.lp) <= 1, `Abstand unter den Meldungen ${m.lu} px gegen ${m.lp} px`);
  });

  for (const dunkel of [false, true])
    await t.test(`M3 Startkasten ${dunkel ? 'dunkel' : 'hell'}`, async () => {
      await b.tab('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: dunkel ? 'dark' : 'light' }],
      });
      await b.tab('Page.reload');
      await bis(`typeof document.getElementById('btn-login')?.onclick === 'function'`, 'Anmeldemaske');
      const m = await b.auswerten(`(() => { const k = document.getElementById('start-offline'); k.hidden = false;
        const s = getComputedStyle(k); const r = { grund: s.backgroundColor, schrift: s.color,
        dunkel: document.documentElement.hasAttribute('data-dunkel') }; k.hidden = true; return r; })()`);
      assert.equal(m.dunkel, dunkel, 'data-dunkel folgt dem System');
      const hell = c =>
        c
          .match(/\d+/g)
          .slice(0, 3)
          .reduce((a, x) => a + Number(x), 0) / 3;
      if (dunkel) {
        assert.ok(hell(m.grund) < 60, `Kasten im Dunkelmodus hell: ${m.grund}`);
        assert.ok(hell(m.schrift) > 180, `Schrift dunkel auf dunkel: ${m.schrift}`);
      } else assert.equal(m.grund, 'rgb(255, 255, 255)');
    });
});
