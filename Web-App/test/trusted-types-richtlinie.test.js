/**
 * The policy `app` (public/js/escaping.js) mints TrustedHTML only for the text that asHtml()
 * has just built from html``: called directly it fails, a string and a replicated
 * SafeHtml arrive escaped. The real module is executed with a dummy of trustedTypes.
 *
 * Counter-checks (measured 09.11.2026, each on its own):
 *   A  createHTML of the policy again `s => s` → red: “called directly …”
 *   B  toText() again with `instanceof SafeHtml` → red: “a replicated …”
 *   C  asHtml() passes a string through unchanged → red: “a string …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/** @type {Record<string, { createHTML(s: string): unknown }>} */
const policies = {};
globalThis.trustedTypes = {
  createPolicy(name, regeln) {
    const r = { createHTML: s => ({ geprueft: regeln.createHTML(s) }) };
    policies[name] = r;
    return r;
  },
};

const laden = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'escaping.js')).href);

test('markup from html`` becomes TrustedHTML, the value inside escaped', async () => {
  const { asHtml, html } = await laden();
  assert.deepEqual(asHtml(html`<b>${'<img src=x onerror=alert(1)>'}</b>`), {
    geprueft: '<b>&lt;img src=x onerror=alert(1)&gt;</b>',
  });
  assert.deepEqual(asHtml([html`<i>a</i>`, html`<i>b</i>`]), { geprueft: '<i>a</i><i>b</i>' });
});

test('called directly the policy accepts nothing', async () => {
  const { asHtml, html } = await laden();
  assert.throws(() => policies.app.createHTML('<img src=x onerror=alert(1)>'), TypeError);
  // Not even the text that just went through: the release applies once.
  asHtml(html`<b>x</b>`);
  assert.throws(() => policies.app.createHTML('<b>x</b>'), TypeError);
});

test('a string arrives escaped as text', async () => {
  const { asHtml } = await laden();
  assert.deepEqual(asHtml('<b>x</b>'), { geprueft: '&lt;b&gt;x&lt;/b&gt;' });
});

test('a replicated SafeHtml without a brand is escaped', async () => {
  const { asHtml, SafeHtml } = await laden();
  const falsch = Object.assign(Object.create(SafeHtml.prototype), { text: '<script>x</script>' });
  assert.ok(falsch instanceof SafeHtml, 'precondition: instanceof would let it through');
  assert.deepEqual(asHtml(falsch), { geprueft: '&lt;script&gt;x&lt;/script&gt;' });
});

test('the default policy only accepts clearing', async () => {
  await laden();
  assert.deepEqual(policies.default.createHTML(''), { geprueft: '' });
  assert.throws(() => policies.default.createHTML('<b>'), TypeError);
});
