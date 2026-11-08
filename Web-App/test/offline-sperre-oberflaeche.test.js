/**
 * Ohne Verbindung sind schreibende Knöpfe gesperrt und nennen das Band als
 * Grund, statt nach dem Klick eine Fehlermeldung zu zeigen. Kommt die
 * Verbindung zurück, sind sie wieder frei. Am echten Bündel in jsdom.
 *
 * Gegenproben (02.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  schreibenSperren(true) in zeigeVerbindung entfernt → rot: „offline:
 *      Hinzufügen gesperrt“
 *   B  MutationObserver nicht gestartet → rot: „neu gezeichnete Knöpfe auch“
 *   C  schreibenSperren(false) beim Zurückkommen entfernt → rot: „online: wieder frei“
 *   D  (02.11.) alte Einzelliste statt schreibt() (nur bp/bd und fünf
 *      Namensmuster, #rb-hinweis ausgenommen) → rot: „alle schreibenden
 *      Bedienelemente“ (Importieren, Schlüssel eintragen, Datei-Wahl, Bearbeiten)
 *   E  (08.11.) alte Regel zurück (bp/bd immer, sonst Namens-Regex) → rot:
 *      „alle schreibenden Bedienelemente“ (Schlüssel eintragen gesperrt)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, takt } = require('./helpers/oberflaeche');

test('offline: schreibende Knöpfe gesperrt', async (t) => {
  const { w, d } = await oeffneOberflaeche();
  try {
    const hinzu = d.querySelector('#tab-gallery button[data-click="oeffneErfassen"]');
    const filter = d.querySelector('#tab-gallery .filter-knopf');
    assert.ok(hinzu && filter);
    Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => false });
    w.dispatchEvent(new w.Event('offline'));
    await takt(10);
    await t.test('offline: Hinzufügen gesperrt', () => {
      assert.equal(d.getElementById('offline-band').hidden, false);
      assert.equal(hinzu.disabled, true);
      assert.match(hinzu.getAttribute('aria-describedby') || '', /offline-band/);
      assert.equal(filter.disabled, false, 'Lesen bleibt möglich');
      assert.match(d.getElementById('offline-band').textContent, /gesperrt/);
    });
    await t.test('alle schreibenden Bedienelemente, Lesen bleibt frei', async () => {
      const import_ = d.querySelector('#tab-gallery .import-menue > summary');
      assert.equal(import_.getAttribute('aria-disabled'), 'true', 'Importieren');
      import_.click();
      assert.equal(import_.parentElement.open, false, 'Importieren öffnet trotzdem');
      assert.equal(d.querySelector('#rb-hinweis .btn.bp').disabled, false, 'Schlüssel eintragen führt nur zu den Einstellungen');
      assert.equal(d.querySelector('#rb-hinweis .hinweis-zu').disabled, false, 'Hinweis schliessen');
      const dateien = [...d.querySelectorAll('input[type=file]')];
      assert.ok(dateien.length >= 3 && dateien.every(f => f.disabled), 'Datei-Wahl');
      const div = d.createElement('div');
      div.innerHTML = '<button class="v-btn" data-click="gutscheinBearbeiten">B</button><button class="v-btn" data-click="gutscheinKopieren">K</button>';
      d.body.appendChild(div);
      await takt(10);
      assert.deepEqual([...div.querySelectorAll('button')].map(k => k.disabled), [true, false]);
      for (const sel of ['.ntab[data-tab="finance"]', '#btn-umenu', '.umenu-item[data-arg="profil"]'])
        assert.equal(d.querySelector(sel).disabled, false, sel);
    });
    await t.test('neu gezeichnete Knöpfe auch', async () => {
      const div = d.createElement('div');
      div.innerHTML = '<button class="btn bp" data-click="speichereAlarm">Speichern</button>';
      d.body.appendChild(div);
      await takt(10);
      assert.equal(div.querySelector('button').disabled, true);
    });
    await t.test('online: wieder frei', async () => {
      Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => true });
      w.dispatchEvent(new w.Event('online'));
      await takt(10);
      assert.equal(hinzu.disabled, false);
      assert.equal(hinzu.hasAttribute('aria-describedby'), false);
      assert.equal(d.querySelector('#tab-gallery .import-menue > summary').hasAttribute('aria-disabled'), false);
      assert.equal(d.getElementById('offline-band').hidden, true);
    });
  } finally { w.close(); }
});
