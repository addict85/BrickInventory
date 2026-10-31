/**
 * Der Anleitungsabruf als Auftrag 'anleitung' (jobs/instructionQueue.ts):
 * Abstand nur nach einem echten Abruf, die Cloudflare-Leiter als Pause der
 * ganzen Art, die Sperre gegen einen zweiten Job-Prozess, ein Set nur einmal
 * offen. Der Abruf selbst ist nachgestellt; geprüft wird, was der Bearbeiter
 * daraus macht.
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  `if (letzterAbrufWarExtern())` vor der Takt-Pause entfernt → rot: „nach
 *      einem versorgten Set wartet niemand“
 *   B  in der Cloudflare-Leiter `stufe + 1` durch `stufe` ersetzt → rot: „die
 *      Cloudflare-Leiter steigt und endet am nächsten Tag“
 *   C  in mitSperre() die Prüfung `!rows[0]?.ok` durch `false` ersetzt → rot:
 *      „hält ein anderer Prozess die Sperre, wird nichts abgerufen“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const abruf = { extern: false, fehler: null, aufrufe: 0 };
const echtesRequire = Module.prototype.require;
Module.prototype.require = function (name) {
  const m = echtesRequire.apply(this, arguments);
  if (!/utils[/\\]instructions(\.js)?$/.test(name)) return m;
  return {
    ...m,
    anzahlAnleitungen: async () => 0,
    letzterAbrufWarExtern: () => abruf.extern,
    downloadSetInstructions: async () => {
      abruf.aufrufe++;
      if (abruf.fehler) throw abruf.fehler;
      return 1;
    },
  };
};

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

test('Anleitungen als Auftrag', { concurrency: 1 }, async (t) => {
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const Q = _req('jobs/instructionQueue.js');
  const A = _req('utils/auftraege.js');
  const { AuftragVerschieben } = _req('jobs/auftragsWorker.js');
  const pause = () => A.liesPause('anleitung');
  const inSek = async () => { const p = await pause(); return p ? Math.round((new Date(p.bis) - Date.now()) / 1000) : null; };
  const zuruecksetzen = () => db.run(`DELETE FROM auftrag_pausen WHERE art = 'anleitung'`);
  t.after(async () => {
    Module.prototype.require = echtesRequire;
    await zuruecksetzen();
    await db.run(`DELETE FROM auftraege WHERE art = 'anleitung'`);
    await db.pool.end().catch(() => {});
  });

  await t.test('nach einem versorgten Set wartet niemand', async () => {
    await zuruecksetzen();
    abruf.extern = false; abruf.fehler = null;
    await Q.anleitungLaden({ set_number: '10001-1' });
    assert.equal(await pause(), null, 'ohne fremden Abruf keine Pause');
    abruf.extern = true;
    await Q.anleitungLaden({ set_number: '10002-1' });
    const s = await inSek();
    assert.ok(s >= 13 && s <= 15, `nach einem echten Abruf ${s} s Abstand statt 15`);
  });

  await t.test('die Cloudflare-Leiter steigt und endet am nächsten Tag', async () => {
    await zuruecksetzen();
    abruf.fehler = new Error('Cloudflare error 1015: rate limited');
    const gesehen = [];
    for (let i = 0; i < 5; i++) {
      await assert.rejects(Q.anleitungLaden({ set_number: '10003-1' }), (e) => e instanceof AuftragVerschieben);
      gesehen.push(await inSek());
      await db.run(`UPDATE auftrag_pausen SET bis = NOW() WHERE art = 'anleitung'`);
    }
    assert.deepEqual(gesehen.slice(0, 4).map(s => Math.round(s / 60)), [5, 10, 15, 20]);
    const morgen = Q.naechsterTag();
    assert.ok(Math.abs(gesehen[4] - (morgen - Date.now()) / 1000) < 5, 'nach der vierten Sperre bis morgen');
    abruf.fehler = null; abruf.extern = false;
    await Q.anleitungLaden({ set_number: '10003-1' });
    assert.equal(await pause(), null, 'ein Erfolg setzt die Leiter zurück');
  });

  await t.test('hält ein anderer Prozess die Sperre, wird nichts abgerufen', async () => {
    await zuruecksetzen();
    const { LOCKS } = _req('src/infra/lockNamespaces.js');
    const fremd = await db.pool.connect();
    await fremd.query('SELECT pg_advisory_lock($1, 0)', [LOCKS.ANLEITUNGS_QUEUE]);
    const vorher = abruf.aufrufe;
    try {
      await assert.rejects(Q.anleitungLaden({ set_number: '10004-1' }), (e) => e instanceof AuftragVerschieben);
      assert.equal(abruf.aufrufe, vorher, 'trotz fremder Sperre abgerufen');
    } finally {
      await fremd.query('SELECT pg_advisory_unlock($1, 0)', [LOCKS.ANLEITUNGS_QUEUE]);
      fremd.release();
    }
    await Q.anleitungLaden({ set_number: '10004-1' });
    assert.equal(abruf.aufrufe, vorher + 1, 'Gegenprobe: ohne fremde Sperre wird abgerufen');
  });

  await t.test('ein Set steht nur einmal offen', async () => {
    await db.run(`DELETE FROM auftraege WHERE art = 'anleitung'`);
    const E = _req('utils/anleitungsAuftrag.js');
    await E.anleitungEinreihen('10005');
    await E.anleitungEinreihen('10005-1');
    assert.equal(await E.offeneAnleitungen(), 1, 'dasselbe Set (mit und ohne Version) zweimal eingereiht');
  });
});
