/**
 * Der CSV-Import als Auftrag: Er entscheidet nur für seine eigenen Aufrufe,
 * dass die Nacharbeit je Set ausfällt, und er setzt nach einem Neustart fort.
 *
 * Vorher zählte routes/sets.ts laufende Importe in `global._csvImportLaeufe`,
 * und addSet() liess die Nacharbeit für JEDES Konto im Prozess aus, solange
 * der Zähler über null stand.
 *
 * Gegenproben (am 29.10.2026 gemessen):
 *   A  den Zähler nachgebaut (globalThis.__importe in fuehreCsvImportAus hoch
 *      und wieder herunter, addSetIntern stellt nur bei 0 ein) → rot: „ein
 *      Set eines anderen Kontos bekommt während des Imports seine Nacharbeit“
 *   B  setzeImportFort nur für status 'running' → rot: „ein unterbrochener
 *      Import setzt fort“ (der als verwaist markierte Lauf blieb stehen)
 *   C  in fuehreCsvImportAus `stand.current` nicht beachtet → rot: „ein
 *      unterbrochener Import setzt fort“ (r2 wurde ein zweites Mal gebucht)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne API-Schlüssel und ohne
 * Bildabruf, damit addSet() kein Netz braucht.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// addSetWithDate gestellt: Jeder Aufruf wird gezählt und wartet auf `freigabe`.
const aufrufe = [];
let freigabe = Promise.resolve();
let loslassen = () => {};
const Module = require('node:module');
const _echtesRequire = Module.prototype.require;
Module.prototype.require = function (name) {
  const m = _echtesRequire.apply(this, arguments);
  if (typeof name === 'string' && /utils[/\\]setService(\.js)?$/.test(name))
    return new Proxy(m, { get: (t, k) => k !== 'addSetWithDate' ? t[k] : async (sn) => {
      aufrufe.push(sn);
      await freigabe;
      return { action: 'added', set_number: sn };
    } });
  if (typeof name === 'string' && /(^|[/\\])setImages(\.js)?$/.test(name))
    return new Proxy(m, { get: (t, k) => k === 'downloadSetImage' ? async () => null : t[k] });
  return m;
};

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const warte = (ms) => new Promise(r => setTimeout(r, ms));

test('CSV-Import als Auftrag', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const schluessel = ['rebrickable_api_key', 'brickset_api_key', 'bricklink_consumer_key'];
  const vorher = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [schluessel]);
  await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [schluessel]);
  const konto = async (name) => {
    await db.run('DELETE FROM users WHERE username=$1', [name]);
    return (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [name])).id;
  };
  const a = await konto(`csvauftrag-a-${process.pid}`);
  const b = await konto(`csvauftrag-b-${process.pid}`);
  const { stelleAuftragEin } = _req('utils/auftraege.js');
  const { jobSet } = _req('utils/importAuftrag.js');
  const worker = _req('jobs/auftraegeStarten.js').starteAuftragsWorker({ arten: ['csv_import'], taktMs: 50 });
  const nacharbeit = (uid) => db.all(
    `SELECT nutzlast->>'set_number' AS sn, nutzlast->>'art' AS art FROM auftraege
      WHERE art = 'nacharbeit' AND user_id = $1 ORDER BY id`, [uid]);
  const stand = () => db.get('SELECT status, done, results, current FROM import_stand WHERE user_id=$1', [a]);
  const bisFertig = async () => {
    for (let i = 0; i < 200; i++) { const s = await stand(); if (s?.status === 'done') return s; await warte(25); }
    return stand();
  };

  try {
    await t.test('ein Set eines anderen Kontos bekommt während des Imports seine Nacharbeit', async () => {
      aufrufe.length = 0;
      freigabe = new Promise(r => { loslassen = r; });
      const lauf = `lauf-${process.pid}-1`;
      const rows = [{ sn: '76001-1', qty: 1, purchasePrice: null, condition: null, acquiredAt: null }];
      await jobSet(a, { status: 'running', total: 1, done: 0, current: null, results: '[]', error: null, run_id: lauf });
      await stelleAuftragEin('csv_import', { user_id: a, lauf, rows }, { userId: a });
      for (let i = 0; i < 100 && !aufrufe.length; i++) await warte(20);
      assert.deepEqual(aufrufe, ['76001-1'], 'der Import steckt im ersten Set');

      const SN = `7${process.pid % 10000}-1`;
      const r = await _req('utils/setService.js').addSet(SN, 1, b, null, 10, 'N');
      assert.equal(r.action, 'added');
      assert.deepEqual(await nacharbeit(b), [{ sn: SN, art: 'neu' }]);

      loslassen();
      assert.equal((await bisFertig()).status, 'done');
      assert.deepEqual(await nacharbeit(a), [{ sn: '76001-1', art: 'csv' }], 'der Import stellt seine Nacharbeit selbst ein');
    });

    await t.test('ein unterbrochener Import setzt fort', async () => {
      aufrufe.length = 0;
      freigabe = Promise.resolve();
      const lauf = `lauf-${process.pid}-2`;
      const rows = ['r1', 'r2', 'r3'].map(sn => ({ sn, qty: 1, purchasePrice: null, condition: null, acquiredAt: null }));
      // So sieht es nach einem Absturz mitten in r2 aus: jobGet() hat den Lauf
      // als verwaist markiert, der Auftrag steht auf 'laeuft' mit abgelaufener Frist.
      await jobSet(a, { status: 'error', total: 3, done: 1, current: 'r2', error: 'unterbrochen',
                        results: JSON.stringify([{ set_number: 'r1', success: true, action: 'added' }]), run_id: lauf });
      await db.run(`INSERT INTO auftraege (art, nutzlast, user_id, status, versuche, frist_bis)
                    VALUES ('csv_import', $1, $2, 'laeuft', 1, NOW() - INTERVAL '1 minute')`,
        [JSON.stringify({ user_id: a, lauf, rows }), a]);
      const s = await bisFertig();
      assert.equal(s.status, 'done');
      assert.deepEqual(aufrufe, ['r3'], 'r1 ist fertig, r2 ungewiss — gebucht wird nur r3');
      assert.deepEqual(s.results.map(z => [z.set_number, z.success, !!z.isWarning]),
        [['r1', true, false], ['r2', false, true], ['r3', true, false]]);
    });
  } finally {
    loslassen();
    await worker.stoppe(0);
    await _req('db/pgNotify.js').close();
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[a, b]]);
    for (const z of vorher) await db.run('INSERT INTO global_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2', [z.key, z.value]);
    await db.pool.end().catch(() => {});
  }
});
