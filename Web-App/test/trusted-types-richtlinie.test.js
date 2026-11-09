/**
 * Die Richtlinie `app` (public/js/00-escapen.js) prägt TrustedHTML nur für den Text, den alsHtml()
 * gerade aus html`` gebaut hat: Direkt aufgerufen scheitert sie, eine Zeichenkette und ein nachgebautes
 * SicheresHtml kommen maskiert an. Ausgeführt wird das echte Modul mit einer Attrappe von trustedTypes.
 *
 * Gegenproben (09.11.2026 gemessen, je einzeln):
 *   A  createHTML der Richtlinie wieder `s => s` → rot: „direkt aufgerufen …“
 *   B  einsetzen() wieder mit `instanceof SicheresHtml` → rot: „ein nachgebautes …“
 *   C  alsHtml() reicht eine Zeichenkette unverändert durch → rot: „eine Zeichenkette …“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/** @type {Record<string, { createHTML(s: string): unknown }>} */
const richtlinien = {};
globalThis.trustedTypes = {
  createPolicy(name, regeln) {
    const r = { createHTML: s => ({ geprueft: regeln.createHTML(s) }) };
    richtlinien[name] = r;
    return r;
  },
};

const laden = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', '00-escapen.js')).href);

test('Markup aus html`` wird TrustedHTML, der Wert darin maskiert', async () => {
  const { alsHtml, html } = await laden();
  assert.deepEqual(alsHtml(html`<b>${'<img src=x onerror=alert(1)>'}</b>`), {
    geprueft: '<b>&lt;img src=x onerror=alert(1)&gt;</b>',
  });
  assert.deepEqual(alsHtml([html`<i>a</i>`, html`<i>b</i>`]), { geprueft: '<i>a</i><i>b</i>' });
});

test('direkt aufgerufen nimmt die Richtlinie nichts an', async () => {
  const { alsHtml, html } = await laden();
  assert.throws(() => richtlinien.app.createHTML('<img src=x onerror=alert(1)>'), TypeError);
  // Auch nicht den Text, der eben durchging: Die Freigabe gilt einmal.
  alsHtml(html`<b>x</b>`);
  assert.throws(() => richtlinien.app.createHTML('<b>x</b>'), TypeError);
});

test('eine Zeichenkette kommt maskiert als Text an', async () => {
  const { alsHtml } = await laden();
  assert.deepEqual(alsHtml('<b>x</b>'), { geprueft: '&lt;b&gt;x&lt;/b&gt;' });
});

test('ein nachgebautes SicheresHtml ohne Marke wird maskiert', async () => {
  const { alsHtml, SicheresHtml } = await laden();
  const falsch = Object.assign(Object.create(SicheresHtml.prototype), { text: '<script>x</script>' });
  assert.ok(falsch instanceof SicheresHtml, 'Vorbedingung: instanceof liesse es durch');
  assert.deepEqual(alsHtml(falsch), { geprueft: '&lt;script&gt;x&lt;/script&gt;' });
});

test('die Richtlinie default nimmt nur das Leeren an', async () => {
  await laden();
  assert.deepEqual(richtlinien.default.createHTML(''), { geprueft: '' });
  assert.throws(() => richtlinien.default.createHTML('<b>'), TypeError);
});
