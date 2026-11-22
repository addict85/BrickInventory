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
const { openUi, warte, sicht, reiter } = require('./helpers/ui');

const NAME = 'A & B <C>';

test('delete message names the set name literally', async () => {
  const { w, d } = await openUi({
    '/v1/sets': {
      success: true,
      total: 1,
      themes: [],
      sets: [{ set_number: '10294-1', name: NAME, quantity: 1, conditions: ['N'], instructions: [], owners: [] }],
    },
  });
  try {
    assert.ok(await warte(() => d.querySelector('#gallery .delbtn[data-click="delSetStop"]')), 'Kachel mit Papierkorb');
    d.querySelector('#gallery .delbtn[data-click="delSetStop"]').click();
    // The own set goes without a question (js/deletion.js); the name stands in the toast instead.
    assert.ok(await warte(() => d.querySelector('#toasts .toast.success .toast-text')), 'keine Meldung');
    const text = d.querySelector('#toasts .toast.success .toast-text').textContent;
    assert.ok(text.includes(NAME), `Meldung: ${text}`);
    assert.ok(!text.includes('&amp;'), `Meldung maskiert doppelt: ${text}`);
  } finally {
    w.close();
  }
});

test('former link names the path literally', async () => {
  const { w, d } = await openUi({
    '/v1/settings/household': {
      success: true,
      currency: 'EUR',
      parent: null,
      children: [],
      invites: [],
      former_links: [{ id: 7, username: 'tom', via: 'Tom & Jerry' }],
    },
  });
  try {
    await sicht(w, 'household');
    assert.ok(await warte(() => d.body.textContent.includes('Jerry')), 'Haushalt geladen');
    const place = [...d.querySelectorAll('span')].find(s => s.textContent.includes('Jerry'));
    assert.ok(place.textContent.includes('Tom & Jerry'), `Text: ${place.textContent}`);
    assert.ok(!place.innerHTML.includes('&amp;amp;'), `doppelt maskiert: ${place.innerHTML}`);
  } finally {
    w.close();
  }
});

test('pause names an unknown job kind literally', async () => {
  const { w, d, ruhig } = await openUi({
    '/v1/admin/job-status': { success: true, job: { running: false } },
    '/v1/admin/jobs': { success: true, jobs: {}, schedules: {}, db: { csvCache: {}, blMapping: {} } },
    '/v1/admin/auftraege': {
      success: true,
      auftraege: [],
      zusammenfassung: [],
      job_prozess: { laeuft: true },
      bildbedarf: 0,
      pausen: [{ type: 'x&y', until_at: '2026-11-05T12:00:00Z', reason: 'Wartung' }],
    },
  });
  try {
    await reiter(w, 'monitor');
    await ruhig();
    assert.ok(
      await warte(() => d.body.textContent.includes('x&y') || d.body.innerHTML.includes('x&amp;amp;y')),
      'Pause sichtbar',
    );
    assert.ok(d.body.textContent.includes('x&y'), 'Auftragsart steht wörtlich da');
    assert.ok(!d.body.innerHTML.includes('x&amp;amp;y'), 'Auftragsart doppelt maskiert');
  } finally {
    w.close();
  }
});
