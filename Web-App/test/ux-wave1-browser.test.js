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
const { AXE_LAUF, LAYOUT } = require('./helpers/layout-measurement');

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
  const EXTERN = `https://example.org/anleitung-${process.pid}.pdf`;
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
        EXTERN,
      ]);
      await db.run(
        `INSERT INTO shared_instructions (set_number, url, description, local_path) VALUES ($1, $2, 'Buch 2', $3)`,
        [SN, `${EXTERN}?2`, LOCAL],
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
  const { b, bis, ruhig } = app;
  // Without a Rebrickable key the setup wizard opens after startup (if it does, within two seconds).
  await bis(`!!document.querySelector('#setup-modal.open')`, 'Setup', 20).catch(() => {});
  await b.auswerten(klick('#setup-modal.open [data-click="setupLater"]'));
  await ruhig();
  const zu = () =>
    b.auswerten(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      document.querySelectorAll('.ovl.open').forEach(o => o.querySelector('[data-dialog-close]')?.click());
      document.querySelectorAll('#toasts .toast').forEach(x => x.remove()); return true; })()`);
  const oeffneSet = async () => {
    await b.auswerten(klick(`#gallery .sc[data-arg="${SN}"]`));
    await bis(`document.querySelectorAll('#m-instr .ii').length === 3`, 'drei Anleitungen im Set-Detail');
    await ruhig();
  };

  await t.test('instructions: kinds as text, tap targets, contrast, new-tab hint', async () => {
    for (const [breite, hoehe, mobil, min] of [
      [1280, 900, false, 24],
      [390, 844, true, 44],
    ]) {
      await b.tab('Emulation.setDeviceMetricsOverride', {
        width: breite,
        height: hoehe,
        deviceScaleFactor: 1,
        mobile: mobil,
      });
      await oeffneSet();
      const m = await b.auswerten(`(() => {
        const rows = [...document.querySelectorAll('#m-instr .ii')];
        const box = e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
        return { arten: rows.map(r => r.querySelector('.ii-kind')?.textContent.trim()),
          links: rows.map(r => box(r.querySelector('a'))[1]),
          weg: [...document.querySelectorAll('#m-instr .ii-remove')].map(box),
          weg_name: document.querySelector('#m-instr .ii-remove')?.getAttribute('aria-label'),
          extern: document.querySelector('#m-instr a[target=_blank] .new-tab .vh')?.textContent };
      })()`);
      assert.deepEqual(m.arten, ['Extern', 'Lokal', 'Manuell'], 'Art nur als Farbe oder Symbol');
      assert.ok(
        m.links.every(h => h >= min),
        `${breite} px: Links ${m.links.join('/')} px hoch, mindestens ${min}`,
      );
      assert.equal(m.weg.length, 1, 'nur die hochgeladene Anleitung ist löschbar');
      assert.ok(m.weg[0][0] >= min && m.weg[0][1] >= min, `${breite} px: Löschknopf ${m.weg[0].join('×')}`);
      assert.equal(m.weg_name, 'Anleitung löschen');
      assert.equal(m.extern, '(öffnet in neuem Tab)');
      for (const dunkel of [false, true]) {
        await b.auswerten(`document.documentElement.toggleAttribute('data-dark', ${dunkel}); true`);
        await ruhig();
        const k = await b.auswerten(CONTRAST('#m-instr .ii-remove'));
        assert.ok(k >= 4.5, `${breite} px ${dunkel ? 'dark' : 'hell'}: Löschknopf ${k.toFixed(2)}:1`);
        const funde = [...(await b.auswerten(LAYOUT(mobil))), ...(await b.auswerten(AXE_LAUF))].filter(f =>
          /\.ii|m-instr|new-tab/.test(f),
        );
        assert.deepEqual(funde, [], `${breite} px ${dunkel ? 'dark' : 'hell'}`);
      }
      await b.auswerten(`document.documentElement.removeAttribute('data-dark'); true`);
      await zu();
      await ruhig();
    }
    await b.tab('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    // Static links into a new tab carry the same hint.
    const statisch = await b.auswerten(
      `[...document.querySelectorAll('a[target=_blank]')].filter(a => !a.querySelector('.new-tab .vh')?.textContent).map(a => a.href)`,
    );
    assert.deepEqual(statisch, []);
  });

  await t.test('themes style the dialogs', async () => {
    await oeffneSet();
    // Per theme: rules of its own stylesheet that hit the open dialog panel (before: none, the class did not exist).
    const treffer = await b.auswerten(`(() => { const m = document.querySelector('#set-modal .modal'); const r = {};
      const regeln = l => [...l].flatMap(x => x.cssRules ? [...(x.selectorText ? [x] : []), ...regeln(x.cssRules)] : []);
      for (const d of ['noppe', 'hochglanz', 'werkbank']) { document.documentElement.setAttribute('data-theme', d);
        const blatt = [...document.styleSheets].find(s => (s.href || '').includes('/themes/' + d + '.css'));
        r[d] = regeln(blatt.cssRules).filter(x => { try { return m.matches(x.selectorText); } catch { return false; } }).length; }
      const s = {}; for (const d of ['classic', 'noppe', 'hochglanz']) { document.documentElement.setAttribute('data-theme', d);
        const c = getComputedStyle(m); s[d] = { rand: c.borderTopWidth, ecke: c.borderTopLeftRadius }; }
      document.documentElement.setAttribute('data-theme', 'classic'); return { r, s }; })()`);
    assert.ok(
      Object.values(treffer.r).every(n => n > 0),
      `Design-Regeln für den Dialog: ${JSON.stringify(treffer)}`,
    );
    assert.notEqual(treffer.s.noppe.rand, treffer.s.classic.rand, 'Noppe: Dialog ohne Tintenrand');
    assert.equal(treffer.s.hochglanz.ecke, '20px', 'Hochglanz: Dialog ohne runde Lackecken');
    await zu();
  });

  await t.test('finance placeholder names no missing button', async () => {
    const text = await b.auswerten(`document.querySelector('#fin-tbl .empty p')?.textContent ?? 'geladen'`);
    // Either the tab already loaded (then no placeholder), or the placeholder says what happens.
    assert.doesNotMatch(text, /Preise laden/);
    if (text !== 'loaded') assert.equal(text, 'Die Preise werden geladen, sobald dieser Reiter offen ist.');
  });

  await t.test('delete rule: restorable at once with undo, irreversible with a question', async () => {
    await b.auswerten(klick('.ntab[data-tab="parts"]'));
    await bis(`!!document.querySelector('.man-tile[data-arg="part"][data-arg2="3001"] .delbtn')`, 'einzelnes Teil');
    await ruhig();
    await b.auswerten(klick('.man-tile[data-arg="part"][data-arg2="3001"] .delbtn'));
    await bis(`!document.querySelector('.man-tile[data-arg="part"][data-arg2="3001"]')`, 'Teil gelöscht');
    assert.notEqual(
      await b.auswerten(`document.getElementById('confirm-modal').style.display`),
      'flex',
      'Rückfrage vor Wiederherstellbarem',
    );
    await bis(`!!document.querySelector('#toasts .toast-action')`, 'Rückgängig im Toast');
    await b.auswerten(klick('#toasts .toast-action'));
    await bis(`!!document.querySelector('.man-tile[data-arg="part"][data-arg2="3001"]')`, 'Teil zurück');
    // A purchase is gone for good: that asks.
    await b.auswerten(klick('.ntab[data-tab="gallery"]'));
    await bis(`!!document.querySelector('#gallery .sc[data-arg="${SN}"]')`, 'Sammlung');
    await oeffneSet();
    await b.auswerten(klick('#set-modal [data-click="openAcqModal"]'));
    await bis(`!!document.querySelector('#acq-modal [data-click="acqDelete"]')`, 'Kaufpreise');
    await b.auswerten(klick('#acq-modal [data-click="acqDelete"]'));
    await bis(`document.getElementById('confirm-modal').style.display === 'flex'`, 'Rückfrage vor Unwiderruflichem');
    // The dialog below is inert while the question is open (41).
    assert.equal(await b.auswerten(`document.getElementById('acq-modal').inert`), true, 'Dialog darunter bedienbar');
    await b.auswerten(klick('#cd-cancel'));
    await bis(`document.getElementById('confirm-modal').style.display !== 'flex'`, 'abgebrochen');
    await zu();
    await ruhig();
  });

  await t.test('inert background and live regions', async () => {
    await oeffneSet();
    const open = await b.auswerten(
      `({ app: document.getElementById('app').inert, dialog: document.getElementById('set-modal').inert, toasts: document.getElementById('toasts').inert })`,
    );
    assert.deepEqual(open, { app: true, dialog: false, toasts: false });
    await zu();
    await bis(`!document.getElementById('set-modal').classList.contains('open')`, 'Dialog zu');
    assert.equal(
      await b.auswerten(`document.getElementById('app').inert`),
      false,
      'Seite bleibt nach dem Schliessen gesperrt',
    );
    // An import without a file reports an error: only the assertive region reads it.
    await b.auswerten(
      `document.getElementById('csv-file').dispatchEvent(new Event('change', { bubbles: true })); true`,
    );
    await bis(`!!document.querySelector('#toasts .toast.error')`, 'Fehlermeldung');
    const text = await b.auswerten(`document.querySelector('#toasts .toast.error .toast-text').textContent`);
    await bis(
      `document.getElementById('announcement-error').textContent === ${JSON.stringify(text)}`,
      'Fehler im Alarmbereich',
    );
    assert.notEqual(await b.auswerten(`document.getElementById('announcement-status').textContent`), text);
    assert.equal(await b.auswerten(`document.getElementById('toasts').closest('[aria-live]')`), null);
    await zu();
  });

  await t.test('offline locks autosave fields', async () => {
    await oeffneSet();
    await b.auswerten(`window.dispatchEvent(new Event('offline')); true`);
    await bis(`document.getElementById('m-qty').disabled`, 'Mengenfeld gesperrt');
    await b.auswerten(`window.dispatchEvent(new Event('online')); true`);
    await bis(`!document.getElementById('m-qty').disabled`, 'Mengenfeld wieder frei');
    await zu();
  });

  await t.test('tab labels never below 12 px', async () => {
    const klein = [];
    for (const [breite, schrift] of [
      [320, 16],
      // Slightly larger font is the tight case: the bar already goes to two rows, the label shrinks by a fifth.
      [320, 18],
      [390, 20],
      [320, 32],
    ]) {
      await b.tab('Emulation.setDeviceMetricsOverride', {
        width: breite,
        height: 640,
        deviceScaleFactor: 1,
        mobile: true,
      });
      await b.tab('Page.setFontSizes', { fontSizes: { standard: schrift, fixed: Math.round(schrift * 0.8) } });
      await ruhig();
      for (const l of await b.auswerten(`[...document.querySelectorAll('nav .ntab')].filter(t => t.checkVisibility())
        .map(t => t.querySelector('.tab-label')).map(l => [l.textContent.trim(), parseFloat(getComputedStyle(l).fontSize)])`))
        if (l[1] < 12) klein.push(`${breite} px, ${schrift} px: ${l[0]} ${l[1]} px`);
    }
    await b.tab('Page.setFontSizes', { fontSizes: { standard: 16, fixed: 13 } });
    await b.tab('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    assert.deepEqual(klein, []);
  });

  await t.test('every page head: title and subtitle', async () => {
    const ohne = await b.auswerten(`[...document.querySelectorAll('#app .tab')].filter(t => {
      const ph = t.querySelector(':scope > .ph'); return !ph?.querySelector('h1.ptitle') || !ph.querySelector('.ptitle-sub')?.textContent.trim();
    }).map(t => t.id)`);
    assert.deepEqual(ohne, []);
  });

  await t.test('no browser alert: a blocked pop-up is a toast', async () => {
    await b.auswerten(`window.__alert = 0; window.alert = () => { window.__alert++; }; window.open = () => null; true`);
    await b.auswerten(klick('.ntab[data-tab="monitor"]'));
    await bis(`!!document.querySelector('[data-click="openLogViewer"]')?.checkVisibility()`, 'Hintergrundarbeiten');
    await b.auswerten(klick('[data-click="openLogViewer"]'));
    await bis(`!!document.querySelector('#toasts .toast.error')`, 'Meldung statt alert()');
    assert.equal(await b.auswerten('window.__alert'), 0);
  });
});
