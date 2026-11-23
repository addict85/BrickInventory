/**
 * Importing a wanted list cannot be triggered twice: on the real
 * bundle in jsdom, with a server response that the test holds back, breaks
 * or sends piece by piece.
 *
 * Counter-checks (measured 08.11.2026, each individually, reverted afterwards;
 * names in English since phase 2b round 5: `_laeuft`→`_busy`, `lies()`→`read()`,
 * `liesStrom`→`readStream`, `knoepfeStand()`→`updateButtons()`):
 *   A  `_busy` removed from the condition in read() → red: “a second click
 *      starts no second run, a new file is rejected” (two requests)
 *   B  `_busy = false;` deleted in the finally of read() → red: “the latch
 *      opens again even after an error” (an error that flies out of the run
 *      could only be triggered in jsdom as an unhandled rejection, which the
 *      test runner charges to the test)
 *   C  `_busy ||` deleted from the line for the write button → red: “a
 *      second click …” (writing operable during the run)
 *   D  the line `if (_busy) { … return; }` removed in wantedXmlSelected →
 *      red: “a second click …” (new file accepted during the run)
 *   E  in readStream `rest = lines.pop() ?? ''` → `rest = ''` → red: “the
 *      progress arrives piece by piece …” (report about two pieces breaks)
 *   F  `p.set('stream', '1')` deleted → red: the same check
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, waitFor } = require('./helpers/ui');

const REPORT = { success: true, preview: true, parsed: 1, items: [], created: 0, topped_up: 0, failed: 0 };

/** Opens the UI; requests to the XML import are answered by `antwort(nr)` (promise of a Response). */
async function withImport(response) {
  const o = await openUi();
  const importList = [];
  const before = o.w.fetch;
  o.w.fetch = (url, opt) => {
    if (!String(url).includes('/wanted-list/import/xml')) return before(url, opt);
    importList.push(String(url));
    return response(importList.length);
  };
  const choose = name => {
    const field = o.d.getElementById('wanted-xml-part');
    Object.defineProperty(field, 'files', { configurable: true, value: [new o.w.File(['<INVENTORY/>'], name)] });
    field.dispatchEvent(new o.w.Event('change', { bubbles: true }));
  };
  const button = id => o.d.getElementById(id);
  return { ...o, importList, choose, button };
}

const asJson = d => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => d });

test('a second click starts no second run, a new file is rejected', async () => {
  let release;
  const { w, d, importList, choose, button } = await withImport(
    () =>
      new Promise(r => {
        release = () => r(asJson(REPORT));
      }),
  );
  try {
    choose('liste.xml');
    assert.ok(await waitFor(() => importList.length === 1), 'The file starts no run');
    assert.deepEqual(
      [button('wanted-xml-new').disabled, button('wanted-xml-write').disabled],
      [true, true],
      'During the run both buttons are disabled',
    );
    // Locked or not: a triggered click and a new file also come to nothing.
    button('wanted-xml-new').disabled = false;
    button('wanted-xml-new').click();
    button('wanted-xml-write').disabled = false;
    button('wanted-xml-write').click();
    choose('andere.xml');
    assert.ok(await waitFor(() => d.querySelector('#toasts .toast')), 'No message about the rejected file');
    assert.equal(importList.length, 1, 'A second import added up the quantities');
    // Back to locked, as updateButtons() would keep it: the release must bring the preview.
    button('wanted-xml-new').disabled = true;
    button('wanted-xml-write').disabled = true;
    release();
    assert.ok(await waitFor(() => d.getElementById('wanted-xml-sub').textContent !== ''), 'The preview does not come');
    assert.deepEqual(
      [button('wanted-xml-new').disabled, button('wanted-xml-write').disabled],
      [false, false],
      'After the preview both buttons are free',
    );
    assert.equal(d.getElementById('wanted-xml-sub').textContent, 'liste.xml', 'The file was swapped');
    // Re-read with the preview showing: writing is locked now too, as long as it runs.
    button('wanted-xml-new').click();
    assert.ok(await waitFor(() => importList.length === 2));
    assert.equal(button('wanted-xml-write').disabled, true, 'Writing is operable during the re-read');
    release();
    assert.ok(await waitFor(() => !button('wanted-xml-write').disabled));
  } finally {
    w.close();
  }
});

test('the latch opens again even after an error', async () => {
  const { w, importList, choose, button } = await withImport(async nr => {
    if (nr === 1) throw new Error('Netz weg');
    return asJson(REPORT);
  });
  try {
    choose('liste.xml');
    assert.ok(await waitFor(() => importList.length === 1));
    assert.ok(await waitFor(() => !button('wanted-xml-new').disabled), 'After the error the dialog stays locked');
    button('wanted-xml-new').click();
    assert.ok(await waitFor(() => importList.length === 2), 'Re-reading starts nothing after the error');
  } finally {
    w.close();
  }
});

test('the progress arrives piece by piece and fills the bar', async () => {
  const pieces = [
    `${JSON.stringify({ progress: { phase: 'rebrickable', done: 1, total: 4 } })}\n{"success":true,"preview":tr`,
    `ue,"parsed":7,"items":[]}\n`,
  ];
  let next;
  const { w, d, importList, choose } = await withImport(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/x-ndjson' },
    body: {
      getReader: () => {
        let i = 0;
        return {
          read: async () => {
            if (i === 1)
              await new Promise(r => {
                next = r;
              });
            return i < pieces.length ? { value: new TextEncoder().encode(pieces[i++]), done: false } : { done: true };
          },
        };
      },
    },
  }));
  try {
    const box = d.getElementById('wanted-xml-progress');
    const wrap = d.getElementById('wanted-xml-bar-wrap');
    assert.equal(box.style.display, 'none', 'The bar is shown empty before the run');
    assert.deepEqual(
      [wrap.getAttribute('role'), wrap.getAttribute('aria-valuemin'), wrap.getAttribute('aria-valuemax')],
      ['progressbar', '0', '100'],
    );
    choose('liste.xml');
    assert.ok(await waitFor(() => typeof next === 'function'));
    assert.match(importList[0], /[?&]stream=1\b/, 'Without stream=1 the server answers in one piece');
    assert.equal(box.style.display, '');
    assert.equal(wrap.getAttribute('aria-valuenow'), '25');
    assert.match(d.getElementById('wanted-xml-progress-text').textContent, /1.*4/);
    next();
    assert.ok(
      await waitFor(() => /7/.test(d.getElementById('wanted-xml-report').textContent)),
      `The report over two pieces does not arrive: ${d.getElementById('wanted-xml-report').textContent}`,
    );
    assert.equal(box.style.display, 'none', 'After the run the bar disappears');
  } finally {
    w.close();
  }
});
