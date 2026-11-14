/**
 * „Fehlende Preise holen“ (src/auftraege/dienst.ts merkePreiseVor): Je Konto und
 * Währung steht höchstens ein Auftrag offen, der neue Posten aufnimmt — auch bei
 * gleichzeitigen Bewertungen. Läuft einer, kommt höchstens ein Folgeauftrag dazu,
 * und der laufende kann trotzdem zurück (verschoben, gescheitert, unterbrochen),
 * ohne am eindeutigen Schlüssel zu scheitern. Dazu der Fortschritt im Worker.
 *
 * Gegenproben (am 13.11.2026 gemessen, je einzeln, dist neu gebaut):
 *   A  in merkePreiseVor wieder ein Schlüssel je Postenliste (Hash) → rot: „je
 *      Konto und Währung ein offener Auftrag“ (zwei offene) und „gleichzeitig …“
 *   B  in ergaenzePreisAuftrag `DO UPDATE …` durch `DO NOTHING` ersetzt → rot:
 *      „je Konto und Währung …“ (die neuen Posten fehlen)
 *   C  in setzeVerschoben wieder fest 'offen' statt OFFEN_ODER_ERSETZT → rot:
 *      „der laufende geht zurück, während sein Folgeauftrag wartet“ (23505)
 *   D  in gibZurueck dasselbe → rot: derselbe Test (23505 beim Zurückgeben)
 *   E  in belegeAuftrag `wartet = false` entfernt → rot: „verschoben wartet, belegt nicht mehr“
 *   F  in setzeFortschritt Math.floor entfernt → rot: „Fortschritt ganzzahlig …“ (5.532)
 *   G  in fortschrittsKette `.then(melde, melde)` wieder `.then(melde)` → rot: derselbe Test
 *      (die Meldung nach der gescheiterten scheitert auch)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { zugangOderSkip } = require('./helpers/db');

const set = n => ({ art: 'set', nummer: `${n}-1`, zustand: 'N' });

test('Fehlende Preise holen: ein Auftrag je Konto und Währung', { concurrency: 1 }, async t => {
  const db = await zugangOderSkip(t, _req);
  if (!db) return;
  const NAME = `pna-${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [NAME])).id;
  const D = _req('src/auftraege/dienst.js');
  const repo = require('./helpers/sources').testBereich('auftraege').auftraege;
  const { erzeugeWorker } = _req('jobs/auftragsWorker.js');
  const leeren = () => db.run(`DELETE FROM auftraege WHERE art = 'preise_nachladen'`);
  const zeilen = () =>
    db.all(
      `SELECT id::text AS id, status, wartet, nutzlast->'posten' AS posten, nutzlast->>'waehrung' AS waehrung
         FROM auftraege WHERE art = 'preise_nachladen' AND user_id = $1 ORDER BY id`,
      [uid],
    );
  t.after(async () => {
    await leeren();
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await require('./helpers/sources')
      .testBereich('auftraege')
      .db.benachrichtigung.close()
      .catch(() => {});
    await db.pool.end().catch(() => {});
  });
  await leeren();

  await t.test('je Konto und Währung ein offener Auftrag, der neue Posten aufnimmt', async () => {
    const a = await D.merkePreiseVor({ user_id: uid, waehrung: 'CHF', posten: [set(1), set(2)] });
    const b = await D.merkePreiseVor({ user_id: uid, waehrung: 'CHF', posten: [set(2), set(3)] });
    assert.equal(b, a, 'eine zweite Liste stellte einen zweiten Auftrag ein');
    await D.merkePreiseVor({ user_id: uid, waehrung: 'EUR', posten: [set(9)] });
    const z = await zeilen();
    assert.deepEqual(
      z.map(x => [x.waehrung, x.status, x.posten.map(p => p.nummer)]),
      [
        ['CHF', 'offen', ['1-1', '2-1', '3-1']],
        ['EUR', 'offen', ['9-1']],
      ],
    );
  });

  await t.test('höchstens 2000 Posten, die älteren zuerst', async () => {
    await leeren();
    const viele = (von, n) => Array.from({ length: n }, (_, i) => set(von + i));
    await D.merkePreiseVor({ user_id: uid, waehrung: 'CHF', posten: viele(0, 1500) });
    await D.merkePreiseVor({ user_id: uid, waehrung: 'CHF', posten: viele(1000, 1500) });
    const [z] = await zeilen();
    assert.equal(z.posten.length, 2000);
    assert.deepEqual([z.posten[0].nummer, z.posten[1999].nummer], ['0-1', '1999-1']);
  });

  await t.test('gleichzeitige Bewertungen stellen trotzdem nur einen ein', async () => {
    await leeren();
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        D.merkePreiseVor({ user_id: uid, waehrung: 'CHF', posten: [set(100 + i), set(200)] }),
      ),
    );
    const z = await zeilen();
    assert.equal(z.length, 1, `${z.length} offene Aufträge`);
    assert.equal(z[0].posten.length, 9);
  });

  await t.test('läuft einer, kommt höchstens ein Folgeauftrag dazu', async () => {
    await leeren();
    await D.merkePreiseVor({ user_id: uid, waehrung: 'CHF', posten: [set(1)] });
    const lauf = await repo.belegeAuftrag(['preise_nachladen'], 60);
    assert.ok(lauf);
    await D.merkePreiseVor({ user_id: uid, waehrung: 'CHF', posten: [set(2)] });
    await D.merkePreiseVor({ user_id: uid, waehrung: 'CHF', posten: [set(3)] });
    assert.deepEqual(
      (await zeilen()).map(x => [x.status, x.posten.length]),
      [
        ['laeuft', 1],
        ['offen', 2],
      ],
    );
  });

  await t.test('der laufende geht zurück, während sein Folgeauftrag wartet', async () => {
    const bis = new Date(Date.now() + 6 * 3600_000);
    for (const zurueck of [
      a => D.verschoben(a, bis, 'BrickLink-Tageskontingent erschöpft', false),
      a => D.fehlgeschlagen(a, 'Quelle weg'),
      a => repo.gibZurueck(a),
    ]) {
      await leeren();
      await D.merkePreiseVor({ user_id: uid, waehrung: 'CHF', posten: [set(1)] });
      const lauf = await repo.belegeAuftrag(['preise_nachladen'], 60);
      const folge = await D.merkePreiseVor({ user_id: uid, waehrung: 'CHF', posten: [set(1), set(2)] });
      await zurueck(lauf);
      const z = await zeilen();
      assert.deepEqual(
        z.map(x => [x.id, x.status]),
        [
          [lauf.id, 'abgebrochen'],
          [folge, 'offen'],
        ],
      );
    }
  });

  await t.test('verschoben wartet, belegt nicht mehr', async () => {
    await leeren();
    await D.merkePreiseVor({ user_id: uid, waehrung: 'CHF', posten: [set(1)] });
    const lauf = await repo.belegeAuftrag(['preise_nachladen'], 60);
    await D.verschoben(lauf, new Date(Date.now() - 1000), 'BrickLink-Tageskontingent erschöpft', false);
    assert.deepEqual(
      (await zeilen()).map(x => [x.status, x.wartet]),
      [['offen', true]],
    );
    await repo.belegeAuftrag(['preise_nachladen'], 60);
    assert.deepEqual(
      (await zeilen()).map(x => [x.status, x.wartet]),
      [['laeuft', false]],
    );
  });

  await t.test('Fortschritt ganzzahlig, und eine gescheiterte Meldung hält die folgenden nicht an', async () => {
    await leeren();
    const id = await D.merkePreiseVor({ user_id: uid, waehrung: 'CHF', posten: [set(1)] });
    const stand = () => db.get('SELECT fortschritt FROM auftraege WHERE id = $1', [id]).then(r => r.fortschritt);
    const gesehen = [];
    const w = erzeugeWorker(require('./helpers/sources').testDienste().auftraege, {
      preise_nachladen: {
        ausfuehren: async (_n, k) => {
          await k.fortschritt({ erledigt: 5.532, gesamt: 8 });
          gesehen.push(await stand());
          // BigInt lässt sich nicht als JSON schreiben: Diese eine Meldung scheitert.
          await assert.rejects(k.fortschritt({ erledigt: 6, gross: 1n }));
          gesehen.push(await k.fortschritt({ erledigt: 7, gesamt: 8 }));
          gesehen.push(await stand());
        },
      },
    });
    assert.equal(await w.verarbeiteEinen(), true);
    assert.deepEqual(gesehen, [{ erledigt: 5, gesamt: 8 }, true, { erledigt: 7, gesamt: 8 }]);
    assert.equal((await zeilen())[0].status, 'erledigt');
  });
});
