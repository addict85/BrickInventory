/**
 * Kein Markup aus Daten: Namen, Themen, Kategorien und Lagerorte mit XSS-Nutzlast
 * durch die Hauptansichten gerendert, im echten Chrome.
 *
 * Geprüft wird das Ergebnis im DOM, nicht der Quelltext: Kein Element trägt einen
 * Ereignis-Handler aus den Daten, kein <img src=x> oder <svg> aus der Nutzlast
 * entsteht, und die Nutzlast steht als Text da (sonst wäre die Ansicht leer und
 * der Test bewiese nichts). Die CSP würde einen Handler ohnehin nicht ausführen;
 * deshalb zählt das Element, nicht der Aufruf.
 *
 * Gegenproben (gemessen):
 *   A  im Kachelnamen der Sammlung (02-gallery.js) `${esc(s.name || '')}` durch
 *      `${s.name || ''}` ersetzt → rot: „Sammlung“ mit img[onerror]
 *   B  in der Lagerortliste der Einstellungen (05-lagerorte.js) das Maskieren des
 *      Namens entfernt → rot: „Lagerorte“
 *
 * Ohne Chrome (CHROME_BIN) wird übersprungen; Voraussetzung: Test-DB.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp, warte } = require('./helpers/app-browser');
const { haeltSet, haeltTeil, haeltFigur } = require('./helpers/bestand');

const N = `<img src=x onerror="window.__xss=1">"'><svg onload="window.__xss=2">`;
const SPUR = 'XSS-Spur';

/** Was im DOM aus der Nutzlast entstanden wäre, und ob sie als Text dasteht. */
const PRUEFE = `(() => {
  const fremd = [...document.querySelectorAll('*')].filter(e =>
      [...e.attributes].some(a => /^on/i.test(a.name)) || (e.tagName === 'IMG' && e.getAttribute('src') === 'x'))
    .map(e => e.outerHTML.slice(0, 100));
  return { fremd, xss: window.__xss ?? null, alsText: document.body.innerText.includes('<img src=x onerror')
    || [...document.querySelectorAll('input')].some(i => i.getClientRects().length && i.value.includes('<img src=x onerror')) };
})()`;

test('XSS-Nutzlasten in den Hauptansichten bleiben Text', { concurrency: 1, timeout: 300_000 }, async (t) => {
  const app = await starteApp(t, {
    name: `xss_${process.pid}`,
    bestand: async (db, uid) => {
      const ort = (await db.get('INSERT INTO storage_locations (user_id, name) VALUES ($1, $2) RETURNING id', [uid, `${SPUR} ${N}`])).id;
      for (const [nr, was] of [['99901-1', 'Set'], ['99902-1', 'Wunsch']])
        await db.run(`INSERT INTO set_catalog (set_number, name, theme, year, pieces) VALUES ($1, $2, $3, 2020, 100)
                      ON CONFLICT (set_number) DO UPDATE SET name = $2, theme = $3`, [nr, `${SPUR} ${was} ${N}`, `${SPUR} Thema ${N}`]);
      await haeltSet(db, uid, '99901-1', 1, { preis: 10 });
      await db.run('UPDATE sets SET storage_id = $1 WHERE user_id = $2 AND set_number = $3', [ort, uid, '99901-1']);
      await db.run(`INSERT INTO teil_eigen (user_id, part_number, part_name, category_name) VALUES ($1, 'xss1', $2, $3)`,
        [uid, `${SPUR} Teil ${N}`, `${SPUR} Kategorie ${N}`]);
      await haeltTeil(db, uid, 'xss1', { storageId: ort, preis: 1 });
      await db.run(`INSERT INTO figur_eigen (user_id, fig_number, fig_name) VALUES ($1, 'fig-xss1', $2)`, [uid, `${SPUR} Figur ${N}`]);
      await haeltFigur(db, uid, 'fig-xss1', { storageId: ort, preis: 1 });
      await db.run(`INSERT INTO wanted (user_id, set_number, condition) VALUES ($1, '99902-1', 'N')`, [uid]);
    },
  });
  if (app.grund) { t.skip(app.grund); return; }
  const { b, bis } = app;
  await warte(800);
  await b.auswerten(`document.querySelector('#einrichtung-modal.open [data-click="einrichtungSpaeter"]')?.click(); true`);

  /** @param {string} name @param {string} hash @param {string} [bereit] Ausdruck, der wahr wird, wenn die Daten stehen */
  const ansicht = async (name, hash, bereit) => {
    await t.test(name, async () => {
      await b.auswerten(`location.hash = ${JSON.stringify(hash)}; true`);
      await bis(bereit ?? `document.body.innerText.includes(${JSON.stringify(SPUR + ' ')})`, `${name}: Daten sichtbar`);
      await warte(300);
      const r = await b.auswerten(PRUEFE);
      assert.deepEqual(r.fremd, [], `${name}: Markup aus Daten im DOM`);
      assert.equal(r.xss, null, `${name}: Nutzlast ausgeführt`);
      assert.ok(r.alsText, `${name}: Nutzlast steht nicht als Text da — prüft der Test noch etwas?`);
    });
  };
  await ansicht('Sammlung', '#/sammlung', `document.querySelector('#gallery')?.innerText.includes(${JSON.stringify(SPUR + ' Set')})`);
  await ansicht('Set-Detail', '#/sammlung/set/99901-1', `document.querySelector('#set-modal.open')?.innerText.includes(${JSON.stringify(SPUR)})`);
  await b.auswerten(`document.querySelector('#set-modal.open [data-click="closeModal"]')?.click(); true`);
  await ansicht('Teile', '#/teile');
  await ansicht('Figuren', '#/minifiguren');
  await ansicht('Merkliste', '#/merkliste');
  await ansicht('Finanzen', '#/finanzen');
  // Die Orte stehen hier in Eingabefeldern (umbenennen); der Name ist dann ein value, kein Text.
  await ansicht('Lagerorte', '#/lagerorte', `[...document.querySelectorAll('.lager-eingabe')].some(i => i.value.includes(${JSON.stringify(SPUR)}))`);
});
