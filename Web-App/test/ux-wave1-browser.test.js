/**
 * UX review, findings 36–42, in real Chrome on the real server (@einzeln: Chrome):
 *   36 instructions in the set detail: tap targets, contrast, kinds as text, new-tab hint
 *   37 the themes noppe, hochglanz, werkbank style the dialogs (.modal)
 *   38 finance placeholder without the non-existent button, translated
 *   39 one delete rule: restorable at once with undo, irreversible with a question
 *   40 tab labels never below 12 px
 *   41 offline locks autosave fields, background of an open dialog inert, separate live regions,
 *      the same page head everywhere
 *   42 no browser alert()
 *
 * Counter-checks (22.11.2026, each alone, bundle rebuilt):
 *   A  .ii-remove back to min 14 px and color var(--s400) → red: “instructions” (tap target, contrast)
 *   B  badge without its text span → red: “instructions” (kind only as colour)
 *   C  noppe.css back to .modal-content → red: “themes style the dialogs” (noppe border)
 *   D  index.html placeholder back to „Klicke auf «Preise laden»“ → red: “finance placeholder”
 *   E  deleteManualPart again with confirmDelete before → red: “delete rule” (question before
 *      a restorable delete)
 *   F  .tab-label back to calc(var(--fs-0) * .8) → red: “tab labels” (10.8 px at 320 px, 18 px font)
 *   G  SERVED without [data-change] → red: “offline” (#m-qty free); updateInert() returning at
 *      once → red: “delete rule” (dialog below not inert) and “inert background”; announce()
 *      always polite → red: “inert background and live regions”
 *   H  monitor.js back to alert() → red: “no alert”
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');
const { patternCollection } = require('./helpers/inventory');
const { AXE_RUN, LAYOUT } = require('./helpers/layout-measurement');

const klick = sel => `document.querySelector(${JSON.stringify(sel)})?.click(); true`;
const SN = '75192-1';

/** Contrast of an element's colour against the nearest opaque background, as WCAG computes it. */
const CONTRAST = sel => `(() => {
  const e = document.querySelector(${JSON.stringify(sel)});
  const rgb = s => s.match(/[\\d.]+/g).map(Number);
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  let x = e, bg = null;
  while (x && !bg) { const c = rgb(getComputedStyle(x).backgroundColor); if ((c[3] ?? 1) > 0.99) bg = c; x = x.parentElement; }
  const [a, b] = [L(rgb(getComputedStyle(e).color)), L(bg || [255, 255, 255])].sort((p, q) => q - p);
  return (a + 0.05) / (b + 0.05); })()`;

test('UX findings 36–42', { concurrency: 1, timeout: 280_000 }, async t => {
  const NAME = `uxw1_${process.pid}`;
  const EXTERNAL = `https://example.org/anleitung-${process.pid}.pdf`;
  const LOCAL = `/anleitungen/geteilt-${process.pid}.pdf`;
  const app = await startApp(t, {
    name: NAME,
    allDesigns: true,
    holding: async (db, uid) => {
      await patternCollection(db, uid);
      // One instruction of each kind: imported from outside, imported and stored, uploaded by hand.
      // Shared rows outlive the account; those of an earlier run would add to the three.
      await db.run(`DELETE FROM shared_instructions WHERE url LIKE 'https://example.org/anleitung-%'`);
      await db.run(`INSERT INTO shared_instructions (set_number, url, description) VALUES ($1, $2, 'Buch 1')`, [
        SN,
        EXTERNAL,
      ]);
      await db.run(
        `INSERT INTO shared_instructions (set_number, url, description, local_path) VALUES ($1, $2, 'Buch 2', $3)`,
        [SN, `${EXTERNAL}?2`, LOCAL],
      );
      await db.run(
        `INSERT INTO instructions (user_id, set_number, url, description, local_path) VALUES ($1, $2, $3, 'Eigene', $3)`,
        [uid, SN, `/anleitungen/eigen-${process.pid}.pdf`],
      );
    },
  });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, until, settle } = app;
  // Without a Rebrickable key the setup wizard opens after startup (if it does, within two seconds).
  await until(`!!document.querySelector('#setup-modal.open')`, 'Setup', 20).catch(() => {});
  await b.evaluate(klick('#setup-modal.open [data-click="setupLater"]'));
  await settle();
  const closed = () =>
    b.evaluate(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      document.querySelectorAll('.ovl.open').forEach(o => o.querySelector('[data-dialog-close]')?.click());
      document.querySelectorAll('#toasts .toast').forEach(x => x.remove()); return true; })()`);
  const openSet = async () => {
    await b.evaluate(klick(`#gallery .sc[data-arg="${SN}"]`));
    await until(`document.querySelectorAll('#m-instr .ii').length === 3`, 'drei Anleitungen im Set-Detail');
    await settle();
  };

  await t.test('instructions: kinds as text, tap targets, contrast, new-tab hint', async () => {
    for (const [width, height, mobileView, min] of [
      [1280, 900, false, 24],
      [390, 844, true, 44],
    ]) {
      await b.tab('Emulation.setDeviceMetricsOverride', {
        width: width,
        height: height,
        deviceScaleFactor: 1,
        mobile: mobileView,
      });
      await openSet();
      const m = await b.evaluate(`(() => {
        const rows = [...document.querySelectorAll('#m-instr .ii')];
        const box = e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
        return { kinds: rows.map(r => r.querySelector('.ii-kind')?.textContent.trim()),
          links: rows.map(r => box(r.querySelector('a'))[1]),
          route: [...document.querySelectorAll('#m-instr .ii-remove')].map(box),
          route_name: document.querySelector('#m-instr .ii-remove')?.getAttribute('aria-label'),
          outside: document.querySelector('#m-instr a[target=_blank] .new-tab .vh')?.textContent };
      })()`);
      assert.deepEqual(m.kinds, ['Extern', 'Lokal', 'Manuell'], 'kind only as colour or icon');
      assert.ok(
        m.links.every(h => h >= min),
        `${width} px: links ${m.links.join('/')} px high, at least ${min}`,
      );
      assert.equal(m.route.length, 1, 'only the uploaded instructions can be deleted');
      assert.ok(m.route[0][0] >= min && m.route[0][1] >= min, `${width} px: delete button ${m.route[0].join('×')}`);
      assert.equal(m.route_name, 'Anleitung löschen');
      assert.equal(m.outside, '(öffnet in neuem Tab)');
      for (const dark of [false, true]) {
        await b.evaluate(`document.documentElement.toggleAttribute('data-dark', ${dark}); true`);
        await settle();
        const k = await b.evaluate(CONTRAST('#m-instr .ii-remove'));
        assert.ok(k >= 4.5, `${width} px ${dark ? 'dark' : 'light'}: delete button ${k.toFixed(2)}:1`);
        const findings = [...(await b.evaluate(LAYOUT(mobileView))), ...(await b.evaluate(AXE_RUN))].filter(f =>
          /\.ii|m-instr|new-tab/.test(f),
        );
        assert.deepEqual(findings, [], `${width} px ${dark ? 'dark' : 'hell'}`);
      }
      await b.evaluate(`document.documentElement.removeAttribute('data-dark'); true`);
      await closed();
      await settle();
    }
    await b.tab('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    // Static links into a new tab carry the same hint.
    const staticPart = await b.evaluate(
      `[...document.querySelectorAll('a[target=_blank]')].filter(a => !a.querySelector('.new-tab .vh')?.textContent).map(a => a.href)`,
    );
    assert.deepEqual(staticPart, []);
  });

  await t.test('themes style the dialogs', async () => {
    await openSet();
    // Per theme: rules of its own stylesheet that hit the open dialog panel (before: none, the class did not exist).
    const hits = await b.evaluate(`(() => { const m = document.querySelector('#set-modal .modal'); const r = {};
      const rules = l => [...l].flatMap(x => x.cssRules ? [...(x.selectorText ? [x] : []), ...rules(x.cssRules)] : []);
      for (const d of ['noppe', 'hochglanz', 'werkbank']) { document.documentElement.setAttribute('data-theme', d);
        const blatt = [...document.styleSheets].find(s => (s.href || '').includes('/themes/' + d + '.css'));
        r[d] = rules(blatt.cssRules).filter(x => { try { return m.matches(x.selectorText); } catch { return false; } }).length; }
      const s = {}; for (const d of ['classic', 'noppe', 'hochglanz']) { document.documentElement.setAttribute('data-theme', d);
        const c = getComputedStyle(m); s[d] = { rand: c.borderTopWidth, ecke: c.borderTopLeftRadius }; }
      document.documentElement.setAttribute('data-theme', 'classic'); return { r, s }; })()`);
    assert.ok(
      Object.values(hits.r).every(n => n > 0),
      `design rules for the dialog: ${JSON.stringify(hits)}`,
    );
    assert.notEqual(hits.s.noppe.rand, hits.s.classic.rand, '„noppe“: dialog without ink border');
    assert.equal(hits.s.hochglanz.ecke, '20px', '„hochglanz“: dialog without rounded lacquer corners');
    await closed();
  });

  await t.test('finance placeholder names no missing button', async () => {
    const text = await b.evaluate(`document.querySelector('#fin-tbl .empty p')?.textContent ?? 'geladen'`);
    // Either the tab already loaded (then no placeholder), or the placeholder says what happens.
    assert.doesNotMatch(text, /Preise laden/);
    if (text !== 'loaded') assert.equal(text, 'Die Preise werden geladen, sobald dieser Reiter offen ist.');
  });

  await t.test('delete rule: restorable at once with undo, irreversible with a question', async () => {
    await b.evaluate(klick('.ntab[data-tab="parts"]'));
    await until(`!!document.querySelector('.man-tile[data-arg="part"][data-arg2="3001"] .delbtn')`, 'einzelnes Teil');
    await settle();
    await b.evaluate(klick('.man-tile[data-arg="part"][data-arg2="3001"] .delbtn'));
    await until(`!document.querySelector('.man-tile[data-arg="part"][data-arg2="3001"]')`, 'Teil gelöscht');
    assert.notEqual(
      await b.evaluate(`document.getElementById('confirm-modal').style.display`),
      'flex',
      'confirmation prompt before something restorable',
    );
    await until(`!!document.querySelector('#toasts .toast-action')`, 'Rückgängig im Toast');
    await b.evaluate(klick('#toasts .toast-action'));
    await until(`!!document.querySelector('.man-tile[data-arg="part"][data-arg2="3001"]')`, 'Teil zurück');
    // A purchase is gone for good: that asks.
    await b.evaluate(klick('.ntab[data-tab="gallery"]'));
    await until(`!!document.querySelector('#gallery .sc[data-arg="${SN}"]')`, 'Sammlung');
    await openSet();
    await b.evaluate(klick('#set-modal [data-click="openAcqModal"]'));
    await until(`!!document.querySelector('#acq-modal [data-click="acqDelete"]')`, 'Kaufpreise');
    await b.evaluate(klick('#acq-modal [data-click="acqDelete"]'));
    await until(`document.getElementById('confirm-modal').style.display === 'flex'`, 'Rückfrage vor Unwiderruflichem');
    // The dialog below is inert while the question is open (41).
    assert.equal(await b.evaluate(`document.getElementById('acq-modal').inert`), true, 'dialog below is operable');
    await b.evaluate(klick('#cd-cancel'));
    await until(`document.getElementById('confirm-modal').style.display !== 'flex'`, 'abgebrochen');
    await closed();
    await settle();
  });

  await t.test('inert background and live regions', async () => {
    await openSet();
    const open = await b.evaluate(
      `({ app: document.getElementById('app').inert, dialog: document.getElementById('set-modal').inert, toasts: document.getElementById('toasts').inert })`,
    );
    assert.deepEqual(open, { app: true, dialog: false, toasts: false });
    await closed();
    await until(`!document.getElementById('set-modal').classList.contains('open')`, 'Dialog zu');
    assert.equal(await b.evaluate(`document.getElementById('app').inert`), false, 'page stays locked after closing');
    // An import without a file reports an error: only the assertive region reads it.
    await b.evaluate(`document.getElementById('csv-file').dispatchEvent(new Event('change', { bubbles: true })); true`);
    await until(`!!document.querySelector('#toasts .toast.error')`, 'Fehlermeldung');
    const text = await b.evaluate(`document.querySelector('#toasts .toast.error .toast-text').textContent`);
    await until(
      `document.getElementById('announcement-error').textContent === ${JSON.stringify(text)}`,
      'Fehler im Alarmbereich',
    );
    assert.notEqual(await b.evaluate(`document.getElementById('announcement-status').textContent`), text);
    assert.equal(await b.evaluate(`document.getElementById('toasts').closest('[aria-live]')`), null);
    await closed();
  });

  await t.test('offline locks autosave fields', async () => {
    await openSet();
    await b.evaluate(`window.dispatchEvent(new Event('offline')); true`);
    await until(`document.getElementById('m-qty').disabled`, 'Mengenfeld gesperrt');
    await b.evaluate(`window.dispatchEvent(new Event('online')); true`);
    await until(`!document.getElementById('m-qty').disabled`, 'Mengenfeld wieder frei');
    await closed();
  });

  await t.test('tab labels never below 12 px', async () => {
    const small = [];
    for (const [width, font] of [
      [320, 16],
      // Slightly larger font is the tight case: the bar already goes to two rows, the label shrinks by a fifth.
      [320, 18],
      [390, 20],
      [320, 32],
    ]) {
      await b.tab('Emulation.setDeviceMetricsOverride', {
        width: width,
        height: 640,
        deviceScaleFactor: 1,
        mobile: true,
      });
      await b.tab('Page.setFontSizes', { fontSizes: { standard: font, fixed: Math.round(font * 0.8) } });
      await settle();
      for (const l of await b.evaluate(`[...document.querySelectorAll('nav .ntab')].filter(t => t.checkVisibility())
        .map(t => t.querySelector('.tab-label')).map(l => [l.textContent.trim(), parseFloat(getComputedStyle(l).fontSize)])`))
        if (l[1] < 12) small.push(`${width} px, ${font} px: ${l[0]} ${l[1]} px`);
    }
    await b.tab('Page.setFontSizes', { fontSizes: { standard: 16, fixed: 13 } });
    await b.tab('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    assert.deepEqual(small, []);
  });

  await t.test('every page head: title and subtitle', async () => {
    const without = await b.evaluate(`[...document.querySelectorAll('#app .tab')].filter(t => {
      const ph = t.querySelector(':scope > .ph'); return !ph?.querySelector('h1.ptitle') || !ph.querySelector('.ptitle-sub')?.textContent.trim();
    }).map(t => t.id)`);
    assert.deepEqual(without, []);
  });

  await t.test('no browser alert: a blocked pop-up is a toast', async () => {
    await b.evaluate(`window.__alert = 0; window.alert = () => { window.__alert++; }; window.open = () => null; true`);
    await b.evaluate(klick('.ntab[data-tab="monitor"]'));
    await until(`!!document.querySelector('[data-click="openLogViewer"]')?.checkVisibility()`, 'Hintergrundarbeiten');
    await b.evaluate(klick('[data-click="openLogViewer"]'));
    await until(`!!document.querySelector('#toasts .toast.error')`, 'Meldung statt alert()');
    assert.equal(await b.evaluate('window.__alert'), 0);
  });
});
