'use strict';
/**
 * Der Worker hält das Lease eines Auftrags selbst, exklusive Arten bleiben
 * über Verbindungen hinweg einzeln, und ein Abbruch erreicht auch einen
 * Auftrag, der gerade auf einen Download wartet.
 *
 * Gegenproben (05.11.2026 gemessen):
 *   A  in fuehreAuftragAus() `haltePacht(...)` durch `() => {}` ersetzt → rot: „ein
 *      Auftrag ohne eigenes Lebenszeichen läuft genau einmal“ (5 Starts, Status fehler)
 *   C  Trigger auftrag_exklusiv gelöscht (DROP TRIGGER) → rot: „B belegt,
 *      solange A noch nicht festgeschrieben hat“
 *   D  im Worker `listen(AUFTRAG_STAND_KANAL, …)` entfernt → rot: „Abbruch
 *      eines csv_sync im Download dauerte 5000 ms“
 *   E  in abruf.ts das Signal nicht beachtet → rot: dieselbe Prüfung (der
 *      Lauf hing am Download)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');
const { warte, bis } = require('./helpers/zeit');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// Der CSV-Download antwortet mit 200 und liefert dann nichts mehr: ein hängender CDN.
let downloadLaeuft = false;
const Module = require('node:module');
const _echtesRequire = Module.prototype.require;
Module.prototype.require = function (name, ...rest) {
  const m = _echtesRequire.call(this, name, ...rest);
  if (name.replace(/^node:/, '') !== 'https') return m;
  return {
    ...m,
    get: (_url, _opt, beiAntwort) => {
      const req = Object.assign(new EventEmitter(), { destroy: () => {} });
      downloadLaeuft = true;
      const res = Object.assign(new PassThrough(), {
        statusCode: 200,
        headers: { 'content-length': '1000000' },
        complete: false,
      });
      setImmediate(() => beiAntwort(res));
      return req;
    },
  };
};

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');

test('Auftrags-Lease, Exklusivität und Abbruch', { concurrency: 1 }, async t => {
  const db = await dbOderSkip(t, _req);
  if (!db) return;
  const A = Object.assign(
    {},
    { ..._req('src/auftraege/dienst.js'), ..._req('src/auftraege/prozess.js').auftraegeBereich().auftraege },
  );
  const { erzeugeWorker } = _req('jobs/auftragsWorker.js');
  t.after(async () => {
    await _req('db/database.js').standardDb().benachrichtigung.close();
    await db.pool.end().catch(() => {});
  });

  await t.test('ein Auftrag ohne eigenes Lebenszeichen läuft genau einmal', async () => {
    await db.run("DELETE FROM auftraege WHERE art = 'wechselkurse'");
    let starts = 0;
    // Zwei Worker wie zwei Prozesse: Der zweite darf die Zeile nicht übernehmen, solange der erste arbeitet.
    // Die Arbeit dauert länger als die Frist (1 s): Nur das eigene Lebenszeichen hält die Zeile.
    const bearbeiter = {
      wechselkurse: {
        ausfuehren: async () => {
          starts++;
          await warte(4500);
        },
      },
    };
    const w = erzeugeWorker(bearbeiter, { parallel: 2, fristSek: 1, taktMs: 300 });
    const w2 = erzeugeWorker(bearbeiter, { parallel: 2, fristSek: 1, taktMs: 300 });
    const id = await A.stelleAuftragEin('wechselkurse', {}, { schluessel: `pacht-${process.pid}` });
    const status = async () => (await db.get('SELECT status FROM auftraege WHERE id = $1', [id])).status;
    w.starte();
    await bis(async () => (await status()) === 'laeuft');
    w2.starte();
    await bis(async () => (await status()) === 'erledigt', 8000);
    await w.stoppe(100);
    await w2.stoppe(100);
    const z = await db.get('SELECT status, versuche FROM auftraege WHERE id = $1', [id]);
    assert.deepEqual(
      { starts, ...z },
      { starts: 1, status: 'erledigt', versuche: 1 },
      'ein Auftrag ohne eigenes Lebenszeichen läuft genau einmal',
    );
  });

  await t.test('die zweite Verbindung belegt keinen zweiten csv_sync', async () => {
    await db.run("DELETE FROM auftraege WHERE art = 'csv_sync'");
    await db.run(
      `INSERT INTO auftraege (art, nutzlast, schluessel) VALUES ('csv_sync', '{}', 'x1'), ('csv_sync', '{}', 'x2')`,
    );
    const a = await db.pool.connect();
    try {
      await a.query('BEGIN');
      // Verbindung A belegt und hält ihre Transaktion offen; B belegt über den Dienst.
      const ra =
        await a.query(`UPDATE auftraege SET status = 'laeuft', belegt_von = 'A', frist_bis = NOW() + INTERVAL '5 min'
                                 WHERE schluessel = 'x1' RETURNING id`);
      assert.equal(ra.rowCount, 1);
      assert.equal(
        await A.belegeAuftrag(['csv_sync'], 60, 'B', ['csv_sync']),
        null,
        'B belegt, solange A noch nicht festgeschrieben hat',
      );
      await a.query('COMMIT');
    } finally {
      a.release();
    }
    assert.equal(
      await A.belegeAuftrag(['csv_sync'], 60, 'B', ['csv_sync']),
      null,
      'B belegt nach dem Festschreiben von A',
    );
    const laufend = await db.all("SELECT belegt_von FROM auftraege WHERE art = 'csv_sync' AND status = 'laeuft'");
    assert.deepEqual(
      laufend.map(z => z.belegt_von),
      ['A'],
      'die zweite Verbindung belegt keinen zweiten csv_sync',
    );
    await db.run("DELETE FROM auftraege WHERE art = 'csv_sync'");
  });

  await t.test('Abbruch eines csv_sync im Download endet in höchstens 2 s', async () => {
    await db.run("DELETE FROM auftraege WHERE art = 'csv_sync'");
    const { BEARBEITER } = _req('jobs/auftraegeStarten.js');
    const w = erzeugeWorker({ csv_sync: BEARBEITER.csv_sync }, { fristSek: 60, taktMs: 100 });
    const id = await A.stelleAuftragEin('csv_sync', {});
    downloadLaeuft = false;
    w.starte();
    t.after(() => w.stoppe(0));
    await bis(() => w.laufend() > 0);
    assert.equal(w.laufend(), 1, 'der Abgleich läuft');
    assert.ok(await bis(() => downloadLaeuft), 'der Download hat begonnen');
    const start = Date.now();
    assert.ok(await A.brichAb(id));
    await bis(() => w.laufend() === 0);
    const dauer = Date.now() - start;
    assert.ok(dauer <= 2000, `Abbruch eines csv_sync im Download dauerte ${dauer} ms`);
    assert.equal((await db.get('SELECT status FROM auftraege WHERE id = $1', [id])).status, 'abgebrochen');
  });
});
