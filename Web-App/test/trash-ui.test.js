/**
 * Trash in jsdom: identical sets of two accounts differ in account and quantity, also in the name
 * of the buttons; the period says what happens then. After restoring, the focus stands on the
 * neighbor, and the „Rückgängig“ of the same deletion disappears.
 *
 * Counter-checks (measured 16.11.2026, each on its own, bundle rebuilt):
 *   A  in zeile() the quantity deleted from text and button names → red: “account and quantity” (each individually)
 *   B  loadTrash() without focus on the neighbor → red: “focus and toast” (focus on the heading)
 *   C  in papierkorbWiederherstellen() the closing of the toast deleted → red: “focus and toast”
 *      (undo still stands)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, sicht, warte } = require('./helpers/ui');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const SET = {
  set_number: '21318-1',
  name: 'Tree House',
  theme: 'Ideas',
  year: 2019,
  quantity: 1,
  conditions: ['N'],
  added_at: '2026-11-01T10:00:00Z',
  instructions: [],
};
const eintrag = (id, user_id, anzahl) => ({
  id,
  type: 'set',
  number: '21318-1',
  color_id: null,
  label: 'Tree House',
  anzahl,
  user_id,
  deleted_at: '2026-11-15T10:00:00Z',
  endgueltig_am: '2026-12-15T10:00:00Z',
});

function antworten() {
  const korb = [eintrag(7, 1, 1), eintrag(8, 2, 2)];
  return {
    '/v1/sets/household-members': {
      success: true,
      members: [
        { id: 1, username: 'anna', is_self: true, tiefe: 0 },
        { id: 2, username: 'lena', is_self: false, tiefe: 1 },
      ],
    },
    '/v1/sets': { success: true, sets: [SET], total: 1, themes: [] },
    '/v1/sets/21318-1': (_u, o) =>
      o.method === 'DELETE' ? { success: true, papierkorb: [7] } : { success: true, set: SET },
    '/v1/papierkorb': () => ({ success: true, eintraege: korb }),
    '/v1/papierkorb/7/wiederherstellen': () => {
      korb.splice(0, 1);
      return { success: true, type: 'set', number: '21318-1', user_id: 1 };
    },
  };
}

test('account and quantity distinguish equal entries', async () => {
  const { w, d } = await openUi(antworten());
  try {
    await sicht(w, 'daten');
    await warte(() => d.querySelectorAll('#papierkorb-liste .pk-zeile').length === 2);
    const zeilen = [...d.querySelectorAll('#papierkorb-liste .pk-zeile')];
    assert.match(text(zeilen[0]), /Menge 1 · anna \(ich\)/);
    assert.match(text(zeilen[1]), /Menge 2 · lena/);
    assert.match(text(zeilen[0].querySelector('.pk-frist')), /^wird am .+ endgültig gelöscht$/);
    const namen = zeilen.map(z =>
      z.querySelector('[data-click="papierkorbWiederherstellen"]').getAttribute('aria-label'),
    );
    assert.equal(new Set(namen).size, 2, `Knöpfe gleich benannt: ${namen.join(' | ')}`);
    assert.match(namen[1], /^Wiederherstellen: 21318-1 · Tree House · Menge 2 · lena$/);
  } finally {
    w.close();
  }
});

test('focus and toast after restoring in the trash', async () => {
  const { w, d, aufrufe } = await openUi(antworten());
  try {
    await warte(() => d.querySelector('#gallery .sc[data-arg="21318-1"] .delbtn'));
    d.querySelector('#gallery .sc[data-arg="21318-1"] .delbtn').click();
    await warte(() => d.getElementById('confirm-modal').style.display === 'flex');
    d.getElementById('cd-confirm').click();
    assert.ok(await warte(() => d.querySelector('#toasts [data-papierkorb="7"] .toast-aktion')), 'Rückgängig');
    await sicht(w, 'daten');
    await warte(() => d.querySelectorAll('#papierkorb-liste .pk-zeile').length === 2);
    const knopf = d.querySelector('[data-click="papierkorbWiederherstellen"][data-arg="7"]');
    knopf.focus();
    knopf.click();
    await warte(() => aufrufe.some(a => a.url.endsWith('/v1/papierkorb/7/wiederherstellen')));
    await warte(() => d.querySelectorAll('#papierkorb-liste .pk-zeile').length === 1);
    assert.ok(
      await warte(() => d.activeElement?.getAttribute('data-arg') === '8'),
      `Fokus auf ${d.activeElement?.outerHTML?.slice(0, 80) ?? d.activeElement?.tagName}`,
    );
    assert.equal(d.querySelector('#toasts [data-papierkorb]'), null, 'Rückgängig steht noch');
  } finally {
    w.close();
  }
});
