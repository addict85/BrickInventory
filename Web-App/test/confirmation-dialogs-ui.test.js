/**
 * The former re-confirmation routes ask for no password or code in the UI: a login
 * is enough (owner's decision, docs/SICHERHEIT.md). Destructive steps keep a plain
 * "are you sure?" without a password field; showing a voucher runs right away.
 * Real bundle in jsdom.
 *
 * Counter-checks (measured 26.11.2026, each alone, bundle rebuilt):
 *   A  in settings.js "delete everything" sends `{ password: 'x' }` again → red:
 *      “delete everything asks only yes or no” (the body carries a password)
 *   B  in trash.js emptyTrash() without confirmDelete() → red: “emptying the
 *      trash asks only yes or no” (no dialog appears)
 *   C  in vouchers.js fetchPlaintext() behind confirmDelete() again → red:
 *      “number and PIN appear without a dialog”
 *   D  in index.html the password field `cd-pw` back into the dialog → red:
 *      every “… asks only yes or no” (“the dialog has no password field”)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, waitFor, tick, view } = require('./helpers/ui');

/** Remembers every body and answers like the server after the decision.
 * @param {unknown[]} list @param {Record<string, unknown>} [answer] */
function recording(list, answer = { success: true, sets: 0, parts: 0, minifigs: 0 }) {
  return (_url, o) => {
    list.push(o?.body ? JSON.parse(o.body) : null);
    return answer;
  };
}

/** The plain question: it appears, has no password or code field, and is answered with yes. */
async function sayYes(d) {
  const modal = d.getElementById('confirm-modal');
  assert.ok(await waitFor(() => modal.style.display === 'flex'), 'the question appears');
  assert.equal(modal.querySelector('input[type="password"]'), null, 'the dialog has no password field');
  assert.equal(modal.querySelector('[autocomplete="one-time-code"]'), null, 'the dialog has no code field');
  d.getElementById('cd-confirm').click();
  await tick(20);
}

test('delete everything asks only yes or no', async () => {
  const calls = [];
  const { w, d } = await openUi({ '/v2/inventory': recording(calls) });
  try {
    d.getElementById('btn-dall').click();
    await sayYes(d);
    assert.ok(await waitFor(() => calls.length === 1), `${calls.length} request(s)`);
    assert.deepEqual(calls, [null], 'the request carries no password');
  } finally {
    w.close();
  }
});

test('creating an account sends no administrator password', async () => {
  const calls = [];
  const { w, d } = await openUi({
    '/v2/auth/users': (url, o) => (o?.method === 'POST' ? recording(calls)(url, o) : { success: true, users: [] }),
  });
  try {
    d.getElementById('nu-n').value = 'bert';
    d.getElementById('nu-p').value = 'Lang-genug-Passwort-1';
    d.getElementById('btn-cu').click();
    assert.ok(await waitFor(() => calls.length === 1), `${calls.length} request(s)`);
    assert.equal(d.getElementById('confirm-modal').style.display === 'flex', false, 'no dialog in between');
    assert.deepEqual(calls[0], { username: 'bert', password: 'Lang-genug-Passwort-1', is_admin: false });
  } finally {
    w.close();
  }
});

test('emptying the trash asks only yes or no', async () => {
  const calls = [];
  const { w, d } = await openUi({
    '/v2/trash': (url, o) =>
      o?.method === 'DELETE' ? recording(calls, { success: true, removed: 0 })(url, o) : { success: true, entries: [] },
  });
  try {
    d.getElementById('trash-empty').click();
    await sayYes(d);
    assert.ok(await waitFor(() => calls.length === 1), `${calls.length} request(s)`);
    assert.deepEqual(calls, [null]);
  } finally {
    w.close();
  }
});

test('deleting a voucher asks only yes or no', async () => {
  const calls = [];
  const { w, d } = await openUi({
    '/v2/vouchers': {
      success: true,
      vouchers: [{ id: 3, number: '6123456789012', pin: '4711', amount: 50, currency: 'CHF', has_pdf: false }],
    },
    '/v2/vouchers/3': recording(calls, { success: true }),
  });
  try {
    await view(w, 'vouchers');
    assert.ok(await waitFor(() => d.querySelector('[data-click="deleteVoucher"]')), 'voucher list');
    d.querySelector('[data-click="deleteVoucher"]').click();
    await sayYes(d);
    assert.ok(await waitFor(() => calls.length === 1), `${calls.length} request(s)`);
    assert.deepEqual(calls, [null]);
  } finally {
    w.close();
  }
});

test('the voucher PDF opens without a dialog, with the ticket', async () => {
  const releases = [],
    fetches = [];
  const { w, d } = await openUi({
    '/v2/vouchers': {
      success: true,
      vouchers: [{ id: 3, number: '…9012', pin: '•••', amount: 50, currency: 'CHF', has_pdf: true }],
    },
    '/v2/vouchers/3/pdf-grant': (_u, o) => {
      releases.push(JSON.parse(o.body));
      return { success: true, ticket: 'T-123', valid_seconds: 60 };
    },
    '/v2/vouchers/3/pdf': u => {
      fetches.push(String(u));
      return { $status: 403, success: false, error: 'abgelehnt', code: 'no_account_access' };
    },
  });
  try {
    await view(w, 'vouchers');
    assert.ok(await waitFor(() => d.querySelector('[data-click="openVoucherPdf"]')), 'voucher list');
    d.querySelector('[data-click="openVoucherPdf"]').click();
    assert.ok(await waitFor(() => fetches.length === 1), 'no fetch of the PDF');
    assert.equal(d.getElementById('confirm-modal').style.display === 'flex', false, 'no dialog in between');
    assert.deepEqual(releases, [{}]);
    assert.match(fetches[0], /\/api\/v2\/vouchers\/3\/pdf\?ticket=T-123$/);
  } finally {
    w.close();
  }
});

test('number and PIN appear without a dialog', async () => {
  const calls = [];
  const { w, d } = await openUi({
    '/v2/vouchers': {
      success: true,
      vouchers: [{ id: 3, number: '…9012', pin: '•••', amount: 50, currency: 'CHF', has_pdf: false }],
    },
    '/v2/vouchers/3/plaintext': (_u, o) => {
      calls.push(JSON.parse(o.body));
      return { success: true, id: 3, number: '6123456789012', pin: '4711' };
    },
  });
  try {
    await view(w, 'vouchers');
    assert.ok(await waitFor(() => d.querySelector('.voucher-row')), 'voucher list');
    assert.equal(d.querySelector('.voucher-num').textContent, '…9012', 'the list shows the mask');
    d.querySelector('[data-click="toggleVoucherPin"]').click();
    assert.ok(await waitFor(() => d.querySelector('.voucher-pin code')?.textContent === '4711'), 'the PIN appears');
    assert.equal(d.getElementById('confirm-modal').style.display === 'flex', false, 'no dialog in between');
    assert.equal(d.querySelector('.voucher-num').textContent, '6123 4567 8901 2');
    assert.deepEqual(calls, [{}]);
  } finally {
    w.close();
  }
});
