/**
 * Set detail in jsdom: without a connection the dialog opens with what the collection has loaded and
 * says so. The details stand as pairs in a <dl>, and in the household every quantity is an <output>
 * with the name of the account.
 *
 * Counter-checks (measured 16.11.2026, each on its own, bundle rebuilt):
 *   A  the fallback to galerieSets deleted in openModal() → red: “offline” (dialog closes)
 *   B  PAAR deleted at year/theme/parts in setDetailHtml() → red: “pairs” (dt/dd ≠ rows)
 *   C  .quantity-number again as <span> → red: “household” (no output)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, waitFor } = require('./helpers/ui');

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

test('offline: set detail from the loaded collection, details as pairs', async () => {
  const { w, d } = await openUi({
    '/v2/sets': { success: true, sets: [SET], total: 1, themes: [] },
    '/v2/sets/21318-1': () => {
      throw new TypeError('Failed to fetch');
    },
    '/v2/sets/21318-1/acquisitions': () => {
      throw new TypeError('Failed to fetch');
    },
  });
  try {
    await waitFor(() => d.querySelector('#gallery [data-click="openModal"]'));
    d.querySelector('#gallery [data-click="openModal"]').click();
    assert.ok(await waitFor(() => text(d.getElementById('m-tit')) === 'Tree House'), 'offline');
    assert.ok(d.getElementById('set-modal').classList.contains('open'), 'offline: Dialog zu');
    assert.ok([...d.querySelectorAll('#toasts .toast')].some(t => /zuletzt geladenen Stand/.test(t.textContent)));
    const list = d.querySelector('#m-det dl');
    assert.ok(list, 'no dl');
    const lines = list.querySelectorAll(':scope > .dr');
    assert.ok(lines.length >= 7, `only ${lines.length} rows`);
    for (const z of lines)
      assert.deepEqual(
        [...z.children].map(k => k.tagName),
        ['DT', 'DD'],
        `Paare: ${text(z).slice(0, 30)}`,
      );
    const year = [...lines].find(z => text(z.querySelector('dt')) === 'Jahr');
    assert.equal(text(year?.querySelector('dd')), '2019');
  } finally {
    w.close();
  }
});

test('household: every quantity an output with the account in the name', async () => {
  const shared = {
    ...SET,
    owners: [
      { id: 1, username: 'anna' },
      { id: 2, username: 'lena' },
    ],
  };
  const { w, d } = await openUi({
    '/v2/sets/household-members': {
      success: true,
      members: [
        { id: 1, username: 'anna', is_self: true, depth: 0 },
        { id: 2, username: 'lena', is_self: false, depth: 1 },
      ],
    },
    '/v2/sets': { success: true, sets: [shared], total: 1, themes: [] },
    '/v2/sets/21318-1': { success: true, set: shared },
    '/v2/sets/21318-1/acquisitions': {
      success: true,
      acquisitions: [
        { id: 1, set_number: '21318-1', quantity: 1, condition: 'N', owner_user_id: 1 },
        { id: 2, set_number: '21318-1', quantity: 1, condition: 'N', owner_user_id: 2 },
      ],
    },
  });
  try {
    await waitFor(() => d.querySelector('#gallery [data-click="openModal"]'));
    d.querySelector('#gallery [data-click="openModal"]').click();
    assert.ok(await waitFor(() => d.querySelectorAll('#m-quantity output.quantity-number').length === 2), 'household');
    const names = [...d.querySelectorAll('#m-quantity output.quantity-number')].map(o => o.getAttribute('aria-label'));
    assert.equal(names.length, 2);
    assert.match(names.find(n => /lena/.test(n)) || '', /^Anzahl: lena/);
    assert.ok(
      names.every(n => /^Anzahl: /.test(n)),
      names.join(' | '),
    );
  } finally {
    w.close();
  }
});
