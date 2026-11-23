/**
 * t() delivers finished markup (SafeHtml), tRaw() plain text. Whoever writes text into
 * textContent or a dialog must take tRaw(), and a
 * variable of t() is not escaped beforehand. What is checked is what arrives visibly in the
 * real bundle (jsdom): a name with „&“ and „<“ stands there
 * literally, not as „&amp;“.
 *
 * Counter-checks (measured 05.11.2026, each on its own, bundle rebuilt):
 *   A  in sammlung.js delSet() again t('gallery.delete.name_parts') →
 *      typecheck:frontend red (SicheresHtml is not a string); forced with
 *      String(t(…)) → red: “delete dialog names the set name
 *      literally” (it said „A &amp; B &lt;C&gt;“)
 *   A2 (22.11.2026, delete without question) users.deleted with t() and String() in delSet →
 *      red: “delete message names the set name literally”
 *   B  in haushalt.js again { via: esc(a.via) } → red: “former
 *      link names the path literally” („Tom &amp;amp; Jerry“ in the source)
 *   C  in monitor.js the pause again with esc(p.art) → red: “pause names
 *      an unknown job kind literally”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, waitFor, view, switchTab } = require('./helpers/ui');

const NAME = 'A & B <C>';

test('delete message names the set name literally', async () => {
  const { w, d } = await openUi({
    '/v2/sets': {
      success: true,
      total: 1,
      themes: [],
      sets: [{ set_number: '10294-1', name: NAME, quantity: 1, conditions: ['N'], instructions: [], owners: [] }],
    },
  });
  try {
    assert.ok(await waitFor(() => d.querySelector('#gallery .delbtn[data-click="delSetStop"]')), 'tile with trash can');
    d.querySelector('#gallery .delbtn[data-click="delSetStop"]').click();
    // The own set goes without a question (js/deletion.js); the name stands in the toast instead.
    assert.ok(await waitFor(() => d.querySelector('#toasts .toast.success .toast-text')), 'no message');
    const text = d.querySelector('#toasts .toast.success .toast-text').textContent;
    assert.ok(text.includes(NAME), `message: ${text}`);
    assert.ok(!text.includes('&amp;'), `message is escaped twice: ${text}`);
  } finally {
    w.close();
  }
});

test('former link names the path literally', async () => {
  const { w, d } = await openUi({
    '/v2/settings/household': {
      success: true,
      currency: 'EUR',
      parent: null,
      children: [],
      invites: [],
      former_links: [{ id: 7, username: 'tom', via: 'Tom & Jerry' }],
    },
  });
  try {
    await view(w, 'household');
    assert.ok(await waitFor(() => d.body.textContent.includes('Jerry')), 'household loaded');
    const place = [...d.querySelectorAll('span')].find(s => s.textContent.includes('Jerry'));
    assert.ok(place.textContent.includes('Tom & Jerry'), `Text: ${place.textContent}`);
    assert.ok(!place.innerHTML.includes('&amp;amp;'), `escaped twice: ${place.innerHTML}`);
  } finally {
    w.close();
  }
});

test('pause names an unknown job kind literally', async () => {
  const { w, d, settle } = await openUi({
    '/v2/admin/job-status': { success: true, job: { running: false } },
    '/v2/admin/jobs': { success: true, jobs: {}, schedules: {}, db: { csvCache: {}, blMapping: {} } },
    '/v2/admin/job-queue': {
      success: true,
      jobs: [],
      summary: [],
      job_process: { running: true },
      image_demand: 0,
      pauses: [{ type: 'x&y', until_at: '2026-11-05T12:00:00Z', reason: 'Wartung' }],
    },
  });
  try {
    await switchTab(w, 'monitor');
    await settle();
    assert.ok(
      await waitFor(() => d.body.textContent.includes('x&y') || d.body.innerHTML.includes('x&amp;amp;y')),
      'pause visible',
    );
    assert.ok(d.body.textContent.includes('x&y'), 'job type is shown literally');
    assert.ok(!d.body.innerHTML.includes('x&amp;amp;y'), 'job type escaped twice');
  } finally {
    w.close();
  }
});
