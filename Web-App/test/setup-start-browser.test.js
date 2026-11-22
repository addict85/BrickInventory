/**
 * The setup wizard only opens by itself over an EMPTY collection
 * (or as long as the initial password applies). Over a filled collection
 * it stays closed, and the hint banner about the Rebrickable key says so. Its
 * text does not promise „bleibt leer“, and the headings follow the level.
 *
 * Counter-checks (measured on 03.11.2026):
 *   A  the inventory check removed in pruefeEinrichtung → red: “filled
 *      collection: no wizard, but the banner”
 *   B  the Rebrickable heading again <h3> → red: “empty collection:
 *      wizard, text and headings” (levels 3,2,2; axe alone stayed
 *      green here, because in the empty state an h2 stands before it)
 *   C  setup.rb_hint again „… bleibt die Sammlung leer …“ → red: the same check
 *   D  (04.11.) in setupSource the check for an empty field removed
 *      → red: “check key: error at the field, in plain text” (no error at the field)
 *   E  (04.11.) quellenFehler no longer shows the details → red: the same
 *      check („Technische Details“ missing)
 *   F  (04.11.) discardToasts removed in zeige() → red: the same check
 *      (toast „Verbindung steht“ stays standing in the next step)
 *   G  (04.11.) in POST /settings the exception for the first key also switched off
 *      in the setup → red: the same check (password question,
 *      „Klartext statt Rohtext“ times out)
 *
 * Without Chrome (CHROME_BIN, google-chrome, chromium) it is skipped.
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');
const { holdsSet } = require('./helpers/inventory');

const AXE = require('axe-core').source;
const SCHLUESSEL = ['rebrickable_api_key', 'einrichtung_erledigt'];

test('setup wizard only above an empty collection', { concurrency: 1, timeout: 300_000 }, async t => {
  const app = await startApp(t, {
    name: `einr_${process.pid}`,
    holding: async db => {
      await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
    },
    // The fetch at Rebrickable runs in the server; here its response is fixed.
    intercept: [
      {
        muster: '*test-source*',
        contains: 'test-source',
        response: {
          success: false,
          code: 'source_unreachable',
          error: 'Rebrickable ist nicht erreichbar. Bitte die Internetverbindung des Servers prüfen.',
          details: 'getaddrinfo ENOTFOUND rebrickable.com',
        },
      },
    ],
  });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, bis, db, uid, ruhig } = app;
  const open = `document.getElementById('setup-modal').classList.contains('open')`;

  await t.test('empty collection: wizard, text and headings', async () => {
    await bis(open, 'Assistent');
    const text = await b.auswerten(`document.querySelector('#setup-modal .wiz-step.active')?.textContent || ''`);
    assert.match(text, /Rebrickable/);
    assert.doesNotMatch(text, /bleibt die Sammlung leer/);
    const funde = await b.auswerten(`(async () => { if (!window.axe) (0, eval)(${JSON.stringify(AXE)});
      const r = await axe.run(document, { runOnly: ['heading-order'] }); return r.violations.flatMap(v => v.nodes.map(n => v.id + ' ' + n.target.join(' '))); })()`);
    assert.deepEqual(funde, []);
    // Whether axe reports heading-order depends on which heading stands before it on
    // the page (above 12 sets: h1, in the empty state: h2). The title of the
    // dialog is not a heading; its steps therefore begin at h2.
    const layers = await b.auswerten(
      `[...document.querySelectorAll('#setup-modal h1, #setup-modal h2, #setup-modal h3, #setup-modal h4')].map(h => +h.tagName[1])`,
    );
    assert.ok(layers.length >= 3, `Testdaten: ${layers}`);
    assert.ok(
      layers[0] === 2 && layers.every((e, i) => i === 0 || e <= layers[i - 1] + 1),
      `Überschriften im Assistenten: ${layers}`,
    );
  });

  await t.test('check key: error at the field, in plain text', async () => {
    const check = `document.querySelector('#setup-modal .wiz-step.active [data-click="setupSource"]').click(); true`;
    const state = `({ fehler: document.getElementById('wiz-error-rebrickable').textContent, ungueltig: document.getElementById('wiz-rb').getAttribute('aria-invalid'),
      fokus: document.activeElement?.id, zeichen: document.getElementById('wiz-status-rebrickable').className,
      toasts: [...document.querySelectorAll('#toasts .toast.error')].map(x => x.textContent) })`;
    await b.auswerten(check);
    await bis(`document.getElementById('wiz-error-rebrickable').textContent !== ''`, 'Fehler am leeren Feld', 50);
    const leer = await b.auswerten(state);
    assert.match(leer.fehler, /Schlüssel eintragen/);
    assert.deepEqual([leer.invalid, leer.fokus, leer.toasts], ['true', 'wiz-rb', []]);
    await b.auswerten(`document.getElementById('wiz-rb').value = 'probe-schluessel'; true`);
    await b.auswerten(check);
    await bis(
      `/nicht erreichbar/.test(document.getElementById('wiz-error-rebrickable').textContent)`,
      'Klartext statt Rohtext',
      100,
    );
    const z = await b.auswerten(state);
    assert.ok(
      await db.get("SELECT 1 FROM global_settings WHERE key = 'rebrickable_api_key'"),
      'in der Einrichtung speichert der Assistent den ersten Schlüssel ohne Passwortfrage',
    );
    assert.match(z.fehler, /Technische Details/, 'die technische Ursache steht aufklappbar dabei');
    assert.match(z.zeichen, /missing/, '✗ neben dem Titel');
    assert.deepEqual(z.toasts, []);
    await b.auswerten(
      `document.getElementById('toasts').append(Object.assign(document.createElement('div'), { className: 'toast success', textContent: 'Verbindung steht' })); document.getElementById('wiz-next').click(); true`,
    );
    assert.equal(
      await b.auswerten(`document.querySelectorAll('#toasts .toast').length`),
      0,
      'Meldungen bleiben nicht über den Schrittwechsel stehen',
    );
    await b.auswerten(`document.getElementById('wiz-back').click(); true`);
    // The wizard has stored the sample key; the banner below needs it missing.
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
  });

  await t.test('filled collection: no wizard, but the banner', async () => {
    await b.auswerten(`document.querySelector('#setup-modal [data-click="setupLater"]').click(); true`);
    await holdsSet(db, uid, '10294-1', 1, { preis: 100 });
    await b.tab('Page.reload');
    await bis(
      `(() => { const g = document.getElementById('gallery'); return !!g && g.querySelectorAll('[data-click="openModal"], .card, .scard').length > 0; })()`,
      'Sammlung mit Set',
      300,
    );
    await ruhig();
    assert.equal(await b.auswerten(open), false, 'Assistent über der gefüllten Sammlung');
    assert.equal(await b.auswerten(`document.getElementById('rb-hint').hidden`), false, 'Hinweisband fehlt');
  });
});
