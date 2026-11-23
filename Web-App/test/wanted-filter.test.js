/**
 * The wishlist filter in the web app — with the same sortings as the server.
 *
 * Step 1 runs in the real bundle (jsdom); 3–4 compare the selection with the
 * server table WANTED_SORTS (structure).
 *
 * Counter-checks:
 *   a) qty_desc added to the web app's selection → step 3 red.
 *   d) (10.11.2026) addScopeParam removed from wanted.js → step 1 red.
 *   f) (10.11.2026) sorting not set in wantedParams → step 1 red.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./helpers/sources');
const withoutComments = (/** @type {string} */ s) => require('./helpers/sources').withoutComments(s);
const { openUi, switchTab, waitFor } = require('./helpers/ui');

/** The sort values of a source — everything that looks like a WANTED_SORTS key. */
function sortValues(source) {
  return [...new Set(source.match(/\b(?:added|name|num|year|price|qty)_(?:asc|desc)\b/g) || [])].sort();
}

test('1. the web app sends all four filters to the server', async () => {
  const o = await openUi({
    '/v2/sets/household-members': {
      success: true,
      members: [
        { id: 1, username: 'anna', is_self: true, depth: 0 },
        { id: 7, username: 'ben', is_self: false, depth: 1 },
      ],
    },
    '/v2/wanted': { success: true, item: [] },
  });
  try {
    await switchTab(o.w, 'wanted');
    await o.settle();
    const put = (id, value) => {
      const f = o.d.getElementById(id);
      f.value = value;
      assert.equal(f.value, value, `${id} does not know ${value}`);
      f.dispatchEvent(new o.w.Event(f.tagName === 'INPUT' ? 'input' : 'change', { bubbles: true }));
    };
    put('scope-wanted', '7');
    put('mkcond', 'U');
    put('mksort', 'price_asc');
    put('mks', 'Burg');
    assert.ok(
      await waitFor(() => o.calls.some(a => /\/v2\/wanted\?.*search=Burg/.test(a.url)), 2000),
      'the search does not reload',
    );
    await o.settle();
    const p = new URL(o.calls.filter(a => /\/v2\/wanted\?/.test(a.url)).at(-1).url, 'http://x').searchParams;
    assert.deepEqual(
      [p.get('search'), p.get('condition'), p.get('sort'), p.get('accounts')],
      ['Burg', 'U', 'price_asc', '7'],
    );
  } finally {
    o.w.close();
  }
});

test('3. the web app offers exactly the sortings the server knows', () => {
  // ── The source of truth ───────────────────────────────────────────────────
  const server = withoutComments(fs.readFileSync(path.join(ROOT, 'src/wanted/repository/wanted.ts'), 'utf8'));
  const table = server.slice(
    server.indexOf('const WANTED_SORTS'),
    server.indexOf('};', server.indexOf('const WANTED_SORTS')),
  );
  const allowed = sortValues(table);
  assert.ok(allowed.length >= 5, `Only ${allowed.length} sort values found — table renamed?`);
  // qty_* explicitly does NOT belong to it: a wishlist item has no quantity.
  assert.ok(
    !allowed.some(w => w.startsWith('qty_')),
    'WANTED_SORTS has a quantity sort — a wanted item has no quantity.',
  );

  // ── Web app: the <option> values of the sort field ────────────────────────
  const html = withoutComments(fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8'));
  const field = html.slice(html.indexOf('id="mksort"'));
  const webValues = sortValues(field.slice(0, field.indexOf('</select>')));
  assert.deepEqual(
    webValues,
    allowed,
    "The web app's choice and WANTED_SORTS drift apart — an unknown " +
      'value silently falls back to the default on the server.',
  );
});

test('4. the default sorting is the same in server and web app', () => {
  // It decides whether the web app sends the parameter at all.
  const server = withoutComments(fs.readFileSync(path.join(ROOT, 'src/wanted/repository/wanted.ts'), 'utf8'));
  const firstRow = server.slice(server.indexOf('const WANTED_SORTS')).split('\n')[1];
  assert.match(firstRow, /added_desc/, 'WANTED_SORTS does not start with added_desc');

  const html = withoutComments(fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8'));
  const field = html.slice(html.indexOf('id="mksort"'));
  assert.match(
    field.slice(0, 200),
    /<option value="added_desc"/,
    'The web app has a different default — the first <option> is the preselection.',
  );
});
