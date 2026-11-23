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

async function size(b, width, phone) {
  await b.tab('Emulation.setDeviceMetricsOverride', {
    width: width,
    height: phone ? 844 : 900,
    deviceScaleFactor: 1,
    mobile: phone,
  });
}

const MASS = `(() => {
  const nav = document.querySelector('#tab-profile .account-nav');
  const r = nav.getBoundingClientRect();
  const title = document.querySelector('#tab-profile .ptitle').getBoundingClientRect();
  const links = [...nav.querySelectorAll('a')].map(a => a.getBoundingClientRect());
  return {
    situation: getComputedStyle(nav).position,
    belowTitle: r.top >= title.bottom - 1,
    height: Math.round(r.height),
    linkHeight: Math.round(Math.max(...links.map(l => l.height))),
    lines: new Set(links.map(l => Math.round(l.top))).size,
    rollt: nav.scrollWidth > nav.clientWidth + 1,
    pageWider: document.documentElement.scrollWidth > innerWidth,
    farbe: getComputedStyle(nav.querySelector('a')).color,
    reason: getComputedStyle(document.body).backgroundColor,
  };
})()`;

test('N5 jump bar in the account', { timeout: 240_000 }, async t => {
  const app = await startApp(t, { name: `r26_${process.pid}` });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  for (const [width, phone] of [
    [390, true],
    [1280, false],
  ])
    for (const dark of [false, true]) {
      await t.test(`${width} px ${dark ? 'dark' : 'light'}`, async () => {
        await size(app.b, width, phone);
        await app.b.tab('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }],
        });
        await app.b.evaluate(`location.hash = '#/konto'; true`);
        await app.until(`document.getElementById('tab-profile').classList.contains('active')`, 'Account open');
        await app.settle();
        const m = await app.b.evaluate(MASS);
        // Since round 27 it sticks below the header (sticky); fixed like the main navigation stays wrong.
        assert.equal(m.situation, 'sticky', 'Bar sticks like the main navigation');
        assert.ok(m.belowTitle, 'Bar is not below the title');
        assert.equal(m.lines, 1, 'Bar wraps');
        assert.ok(m.linkHeight >= 40, `Links too small: ${m.linkHeight} px`);
        assert.equal(m.pageWider, false, 'Page wider than the window');
        assert.equal(m.rollt, phone, phone ? 'rollt am Telefon nicht' : 'rollt am Rechner');
        assert.notEqual(m.farbe, m.reason, 'Link color equals the background');
        for (const target of ['account-t-danger', 'account-t-profile']) {
          await app.b.evaluate(`document.querySelector('.account-nav a[data-arg="${target}"]').click(); true`);
          await app.settle(500);
          const situation =
            await app.b.evaluate(`(() => { const r = document.getElementById('${target}').getBoundingClientRect();
            return { upper: r.top, lower: r.bottom, h: innerHeight, focused: document.activeElement.id, hash: location.hash }; })()`);
          assert.equal(situation.focused, target, `${target}: focus`);
          assert.ok(
            situation.upper >= 0 && situation.lower <= situation.h,
            `${target}: not in view (${situation.upper}–${situation.lower})`,
          );
          assert.equal(situation.hash, '#/konto', `${target}: address changed`);
        }
        await app.b.evaluate(`scrollTo(0, 0); true`);
      });
    }
});
