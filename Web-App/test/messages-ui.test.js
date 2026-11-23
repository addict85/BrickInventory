/**
 * Messages (toasts), on the real bundle in jsdom: errors and messages with a
 * button do not expire, others pause under mouse or focus, a click
 * clears them away.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  (re-measured 05.11.2026) `stays` in toast() always false → red:
 *      “errors and button messages do not expire”
 *   B  the click handler on the toast removed → red: “a click clears the message”
 *   C  (30.10.) the search for the same message in toast() removed → red:
 *      “identical errors do not stack” (3 messages instead of 1)
 *   D  (05.11.2026) the mouseenter pause removed → red: “the mouse on the message
 *      stops the deadline”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, switchTab, waitFor } = require('./helpers/ui');

// Since 29.10. a list shows its load error itself (errorState);
// a message comes from an action — here „Auf die Merkliste“.
const ERROR = { '/v2/wanted': { success: false, error: 'Merkliste kaputt' } };
async function createWantedItem(w, d) {
  await switchTab(w, 'wanted');
  d.getElementById('mk-num').value = '10294-1';
  d.getElementById('mk-add').click();
}

/** Record timers from now on instead of letting them run. */
function catchZeitgeber(w) {
  const caughtOne = [];
  const original = w.setTimeout;
  w.setTimeout = (fn, ms, ...rest) => {
    if (typeof fn === 'function' && ms >= 3000) {
      caughtOne.push({ fn, ms });
      return 0;
    }
    return original.call(w, fn, ms, ...rest);
  };
  return caughtOne;
}

test('errors and button messages do not expire', async () => {
  const { w, d } = await openUi(ERROR);
  try {
    const caughtOne = catchZeitgeber(w);
    await createWantedItem(w, d);
    await waitFor(() => d.querySelector('#toasts .toast.error'));
    const message = d.querySelector('#toasts .toast.error');
    assert.match(message.textContent, /Merkliste kaputt/);
    for (const z of caughtOne) z.fn();
    assert.ok(message.isConnected, 'the error expired after its timeout');
    const closed = message.querySelector('.toast-close');
    assert.equal(closed.getAttribute('aria-label'), 'Schliessen');
    closed.click();
    assert.equal(message.isConnected, false, 'the ✕ closes');
  } finally {
    w.close();
  }
});

test('the mouse on the message stops the deadline', async () => {
  const { w, d } = await openUi({
    '/v2/wanted': (_u, o) => (o.method === 'POST' ? { success: true, was_new: true } : { success: true, items: [] }),
  });
  try {
    // Like catchZeitgeber, but clearTimeout takes a caught timer out again.
    const open = new Map();
    let n = 1e6;
    const put = w.setTimeout,
      remove = w.clearTimeout;
    w.setTimeout = (fn, ms, ...rest) => {
      if (typeof fn === 'function' && ms >= 3000) {
        open.set(++n, fn);
        return n;
      }
      return put.call(w, fn, ms, ...rest);
    };
    w.clearTimeout = id => (open.has(id) ? open.delete(id) : remove.call(w, id));
    await createWantedItem(w, d);
    await waitFor(() => d.querySelector('#toasts .toast.success'));
    const message = d.querySelector('#toasts .toast.success');
    message.dispatchEvent(new w.MouseEvent('mouseenter'));
    for (const fn of [...open.values()]) fn();
    assert.ok(message.isConnected, 'the timeout expired under the mouse');
    message.dispatchEvent(new w.MouseEvent('mouseleave'));
    for (const fn of [...open.values()]) fn();
    assert.equal(message.isConnected, false, 'after leaving, the timeout runs again');
  } finally {
    w.close();
  }
});

test('identical errors do not stack', async () => {
  const { w, d } = await openUi(ERROR);
  try {
    for (let i = 0; i < 3; i++) {
      await createWantedItem(w, d);
      await waitFor(() => d.querySelectorAll('#toasts .toast.error').length > 0);
    }
    await waitFor(() => d.querySelector('#toasts .toast-count:not([hidden])')?.textContent === '×3', 1000);
    const messages = d.querySelectorAll('#toasts .toast.error');
    assert.equal(messages.length, 1, `${messages.length} messages`);
    assert.equal(messages[0].querySelector('.toast-count').textContent, '×3');
  } finally {
    w.close();
  }
});

test('a click clears the message', async () => {
  const { w, d } = await openUi(ERROR);
  try {
    await createWantedItem(w, d);
    await waitFor(() => d.querySelector('#toasts .toast.error'));
    const message = d.querySelector('#toasts .toast.error');
    message.querySelector('.toast-text').click();
    assert.equal(message.isConnected, false);
  } finally {
    w.close();
  }
});
