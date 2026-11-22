/**
 * On a slow network the UI shows immediately that something is coming: the
 * set detail opens right away with a placeholder, the wishlist shows
 * placeholder rows – before, both stayed empty or closed until the response.
 *
 * Counter-checks (measured 02.11.2026, each on its own):
 *   A  the immediate opening removed in openModal() → red: “set detail …”
 *      (dialog closed before the response)
 *   B  the placeholder rows removed in loadWanted() → red: “wishlist …”
 *   C  run check removed in openModal() → red: “set detail: closed
 *      stays closed” (dialog opened again after the response)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter, takt, warte } = require('./helpers/ui');

const SET = {
  success: true,
  set: { set_number: '10294-1', name: 'Titanic', quantity: 1, instructions: [], owners: [] },
};
const spaeter =
  (response, ms = 400) =>
  () =>
    new Promise(r => setTimeout(() => r(response), ms));

async function detail(o) {
  const k = o.d.createElement('button');
  k.dataset.click = 'openModal';
  k.dataset.arg = '10294-1';
  o.d.body.append(k);
  k.click();
  await takt(30);
}

test('set detail opens immediately with a placeholder', async () => {
  const o = await openUi({
    '/v2/sets/10294-1': spaeter(SET),
    '/v2/sets/10294-1/acquisitions': { success: true, acquisitions: [] },
  });
  try {
    await detail(o);
    assert.equal(o.d.getElementById('set-modal').classList.contains('open'), true, 'Dialog vor der Antwort zu');
    assert.ok(o.d.querySelector('#m-det .skeleton-list[aria-busy="true"]'), 'kein Platzhalter');
    assert.equal(o.d.getElementById('m-tit').textContent, '10294-1');
    await warte(() => o.d.getElementById('m-tit').textContent === 'Titanic');
    assert.equal(o.d.querySelector('#m-det .skeleton-list'), null, 'Platzhalter blieb stehen');
  } finally {
    o.w.close();
  }
});

test('set detail: closed stays closed', async () => {
  const o = await openUi({
    '/v2/sets/10294-1': spaeter(SET),
    '/v2/sets/10294-1/acquisitions': { success: true, acquisitions: [] },
  });
  try {
    await detail(o);
    o.d.getElementById('set-modal').classList.remove('open');
    assert.ok(await o.ruhig(), 'die Antwort kam nicht');
    assert.equal(o.d.getElementById('set-modal').classList.contains('open'), false);
  } finally {
    o.w.close();
  }
});

test('wishlist shows placeholder rows until the list is there', async () => {
  const liste = {
    success: true,
    item: [{ set_number: '10276-1', condition: 'N', name: 'Kolosseum', added_at: '2026-10-01T00:00:00Z' }],
  };
  const o = await openUi({ '/v2/wanted': spaeter(liste) });
  try {
    await reiter(o.w, 'wanted');
    assert.ok(o.d.querySelector('#mk-list .skeleton-list[aria-busy="true"]'), 'keine Platzhalter');
    await warte(() => o.d.querySelector('#mk-list .mk-row'));
    assert.equal(o.d.querySelector('#mk-list .skeleton-list'), null);
  } finally {
    o.w.close();
  }
});
