/**
 * UX review 26 in real Chrome: the jump bar in the account (N5) at phone width and on the desktop, light and
 * dark. It sits below the title (not above the bottom bar), scrolls horizontally on the phone without widening
 * the page, and every link brings its heading into view.
 *
 * Counter-checks (measured 15.11.2026, each alone, bundle rebuilt):
 *   A  bar back as <nav> instead of <div role="navigation"> → red: all four subcases (“bar is fixed like
 *      the main navigation”; on the phone it lay over the bottom bar)
 *   B  mobile rule .account-nav{flex-wrap:nowrap;overflow-x:auto} removed → red: both 390 px cases (“bar
 *      wraps”)
 *
 * Skipped without Chrome (CHROME_BIN, google-chrome, chromium).
 * Prerequisite: test DB via TEST_DATABASE_URL.
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
  const nav = document.querySelector('#tab-profile .account-nav');
  const r = nav.getBoundingClientRect();
  const titel = document.querySelector('#tab-profile .ptitle').getBoundingClientRect();
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

test('N5 jump bar in the account', { timeout: 240_000 }, async t => {
  const app = await startApp(t, { name: `r26_${process.pid}` });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  for (const [breite, telefon] of [
    [390, true],
    [1280, false],
  ])
    for (const dunkel of [false, true]) {
      await t.test(`${breite} px ${dunkel ? 'dark' : 'light'}`, async () => {
        await groesse(app.b, breite, telefon);
        await app.b.tab('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-color-scheme', value: dunkel ? 'dark' : 'light' }],
        });
        await app.b.auswerten(`location.hash = '#/konto'; true`);
        await app.bis(`document.getElementById('tab-profile').classList.contains('active')`, 'Konto offen');
        await app.ruhig();
        const m = await app.b.auswerten(MASS);
        // Since round 27 it sticks below the header (sticky); fixed like the main navigation stays wrong.
        assert.equal(m.situation, 'sticky', 'Leiste klebt fest wie die Hauptnavigation');
        assert.ok(m.belowTitle, 'Leiste steht nicht unter dem Titel');
        assert.equal(m.zeilen, 1, 'Leiste bricht um');
        assert.ok(m.linkHeight >= 40, `Links zu klein: ${m.linkHeight} px`);
        assert.equal(m.pageWider, false, 'Seite breiter als das Fenster');
        assert.equal(m.rollt, telefon, telefon ? 'rollt am Telefon nicht' : 'rollt am Rechner');
        assert.notEqual(m.farbe, m.reason, 'Linkfarbe gleich dem Grund');
        for (const ziel of ['account-t-danger', 'account-t-profile']) {
          await app.b.auswerten(`document.querySelector('.account-nav a[data-arg="${ziel}"]').click(); true`);
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
