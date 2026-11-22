/**
 * The settings align their columns with each other, not with the text length.
 *
 * ── Counter-checks (carried out) ──────────────────────────────────────────────
 *
 *   a) the grid moved from the list back to the row → cases 2 and 3 red.
 *   b) margin-top removed on the link button → case 1 red.
 *   c) (14.11.2026) .konto-fuss without margin-top → case 1 red.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const QUELLE = require('./helpers/sources').ansichtQuelle('einstellungen');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

/** As in test/catalog-frontend.test.js: the module wrapping gone. */
function withoutModule(src) {
  return src.replace(/^import[^;]*;\s*$/gm, '').replace(/^export\s+/gm, '');
}

/**
 * Run a function from einstellungen.js in a sandbox.
 *
 * Only the function itself, not the whole file: it pulls half a dozen
 * other modules along (gallery, parts, minifigures), and rebuilding them here
 * would mean starting the application to check a grid.
 */
function runFrom(funktionsName, environment) {
  const start = QUELLE.indexOf(`function ${funktionsName}(`);
  assert.ok(start > 0, `${funktionsName}() steht nicht mehr in den Dateien der Ansicht „einstellungen“`);
  // Up to the bracket in column 0 — that is how these files are written.
  const ende = QUELLE.indexOf('\n}\n', start) + 3;
  const code = withoutModule(QUELLE.slice(start, ende));
  const sandbox = { ...environment };
  vm.createContext(sandbox);
  vm.runInContext(code + `\n${funktionsName}(ARG);`, sandbox);
  return sandbox;
}

/** Minimal scaffold: only what the two producers really touch. */
function rack(dom, targetId) {
  const d = dom.window.document;
  return {
    document: d,
    G: id => d.getElementById(id),
    ...require('./helpers/markup').markupHelper(),
    echt: () => '',
    t: (k, v) => k + (v ? ' ' + JSON.stringify(v) : ''),
    tRaw: k => k,
    ZIEL: targetId,
  };
}

test('spacing between invitation code and link button', () => {
  const d = new JSDOM(HTML).window.document;
  const knopf = d.querySelector('[data-click="redeemHouseholdInvite"]');
  assert.ok(knopf, 'Der Verknüpfen-Knopf ist nicht mehr zu finden');
  // Since UI check 22 it stands in the footer of the menu pages (.konto-fuss, margin-top:.75rem).
  const css = fs.readFileSync(path.join(ROOT, 'public', 'styles.css'), 'utf8');
  assert.ok(knopf.parentElement?.classList.contains('konto-fuss'), 'Der Knopf steht nicht in .konto-fuss');
  assert.match(
    css,
    /\.konto-fuss\{[^}]*margin-top:\.?\d/,
    'Die Fusszeile trägt keinen oberen Abstand; der Knopf klebte dann am Eingabefeld darüber — Marcos Bild.',
  );
});

test('the linked accounts are in two columns, not new per row', () => {
  const dom = new JSDOM(
    '<!doctype html><html><body>' +
      '<div id="household-state"></div><div id="household-invite-box"></div>' +
      '<div id="household-redeem-box"></div></body></html>',
  );
  const umg = rack(dom);
  umg.ARG = {
    is_sub: false,
    currency: 'CHF',
    sub_accounts: [
      { id: 1, username: 'emily.bigolin' },
      { id: 2, username: 'alessio.bigolin' },
      { id: 3, username: 'eliano.bigolin' },
    ],
  };
  runFrom('renderHousehold', umg);

  const liste = dom.window.document.querySelector('#household-state ul');
  assert.ok(liste, 'Die Liste der verknüpften Konten wurde nicht erzeugt');
  // The grid stands in styles.css (.haushalt-liste); minmax(0, …) lets the
  // columns shrink at large font sizes instead of widening the page.
  assert.ok(liste.classList.contains('haushalt-liste'), 'Die Liste trägt die Klasse haushalt-liste nicht');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  const stil = (css.match(/\n\.haushalt-liste\{([^}]*)\}/) || [])[1] || '';
  assert.match(
    stil,
    /display\s*:\s*grid/,
    `Die LISTE trägt kein Raster („${stil}“) — dann richtet sich jede Zeile ` +
      'für sich aus, und die Knöpfe stehen versetzt.',
  );
  assert.match(
    stil,
    /grid-template-columns\s*:\s*minmax\(0,\s*max-content\)\s+minmax\(0,\s*max-content\)/,
    'Die Liste hat keine zwei Inhaltsspalten — ohne sie teilen sich die Zeilen ' + 'keine gemeinsame Breite',
  );

  const zeilen = [...liste.querySelectorAll('li')];
  assert.equal(zeilen.length, 3, `${zeilen.length} Zeilen statt 3`);
  for (const li of zeilen) {
    assert.match(
      li.getAttribute('data-stil') || '',
      /display\s*:\s*contents/,
      'Eine Zeile erzeugt einen eigenen Kasten — damit liegen ihre Zellen NICHT ' +
        'in den Spalten der Liste, und die Ausrichtung ist wieder dahin',
    );
  }
  // And every row delivers exactly two cells — otherwise the columns shift
  // from the first row that is built differently.
  for (const li of zeilen) {
    assert.equal(
      li.children.length,
      2,
      `Eine Zeile hat ${li.children.length} Zellen statt 2 — bei display:contents ` +
        'zählt jede Zelle einzeln ins Raster, eine zu viel verschiebt alles danach',
    );
  }
  assert.equal(
    liste.querySelectorAll('[data-click="unlinkHousehold"]').length,
    3,
    'Nicht jede Zeile hat ihren Entfernen-Knopf',
  );
});

test('the storage locations are laid out like a table', () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="storage-list"></div></body></html>');
  const d = dom.window.document;

  // ladeLagerortVerwaltung() fetches the data from the server itself. What is checked
  // here is the PRODUCED structure, not the fetching — hence only the
  // markup part is executed, with fixed data.
  const quelle = QUELLE.slice(QUELLE.indexOf('export async function ladeLagerortVerwaltung'));
  const ende = quelle.indexOf('\n}\n') + 3;
  const rumpf = quelle.slice(0, ende);
  assert.match(rumpf, /storage-list/, 'Der Abschnitt wurde nicht gefunden');

  const sandbox = {
    document: d,
    G: id => d.getElementById(id),
    ...require('./helpers/markup').markupHelper(),
    echt: () => '',
    ico: n => `<svg class="ico"><use href="#i-${n}"/></svg>`,
    t: (k, v) => k + ' ' + JSON.stringify(v || {}),
    tRaw: k => k,
    loadLocations: async () => {},
    // success: true, otherwise the function turns back right at the start. And the
    // occupancy is keyed on `ort`, not on `name` — exactly Marco's situation:
    // three places with content, one empty, so that the column „Belegung" really
    // gets texts of different lengths.
    api: async (_m, pfad) =>
      pfad.includes('locations')
        ? {
            success: true,
            orte: [
              { id: 1, name: 'Büro' },
              { id: 2, name: 'Estrich' },
              { id: 3, name: 'Zimmer Alessio' },
              { id: 4, name: 'Zimmer Emily' },
            ],
            vorgabe: { id: 2 },
          }
        : {
            success: true,
            orte: [
              { ort: 'Büro', sets: 24, teile: 0, figuren: 0 },
              { ort: 'Estrich', sets: 406, teile: 0, figuren: 0 },
              { ort: 'Zimmer Alessio', sets: 2, teile: 0, figuren: 0 },
            ],
          },
  };
  vm.createContext(sandbox);
  vm.runInContext(rumpf.replace(/^export\s+/, '') + '\nERG = ladeLagerortVerwaltung();', sandbox);
  return sandbox.ERG.then(() => {
    const raster = d.querySelector('#storage-list > div[data-stil*="grid"]');
    assert.ok(
      raster,
      'Es gibt keinen Rasterbehälter — dann richtet sich jede Zeile ' +
        'für sich aus, und die Eingabefelder sind verschieden lang',
    );
    const stil = raster.getAttribute('data-stil');
    assert.match(
      stil,
      /grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+max-content\s+max-content\s+max-content/,
      `Das Raster hat nicht die vier erwarteten Spalten (data-stil="${stil}"). minmax(0,1fr) ` +
        'und nicht 1fr: Ein langer Ortsname sprengte sonst die Spalte.',
    );

    const zeilen = [...raster.children];
    assert.equal(zeilen.length, 4, `${zeilen.length} Zeilen statt 4`);
    for (const z of zeilen) {
      assert.match(
        z.getAttribute('data-stil') || '',
        /display\s*:\s*contents/,
        'Eine Lagerortzeile erzeugt einen eigenen Kasten — damit hat sie wieder ' + 'ihre eigenen Spaltenbreiten',
      );
      assert.equal(
        z.children.length,
        4,
        `Eine Zeile hat ${z.children.length} Zellen statt 4 (Feld, Belegung, Stern, Papierkorb)`,
      );
    }
    // The separator line sat on the row; a display:contents element cannot
    // carry a border. It must lie on the CELLS, otherwise it is gone.
    for (const zelle of zeilen[0].children) {
      assert.match(
        zelle.getAttribute('data-stil') || '',
        /border-bottom/,
        'Eine Zelle trägt keinen Trennstrich — bei display:contents ist die Linie ' +
          'sonst verschwunden, weil die Zeile keinen Kasten mehr hat',
      );
    }
  });
});
