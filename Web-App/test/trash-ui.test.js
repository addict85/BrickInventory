/**
 * Trash in jsdom: identical sets of two accounts differ in account and quantity, also in the name
 * of the buttons; the period says what happens then. After restoring, the focus stands on the
 * neighbor, and the „Rückgängig“ of the same deletion disappears.
 *
 * Counter-checks (measured 16.11.2026, each on its own, bundle rebuilt):
 *   A  in zeile() the quantity deleted from text and button names → red: “account and quantity” (each individually)
 *   B  loadTrash() without focus on the neighbor → red: “focus and toast” (focus on the heading)
 *   C  in restoreFromTrash() the closing of the toast deleted → red: “focus and toast”
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
const entryRow = (id, user_id, count) => ({
  id,
  type: 'set',
  number: '21318-1',
  color_id: null,
  label: 'Tree House',
  count,
  user_id,
  deleted_at: '2026-11-15T10:00:00Z',
  purge_at: '2026-12-15T10:00:00Z',
});

function antworten() {
  const basket = [entryRow(7, 1, 1), entryRow(8, 2, 2)];
  return {
    '/v2/sets/household-members': {
      success: true,
      members: [
        { id: 1, username: 'anna', is_self: true, depth: 0 },
        { id: 2, username: 'lena', is_self: false, depth: 1 },
      ],
    },
    '/v2/sets': { success: true, sets: [SET], total: 1, themes: [] },
    '/v2/sets/21318-1': (_u, o) =>
      o.method === 'DELETE' ? { success: true, trash: [7] } : { success: true, set: SET },
    '/v2/trash': () => ({ success: true, entries: basket }),
    '/v2/trash/7/restore': () => {
      basket.splice(0, 1);
      return { success: true, type: 'set', number: '21318-1', user_id: 1 };
    },
  };
}

test('account and quantity distinguish equal entries', async () => {
  const { w, d } = await openUi(antworten());
  try {
    await sicht(w, 'data');
    await warte(() => d.querySelectorAll('#trash-list .pk-row').length === 2);
    const zeilen = [...d.querySelectorAll('#trash-list .pk-row')];
    assert.match(text(zeilen[0]), /Menge 1 · anna \(ich\)/);
    assert.match(text(zeilen[1]), /Menge 2 · lena/);
    assert.match(text(zeilen[0].querySelector('.pk-deadline')), /^wird am .+ endgültig gelöscht$/);
    const namen = zeilen.map(z => z.querySelector('[data-click="restoreFromTrash"]').getAttribute('aria-label'));
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
    assert.ok(await warte(() => d.querySelector('#toasts [data-trash="7"] .toast-action')), 'Rückgängig');
    await sicht(w, 'data');
    await warte(() => d.querySelectorAll('#trash-list .pk-row').length === 2);
    const knopf = d.querySelector('[data-click="restoreFromTrash"][data-arg="7"]');
    knopf.focus();
    knopf.click();
    await warte(() => aufrufe.some(a => a.url.endsWith('/v2/trash/7/restore')));
    await warte(() => d.querySelectorAll('#trash-list .pk-row').length === 1);
    assert.ok(
      await warte(() => d.activeElement?.getAttribute('data-arg') === '8'),
      `Fokus auf ${d.activeElement?.outerHTML?.slice(0, 80) ?? d.activeElement?.tagName}`,
    );
    assert.equal(d.querySelector('#toasts [data-trash]'), null, 'Rückgängig steht noch');
  } finally {
    w.close();
  }
});
