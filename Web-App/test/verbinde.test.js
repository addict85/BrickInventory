/**
 * joinHtml() (public/js/escaping.js) hängt Stücke aus html`` aneinander, statt dass
 * rawHtml(liste.join('')) jede Zeichenkette als Markup durchlässt: Ein Trenner als
 * Text wird maskiert, eine rohe Zeichenkette in der Liste wirft.
 *
 * Gegenproben (12.11.2026 gemessen, je einzeln):
 *   A  in verbinde() die Prüfung auf SicheresHtml durch `void x;` ersetzt → rot:
 *      „eine rohe Zeichenkette wirft“ (sie kam maskiert durch und fiele nicht auf)
 *   B  den Trenner ohne einsetzen() angehängt → rot: „ein Trenner als Text wird maskiert“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const modul = import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'escaping.js')).href);

test('Stücke aus html`` werden verbunden, ihr Inhalt bleibt maskiert', async () => {
  const { html, joinHtml, SafeHtml } = await modul;
  const v = joinHtml([html`<b>${'<x>'}</b>`, '', null, html`<i>1</i>`, [html`<u>2</u>`]], html`<br>`);
  assert.ok(v instanceof SafeHtml);
  assert.equal(v.text, '<b>&lt;x&gt;</b><br><i>1</i><br><u>2</u>');
  assert.equal(joinHtml([]).text, '');
  assert.equal(html`<ul>${joinHtml([html`<li>a</li>`, html`<li>b</li>`])}</ul>`.text, '<ul><li>a</li><li>b</li></ul>');
});

test('ein Trenner als Text wird maskiert', async () => {
  const { html, joinHtml } = await modul;
  assert.equal(joinHtml([html`a`, html`b`], ' <hr> & ').text, 'a &lt;hr&gt; &amp; b');
});

test('eine rohe Zeichenkette wirft', async () => {
  const { html, joinHtml } = await modul;
  assert.throws(() => joinHtml([html`a`, '<img src=x onerror=alert(1)>']), /joinHtml: only pieces from html``/);
  assert.throws(() => joinHtml([html`a`, 42]), TypeError);
});
