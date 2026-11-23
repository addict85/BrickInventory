/**
 * Accessibility of the loaded UI (jsdom, real bundle): what a screen reader
 * can say about fields, buttons, dialogs and the price signs of the
 * finances table once the language has been applied.
 *
 * Counter-checks (measured 10.11.2026, each alone, reverted, bundle rebuilt):
 *   A  in index.html `for="s-cur"` removed from the label → red: “every form field
 *      is labeled” (s-cur)
 *   B  the same label set to `for="s-curx"` → red: “every form field …” and “every for= …”
 *   C  role="dialog" removed from #confirm-modal → red: “modal overlays …”
 *   D  in i18n.js `document.documentElement.lang = lang;` deleted → red:
 *      “the language is on the <html> element”
 *   E  in priceStatusBadge() (finanzen.js) aria-label of the error badge
 *      removed → red: “meaningful signs …”
 *   F  #btn-sav-pw without text and data-i18n, with aria-label="btn-sav-pw" →
 *      red: “no aria-label that is only the identifier”
 *   G  #btn-sav-pw without text and data-i18n → red: “every visible control …”
 * Replaces bedienelement-name.test.js, which checked the same rules via regex on the markup.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, switchTab, waitFor } = require('./helpers/ui');

/** Fields that deliberately need no visible label. */
const EXEMPT = new Set([
  'cfg-import-file', // hidden <input type="file">, triggered via a labeled button
]);

const FIN_SETS = [
  { set_number: '10294-1', name: 'Titanic', avg_price: 600, value_total: 600 },
  { set_number: '10295-1', name: 'Porsche', error: 'Zeitüberschreitung', avg_price: null, value_total: 0 },
  { set_number: '10296-1', name: 'Mini', no_price: true, avg_price: null, value_total: 0 },
].map(s => ({
  quantity: 1,
  from_cache: true,
  is_fallback: false,
  no_price: false,
  mixed: false,
  acquisitions: [],
  ...s,
}));

let _o;
/** One UI for all cases: loading takes time, the checks only read. */
async function ui() {
  _o ??= await openUi({
    '/v2/finance/valuation': {
      success: true,
      currency: 'EUR',
      condition: 'N',
      total_value: '600',
      foreign_currency_purchases: 0,
      totals: { min: '0', avg: '600', max: '0', qty_avg: '600' },
      sets: FIN_SETS,
    },
  });
  return _o;
}
test.after(() => _o?.w.close());

const fields = d =>
  [...d.querySelectorAll('input[id], select[id], textarea[id]')].filter(f => f.type !== 'hidden' && !EXEMPT.has(f.id));

test('every form field is labeled', async () => {
  const { d } = await ui();
  const all = fields(d);
  assert.ok(all.length >= 50, `only ${all.length} fields found`);
  const without = all.filter(
    f => !f.labels?.length && !f.getAttribute('aria-label') && !f.getAttribute('aria-labelledby'),
  );
  assert.deepEqual(
    without.map(f => f.id),
    [],
  );
});

test('every for= points to an existing field, an enclosing label to its own', async () => {
  const { d } = await ui();
  const labels = [...d.querySelectorAll('label[for]')];
  assert.ok(labels.length >= 30, `only ${labels.length} labels with for=`);
  assert.deepEqual(
    labels.filter(l => !l.control).map(l => l.htmlFor),
    [],
    'for= without a target',
  );
  // A click puts focus on the target of for=, not on the wrapped field.
  const fremd = labels.filter(l => {
    const inner = l.querySelector('input, select, textarea');
    return inner && l.control !== inner;
  });
  assert.deepEqual(
    fremd.map(l => `${l.htmlFor} → ${l.querySelector('input, select, textarea').id}`),
    [],
  );
});

test('modal overlays are marked up as dialogs', async () => {
  const { d } = await ui();
  const modals = [...d.querySelectorAll('div.ovl[id$="modal"]')];
  assert.ok(modals.length >= 5, `Only ${modals.length} modals found`);
  assert.deepEqual(
    modals.filter(m => m.getAttribute('role') !== 'dialog' || m.getAttribute('aria-modal') !== 'true').map(m => m.id),
    [],
  );
});

test('the language is set on the <html> element', async () => {
  // Without lang= the screen reader guesses the pronunciation — audibly wrong in mixed German-English UIs.
  const en = await openUi({}, { language: 'en' });
  try {
    assert.equal(en.d.documentElement.lang, 'en');
  } finally {
    en.w.close();
  }
  assert.equal((await ui()).d.documentElement.lang, 'de');
});

test('meaningful symbols in the finance table are explained', async () => {
  // The price status column is a single sign; without title (mouse) and aria-label (reader) unreadable.
  // The legend signs are aria-hidden: the sentence next to them explains them.
  const { w, d } = await ui();
  await switchTab(w, 'finance');
  assert.ok(
    await waitFor(() => d.querySelectorAll('#fin-tbl .pst:not([aria-hidden])').length >= 3),
    'Badges are missing',
  );
  const states = new Set();
  for (const p of d.querySelectorAll('#fin-tbl .pst:not([aria-hidden])')) {
    states.add([...p.classList].find(k => k.startsWith('pst-')));
    for (const a of ['title', 'aria-label'])
      assert.ok(
        p.getAttribute(a) && !/^finance\./.test(p.getAttribute(a)),
        `${p.className}: ${a}="${p.getAttribute(a)}"`,
      );
  }
  assert.deepEqual([...states].sort(), ['pst-empty', 'pst-err', 'pst-ok']);
});

/** Visible here means: no ancestor with display:none (markup or script). */
const visible = el => {
  for (let e = el; e; e = e.parentElement) if (e.style?.display === 'none' || e.hidden) return false;
  return true;
};

test('every visible control has a name that can be read aloud', async () => {
  const { d } = await ui();
  const name = el =>
    el.getAttribute('aria-label') ||
    el.getAttribute('title') ||
    (el.getAttribute('aria-labelledby') || '')
      .split(/\s+/)
      .map(id => d.getElementById(id)?.textContent || '')
      .join(' ') ||
    [...(el.labels || [])].map(l => l.textContent).join(' ') ||
    el.textContent;
  const elements = [...d.querySelectorAll('button, a[href], select, textarea')].filter(visible);
  assert.ok(elements.length >= 50, `Only ${elements.length} controls found`);
  // At least two letters — a symbol or a ✕ is not a name.
  const without = elements
    .filter(el => !/[^\W\d_]{2,}/u.test(name(el) || ''))
    .map(el => `<${el.tagName.toLowerCase()}> ${el.id || el.className}`);
  assert.deepEqual(without, []);
});

test('no aria-label that is only the identifier', async () => {
  // The value is read aloud — “mon-default-condition" helps nobody.
  const { d } = await ui();
  const withIt = [...d.querySelectorAll('[aria-label]')].filter(visible);
  assert.ok(withIt.length >= 20, `Only ${withIt.length} aria-label found`);
  const badOne = withIt
    .filter(el => {
      const v = el.getAttribute('aria-label');
      return v === el.id || (!/\s/.test(v) && /[-_.]/.test(v) && v === v.toLowerCase());
    })
    .map(el => `${el.id}: ${el.getAttribute('aria-label')}`);
  assert.deepEqual(badOne, []);
});
