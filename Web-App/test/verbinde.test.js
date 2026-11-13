/**
 * verbinde() (public/js/escapen.js) hängt Stücke aus html`` aneinander, statt dass
 * ungeprueft(liste.join('')) jede Zeichenkette als Markup durchlässt: Ein Trenner als
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

const modul = import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'escapen.js')).href);

test('Stücke aus html`` werden verbunden, ihr Inhalt bleibt maskiert', async () => {
  const { html, verbinde, SicheresHtml } = await modul;
  const v = verbinde([html`<b>${'<x>'}</b>`, '', null, html`<i>1</i>`, [html`<u>2</u>`]], html`<br>`);
  assert.ok(v instanceof SicheresHtml);
  assert.equal(v.text, '<b>&lt;x&gt;</b><br><i>1</i><br><u>2</u>');
  assert.equal(verbinde([]).text, '');
  assert.equal(html`<ul>${verbinde([html`<li>a</li>`, html`<li>b</li>`])}</ul>`.text, '<ul><li>a</li><li>b</li></ul>');
});

test('ein Trenner als Text wird maskiert', async () => {
  const { html, verbinde } = await modul;
  assert.equal(verbinde([html`a`, html`b`], ' <hr> & ').text, 'a &lt;hr&gt; &amp; b');
});

test('eine rohe Zeichenkette wirft', async () => {
  const { html, verbinde } = await modul;
  assert.throws(() => verbinde([html`a`, '<img src=x onerror=alert(1)>']), /verbinde: nur Stücke aus html``/);
  assert.throws(() => verbinde([html`a`, 42]), TypeError);
});
