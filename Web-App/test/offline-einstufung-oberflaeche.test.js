/**
 * Offline sperrt die Oberfläche genau die Knöpfe, deren Aktion Serverzustand
 * ändert (SCHREIBENDE_AKTIONEN in verbindung.js); Lesendes bleibt frei.
 * Jede angemeldete Aktion ist genau einmal eingestuft, sonst rot. In jsdom am
 * Bündel aus main.js, das zusätzlich Registry und Einstufung zeigt.
 *
 * Gegenproben (08.11.2026 gemessen, je einzeln, danach zurückgesetzt):
 *   A  'revokeToken' aus SCHREIBENDE_AKTIONEN gestrichen → rot: „jede
 *      angemeldete Aktion ist genau einmal eingestuft“ und „je Aktion ein Knopf“
 *   B  'legeLagerortAn' nach LESENDE_AKTIONEN verschoben → rot: „je Aktion
 *      ein Knopf“
 *   C  schreibt() wieder nach alter Regel (button.bp/.bd, sonst Namens-Regex
 *      SCHREIB_VERBEN) → rot: „je Aktion ein Knopf“, „index.html und Vorlagen“
 *      und „per id verdrahtete Knöpfe“
 *   D  'oeffneReiter' zusätzlich in SCHREIBENDE_AKTIONEN → rot: „genau
 *      einmal eingestuft“ (doppelt) und „je Aktion ein Knopf“ (Lesen gesperrt)
 *   E  data-schreibend an #btn-clr entfernt → rot: „per id verdrahtete
 *      Knöpfe“
 *   F  Klicksperre wieder nur für summary → rot: „index.html und Vorlagen“
 *      (das Löschkreuz der Kachel öffnet offline die Löschabfrage)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'public', 'js');

/** Das Bündel aus main.js, dazu Registry und Einstufung auf window.__einstufung. */
function baueBuendel() {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'));
  const { erlaubteStile } = require(path.join(ROOT, 'scripts', 'build-frontend.js'));
  const ziel = path.join(os.tmpdir(), `offline-einstufung-${process.pid}.js`);
  esbuild.buildSync({
    stdin: {
      contents:
        "import './main.js';\nimport { actionNames } from './registry.js';\n" +
        "import { SCHREIBENDE_AKTIONEN, LESENDE_AKTIONEN } from './verbindung.js';\n" +
        'window.__einstufung = { actionNames, SCHREIBENDE_AKTIONEN, LESENDE_AKTIONEN };\n',
      resolveDir: JS,
      loader: 'js',
      sourcefile: 'einstufung-einstieg.js',
    },
    bundle: true,
    format: 'iife',
    charset: 'utf8',
    outfile: ziel,
    logLevel: 'error',
    define: { __ERLAUBTE_STILE__: JSON.stringify(erlaubteStile()) },
  });
  return ziel;
}

const BUENDEL = baueBuendel();
process.env.TEST_BUENDEL = BUENDEL;
const { oeffneOberflaeche, reiter, sicht, warte } = require('./helpers/oberflaeche');
test.after(() => fs.rmSync(BUENDEL, { force: true }));

const BEDIENT = 'button, input[type=file], .import-menue > summary';
const gesperrt = k => k.dataset.offlineGesperrt === '1';

async function offline(w) {
  Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => false });
  w.dispatchEvent(new w.Event('offline'));
  await warte(() => w.document.documentElement.hasAttribute('data-offline'));
}

const ZEIT = '2026-11-01T10:00:00Z';
const DATEN = {
  '/v1/sets': {
    success: true,
    total: 1,
    themes: [],
    sets: [{ set_number: '10294-1', name: 'Titanic', quantity: 1, year: 2021 }],
  },
  '/v1/wanted': {
    success: true,
    merkposten: [
      { set_number: '99999-1', name: 'Burg', condition: 'N', user_id: 1, marktpreis: 12.5, waehrung: 'EUR' },
    ],
  },
  '/v1/settings/household': {
    success: true,
    is_main: true,
    is_sub: true,
    currency: 'EUR',
    parents: [{ id: 9, username: 'mia' }],
    sub_accounts: [{ id: 7, username: 'ben', is_self: false }],
    open_invites: 0,
    former_links: [],
  },
  '/v1/papierkorb': {
    success: true,
    eintraege: [
      {
        id: 4,
        art: 'set',
        nummer: '42143-1',
        farbe_id: null,
        bezeichnung: 'Ferrari',
        anzahl: 1,
        user_id: 1,
        geloescht_am: ZEIT,
        endgueltig_am: ZEIT,
      },
    ],
  },
  '/v1/settings/tokens': { success: true, tokens: [{ token_id: 't1', label: 'Telefon', aktuell: false }] },
  '/v1/vouchers': {
    success: true,
    vouchers: [{ id: 3, number: '…9012', pin: '•••', amount: 50, currency: 'CHF', hat_pdf: false }],
  },
  '/v1/storage/locations': { success: true, orte: [{ id: 1, name: 'Regal A' }], vorgabe: null },
  '/v1/storage': { success: true, orte: [{ ort: 'Regal A', sets: 2, teile: 0, figuren: 0 }] },
  '/v1/alerts': {
    success: true,
    alerts: [
      {
        set_number: '10294-1',
        name: 'Titanic',
        condition: 'N',
        richtung: 'unter',
        schwelle: 249,
        currency_code: 'EUR',
      },
    ],
  },
};

test('jede angemeldete Aktion ist genau einmal eingestuft', async () => {
  const { w } = await oeffneOberflaeche();
  try {
    const { actionNames, SCHREIBENDE_AKTIONEN: s, LESENDE_AKTIONEN: l } = w.__einstufung;
    const namen = Array.from(actionNames());
    assert.ok(namen.length > 150, `nur ${namen.length} Handler angemeldet — greift die Registry noch?`);
    assert.deepEqual(
      namen.filter(n => !s.has(n) && !l.has(n)),
      [],
      'nicht eingestuft: in verbindung.js eintragen',
    );
    assert.deepEqual(
      [...s, ...l].filter(n => !namen.includes(n)),
      [],
      'eingestuft, aber nicht angemeldet',
    );
    assert.deepEqual(
      [...s].filter(n => l.has(n)),
      [],
      'doppelt eingestuft',
    );
  } finally {
    w.close();
  }
});

test('je Aktion ein Knopf: offline gesperrt sind genau die schreibenden', async () => {
  const { w, d } = await oeffneOberflaeche();
  try {
    const { actionNames, SCHREIBENDE_AKTIONEN: s } = w.__einstufung;
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
      .map(k => `${k.getAttribute('data-click')}: ${gesperrt(k) ? 'gesperrt' : 'frei'}`);
    assert.deepEqual(falsch, []);
    // Die Aktionen, die die alte Namensregel verfehlte, und Lesen, das frei bleiben muss.
    const knopf = n => kasten.querySelector(`[data-click="${n}"]`);
    for (const n of [
      'legeLagerortAn',
      'createHouseholdInvite',
      'redeemHouseholdInvite',
      'unlinkFromParent',
      'unlinkHousehold',
      'papierkorbEndgueltig',
      'papierkorbLeeren',
      'revokeToken',
      'redownloadInstr',
      'retryBricksetQueueEntry',
      'katalogAufMerkliste',
      'wantedXmlSchreiben',
      'plFuelleBestand',
      'openRpw',
      'oeffneErfassen',
    ])
      assert.equal(knopf(n).disabled, true, n);
    for (const n of [
      'oeffneReiter',
      'filterUmschalten',
      'closeModal',
      'rbHinweisOeffnen',
      'gutscheinKopieren',
      'loadGallery',
      'plGenerate',
    ])
      assert.equal(knopf(n).disabled, false, n);
  } finally {
    w.close();
  }
});

test('index.html und Vorlagen: offline genau die schreibenden gesperrt', async () => {
  const { w, d, aufrufe, ruhig } = await oeffneOberflaeche(DATEN);
  try {
    const { SCHREIBENDE_AKTIONEN: s } = w.__einstufung;
    await warte(() => d.querySelector('#gallery .sc'));
    await reiter(w, 'wanted');
    await warte(() => d.querySelector('.mk-zeile'));
    for (const [name, zeichen] of [
      ['haushalt', '[data-click="unlinkFromParent"]'],
      ['daten', '[data-click="papierkorbEndgueltig"]'],
      ['app', '[data-click="revokeToken"]'],
      ['gutscheine', '[data-click="gutscheinLoeschen"]'],
      ['lagerorte', '[data-click="loescheLagerort"]'],
    ]) {
      await sicht(w, name);
      assert.ok(await warte(() => d.querySelector(zeichen)), `${name}: ${zeichen} nicht gezeichnet`);
    }
    const vorher = new Set([...d.querySelectorAll(BEDIENT)].filter(k => k.disabled));
    await offline(w);
    // Danach Gezeichnetes sperrt der Beobachter.
    await sicht(w, 'alarme');
    assert.ok(
      await warte(() => d.querySelector('#alerts-list [data-click="loescheAlarm"]')),
      'alarme nicht gezeichnet',
    );

    const knoepfe = [...d.querySelectorAll('[data-click]')].filter(
      k => !vorher.has(k) && !k.closest('#login-screen, .toast'),
    );
    const namen = new Set(knoepfe.map(k => k.getAttribute('data-click')));
    for (const n of [
      'legeLagerortAn',
      'createHouseholdInvite',
      'redeemHouseholdInvite',
      'unlinkFromParent',
      'unlinkHousehold',
      'papierkorbEndgueltig',
      'papierkorbLeeren',
      'revokeToken',
      'katalogAufMerkliste',
      'wantedXmlSchreiben',
      'plFuelleBestand',
      'loescheAlarm',
      'delSetStop',
      'merkpostenLoeschenStop',
    ])
      assert.ok(namen.has(n), `${n} kommt in den gezeichneten Knöpfen nicht vor`);
    assert.ok([...namen].filter(n => !s.has(n)).length > 40, 'zu wenig lesende Knöpfe gezeichnet');
    const falsch = knoepfe
      .filter(k => gesperrt(k) !== s.has(k.getAttribute('data-click')))
      .map(k => `${k.getAttribute('data-click')}${k.id ? '#' + k.id : ''}: ${gesperrt(k) ? 'gesperrt' : 'frei'}`);
    assert.deepEqual(falsch, []);
    // Das Löschkreuz der Kachel ist ein <span> ohne disabled: Der Klick darf nichts auslösen.
    const vorAufrufe = aufrufe.length;
    await reiter(w, 'gallery');
    d.querySelector('#gallery .delbtn[data-click="delSetStop"]').click();
    await ruhig();
    assert.equal(d.getElementById('confirm-modal').style.display === 'flex', false, 'Löschabfrage geöffnet');
    assert.deepEqual(
      aufrufe.slice(vorAufrufe).filter(a => a.method !== 'GET'),
      [],
      'offline geschrieben',
    );
  } finally {
    w.close();
  }
});

test('per id verdrahtete Knöpfe: data-schreibend sperrt, sonst frei', async () => {
  const { w, d } = await oeffneOberflaeche();
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
    assert.equal(d.getElementById('btn-login').disabled, false, 'Anmeldung bleibt frei');
  } finally {
    w.close();
  }
});
