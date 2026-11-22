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
const { openUi, warte } = require('./helpers/ui');

const BERICHT = { success: true, preview: true, parsed: 1, items: [], created: 0, topped_up: 0, failed: 0 };

/** Opens the UI; requests to the XML import are answered by `antwort(nr)` (promise of a Response). */
async function withImport(response) {
  const o = await openUi();
  const importe = [];
  const davor = o.w.fetch;
  o.w.fetch = (url, opt) => {
    if (!String(url).includes('/wanted-list/import/xml')) return davor(url, opt);
    importe.push(String(url));
    return response(importe.length);
  };
  const choose = name => {
    const field = o.d.getElementById('wanted-xml-part');
    Object.defineProperty(field, 'files', { configurable: true, value: [new o.w.File(['<INVENTORY/>'], name)] });
    field.dispatchEvent(new o.w.Event('change', { bubbles: true }));
  };
  const knopf = id => o.d.getElementById(id);
  return { ...o, importe, choose, knopf };
}

const alsJson = d => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => d });

test('a second click starts no second run, a new file is rejected', async () => {
  let freigeben;
  const { w, d, importe, choose, knopf } = await withImport(
    () =>
      new Promise(r => {
        freigeben = () => r(alsJson(BERICHT));
      }),
  );
  try {
    choose('liste.xml');
    assert.ok(await warte(() => importe.length === 1), 'Die Datei startet keinen Lauf');
    assert.deepEqual(
      [knopf('wanted-xml-new').disabled, knopf('wanted-xml-write').disabled],
      [true, true],
      'Während des Laufs sind beide Knöpfe gesperrt',
    );
    // Locked or not: a triggered click and a new file also come to nothing.
    knopf('wanted-xml-new').disabled = false;
    knopf('wanted-xml-new').click();
    knopf('wanted-xml-write').disabled = false;
    knopf('wanted-xml-write').click();
    choose('andere.xml');
    assert.ok(await warte(() => d.querySelector('#toasts .toast')), 'Keine Meldung zur abgewiesenen Datei');
    assert.equal(importe.length, 1, 'Ein zweiter Import addierte die Mengen auf');
    // Back to locked, as updateButtons() would keep it: the release must bring the preview.
    knopf('wanted-xml-new').disabled = true;
    knopf('wanted-xml-write').disabled = true;
    freigeben();
    assert.ok(await warte(() => d.getElementById('wanted-xml-sub').textContent !== ''), 'Die Vorschau kommt nicht');
    assert.deepEqual(
      [knopf('wanted-xml-new').disabled, knopf('wanted-xml-write').disabled],
      [false, false],
      'Nach der Vorschau sind beide Knöpfe frei',
    );
    assert.equal(d.getElementById('wanted-xml-sub').textContent, 'liste.xml', 'Die Datei wurde ausgetauscht');
    // Re-read with the preview showing: writing is locked now too, as long as it runs.
    knopf('wanted-xml-new').click();
    assert.ok(await warte(() => importe.length === 2));
    assert.equal(knopf('wanted-xml-write').disabled, true, 'Schreiben ist während des Neueinlesens bedienbar');
    freigeben();
    assert.ok(await warte(() => !knopf('wanted-xml-write').disabled));
  } finally {
    w.close();
  }
});

test('the latch opens again even after an error', async () => {
  const { w, importe, choose, knopf } = await withImport(async nr => {
    if (nr === 1) throw new Error('Netz weg');
    return alsJson(BERICHT);
  });
  try {
    choose('liste.xml');
    assert.ok(await warte(() => importe.length === 1));
    assert.ok(await warte(() => !knopf('wanted-xml-new').disabled), 'Nach dem Fehler bleibt der Dialog gesperrt');
    knopf('wanted-xml-new').click();
    assert.ok(await warte(() => importe.length === 2), 'Neu einlesen startet nach dem Fehler nichts');
  } finally {
    w.close();
  }
});

test('the progress arrives piece by piece and fills the bar', async () => {
  const stuecke = [
    `${JSON.stringify({ progress: { phase: 'rebrickable', done: 1, total: 4 } })}\n{"success":true,"preview":tr`,
    `ue,"parsed":7,"items":[]}\n`,
  ];
  let weiter;
  const { w, d, importe, choose } = await withImport(async () => ({
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
                weiter = r;
              });
            return i < stuecke.length ? { value: new TextEncoder().encode(stuecke[i++]), done: false } : { done: true };
          },
        };
      },
    },
  }));
  try {
    const box = d.getElementById('wanted-xml-progress');
    const wrap = d.getElementById('wanted-xml-bar-wrap');
    assert.equal(box.style.display, 'none', 'Der Balken steht vor dem Lauf leer da');
    assert.deepEqual(
      [wrap.getAttribute('role'), wrap.getAttribute('aria-valuemin'), wrap.getAttribute('aria-valuemax')],
      ['progressbar', '0', '100'],
    );
    choose('liste.xml');
    assert.ok(await warte(() => typeof weiter === 'function'));
    assert.match(importe[0], /[?&]stream=1\b/, 'Ohne strom=1 antwortet der Server in einem Stück');
    assert.equal(box.style.display, '');
    assert.equal(wrap.getAttribute('aria-valuenow'), '25');
    assert.match(d.getElementById('wanted-xml-progress-text').textContent, /1.*4/);
    weiter();
    assert.ok(
      await warte(() => /7/.test(d.getElementById('wanted-xml-report').textContent)),
      `Der Bericht über zwei Stücke kommt nicht an: ${d.getElementById('wanted-xml-report').textContent}`,
    );
    assert.equal(box.style.display, 'none', 'Nach dem Lauf verschwindet der Balken');
  } finally {
    w.close();
  }
});
