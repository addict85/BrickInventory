/**
 * joinHtml() (public/js/escaping.js) chains pieces from html`` instead of
 * rawHtml(liste.join('')) letting every string through as markup: a separator as
 * text is escaped, a raw string in the list throws.
 *
 * Counter-checks (measured 12.11.2026, each alone):
 *   A  in verbinde() the check for SicheresHtml replaced by `void x;` → red:
 *      “a raw string throws” (it came through escaped and would not stand out)
 *   B  the separator appended without einsetzen() → red: “a separator as text is escaped”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const modul = import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'escaping.js')).href);

test('pieces from html`` are joined, their content stays escaped', async () => {
  const { html, joinHtml, SafeHtml } = await modul;
  const v = joinHtml([html`<b>${'<x>'}</b>`, '', null, html`<i>1</i>`, [html`<u>2</u>`]], html`<br>`);
  assert.ok(v instanceof SafeHtml);
  assert.equal(v.text, '<b>&lt;x&gt;</b><br><i>1</i><br><u>2</u>');
  assert.equal(joinHtml([]).text, '');
  assert.equal(html`<ul>${joinHtml([html`<li>a</li>`, html`<li>b</li>`])}</ul>`.text, '<ul><li>a</li><li>b</li></ul>');
});

test('a separator as text is escaped', async () => {
  const { html, joinHtml } = await modul;
  assert.equal(joinHtml([html`a`, html`b`], ' <hr> & ').text, 'a &lt;hr&gt; &amp; b');
});

test('a raw string throws', async () => {
  const { html, joinHtml } = await modul;
  assert.throws(() => joinHtml([html`a`, '<img src=x onerror=alert(1)>']), /joinHtml: only pieces from html``/);
  assert.throws(() => joinHtml([html`a`, 42]), TypeError);
});
