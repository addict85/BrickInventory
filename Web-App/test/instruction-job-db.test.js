/**
 * Der Anleitungsabruf als Auftrag 'anleitung' (src/catalog/loadInstruction.ts):
 * Abstand nur nach einem echten Abruf, die Cloudflare-Leiter als Pause der
 * ganzen Art, die Sperre gegen einen zweiten Job-Prozess, ein Set nur einmal
 * offen. Der Abruf selbst ist nachgestellt; geprüft wird, was der Bearbeiter
 * daraus macht.
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  `if (lastFetchWarExtern())` vor der Takt-Pause entfernt → rot: „nach
 *      einem versorgten Set waiting niemand“
 *   B  in der Cloudflare-Leiter `level + 1` durch `level` ersetzt → rot: „die
 *      Cloudflare-Leiter steigt und endet am nächsten Tag“
 *   C  in withLock() die Prüfung `!rows[0]?.ok` durch `false` ersetzt → rot:
 *      „hält ein anderer Prozess die Sperre, wird nichts abgerufen“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const abruf = { extern: false, error_message: null, aufrufe: 0 };
const realRequire = Module.prototype.require;
Module.prototype.require = function (name, ...rest) {
  const m = realRequire.call(this, name, ...rest);
  if (!/[/\\]instructions(\.js)?$/.test(name)) return m;
  return {
    ...m,
    anzahlAnleitungen: async () => 0,
    lastFetchWarExtern: () => abruf.extern,
    setAnleitungenLaden: async () => {
      abruf.aufrufe++;
      if (abruf.error_message) throw abruf.error_message;
      return 1;
    },
  };
};

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = testData();

test('instructions as a job', { concurrency: 1 }, async t => {
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  const Q = _req('src/catalog/loadInstruction.js');
  const A = Object.assign({}, _req('src/jobQueue/jobs.js'), {
    ..._req('src/jobQueue/service.js'),
    ...require('./helpers/sources').testArea('jobQueue').auftraege,
  });
  const { JobMove } = _req('jobs/jobWorker.js');
  const pause = () => A.liesPause('anleitung');
  const inSec = async () => {
    const p = await pause();
    return p ? Math.round((new Date(p.until_at).getTime() - Date.now()) / 1000) : null;
  };
  const zuruecksetzen = () => db.run(`DELETE FROM job_pauses WHERE type = 'anleitung'`);
  t.after(async () => {
    Module.prototype.require = realRequire;
    await zuruecksetzen();
    await db.run(`DELETE FROM jobs WHERE type = 'anleitung'`);
    await db.pool.end().catch(() => {});
  });

  await t.test('after a supplied set nobody waits', async () => {
    await zuruecksetzen();
    abruf.extern = false;
    abruf.error_message = null;
    await Q.anleitungLaden({ set_number: '10001-1' });
    assert.equal(await pause(), null, 'ohne fremden Abruf keine Pause');
    abruf.extern = true;
    await Q.anleitungLaden({ set_number: '10002-1' });
    const s = await inSec();
    assert.ok(s >= 13 && s <= 15, `nach einem echten Abruf ${s} s Abstand statt 15`);
  });

  await t.test('the Cloudflare ladder climbs and ends the next day', async () => {
    await zuruecksetzen();
    abruf.error_message = new Error('Cloudflare error 1015: rate limited');
    const gesehen = [];
    for (let i = 0; i < 5; i++) {
      await assert.rejects(Q.anleitungLaden({ set_number: '10003-1' }), e => e instanceof JobMove);
      gesehen.push(await inSec());
      await db.run(`UPDATE job_pauses SET until_at = NOW() WHERE type = 'anleitung'`);
    }
    assert.deepEqual(
      gesehen.slice(0, 4).map(s => Math.round(s / 60)),
      [5, 10, 15, 20],
    );
    const morgen = Q.nextTag(new Date());
    assert.ok(Math.abs(gesehen[4] - (morgen - Date.now()) / 1000) < 5, 'nach der vierten Sperre until_at morgen');
    abruf.error_message = null;
    abruf.extern = false;
    await Q.anleitungLaden({ set_number: '10003-1' });
    assert.equal(await pause(), null, 'ein Erfolg setzt die Leiter zurück');
  });

  await t.test('if another process holds the lock, nothing is fetched', async () => {
    await zuruecksetzen();
    const { LOCKS } = _req('src/infra/lockNamespaces.js');
    const fremd = await db.pool.connect();
    await fremd.query('SELECT pg_advisory_lock($1, 0)', [LOCKS.ANLEITUNGS_QUEUE]);
    const vorher = abruf.aufrufe;
    try {
      await assert.rejects(Q.anleitungLaden({ set_number: '10004-1' }), e => e instanceof JobMove);
      assert.equal(abruf.aufrufe, vorher, 'trotz fremder Sperre abgerufen');
    } finally {
      await fremd.query('SELECT pg_advisory_unlock($1, 0)', [LOCKS.ANLEITUNGS_QUEUE]);
      fremd.release();
    }
    await Q.anleitungLaden({ set_number: '10004-1' });
    assert.equal(abruf.aufrufe, vorher + 1, 'Gegenprobe: ohne fremde Sperre wird abgerufen');
  });

  await t.test('a set is open only once', async () => {
    await db.run(`DELETE FROM jobs WHERE type = 'anleitung'`);
    const E = _req('src/catalog/instructionJob.js');
    await E.anleitungEinreihen('10005');
    await E.anleitungEinreihen('10005-1');
    const z = await require('./helpers/sources').testServices().jobQueue.countKind('anleitung');
    assert.equal(z.offen + z.laeuft, 1, 'dasselbe Set (mit und ohne Version) zweimal eingereiht');
  });
});
