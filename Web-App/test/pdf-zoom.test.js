/**
 * The PDF viewer can zoom — and loses neither the position nor
 * the left half of the page while doing so.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { warte } = require('./helpers/time');

const QUELLE = path.join(__dirname, '..', 'public', 'js', 'pdfviewer.js');

const CONTAINER_W = 600;
const CONTAINER_H = 400;
const PAGE_W = 595,
  PAGE_H = 842; // A4 at scale 1, that is how PDF.js delivers it
const SEITEN = 20;

/** Remove import/export — the file is evaluated here as a classic script. */
function withoutModuleShell(src) {
  return src.replace(/^import[^;]*;\s*$/gm, '').replace(/^export\s+/gm, '');
}

/**
 * A workbench with the real viewer in it.
 *
 * @param {(code: string) => string} [rebuild] counter-check: rebuilds the source text
 *        before it is evaluated. Must change something, otherwise it fails.
 */
async function werkbank(rebuild) {
  let code = withoutModuleShell(fs.readFileSync(QUELLE, 'utf8'));
  if (rebuild) {
    const vorher = code;
    code = rebuild(code);
    assert.notEqual(
      code,
      vorher,
      'The counter-check did not find its place in the source. Either ' +
        'it has a different name — then update this file — or it no longer exists.',
    );
  }

  const dom = new JSDOM(
    `<!doctype html><html><body>
    <div id="pdf-viewer-modal" style="display:none">
      <div id="pdf-viewer-title"></div>
      <button id="pdf-viewer-zoom-out"></button>
      <button id="pdf-viewer-zoom">100%</button>
      <button id="pdf-viewer-zoom-in"></button>
      <a id="pdf-viewer-download" download href="#"></a>
      <div id="pdf-viewer-loading"></div>
      <div id="pdf-viewer-pages"></div>
    </div></body></html>`,
    { runScripts: 'outside-only', pretendToBeVisual: true },
  );
  const w = dom.window;

  // Dimensions and scroll positions by hand — jsdom computes no layout.
  const container = w.document.getElementById('pdf-viewer-pages');
  let rollX = 0,
    rollY = 0;
  Object.defineProperty(container, 'clientWidth', { get: () => CONTAINER_W, configurable: true });
  Object.defineProperty(container, 'clientHeight', { get: () => CONTAINER_H, configurable: true });
  Object.defineProperty(container, 'scrollLeft', {
    get: () => rollX,
    set: v => {
      rollX = Math.max(0, v);
    },
    configurable: true,
  });
  Object.defineProperty(container, 'scrollTop', {
    get: () => rollY,
    set: v => {
      rollY = Math.max(0, v);
    },
    configurable: true,
  });

  /**
   * Staged IntersectionObserver — jsdom has none.
   */
  const beobachtet = [];
  let visiblePages = new Set([1, 2]);
  w.IntersectionObserver = class {
    constructor(cb) {
      this.cb = cb;
      this.ziele = new Set();
    }
    observe(el) {
      const n = parseInt(el.dataset.page, 10);
      this.ziele.add(el);
      beobachtet.push(n);
      // disconnect() cancels the registration, a later observe() applies again
      // — hence the TARGET is checked here and not a switch on the
      // observer. With a switch it stayed silent forever after the first zoom,
      // and three cases turned red without anything missing in the viewer.
      setTimeout(() => {
        if (this.ziele.has(el)) this.cb([{ target: el, isIntersecting: visiblePages.has(n) }]);
      }, 0);
    }
    disconnect() {
      this.ziele.clear();
    }
  };

  // Staged PDF.js. `anhalten` lets render jobs hang until they are
  // explicitly released — this way the case can be built in which
  // zooming happens during a running render.
  const openRender = [];
  const options = [];
  const backgrounds = [];
  let anhalten = false;
  w.pdfjsLib = {
    getDocument(o) {
      options.push(o);
      return {
        promise: Promise.resolve({
          numPages: SEITEN,
          getPage() {
            return Promise.resolve({
              getViewport({ scale }) {
                return { width: PAGE_W * scale, height: PAGE_H * scale };
              },
              render({ viewport, background }) {
                backgrounds.push(background);
                if (!anhalten) return { promise: Promise.resolve(), cancel() {} };
                let frei;
                const p = new Promise(r => {
                  frei = r;
                });
                openRender.push({ frei, breite: Math.round(viewport.width) });
                return {
                  promise: p,
                  cancel() {
                    frei();
                  },
                };
              },
            });
          },
          destroy() {},
        }),
      };
    },
  };

  const aktionen = {};
  w.registerActions = o => Object.assign(aktionen, o);
  w.G = id => w.document.getElementById(id);
  Object.assign(w, require('./helpers/markup').markupHelper());
  w.t = k => k;
  w.tRaw = k => k;
  w.eval(code);

  await w.window.openPdfViewer('/data/instructions/BI-3004.pdf', 'Test');
  await warte(40);

  return {
    w,
    container,
    aktionen,
    warte,
    beobachtet,
    openRender,
    options,
    backgrounds,
    set anhalten(v) {
      anhalten = v;
    },
    set sichtbar(v) {
      visiblePages = new Set(v);
    },
    faktor: () => parseFloat(w.document.getElementById('pdf-viewer-zoom').textContent) / 100,
    platzhalter: () => [...container.querySelectorAll('.pdf-page-ph')],
    /** Where in the document lies the middle of the viewport — in units of zoom 1? */
    place() {
      const f = parseFloat(w.document.getElementById('pdf-viewer-zoom').textContent) / 100;
      return (container.scrollTop + CONTAINER_H / 2) / f;
    },
  };
}

// Counter-check (measured 02.11.2026): isEvalSupported deleted in pdfviewer.js
// → red.
test('PDF.js loads without eval and without scripts in the PDF', async () => {
  const b = await werkbank();
  assert.equal(b.options.length, 1);
  assert.equal(b.options[0].isEvalSupported, false);
  assert.equal(b.options[0].enableScripting, false);
});

test('zoom in the PDF viewer', async t => {
  await t.test('the initial state is 100 % and the minus button is disabled', async () => {
    const b = await werkbank();
    assert.equal(b.faktor(), 1);
    assert.equal(
      b.w.document.getElementById('pdf-viewer-zoom-out').disabled,
      true,
      '1x is the lower stop — there is nothing to see below it.',
    );
    assert.equal(b.platzhalter().length, SEITEN);
  });

  await t.test('placeholder carries the auto margins', async () => {
    const b = await werkbank();
    const stil = b.platzhalter()[0].style;
    assert.equal(stil.marginLeft, 'auto');
    assert.equal(stil.marginRight, 'auto');
  });

  await t.test('zooming in enlarges the page and reports the factor', async () => {
    const b = await werkbank();
    const vorher = parseFloat(b.platzhalter()[0].style.width);
    b.aktionen.pdfZoomIn();
    await b.warte(40);
    assert.equal(b.faktor(), 1.25);
    const nachher = parseFloat(b.platzhalter()[0].style.width);
    assert.ok(
      Math.abs(nachher / vorher - 1.25) < 0.01,
      `Placeholder went from ${vorher} to ${nachher} — that is not 1.25x.`,
    );
  });

  await t.test('the stops hold', async () => {
    const b = await werkbank();
    for (let i = 0; i < 25; i++) b.aktionen.pdfZoomIn();
    await b.warte(40);
    assert.equal(b.faktor(), 5, 'oberer Anschlag');
    assert.equal(b.w.document.getElementById('pdf-viewer-zoom-in').disabled, true);
    for (let i = 0; i < 25; i++) b.aktionen.pdfZoomOut();
    await b.warte(40);
    assert.equal(b.faktor(), 1, 'unterer Anschlag');
    assert.equal(b.w.document.getElementById('pdf-viewer-zoom-out').disabled, true);
  });

  await t.test('the anchor holds: the same spot stays in the middle', async () => {
    const b = await werkbank();
    b.container.scrollTop = 7000;
    const vorher = b.place();
    b.aktionen.pdfZoomIn();
    await b.warte(40);
    const nachher = b.place();
    assert.ok(
      Math.abs(nachher - vorher) < 1,
      `The spot moved from ${vorher.toFixed(1)} to ${nachher.toFixed(1)} ` +
        `(${Math.abs(nachher - vorher).toFixed(1)} units). When zooming ` +
        `the point in the middle of the viewport should stay put.`,
    );
  });

  await t.test('counter-check: without the anchor calculation it jumps', async () => {
    // Take the restoration out — the scroll positions stay where they were.
    const b = await werkbank(code =>
      code
        .replace('container.scrollLeft = docX * target - ax;', '')
        .replace('container.scrollTop = docY * target - ay;', ''),
    );
    b.container.scrollTop = 7000;
    const vorher = b.place();
    b.aktionen.pdfZoomIn();
    await b.warte(40);
    const nachher = b.place();
    assert.ok(
      Math.abs(nachher - vorher) > 100,
      `Without the anchor calculation the spot would have to move clearly, but it only went ` +
        `from ${vorher.toFixed(1)} to ${nachher.toFixed(1)}. Then the case ` +
        `above measures nothing.`,
    );
  });

  await t.test('after zooming the visible pages are re-rendered', async () => {
    const b = await werkbank();
    const vorher = b.beobachtet.length;
    b.aktionen.pdfZoomIn();
    await b.warte(40);
    assert.equal(
      b.beobachtet.length,
      vorher + SEITEN,
      'An IntersectionObserver does NOT report by itself when an ' +
        'observed element only changes its size. Without a new observe() ' +
        'the visible pages would stay empty after zooming.',
    );
    assert.ok(b.platzhalter()[0].querySelector('canvas'), 'Page 1 is visible and should have a canvas again.');
  });

  /**
   * A render runs asynchronously. If zooming happens meanwhile, the
   * placeholder has a different size when it finishes — the old canvas
   * would have no business being there any more.
   *
   * @param {boolean} withGuard false = counter-check, the generation counter
   *        is taken out.
   * @returns {Promise<{ haengen: number[], oldWidths: number[], soll: number }>} widths of the canvases that hang at the end.
   */
  async function staleRender(withGuard) {
    const b = await werkbank(
      withGuard ? undefined : code => code.replace('if (gen !== _pdfZoomGen) {', 'if (false) {'),
    );
    b.anhalten = true;
    b.aktionen.pdfZoomIn(); // stage 1: jobs stay hanging
    await b.warte(40);
    assert.ok(b.openRender.length > 0, 'The workbench does not hold a job — the case measures nothing.');
    const alte = b.openRender.splice(0);
    const oldWidths = alte.map(r => r.breite);

    b.aktionen.pdfZoomIn(); // stage 2: while stage 1 is still running
    await b.warte(40);
    // First let the NEW ones finish, then the old ones. Exactly this
    // order is the damage case: the old pass has less to
    // render and regularly comes last at strong zoom. The other way round
    // the new one cleans up behind it, and the error would stay invisible.
    for (const r of b.openRender) r.frei();
    await b.warte(30);
    for (const r of alte) r.frei();
    await b.warte(40);

    const haengen = b
      .platzhalter()
      .map(ph => {
        const c = ph.querySelector('canvas');
        return c ? c.width : 0;
      })
      .filter(Boolean);
    return { haengen, oldWidths, soll: Math.round(parseFloat(b.platzhalter()[0].style.width)) };
  }

  await t.test('a render that runs across a zoom is discarded', async () => {
    const r = await staleRender(true);
    const veraltet = r.haengen.filter(w => w !== r.soll);
    assert.deepEqual(
      veraltet,
      [],
      `Canvases with the old resolution (${r.oldWidths.join(', ')}px) hang in ` +
        `placeholders that are now ${r.soll}px wide. They are stretched ` +
        `— and the new pass turns back at the top because a canvas is already there. ` +
        `The page would stay coarse. The generation counter in _renderPdfPage guards against that.`,
    );
  });

  await t.test('counter-check: without the generation counter the old canvas hangs in', async () => {
    const r = await staleRender(false);
    const veraltet = r.haengen.filter(w => w !== r.soll);
    assert.ok(
      veraltet.length > 0,
      `Without the counter at least one stale canvas (one of ` +
        `${r.oldWidths.join(', ')}px) would have to land in a ${r.soll}px wide placeholder; ` +
        `stuck are ${r.haengen.join(', ') || 'none at all'}. ` +
        `Then the case above checks nothing.`,
    );
  });

  await t.test('Ctrl + wheel zooms, the wheel alone does not', async () => {
    const b = await werkbank();
    const rad = ctrl =>
      b.container.dispatchEvent(
        new b.w.WheelEvent('wheel', {
          deltaY: -120,
          ctrlKey: ctrl,
          clientX: 300,
          clientY: 200,
          bubbles: true,
          cancelable: true,
        }),
      );
    rad(false);
    await b.warte(40);
    assert.equal(b.faktor(), 1, 'Without a modifier key the wheel keeps scrolling.');
    rad(true);
    await b.warte(40);
    assert.equal(b.faktor(), 1.25);
  });

  await t.test('the listeners only hang once, even after opening several times', async () => {
    const b = await werkbank();
    for (let i = 0; i < 5; i++) {
      b.aktionen.closePdfViewer();
      await b.w.window.openPdfViewer('/data/instructions/BI-3004.pdf', 'Test');
      await b.warte(40);
    }
    b.container.dispatchEvent(
      new b.w.WheelEvent('wheel', {
        deltaY: -120,
        ctrlKey: true,
        clientX: 300,
        clientY: 200,
        bubbles: true,
        cancelable: true,
      }),
    );
    await b.warte(40);
    assert.equal(
      b.faktor(),
      1.25,
      'One wheel turn caused more than one step — then every ' + 'opened PDF collects another listener.',
    );
  });
});

// Counter-check (measured 08.11.2026): in pdfviewer.js given the placeholder `background:#fff` again
// → red „Platzhalter ist gedämpft“; `background: '#fff'` deleted from render() → red „Seite bleibt weiss“.
test('placeholder is dimmed, the rendered page stays white', async () => {
  const b = await werkbank();
  const reason = b.platzhalter()[0].style.background;
  assert.ok(
    reason && !/^(#fff|#ffffff|white|rgb\(255, ?255, ?255\))$/i.test(reason),
    `placeholder is dimmed (${reason})`,
  );
  assert.ok(b.backgrounds.length > 0, 'it was rendered');
  assert.ok(
    b.backgrounds.every(h => h === '#fff'),
    'page stays white',
  );
});
