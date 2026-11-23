/**
 * The owner label only stands where ANOTHER account of the household is
 * involved; the own collection carries none. And the header number is called
 * „Anleitungen“, not „Anleit.“. Checked on the real bundle in jsdom.
 *
 * Counter-checks (measured on 28.10.):
 *   A  the exception for own entries removed in ownerBadges() → red:
 *      “own sets without a label”
 *   B  ownerBadges() always returns '' → red: “the child's set carries its name”
 *   C  (13.11.2026) ownerBadges() again with o.username instead of accountDisplay() → red:
 *      “the child's set carries its name” („anna“ instead of „anna (ich)“)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, waitFor } = require('./helpers/ui');

const SET = (nr, name, owners) => ({ set_number: nr, name, quantity: 1, conditions: ['N'], instructions: [], owners });
const ANNA = { id: 1, username: 'anna' },
  EMILY = { id: 3, username: 'emily' };

async function gallery() {
  const o = await openUi({
    '/v2/sets/household-members': {
      success: true,
      members: [
        { ...ANNA, is_self: true, depth: 0 },
        { ...EMILY, is_self: false, depth: 1 },
      ],
    },
    '/v2/sets': {
      success: true,
      total: 3,
      themes: [],
      sets: [
        SET('10294-1', 'Titanic', [ANNA]),
        SET('42143-1', 'Ferrari', [EMILY]),
        SET('75192-1', 'Falke', [ANNA, EMILY]),
      ],
    },
  });
  await waitFor(() => o.d.querySelectorAll('#gallery .sc').length === 3);
  return o;
}
const labels = (d, nr) =>
  [...d.querySelector(`#gallery .sc[data-arg="${nr}"]`).querySelectorAll('.owner-badge')].map(e => e.textContent);

test('own sets without a label', async () => {
  const { w, d } = await gallery();
  try {
    assert.deepEqual(labels(d, '10294-1'), []);
  } finally {
    w.close();
  }
});

test("the child's set carries its name, a shared one both", async () => {
  const { w, d } = await gallery();
  try {
    assert.deepEqual(labels(d, '42143-1'), ['emily']);
    assert.deepEqual(labels(d, '75192-1'), ['anna (ich)', 'emily']);
  } finally {
    w.close();
  }
});

test('the metric is called instructions', async () => {
  const { w, d } = await openUi({});
  try {
    const l = d.getElementById('bstat-instr').parentElement.querySelector('.bstat-l');
    assert.equal(l.textContent, 'Anleitungen');
  } finally {
    w.close();
  }
});
