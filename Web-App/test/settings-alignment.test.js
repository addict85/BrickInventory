/**
 * The settings align their columns with each other, not with the text length.
 *
 * ── Counter-checks (carried out) ──────────────────────────────────────────────
 *
 *   a) the grid moved from the list back to the row → cases 2 and 3 red.
 *   b) margin-top removed on the link button → case 1 red.
 *   c) (14.11.2026) .account-footer without margin-top → case 1 red.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const QUELLE = require('./helpers/sources').ansichtQuelle('settings');
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
function runFrom(functionName, environment) {
  const start = QUELLE.indexOf(`function ${functionName}(`);
  assert.ok(start > 0, `${functionName}() is no longer in the files of the „einstellungen“ view`);
  // Up to the bracket in column 0 — that is how these files are written.
  const ende = QUELLE.indexOf('\n}\n', start) + 3;
  const code = withoutModule(QUELLE.slice(start, ende));
  const sandbox = { ...environment };
  vm.createContext(sandbox);
  vm.runInContext(code + `\n${functionName}(ARG);`, sandbox);
  return sandbox;
}

/** Minimal scaffold: only what the two producers really touch. */
function rack(dom, targetId) {
  const d = dom.window.document;
  return {
    document: d,
    G: id => d.getElementById(id),
    ...require('./helpers/markup').markupHelper(),
    genuine: () => '',
    t: (k, v) => k + (v ? ' ' + JSON.stringify(v) : ''),
    tRaw: k => k,
    ZIEL: targetId,
  };
}

test('spacing between invitation code and link button', () => {
  const d = new JSDOM(HTML).window.document;
  const knopf = d.querySelector('[data-click="redeemHouseholdInvite"]');
  assert.ok(knopf, 'The link button can no longer be found');
  // Since UI check 22 it stands in the footer of the menu pages (.account-footer, margin-top:.75rem).
  const css = fs.readFileSync(path.join(ROOT, 'public', 'styles.css'), 'utf8');
  assert.ok(knopf.parentElement?.classList.contains('account-footer'), 'The button is not in .account-footer');
  assert.match(
    css,
    /\.account-footer\{[^}]*margin-top:\.?\d/,
    "The footer has no top margin; the button then stuck to the input field above — Marco's screenshot.",
  );
});

test('the linked accounts are in two columns, not new per row', () => {
  const dom = new JSDOM(
    '<!doctype html><html><body>' +
      '<div id="household-state"></div><div id="household-invite-box"></div>' +
      '<div id="household-redeem-box"></div></body></html>',
  );
  const env = rack(dom);
  env.ARG = {
    is_sub: false,
    currency: 'CHF',
    sub_accounts: [
      { id: 1, username: 'emily.bigolin' },
      { id: 2, username: 'alessio.bigolin' },
      { id: 3, username: 'eliano.bigolin' },
    ],
  };
  runFrom('renderHousehold', env);

  const liste = dom.window.document.querySelector('#household-state ul');
  assert.ok(liste, 'The list of linked accounts was not created');
  // The grid stands in styles.css (.household-list); minmax(0, …) lets the
  // columns shrink at large font sizes instead of widening the page.
  assert.ok(liste.classList.contains('household-list'), 'The list does not carry the class household-list');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  const stil = (css.match(/\n\.household-list\{([^}]*)\}/) || [])[1] || '';
  assert.match(
    stil,
    /display\s*:\s*grid/,
    `The LIST carries no grid („${stil}“) — then every row aligns ` + 'on its own, and the buttons are staggered.',
  );
  assert.match(
    stil,
    /grid-template-columns\s*:\s*minmax\(0,\s*max-content\)\s+minmax\(0,\s*max-content\)/,
    'The list does not have two content columns — without them the rows share ' + 'no common width',
  );

  const zeilen = [...liste.querySelectorAll('li')];
  assert.equal(zeilen.length, 3, `${zeilen.length} rows instead of 3`);
  for (const li of zeilen) {
    assert.match(
      li.getAttribute('data-style') || '',
      /display\s*:\s*contents/,
      'A row creates a box of its own — then its cells are NOT ' +
        'in the columns of the list, and the alignment is gone again',
    );
  }
  // And every row delivers exactly two cells — otherwise the columns shift
  // from the first row that is built differently.
  for (const li of zeilen) {
    assert.equal(
      li.children.length,
      2,
      `A row has ${li.children.length} cells instead of 2 — with display:contents ` +
        'every cell counts separately in the grid, one too many shifts everything after it',
    );
  }
  assert.equal(
    liste.querySelectorAll('[data-click="unlinkHousehold"]').length,
    3,
    'Not every row has its remove button',
  );
});

test('the storage locations are laid out like a table', () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="storage-list"></div></body></html>');
  const d = dom.window.document;

  // loadLocationManagement() fetches the data from the server itself. What is checked
  // here is the PRODUCED structure, not the fetching — hence only the
  // markup part is executed, with fixed data.
  const source = QUELLE.slice(QUELLE.indexOf('export async function loadLocationManagement'));
  const ende = source.indexOf('\n}\n') + 3;
  const rumpf = source.slice(0, ende);
  assert.match(rumpf, /storage-list/, 'The section was not found');

  const sandbox = {
    document: d,
    G: id => d.getElementById(id),
    ...require('./helpers/markup').markupHelper(),
    genuine: () => '',
    ico: n => `<svg class="ico"><use href="#i-${n}"/></svg>`,
    t: (k, v) => k + ' ' + JSON.stringify(v || {}),
    tRaw: k => k,
    loadLocations: async () => {},
    // success: true, otherwise the function turns back right at the start. And the
    // occupancy is keyed on `ort`, not on `name` — exactly Marco's situation:
    // three places with content, one empty, so that the column „Belegung" really
    // gets texts of different lengths.
    api: async (_m, path) =>
      path.includes('locations')
        ? {
            success: true,
            locations: [
              { id: 1, name: 'Büro' },
              { id: 2, name: 'Estrich' },
              { id: 3, name: 'Zimmer Alessio' },
              { id: 4, name: 'Zimmer Emily' },
            ],
            preset: { id: 2 },
          }
        : {
            success: true,
            locations: [
              { location: 'Büro', sets: 24, parts: 0, minifigs: 0 },
              { location: 'Estrich', sets: 406, parts: 0, minifigs: 0 },
              { location: 'Zimmer Alessio', sets: 2, parts: 0, minifigs: 0 },
            ],
          },
  };
  vm.createContext(sandbox);
  vm.runInContext(rumpf.replace(/^export\s+/, '') + '\nERG = loadLocationManagement();', sandbox);
  return sandbox.ERG.then(() => {
    const raster = d.querySelector('#storage-list > div[data-style*="grid"]');
    assert.ok(
      raster,
      'There is no grid container — then every row aligns ' + 'on its own, and the input fields have different lengths',
    );
    const stil = raster.getAttribute('data-style');
    assert.match(
      stil,
      /grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+max-content\s+max-content\s+max-content/,
      `The grid does not have the four expected columns (data-style="${stil}"). minmax(0,1fr) ` +
        'and not 1fr: a long location name would otherwise burst the column.',
    );

    const zeilen = [...raster.children];
    assert.equal(zeilen.length, 4, `${zeilen.length} rows instead of 4`);
    for (const z of zeilen) {
      assert.match(
        z.getAttribute('data-style') || '',
        /display\s*:\s*contents/,
        'A location row creates a box of its own — then it has ' + 'its own column widths again',
      );
      assert.equal(
        z.children.length,
        4,
        `A row has ${z.children.length} cells instead of 4 (field, usage, star, trash can)`,
      );
    }
    // The separator line sat on the row; a display:contents element cannot
    // carry a border. It must lie on the CELLS, otherwise it is gone.
    for (const zelle of zeilen[0].children) {
      assert.match(
        zelle.getAttribute('data-style') || '',
        /border-bottom/,
        'A cell carries no divider — with display:contents the line ' +
          'is otherwise gone, because the row no longer has a box',
      );
    }
  });
});
