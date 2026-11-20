/**
 * UX-Prüfung 26 im echten Chrome: die Sprungleiste im Konto (N5) auf Telefonbreite und am Rechner, hell und
 * dunkel. Sie steht unter dem Titel (nicht über der unteren Leiste), rollt am Telefon waagrecht ohne die Seite
 * zu verbreitern, und jeder Link bringt seine Überschrift ins Bild.
 *
 * Gegenproben (15.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  Leiste wieder als <nav> statt <div role="navigation"> → rot: alle vier Teilfälle („Leiste klebt fest wie
 *      die Hauptnavigation“; am Telefon lag sie über der unteren Leiste)
 *   B  mobile Regel .konto-nav{flex-wrap:nowrap;overflow-x:auto} entfernt → rot: beide 390-px-Fälle („Leiste
 *      bricht um“)
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');

async function groesse(b, breite, telefon) {
  await b.tab('Emulation.setDeviceMetricsOverride', {
    width: breite,
    height: telefon ? 844 : 900,
    deviceScaleFactor: 1,
    mobile: telefon,
  });
}

const MASS = `(() => {
  const nav = document.querySelector('#tab-profil .konto-nav');
  const r = nav.getBoundingClientRect();
  const titel = document.querySelector('#tab-profil .ptitle').getBoundingClientRect();
  const links = [...nav.querySelectorAll('a')].map(a => a.getBoundingClientRect());
  return {
    situation: getComputedStyle(nav).position,
    belowTitle: r.top >= titel.bottom - 1,
    hoehe: Math.round(r.height),
    linkHeight: Math.round(Math.max(...links.map(l => l.height))),
    zeilen: new Set(links.map(l => Math.round(l.top))).size,
    rollt: nav.scrollWidth > nav.clientWidth + 1,
    pageWider: document.documentElement.scrollWidth > innerWidth,
    farbe: getComputedStyle(nav.querySelector('a')).color,
    grund: getComputedStyle(document.body).backgroundColor,
  };
})()`;

test('N5 Sprungleiste im Konto', { timeout: 240_000 }, async t => {
  const app = await startApp(t, { name: `r26_${process.pid}` });
  if (app.grund) {
    t.skip(app.grund);
    return;
  }
  for (const [breite, telefon] of [
    [390, true],
    [1280, false],
  ])
    for (const dunkel of [false, true]) {
      await t.test(`${breite} px ${dunkel ? 'dunkel' : 'hell'}`, async () => {
        await groesse(app.b, breite, telefon);
        await app.b.tab('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-color-scheme', value: dunkel ? 'dark' : 'light' }],
        });
        await app.b.auswerten(`location.hash = '#/konto'; true`);
        await app.bis(`document.getElementById('tab-profil').classList.contains('active')`, 'Konto offen');
        await app.ruhig();
        const m = await app.b.auswerten(MASS);
        // Seit Runde 27 klebt sie unter dem Kopf (sticky); fest wie die Hauptnavigation (fixed) bleibt falsch.
        assert.equal(m.situation, 'sticky', 'Leiste klebt fest wie die Hauptnavigation');
        assert.ok(m.belowTitle, 'Leiste steht nicht unter dem Titel');
        assert.equal(m.zeilen, 1, 'Leiste bricht um');
        assert.ok(m.linkHeight >= 40, `Links zu klein: ${m.linkHeight} px`);
        assert.equal(m.pageWider, false, 'Seite breiter als das Fenster');
        assert.equal(m.rollt, telefon, telefon ? 'rollt am Telefon nicht' : 'rollt am Rechner');
        assert.notEqual(m.farbe, m.grund, 'Linkfarbe gleich dem Grund');
        for (const ziel of ['konto-t-gefahr', 'konto-t-profil']) {
          await app.b.auswerten(`document.querySelector('.konto-nav a[data-arg="${ziel}"]').click(); true`);
          await app.ruhig(500);
          const situation =
            await app.b.auswerten(`(() => { const r = document.getElementById('${ziel}').getBoundingClientRect();
            return { oben: r.top, unten: r.bottom, h: innerHeight, fokus: document.activeElement.id, hash: location.hash }; })()`);
          assert.equal(situation.fokus, ziel, `${ziel}: Fokus`);
          assert.ok(
            situation.oben >= 0 && situation.unten <= situation.h,
            `${ziel}: nicht im Bild (${situation.oben}–${situation.unten})`,
          );
          assert.equal(situation.hash, '#/konto', `${ziel}: Adresse verändert`);
        }
        await app.b.auswerten(`scrollTo(0, 0); true`);
      });
    }
});
