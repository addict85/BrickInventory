/**
 * UI review 17 in real Chrome: what the view check (oberflaeche-*)
 * does not measure because it needs key paths or a second window.
 *   - PDF viewer (accessibility H1): the pages take the focus,
 *     PageDown scrolls, every page is called “page n of m”.
 *   - CSV progress (H3): after choosing the file the focus lies in the overlay,
 *     ten times Tab does not leave it, the progress stands in role=status.
 *   - Log window (M4): axe without finding, level buttons with aria-pressed
 *     matching .active.
 *   - Focus ring (H4): in header and tab bar the ring of every
 *     control stands out ≥ 3:1 from the background in all eleven design states.
 *   - Flows M19, M20, N23: set numbers of the list view single-line at
 *     1440 px; at 720 × 450 (200 % zoom) the value in the set detail is in view
 *     without scrolling; at 360 px the floating button is at most 56 px wide
 *     after scrolling.
 *
 * Counter-checks (measured 05.11.2026, each alone, bundle rebuilt):
 *   A  #pdf-viewer-pages without tabindex → red: “PDF viewer” (focus not
 *      in the pages, scrollTop 0)
 *   B  in noppe.css --focus-header removed → red: “focus ring” (noppe light,
 *      header 1.0:1)
 *   C  in the log window aria-pressed removed from the info button → red:
 *      “log window”
 *   D  in mobile.css the rule `.header-remove .button-floating` removed → red:
 *      “dimensions” (button wider than 56 px)
 *   E  (06.11.2026) in logviewer.js an <img> without alt appended → red:
 *      “log window” (axe in the frame); C repeated on 06.11. in the frame.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, sleep } = require('./helpers/app-browser');
const { patternHousehold } = require('./helpers/inventory');
const { AXE, AXE_RUN } = require('./helpers/layout-measurement');

const TAB = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 };
const taste = async (b, t) => {
  await b.tab('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...t });
  await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', ...t });
};
const file = (sel, name, kind, content) => `(() => { const f = document.querySelector(${JSON.stringify(sel)});
  const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(content)}], ${JSON.stringify(name)}, { type: ${JSON.stringify(kind)} }));
  f.files = dt.files; f.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
const PDF =
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R 4 0 R]/Count 2>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 400]>>endobj\n4 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 400]>>endobj\n' +
  'trailer<</Root 1 0 R>>\n%%EOF\n';

const CLOSE = `(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  document.querySelectorAll('.ovl.open').forEach(o => o.classList.remove('open'));
  const p = document.getElementById('pdf-viewer-modal'); if (p) p.style.display = 'none'; return true; })()`;

async function pdfViewer(_t, a) {
  const { b, until } = a;
  await b.evaluate(
    `document.querySelector('.ntab[data-tab="gallery"]').click(); document.querySelector('#gallery [data-click="openModal"]').click(); true`,
  );
  await until(`!!document.getElementById('instr-file')`, 'Set-Detail');
  await b.evaluate(file('#instr-file', 'anleitung.pdf', 'application/pdf', PDF));
  await until(`!!document.querySelector('#set-modal [data-click="openPdfViewerLink"]')`, 'Instruction uploaded');
  await b.evaluate(`document.querySelector('#set-modal [data-click="openPdfViewerLink"]').click(); true`);
  await until(`document.querySelectorAll('#pdf-viewer-pages [role="img"]').length === 2`, 'two pages');
  await until(`document.activeElement?.id === 'pdf-viewer-pages'`, 'Focus in the pages').catch(() => {});
  const names = await b.evaluate(
    `[...document.querySelectorAll('#pdf-viewer-pages [role="img"]')].map(s => s.getAttribute('aria-label'))`,
  );
  assert.deepEqual(names, ['Seite 1 von 2', 'Seite 2 von 2']);
  assert.ok(await b.evaluate(`document.activeElement?.id === 'pdf-viewer-pages'`), 'Focus not in the pages');
  await taste(b, { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 });
  // Under load the scrolling arrives later; the wait is up to 3 s.
  await until(`document.getElementById('pdf-viewer-pages').scrollTop > 0`, 'Bildlauf', 30).catch(() => {});
  assert.ok(
    await b.evaluate(`document.getElementById('pdf-viewer-pages').scrollTop > 0`),
    `PageDown does not scroll: ${await b.evaluate(`(() => { const p = document.getElementById('pdf-viewer-pages'); return [p.scrollHeight, p.clientHeight, document.activeElement?.id].join(' '); })()`)}`,
  );
  assert.deepEqual(await b.evaluate(AXE_RUN), []);
}

async function csvProgress(_t, a) {
  const { b, until } = a;
  await b.evaluate(`document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
  await b.evaluate(file('#csv-file', 'sets.csv', 'text/csv', 'set_number,quantity\n75192-1,1\n99999-1,abc\n'));
  // If a set is already in the stock, the UI asks first.
  await b.evaluate(`new Promise(r => { const t0 = Date.now(); (function w() { const c = document.getElementById('confirm-modal');
      if (c && c.style.display === 'flex') { document.getElementById('cd-confirm').click(); r(true); }
      else if (document.getElementById('progress-overlay').classList.contains('open') || Date.now() - t0 > 5000) r(true); else setTimeout(w, 100); })(); })`);
  await until(`document.getElementById('progress-overlay').classList.contains('open')`, 'Overlay open');
  await until(
    `document.getElementById('progress-overlay').contains(document.activeElement)`,
    'Focus in the overlay',
  ).catch(() => {});
  assert.ok(
    await b.evaluate(`document.getElementById('progress-overlay').contains(document.activeElement)`),
    `Focus on ${await b.evaluate('document.activeElement?.outerHTML?.slice(0, 80)')}`,
  );
  for (let i = 0; i < 10; i++) {
    await taste(b, TAB);
    assert.ok(
      await b.evaluate(`document.getElementById('progress-overlay').contains(document.activeElement)`),
      `Tab ${i + 1} leaves the overlay: focus on ${await b.evaluate('document.activeElement?.outerHTML?.slice(0, 120)')}, overlay ${await b.evaluate(`document.getElementById('progress-overlay').className`)}`,
    );
  }
  assert.ok(
    await b.evaluate(`!!document.getElementById('prog-footer').closest('[role="status"],[aria-live]')`),
    'Progress not announced',
  );
  assert.deepEqual(await b.evaluate(AXE_RUN), []);
}

async function logWindow(_t, a) {
  const { b, until } = a;
  await b.evaluate(`document.querySelector('.ntab[data-tab="monitor"]').click(); true`);
  await until(`!!document.querySelector('[data-click="openLogViewer"]')`, 'Hintergrundarbeiten');
  // A separate window like window.open(), but in the frame of the same page: with its own
  // Trusted Types policies (logviewer.js creates “app” itself) and reachable for axe.
  await b.evaluate(`window.open = () => { const f = document.createElement('iframe'); f.id = 'lv-rahmen';
    f.title = 'Protokoll'; f.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:2147483647';
    document.body.append(f); return f.contentWindow; };
    document.querySelector('[data-click="openLogViewer"]').click(); true`);
  const within = (/** @type {string} */ expression) =>
    `(() => { const document = window.document.getElementById('lv-rahmen')?.contentDocument; return !!document && (${expression}); })()`;
  await until(
    within(`!!document.getElementById('log-wrap') && !!document.getElementById('btn-info')`),
    'Protokollfenster',
  );
  // logviewer.js loads afterwards; only its first list shows that the buttons are wired.
  await until(within(`/^\\d+ \\/ \\d+/.test(document.getElementById('status')?.textContent || '')`), 'Log loaded');
  // axe in its own world of the frame: there the frame's CSP does not apply to eval.
  const { frameTree } = await b.tab('Page.getFrameTree');
  const frame = (frameTree.childFrames || []).at(-1)?.frame;
  assert.ok(frame, 'no frame for the log window');
  const { executionContextId } = await b.tab('Page.createIsolatedWorld', { frameId: frame.id, worldName: 'axe' });
  await b.tab('Runtime.evaluate', { contextId: executionContextId, expression: `${AXE};0` });
  const { result } = await b.tab('Runtime.evaluate', {
    contextId: executionContextId,
    awaitPromise: true,
    returnByValue: true,
    expression: `axe.run(document, { resultTypes: ['violations'] }).then(r =>
      r.violations.flatMap(v => v.nodes.slice(0, 4).map(n => v.id + ': ' + n.target.join(' '))))`,
  });
  const axe = result.value;
  assert.deepEqual(axe, []);
  const levels = await b.evaluate(
    within(
      `[...document.querySelectorAll('.lvbtn')].map(k => [k.id, k.classList.contains('active'), k.getAttribute('aria-pressed')])`,
    ),
  );
  assert.ok(levels.length >= 3, `only ${levels.length} level buttons`);
  for (const [id, active, pressed] of levels) assert.equal(pressed, String(active), id);
  const prior = await b.evaluate(within(`document.getElementById('btn-info').getAttribute('aria-pressed')`));
  await b.evaluate(within(`document.getElementById('btn-info').click() ?? true`));
  assert.equal(
    await b.evaluate(within(`document.getElementById('btn-info').getAttribute('aria-pressed')`)),
    String(prior !== 'true'),
    'the info button does not report its state',
  );
  assert.equal(await b.evaluate(within(`document.getElementById('status').getAttribute('role')`)), 'status');
  await b.evaluate(`document.getElementById('lv-rahmen').remove(); true`);
}

async function measures(_t, a) {
  const { b, until, settle } = a;
  const size = (w, h, mobileView) =>
    b.tab('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: mobileView });
  try {
    await size(1440, 900, false);
    await b.evaluate(
      `document.querySelector('.ntab[data-tab="gallery"]').click(); document.getElementById('vl').click(); true`,
    );
    await until(`!!document.querySelector('#gallery table tbody tr')`, 'Listenansicht');
    const numbers =
      await b.evaluate(`[...document.querySelectorAll('#gallery table tbody tr')].map(z => z.cells[1]).filter(Boolean)
      .map(c => { const lh = parseFloat(getComputedStyle(c).lineHeight) || 20; return [c.innerText.trim(), c.querySelector('*')?.getBoundingClientRect().height ?? c.getBoundingClientRect().height, lh]; })`);
    assert.ok(numbers.length >= 3, `only ${numbers.length} rows`);
    for (const [text, height, lh] of numbers)
      assert.ok(!text.includes('\n') && height <= 1.5 * lh + 24, `Number „${text}“ ${height}px`);

    await size(720, 450, false);
    await b.evaluate(
      `document.getElementById('vg').click(); document.querySelector('#gallery [data-click="openModal"]').click(); true`,
    );
    await until(
      `!!document.querySelector('#m-market-rows') && !document.querySelector('#m-market-rows .skeleton-row')`,
      'Set-Detail',
    );
    const upper = await b.evaluate(`document.getElementById('m-market-rows').getBoundingClientRect().top`);
    assert.ok(upper < 450 - 40, `Value box only at ${upper}px`);
    await b.evaluate(CLOSE);

    await size(360, 740, true);
    await b.evaluate(`window.scrollTo(0, 0); true`);
    await settle();
    for (const y of [120, 300, 600]) {
      await b.evaluate(`window.scrollTo(0, ${y}); true`);
      await settle();
    }
    const width = await b.evaluate(
      `document.querySelector('#tab-gallery .button-floating').getBoundingClientRect().width`,
    );
    assert.ok(width <= 56.5, `floating button ${width}px wide`);
  } finally {
    await size(1280, 900, false);
    await b.evaluate(`window.scrollTo(0, 0); true`);
  }
}

const RING = `(() => {
  const rgba = (s) => { const m = String(s).match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const hell = (f) => 0.2126 * lin(f.r) + 0.7152 * lin(f.g) + 0.0722 * lin(f.b);
  const kontrast = (v, h) => { const [a, b] = [hell(v), hell(h)].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05); };
  const reason = (e) => { for (let x = e; x; x = x.parentElement) { const f = rgba(getComputedStyle(x).backgroundColor); if (f && f.a >= 1) return f; } return { r: 255, g: 255, b: 255 }; };
  const findings = [];
  for (const e of document.querySelectorAll('header :is(a,button,summary,select,input), nav:not(.settings-nav) :is(a,button)')) {
    const r = e.getBoundingClientRect(); if (r.width < 1 || !e.checkVisibility()) continue;
    e.focus(); if (!e.matches(':focus-visible')) continue;
    const s = getComputedStyle(e), farbe = rgba(s.outlineColor);
    const wert = s.outlineStyle === 'none' || !farbe ? 0 : kontrast(farbe, reason(e.parentElement));
    if (wert < 3) findings.push((e.id || e.className || e.tagName) + ' ' + wert.toFixed(2) + ':1');
  }
  document.activeElement?.blur(); return findings; })()`;

async function fokusring(_t, a) {
  const { b } = a;
  // A real key first: afterwards Chrome shows the ring for focus() too (:focus-visible).
  await taste(b, { key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
  const findings = [];
  for (const design of ['classic', 'brick', 'noppe', 'werkbank', 'farbfaecher', 'hochglanz'])
    for (const dark of [false, true]) {
      if (design === 'werkbank' && !dark) continue;
      await b.evaluate(
        `document.documentElement.setAttribute('data-theme', '${design}'); document.documentElement.toggleAttribute('data-dark', ${dark}); true`,
      );
      await sleep(50);
      for (const f of await b.evaluate(RING)) findings.push(`${design} ${dark ? 'dark' : 'hell'}: ${f}`);
    }
  assert.deepEqual(findings, []);
}

test('focus, PDF viewer, log window', { concurrency: 1, timeout: 300_000 }, async t => {
  const a = await startApp(t, { name: `r17_${process.pid}`, holding: patternHousehold, allDesigns: true });
  if (a.reason) {
    t.skip(a.reason);
    return;
  }
  // The PDF viewer uploads an instruction; otherwise it would stay for the next account with the same number.
  t.after(() =>
    require('node:fs').rmSync(require('node:path').join(__dirname, '..', 'data', 'uploads', String(a.uid)), {
      recursive: true,
      force: true,
    }),
  );
  await a.settle();
  await a.b.evaluate(`document.querySelector('#setup-modal.open [data-click="setupLater"]')?.click(); true`);
  // The log window replaces the page; that is why it comes last.
  /** @type {[string, (t: import('node:test').TestContext, a: object) => Promise<void>][]} */
  const pruefungen = [
    ['Fokusring', fokusring],
    ['Masse', measures],
    ['PDF-Betrachter', pdfViewer],
    ['CSV-Fortschritt', csvProgress],
    ['Protokollfenster', logWindow],
  ];
  for (const [name, fn] of pruefungen) {
    await a.b.evaluate(CLOSE);
    await t.test(name, () => fn(t, a));
  }
});
