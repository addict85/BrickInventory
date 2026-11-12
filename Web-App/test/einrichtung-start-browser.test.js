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
 *   D  (04.11.) in einrichtungQuelle die Prüfung auf ein leeres Feld entfernt
 *      → rot: „Schlüssel prüfen: Fehler am Feld, in Klartext“ (kein Fehler am Feld)
 *   E  (04.11.) quellenFehler zeigt die Details nicht mehr → rot: dieselbe
 *      Prüfung („Technische Details“ fehlt)
 *   F  (04.11.) verwirfToasts in zeige() entfernt → rot: dieselbe Prüfung
 *      (Toast „Verbindung steht“ bleibt im nächsten Schritt stehen)
 *   G  (04.11.) in POST /settings die Ausnahme für den ersten Schlüssel auch in
 *      der Einrichtung abgeschaltet → rot: dieselbe Prüfung (Passwortfrage,
 *      „Klartext statt Rohtext“ läuft ab)
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp } = require('./helpers/app-browser');
const { haeltSet } = require('./helpers/bestand');

const AXE = require('axe-core').source;
const SCHLUESSEL = ['rebrickable_api_key', 'einrichtung_erledigt'];

test('Einrichtungsassistent nur über leerer Sammlung', { concurrency: 1, timeout: 300_000 }, async t => {
  const app = await starteApp(t, {
    name: `einr_${process.pid}`,
    bestand: async db => {
      await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
    },
    // Der Abruf bei Rebrickable läuft im Server; hier steht seine Antwort fest.
    abfangen: [
      {
        muster: '*quelle-testen*',
        enthaelt: 'quelle-testen',
        antwort: {
          success: false,
          code: 'quelle_nicht_erreichbar',
          error: 'Rebrickable ist nicht erreichbar. Bitte die Internetverbindung des Servers prüfen.',
          details: 'getaddrinfo ENOTFOUND rebrickable.com',
        },
      },
    ],
  });
  if (app.grund) {
    t.skip(app.grund);
    return;
  }
  const { b, bis, db, uid, ruhig } = app;
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
    const ebenen = await b.auswerten(
      `[...document.querySelectorAll('#einrichtung-modal h1, #einrichtung-modal h2, #einrichtung-modal h3, #einrichtung-modal h4')].map(h => +h.tagName[1])`,
    );
    assert.ok(ebenen.length >= 3, `Testdaten: ${ebenen}`);
    assert.ok(
      ebenen[0] === 2 && ebenen.every((e, i) => i === 0 || e <= ebenen[i - 1] + 1),
      `Überschriften im Assistenten: ${ebenen}`,
    );
  });

  await t.test('Schlüssel prüfen: Fehler am Feld, in Klartext', async () => {
    const pruefen = `document.querySelector('#einrichtung-modal .ew-schritt.aktiv [data-click="einrichtungQuelle"]').click(); true`;
    const stand = `({ fehler: document.getElementById('ew-fehler-rebrickable').textContent, ungueltig: document.getElementById('ew-rb').getAttribute('aria-invalid'),
      fokus: document.activeElement?.id, zeichen: document.getElementById('ew-stand-rebrickable').className,
      toasts: [...document.querySelectorAll('#toasts .toast.error')].map(x => x.textContent) })`;
    await b.auswerten(pruefen);
    await bis(`document.getElementById('ew-fehler-rebrickable').textContent !== ''`, 'Fehler am leeren Feld', 50);
    const leer = await b.auswerten(stand);
    assert.match(leer.fehler, /Schlüssel eintragen/);
    assert.deepEqual([leer.ungueltig, leer.fokus, leer.toasts], ['true', 'ew-rb', []]);
    await b.auswerten(`document.getElementById('ew-rb').value = 'probe-schluessel'; true`);
    await b.auswerten(pruefen);
    await bis(
      `/nicht erreichbar/.test(document.getElementById('ew-fehler-rebrickable').textContent)`,
      'Klartext statt Rohtext',
      100,
    );
    const z = await b.auswerten(stand);
    assert.ok(
      await db.get("SELECT 1 FROM global_settings WHERE key = 'rebrickable_api_key'"),
      'in der Einrichtung speichert der Assistent den ersten Schlüssel ohne Passwortfrage',
    );
    assert.match(z.fehler, /Technische Details/, 'die technische Ursache steht aufklappbar dabei');
    assert.match(z.zeichen, /fehlt/, '✗ neben dem Titel');
    assert.deepEqual(z.toasts, []);
    await b.auswerten(
      `document.getElementById('toasts').append(Object.assign(document.createElement('div'), { className: 'toast success', textContent: 'Verbindung steht' })); document.getElementById('ew-weiter').click(); true`,
    );
    assert.equal(
      await b.auswerten(`document.querySelectorAll('#toasts .toast').length`),
      0,
      'Meldungen bleiben nicht über den Schrittwechsel stehen',
    );
    await b.auswerten(`document.getElementById('ew-zurueck').click(); true`);
    // Der Assistent hat den Probeschlüssel gespeichert; das Band unten braucht ihn fehlend.
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
  });

  await t.test('gefüllte Sammlung: kein Assistent, aber das Band', async () => {
    await b.auswerten(`document.querySelector('#einrichtung-modal [data-click="einrichtungSpaeter"]').click(); true`);
    await haeltSet(db, uid, '10294-1', 1, { preis: 100 });
    await b.tab('Page.reload');
    await bis(
      `(() => { const g = document.getElementById('gallery'); return !!g && g.querySelectorAll('[data-click="openModal"], .card, .scard').length > 0; })()`,
      'Sammlung mit Set',
      300,
    );
    await ruhig();
    assert.equal(await b.auswerten(offen), false, 'Assistent über der gefüllten Sammlung');
    assert.equal(await b.auswerten(`document.getElementById('rb-hinweis').hidden`), false, 'Hinweisband fehlt');
  });
});
