/**
 * Offline the UI locks exactly the buttons whose action changes server state
 * (WRITING_ACTIONS in verbindung.js); reading stays free.
 * Every registered action is classified exactly once, otherwise red. In jsdom on the
 * bundle from main.js, which additionally exposes registry and classification.
 *
 * Counter-checks (measured 08.11.2026, each on its own, reset afterwards):
 *   A  'revokeToken' deleted from WRITING_ACTIONS → red: “every
 *      registered action is classified exactly once” and “one button per action”
 *   B  'createLocation' moved to READING_ACTIONS → red: “one button per
 *      action”
 *   C  schreibt() again by the old rule (button.bp/.bd, otherwise name regex
 *      SCHREIB_VERBEN) → red: “one button per action”, “index.html and templates”
 *      and “buttons wired by id”
 *   D  'openTab' additionally in WRITING_ACTIONS → red: “exactly
 *      once classified” (twice) and “one button per action” (reading locked)
 *   E  data-writing removed on #btn-clr → red: “buttons wired by
 *      id”
 *   F  click lock again only for summary → red: “index.html and templates”
 *      (the delete cross of the tile opens the delete prompt offline)
 *   G  (22.11.2026) SERVED again without [data-change], [data-input] → red: “index.html and
 *      templates” (autosave fields such as the alert threshold stay free offline)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'public', 'js');

/** The bundle from main.js, plus registry and classification on window.__rating. */
function buildBundle() {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'));
  const { allowedStyles } = require(path.join(ROOT, 'scripts', 'build-frontend.js'));
  const ziel = path.join(os.tmpdir(), `offline-einstufung-${process.pid}.js`);
  esbuild.buildSync({
    stdin: {
      contents:
        "import './main.js';\nimport { actionNames } from './registry.js';\n" +
        "import { WRITING_ACTIONS, READING_ACTIONS } from './connection.js';\n" +
        'window.__rating = { actionNames, WRITING_ACTIONS, READING_ACTIONS };\n',
      resolveDir: JS,
      loader: 'js',
      sourcefile: 'einstufung-einstieg.js',
    },
    bundle: true,
    format: 'iife',
    charset: 'utf8',
    outfile: ziel,
    logLevel: 'error',
    define: { __ALLOWED_STYLES__: JSON.stringify(allowedStyles()) },
  });
  return ziel;
}

const BUNDLE_FILE = buildBundle();
process.env.TEST_BUENDEL = BUNDLE_FILE;
const { openUi, reiter, sicht, warte } = require('./helpers/ui');
test.after(() => fs.rmSync(BUNDLE_FILE, { force: true }));

const SERVED = 'button, input[type=file], .import-menu > summary';
const gesperrt = k => k.dataset.offlineLocked === '1';

async function offline(w) {
  Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => false });
  w.dispatchEvent(new w.Event('offline'));
  await warte(() => w.document.documentElement.hasAttribute('data-offline'));
}

const TIME = '2026-11-01T10:00:00Z';
const DATA = {
  '/v2/sets': {
    success: true,
    total: 1,
    themes: [],
    sets: [{ set_number: '10294-1', name: 'Titanic', quantity: 1, year: 2021 }],
  },
  '/v2/wanted': {
    success: true,
    item: [{ set_number: '99999-1', name: 'Burg', condition: 'N', user_id: 1, market_price: 12.5, currency: 'EUR' }],
  },
  '/v2/settings/household': {
    success: true,
    is_main: true,
    is_sub: true,
    currency: 'EUR',
    parents: [{ id: 9, username: 'mia' }],
    sub_accounts: [{ id: 7, username: 'ben', is_self: false }],
    open_invites: 0,
    former_links: [],
  },
  '/v2/trash': {
    success: true,
    entries: [
      {
        id: 4,
        kind: 'set',
        number: '42143-1',
        farbe_id: null,
        bezeichnung: 'Ferrari',
        count: 1,
        user_id: 1,
        geloescht_am: TIME,
        purge_at: TIME,
      },
    ],
  },
  '/v2/settings/tokens': { success: true, tokens: [{ token_id: 't1', label: 'Telefon', current: false }] },
  '/v2/vouchers': {
    success: true,
    vouchers: [{ id: 3, number: '…9012', pin: '•••', amount: 50, currency: 'CHF', has_pdf: false }],
  },
  '/v2/storage/locations': { success: true, locations: [{ id: 1, name: 'Regal A' }], preset: null },
  '/v2/storage': { success: true, locations: [{ location: 'Regal A', sets: 2, parts: 0, minifigs: 0 }] },
  '/v2/alerts': {
    success: true,
    alerts: [
      {
        set_number: '10294-1',
        name: 'Titanic',
        condition: 'N',
        direction: 'below',
        threshold: 249,
        currency_code: 'EUR',
      },
    ],
  },
};

test('every registered action is classified exactly once', async () => {
  const { w } = await openUi();
  try {
    const { actionNames, WRITING_ACTIONS: s, READING_ACTIONS: l } = w.__rating;
    const namen = Array.from(actionNames());
    assert.ok(namen.length > 150, `only ${namen.length} handlers registered — does the registry still work?`);
    assert.deepEqual(
      namen.filter(n => !s.has(n) && !l.has(n)),
      [],
      'not classified: add it in verbindung.js',
    );
    assert.deepEqual(
      [...s, ...l].filter(n => !namen.includes(n)),
      [],
      'classified but not registered',
    );
    assert.deepEqual(
      [...s].filter(n => l.has(n)),
      [],
      'classified twice',
    );
  } finally {
    w.close();
  }
});

test('one button per action: exactly the writing ones are locked offline', async () => {
  const { w, d } = await openUi();
  try {
    const { actionNames, WRITING_ACTIONS: s } = w.__rating;
    const kasten = d.createElement('div');
    for (const n of actionNames()) {
      const k = d.createElement('button');
      k.setAttribute('data-click', n);
      kasten.appendChild(k);
    }
    d.getElementById('app').appendChild(kasten);
    await offline(w);
    const falsch = [...kasten.children]
      .filter(k => gesperrt(k) !== s.has(k.getAttribute('data-click')))
      .map(k => `${k.getAttribute('data-click')}: ${gesperrt(k) ? 'gesperrt' : 'free'}`);
    assert.deepEqual(falsch, []);
    // The actions the old name rule missed, and reading that must stay free.
    const knopf = n => kasten.querySelector(`[data-click="${n}"]`);
    for (const n of [
      'createLocation',
      'createHouseholdInvite',
      'redeemHouseholdInvite',
      'unlinkFromParent',
      'unlinkHousehold',
      'deleteFromTrashPermanently',
      'emptyTrash',
      'revokeToken',
      'redownloadInstr',
      'retryBricksetQueueEntry',
      'catalogToWanted',
      'writeWantedXml',
      'plFillStock',
      'openRpw',
      'openCapture',
    ])
      assert.equal(knopf(n).disabled, true, n);
    for (const n of ['openTab', 'toggleFilter', 'closeModal', 'openRbHint', 'copyVoucher', 'loadGallery', 'plGenerate'])
      assert.equal(knopf(n).disabled, false, n);
  } finally {
    w.close();
  }
});

test('index.html and templates: exactly the writing ones locked offline', async () => {
  const { w, d, aufrufe, ruhig } = await openUi(DATA);
  try {
    const { WRITING_ACTIONS: s } = w.__rating;
    await warte(() => d.querySelector('#gallery .sc'));
    await reiter(w, 'wanted');
    await warte(() => d.querySelector('.mk-row'));
    for (const [name, zeichen] of [
      ['household', '[data-click="unlinkFromParent"]'],
      ['data', '[data-click="deleteFromTrashPermanently"]'],
      ['app', '[data-click="revokeToken"]'],
      ['vouchers', '[data-click="deleteVoucher"]'],
      ['locations', '[data-click="deleteLocation"]'],
    ]) {
      await sicht(w, name);
      assert.ok(await warte(() => d.querySelector(zeichen)), `${name}: ${zeichen} not marked`);
    }
    const vorher = new Set([...d.querySelectorAll(SERVED)].filter(k => k.disabled));
    await offline(w);
    // What is drawn afterwards is locked by the observer.
    await sicht(w, 'alerts');
    assert.ok(await warte(() => d.querySelector('#alerts-list [data-click="deleteAlert"]')), 'alarms not marked');

    const buttonList = [...d.querySelectorAll('[data-click]')].filter(
      k => !vorher.has(k) && !k.closest('#login-screen, .toast'),
    );
    const namen = new Set(buttonList.map(k => k.getAttribute('data-click')));
    for (const n of [
      'createLocation',
      'createHouseholdInvite',
      'redeemHouseholdInvite',
      'unlinkFromParent',
      'unlinkHousehold',
      'deleteFromTrashPermanently',
      'emptyTrash',
      'revokeToken',
      'catalogToWanted',
      'writeWantedXml',
      'plFillStock',
      'deleteAlert',
      'delSetStop',
      'stopDeleteWantedItem',
    ])
      assert.ok(namen.has(n), `${n} does not occur among the marked buttons`);
    assert.ok([...namen].filter(n => !s.has(n)).length > 40, 'too few reading buttons marked');
    // A field that saves on change counts like a writing button, whatever its data-click does.
    const writes = k => ['data-click', 'data-change', 'data-input'].some(a => s.has(k.getAttribute(a)));
    const falsch = buttonList
      .filter(k => gesperrt(k) !== writes(k))
      .map(k => `${k.getAttribute('data-click')}${k.id ? '#' + k.id : ''}: ${gesperrt(k) ? 'gesperrt' : 'free'}`);
    assert.deepEqual(falsch, []);
    // Autosave fields (alert threshold and the like) are locked as well, reading filters stay free.
    const felder = [
      ...d.querySelectorAll('input:not([type=file])[data-change], select[data-change], input[data-input]'),
    ].filter(k => !vorher.has(k) && !k.closest('#login-screen'));
    const writers = felder.filter(k => s.has(k.getAttribute('data-change') || k.getAttribute('data-input')));
    assert.ok(writers.length > 0, 'no saving field marked');
    assert.deepEqual(
      felder
        .filter(k => k.disabled !== writers.includes(k))
        .map(k => `${k.id || k.getAttribute('data-change')}: ${k.disabled ? 'gesperrt' : 'free'}`),
      [],
    );
    // The delete cross of the tile is a <span> without disabled: the click must trigger nothing.
    const beforeCalls = aufrufe.length;
    await reiter(w, 'gallery');
    d.querySelector('#gallery .delbtn[data-click="delSetStop"]').click();
    await ruhig();
    assert.equal(d.getElementById('confirm-modal').style.display === 'flex', false, 'delete prompt opened');
    assert.deepEqual(
      aufrufe.slice(beforeCalls).filter(a => a.method !== 'GET'),
      [],
      'written while offline',
    );
  } finally {
    w.close();
  }
});

test('buttons wired by id: data-writing locks, otherwise free', async () => {
  const { w, d } = await openUi();
  try {
    await offline(w);
    for (const id of [
      'btn-clr',
      'btn-job-trigger',
      'btn-add',
      'btn-md',
      'btn-sav-prof',
      'cd-confirm',
      'man-detail-del',
      'btn-test-smtp',
      'btn-cancel-import',
    ])
      assert.equal(d.getElementById(id).disabled, true, id);
    for (const id of ['btn-cfg-export', 'btn-logout', 'vg', 'cd-cancel'])
      assert.equal(d.getElementById(id).disabled, false, id);
    assert.equal(d.getElementById('btn-login').disabled, false, 'login stays free');
  } finally {
    w.close();
  }
});
