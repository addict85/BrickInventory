/**
 * Set-Detail in jsdom: Ohne Verbindung öffnet der Dialog mit dem, was die Sammlung geladen hat, und
 * sagt es. Die Angaben stehen als Paare in einem <dl>, und im Haushalt ist jede Menge ein <output>
 * mit dem Namen des Kontos.
 *
 * Gegenproben (16.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  in openModal() den Rückgriff auf galerieSets gestrichen → rot: „offline“ (Dialog geht zu)
 *   B  in setDetailHtml() PAAR an Jahr/Thema/Teile gestrichen → rot: „Paare“ (dt/dd ≠ Zeilen)
 *   C  .menge-zahl wieder als <span> → rot: „Haushalt“ (kein output)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, warte } = require('./helpers/ui');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const SET = {
  set_number: '21318-1',
  name: 'Tree House',
  theme: 'Ideas',
  year: 2019,
  pieces: 3036,
  quantity: 2,
  conditions: ['N'],
  added_at: '2026-11-01T10:00:00Z',
  instructions: [],
};

test('offline: Set-Detail aus der geladenen Sammlung, Angaben als Paare', async () => {
  const { w, d } = await openUi({
    '/v1/sets': { success: true, sets: [SET], total: 1, themes: [] },
    '/v1/sets/21318-1': () => {
      throw new TypeError('Failed to fetch');
    },
    '/v1/sets/21318-1/acquisitions': () => {
      throw new TypeError('Failed to fetch');
    },
  });
  try {
    await warte(() => d.querySelector('#gallery [data-click="openModal"]'));
    d.querySelector('#gallery [data-click="openModal"]').click();
    assert.ok(await warte(() => text(d.getElementById('m-tit')) === 'Tree House'), 'offline');
    assert.ok(d.getElementById('set-modal').classList.contains('open'), 'offline: Dialog zu');
    assert.ok([...d.querySelectorAll('#toasts .toast')].some(t => /zuletzt geladenen Stand/.test(t.textContent)));
    const liste = d.querySelector('#m-det dl');
    assert.ok(liste, 'kein dl');
    const zeilen = liste.querySelectorAll(':scope > .dr');
    assert.ok(zeilen.length >= 7, `nur ${zeilen.length} Zeilen`);
    for (const z of zeilen)
      assert.deepEqual(
        [...z.children].map(k => k.tagName),
        ['DT', 'DD'],
        `Paare: ${text(z).slice(0, 30)}`,
      );
    const jahr = [...zeilen].find(z => text(z.querySelector('dt')) === 'Jahr');
    assert.equal(text(jahr?.querySelector('dd')), '2019');
  } finally {
    w.close();
  }
});

test('Haushalt: jede Menge ein output mit dem Konto im Namen', async () => {
  const geteilt = {
    ...SET,
    owners: [
      { id: 1, username: 'anna' },
      { id: 2, username: 'lena' },
    ],
  };
  const { w, d } = await openUi({
    '/v1/sets/household-members': {
      success: true,
      members: [
        { id: 1, username: 'anna', is_self: true, tiefe: 0 },
        { id: 2, username: 'lena', is_self: false, tiefe: 1 },
      ],
    },
    '/v1/sets': { success: true, sets: [geteilt], total: 1, themes: [] },
    '/v1/sets/21318-1': { success: true, set: geteilt },
    '/v1/sets/21318-1/acquisitions': {
      success: true,
      acquisitions: [
        { id: 1, set_number: '21318-1', quantity: 1, condition: 'N', owner_user_id: 1 },
        { id: 2, set_number: '21318-1', quantity: 1, condition: 'N', owner_user_id: 2 },
      ],
    },
  });
  try {
    await warte(() => d.querySelector('#gallery [data-click="openModal"]'));
    d.querySelector('#gallery [data-click="openModal"]').click();
    assert.ok(await warte(() => d.querySelectorAll('#m-menge output.menge-zahl').length === 2), 'Haushalt');
    const namen = [...d.querySelectorAll('#m-menge output.menge-zahl')].map(o => o.getAttribute('aria-label'));
    assert.equal(namen.length, 2);
    assert.match(namen.find(n => /lena/.test(n)) || '', /^Anzahl: lena/);
    assert.ok(
      namen.every(n => /^Anzahl: /.test(n)),
      namen.join(' | '),
    );
  } finally {
    w.close();
  }
});
