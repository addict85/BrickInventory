/**
 * Der Set-CSV-Import ist ehrlich zu Fehlern (UI-Prüfung 17, M2): Eine
 * ungültige Menge wird nicht still „repariert“, eine Zeile ohne Setnummer
 * nicht still übersprungen, jedes Ergebnis nennt seine Zeile, ein dem Katalog
 * unbekanntes Set zählt als Warnung, und vor dem Übernehmen sagt die Prüfung,
 * welche Sets schon in der Sammlung sind. Datei wie im Bericht
 * (import-fehler.csv), Import als Auftrag mit gestelltem addSetWithDate.
 *
 * Gegenproben (05.11.2026 gemessen, je einzeln):
 *   A  csvMenge() wieder mit .replace(/[^0-9]/g, '') → rot: „jede Zeile mit
 *      ihrem Ergebnis“ (Zeile 5 als „+1 Exemplar“ gebucht)
 *   B  `if (!sn) continue;` statt der Fehlerzeile → rot: „jede Zeile mit
 *      ihrem Ergebnis“ (Zeile 7 fehlt, 7 statt 8 Ergebnisse)
 *   C  buildJobStatus zählt katalog_offen wieder als ok → rot: „Summen“
 *      (ok 4, warn 0)
 *   D  in setCsvImportStarten schonVorhanden() durch [] ersetzt → rot: „die
 *      Prüfung nennt vorhandene Sets und startet nichts“
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const gebucht = [];
const Module = require('node:module');
const _echtesRequire = Module.prototype.require;
Module.prototype.require = function (name) {
  const m = _echtesRequire.apply(this, arguments);
  if (typeof name === 'string' && /[/\\]erfassen(\.js)?$/.test(name))
    return new Proxy(m, {
      get: (t, k) => {
        if (k === 'nacharbeitEinstellen') return async () => {};
        if (k !== 'addSetWithDate') return t[k];
        return async (sn, qty) => {
          if (sn === 'abc') throw new Error('Das ist keine Setnummer');
          gebucht.push(`${sn}×${qty}`);
          return { action: 'added', set_number: sn, ...(sn === '99999-1' ? { katalog_offen: true } : {}) };
        };
      },
    });
  return m;
};

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const { bis } = require('./helpers/zeit');

const DATEI = 'Set Number,Quantity\n10200-1,1\n10305-1,2\nabc,1\n10312-1,x\n99999-1,1\n,3\n10319-1,-2\n10326-1,1\n';

test('CSV-Import: Prüfung, Zeilen und Summen', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;
  const NAME = `csvpruef-${process.pid}`;
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1,$2)', [uid, '10305-1']);
  const { base } = testServer(_req, { sitzung: { userId: uid }, routen: { '/api/v1': 'routes/api_v1/index.js' }, t });
  const worker = _req('jobs/auftraegeStarten.js').starteAuftragsWorker({ arten: ['csv_import'], taktMs: 50 });
  t.after(async () => {
    await worker.stoppe(0);
    await _req('db/pgNotify.js').close();
    await db.run('DELETE FROM users WHERE id=$1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const sende = async pruefen => {
    const fd = new FormData();
    fd.append('file', new Blob([DATEI]), 'import-fehler.csv');
    const r = await fetch(`${base}/api/v1/sets/import/csv${pruefen ? '?pruefen=1' : ''}`, { method: 'POST', body: fd });
    assert.equal(r.status, 200);
    return r.json();
  };

  await t.test('die Prüfung nennt vorhandene Sets und startet nichts', async () => {
    const p = await sende(true);
    assert.equal(p.gestartet, false);
    assert.equal(p.total, 8, 'acht Datenzeilen gelesen');
    assert.equal(p.vorhanden, 1);
    assert.deepEqual(p.vorhanden_nummern, ['10305-1']);
    assert.equal(await db.get('SELECT 1 FROM import_stand WHERE user_id=$1', [uid]), undefined, 'kein Lauf angelegt');
  });

  await sende(false);
  let s;
  await bis(async () => {
    s = await (await fetch(`${base}/api/v1/sets/import/csv/status`)).json();
    return s.status !== 'running';
  });

  await t.test('jede Zeile mit ihrem Ergebnis', () => {
    assert.equal(s.status, 'done');
    const kurz = s.results.map(
      r => `${r.zeile}:${r.set_number}:${r.success ? (r.katalog_offen ? 'warn' : 'ok') : r.code || 'fehler'}`,
    );
    assert.deepEqual(kurz, [
      '2:10200-1:ok',
      '3:10305-1:ok',
      '4:abc:fehler',
      '5:10312-1:csv_menge_ungueltig',
      '6:99999-1:warn',
      '7::csv_keine_setnummer',
      '8:10319-1:csv_menge_ungueltig',
      '9:10326-1:ok',
    ]);
    assert.match(s.results[3].error, /Menge „x“ ungültig/);
    assert.match(s.results[6].error, /Menge „-2“ ungültig/);
    assert.deepEqual(gebucht, ['10200-1×1', '10305-1×2', '99999-1×1', '10326-1×1'], 'nur gültige Zeilen gebucht');
  });

  await t.test('Summen', () => {
    assert.deepEqual({ total: s.total, ok: s.ok, warn: s.warn, err: s.err }, { total: 8, ok: 3, warn: 1, err: 4 });
    assert.ok(Date.now() - Date.parse(s.beendet_am) < 60_000, `beendet_am: ${s.beendet_am}`);
  });
});
