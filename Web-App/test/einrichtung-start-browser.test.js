/**
 * Der Einrichtungsassistent geht von selbst nur über einer LEEREN Sammlung
 * auf (oder solange das Startpasswort gilt). Über einer gefüllten Sammlung
 * bleibt er zu, und das Hinweisband zum Rebrickable-Schlüssel sagt es. Sein
 * Text verspricht nicht „bleibt leer“, und die Überschriften folgen der Ebene.
 *
 * Gegenproben (am 03.11.2026 gemessen):
 *   A  in pruefeEinrichtung die Bestandsprüfung entfernt → rot: „gefüllte
 *      Sammlung: kein Assistent, aber das Band“
 *   B  die Rebrickable-Überschrift wieder <h3> → rot: „leere Sammlung:
 *      Assistent, Text und Überschriften“ (Ebenen 3,2,2; axe allein blieb
 *      hier grün, weil im Leerzustand ein h2 davor steht)
 *   C  setup.rb_hint wieder „… bleibt die Sammlung leer …“ → rot: dieselbe Prüfung
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp, warte } = require('./helpers/app-browser');
const { haeltSet } = require('./helpers/bestand');

const AXE = require('axe-core').source;
const SCHLUESSEL = ['rebrickable_api_key', 'einrichtung_erledigt'];

test('Einrichtungsassistent nur über leerer Sammlung', { concurrency: 1, timeout: 300_000 }, async (t) => {
  const app = await starteApp(t, {
    name: `einr_${process.pid}`,
    bestand: async (db) => { await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]); },
  });
  if (app.grund) { t.skip(app.grund); return; }
  const { b, bis, db, uid } = app;
  const offen = `document.getElementById('einrichtung-modal').classList.contains('open')`;

  await t.test('leere Sammlung: Assistent, Text und Überschriften', async () => {
    await bis(offen, 'Assistent');
    const text = await b.auswerten(`document.querySelector('#einrichtung-modal .ew-schritt.aktiv')?.textContent || ''`);
    assert.match(text, /Rebrickable/);
    assert.doesNotMatch(text, /bleibt die Sammlung leer/);
    const funde = await b.auswerten(`(async () => { if (!window.axe) (0, eval)(${JSON.stringify(AXE)});
      const r = await axe.run(document, { runOnly: ['heading-order'] }); return r.violations.flatMap(v => v.nodes.map(n => v.id + ' ' + n.target.join(' '))); })()`);
    assert.deepEqual(funde, []);
    // Ob axe heading-order meldet, hängt davon ab, welche Überschrift davor auf
    // der Seite steht (über 12 Sets: h1, im Leerzustand: h2). Der Titel des
    // Dialogs ist keine Überschrift; seine Schritte beginnen deshalb bei h2.
    const ebenen = await b.auswerten(`[...document.querySelectorAll('#einrichtung-modal h1, #einrichtung-modal h2, #einrichtung-modal h3, #einrichtung-modal h4')].map(h => +h.tagName[1])`);
    assert.ok(ebenen.length >= 3, `Testdaten: ${ebenen}`);
    assert.ok(ebenen[0] === 2 && ebenen.every((e, i) => i === 0 || e <= ebenen[i - 1] + 1), `Überschriften im Assistenten: ${ebenen}`);
  });

  await t.test('gefüllte Sammlung: kein Assistent, aber das Band', async () => {
    await b.auswerten(`document.querySelector('#einrichtung-modal [data-click="einrichtungSpaeter"]').click(); true`);
    await haeltSet(db, uid, '10294-1', 1, { preis: 100 });
    await b.tab('Page.reload');
    await bis(`(() => { const g = document.getElementById('gallery'); return !!g && g.querySelectorAll('[data-click="openModal"], .card, .scard').length > 0; })()`, 'Sammlung mit Set', 300);
    await warte(2500);
    assert.equal(await b.auswerten(offen), false, 'Assistent über der gefüllten Sammlung');
    assert.equal(await b.auswerten(`document.getElementById('rb-hinweis').hidden`), false, 'Hinweisband fehlt');
  });
  t.after(() => db.run('DELETE FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]).catch(() => {}));
});
