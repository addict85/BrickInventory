/**
 * Zweite Linie im Repository: Die schreibenden Funktionen für Erfassungen
 * ändern, löschen und verschieben nur Zeilen der übergebenen Konten, auch wenn
 * ein Aufrufer die Prüfung im Schreib-Blickfeld vergisst. Gemessen gegen die
 * echte Datenbank, die Funktionen werden direkt gerufen.
 *
 * Gegenproben (am 08.11.2026 gemessen, je einzeln):
 *   A  in setzeErfassungsMenge() `AND user_id = ANY($3)` entfernt → rot:
 *      „Menge, Preis, Zustand und Datum einer fremden Erfassung bleiben“
 *   B  dasselbe in kuerzeErfassung() → rot: „eine fremde manuelle Erfassung
 *      lässt sich weder kürzen noch entfernen“
 *   C  in loescheSetErfassung() die Konten-Bedingung entfernt → rot: „eine
 *      fremde Erfassung lässt sich nicht aus einem Verschieben löschen“
 *   D  in entferneManuell() `AND user_id = $2` bei der Bestandszeile entfernt
 *      → rot: „die Bestandszeile eines fremden Kontos bleibt“
 *   (Jeweils auch die eigene Seite: „Gegenprobe: mit dem richtigen Konto
 *   wirkt dieselbe Funktion“ bleibt grün.)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const erf = _req('src/sammlung/repository/erfassungen.js');
const manuell = {
  ..._req('src/bestand/repository/manuelleMengen.js'),
  ..._req('src/bestand/prozess.js').bestandBereich().manuelleMengen,
};
const versch = _req('src/sets/repository/verschieben.js');

test('Repository schreibt nur in übergebene Konten', { concurrency: 1 }, async t => {
  const db = await dbOderSkip(t, _req);
  if (!db) return;
  const name = n => `zl_${process.pid}_${n}`;
  const konto = async n =>
    (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [name(n)])).id;
  const eigen = await konto('eigen');
  const fremd = await konto('fremd');
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[eigen, fremd]]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const ein = fn => db.transaction(fn);

  // Je Erfassung ein eigener Satz: Pro Tag und Set ist nur eine Erfassung erlaubt.
  let zaehler = 0;
  const setErfassung = async uid => {
    const sn = `7519${++zaehler}-1`;
    await db.run(`INSERT INTO sets (user_id, set_number) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [uid, sn]);
    return (
      await db.get(
        `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, currency)
     VALUES ($1,$2,3,10,'N','EUR') RETURNING id`,
        [uid, sn],
      )
    ).id;
  };
  const lies = (tabelle, id) => db.get(`SELECT * FROM ${tabelle} WHERE id = $1`, [id]);

  await t.test('Menge, Preis, Zustand und Datum einer fremden Erfassung bleiben', async () => {
    const id = await setErfassung(fremd);
    await ein(async tx => {
      await erf.setzeErfassungsMenge(tx, 'set', id, 99, [eigen]);
      await erf.setzeErfassungsPreis(tx, 'set', id, 1, true, [eigen]);
      await erf.setzeErfassungsZustand(tx, 'set', id, 'U', [eigen]);
      await erf.setzeErfassungsDatum(tx, 'set', id, '2020-01-02', [eigen]);
    });
    const z = await lies('set_acquisitions', id);
    assert.deepEqual([z.quantity, Number(z.purchase_price), z.condition, z.price_estimated], [3, 10, 'N', false]);
  });

  await t.test('Gegenprobe: mit dem richtigen Konto wirkt dieselbe Funktion', async () => {
    const id = await setErfassung(fremd);
    await ein(async tx => {
      await erf.setzeErfassungsMenge(tx, 'set', id, 99, [eigen, fremd]);
      await erf.setzeErfassungsPreis(tx, 'set', id, 1, true, [fremd]);
      await erf.setzeErfassungsZustand(tx, 'set', id, 'U', [fremd]);
      await erf.setzeErfassungsDatum(tx, 'set', id, '2020-01-02', [fremd]);
    });
    const z = await lies('set_acquisitions', id);
    assert.deepEqual([z.quantity, Number(z.purchase_price), z.condition, z.price_estimated], [99, 1, 'U', true]);
    assert.equal((await db.get('SELECT tag::text AS t FROM set_acquisitions WHERE id = $1', [id])).t, '2020-01-02');
  });

  await t.test('eine fremde manuelle Erfassung lässt sich weder kürzen noch entfernen', async () => {
    const id = (
      await db.get(
        `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, currency) VALUES ($1,'3001',5,4,'EUR') RETURNING id`,
        [fremd],
      )
    ).id;
    await ein(async tx => {
      await manuell.kuerzeErfassung(tx, 'part', id, 1, [eigen]);
      await manuell.entferneErfassung(tx, 'part', id, [eigen]);
    });
    assert.equal((await lies('part_acquisitions', id)).quantity, 4);
    await ein(tx => manuell.kuerzeErfassung(tx, 'part', id, 1, [fremd]));
    assert.equal((await lies('part_acquisitions', id)).quantity, 3, 'Gegenprobe: das eigene Konto kürzt');
    await ein(tx => manuell.entferneErfassung(tx, 'part', id, [fremd]));
    assert.equal(await lies('part_acquisitions', id), undefined, 'Gegenprobe: das eigene Konto entfernt');
  });

  await t.test('eine fremde Erfassung lässt sich nicht aus einem Verschieben löschen', async () => {
    const setId = await setErfassung(fremd);
    const figId = (
      await db.get(
        `INSERT INTO minifig_acquisitions (user_id, fig_number, quantity, currency) VALUES ($1,'fig-000001',1,'EUR') RETURNING id`,
        [fremd],
      )
    ).id;
    await ein(async tx => {
      await versch.loescheSetErfassung(tx, setId, [eigen]);
      await versch.loescheManuelleErfassung(tx, 'fig', figId, [eigen]);
    });
    assert.ok(await lies('set_acquisitions', setId));
    assert.ok(await lies('minifig_acquisitions', figId));
    await ein(async tx => {
      await versch.loescheSetErfassung(tx, setId, [fremd]);
      await versch.loescheManuelleErfassung(tx, 'fig', figId, [fremd]);
    });
    assert.equal(await lies('set_acquisitions', setId), undefined, 'Gegenprobe: das eigene Konto löscht');
    assert.equal(await lies('minifig_acquisitions', figId), undefined);
  });

  await t.test('die Bestandszeile eines fremden Kontos bleibt', async () => {
    const zeile = (
      await db.get(
        `INSERT INTO minifigs (user_id, fig_number, source) VALUES ($1,'fig-000002','manual') RETURNING id`,
        [fremd],
      )
    ).id;
    await ein(tx => versch.entferneManuell(tx, 'fig', eigen, ['fig-000002'], zeile));
    assert.ok(await lies('minifigs', zeile), 'mit dem Konto des Absenders ist es eine fremde Zeile');
    await ein(tx => versch.entferneManuell(tx, 'fig', fremd, ['fig-000002'], zeile));
    assert.equal(await lies('minifigs', zeile), undefined, 'Gegenprobe: das eigene Konto entfernt');
  });
});
