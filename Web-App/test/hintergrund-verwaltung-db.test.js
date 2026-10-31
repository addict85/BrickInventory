/**
 * Die Hintergrundarbeiten in der Verwaltung (routes/api_v1/admin.ts,
 * src/auftraege/hintergrund.ts) über die echte Route: Auftragsliste, Abbrechen,
 * Wiederholen, Leeren, Jetzt — und die alten Adressen (brickset-queue,
 * job-status, job-schedule, trigger-price-job) liefern ihre Felder weiter.
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  in leereArt() die Ausnahme für `plan:%` entfernt → rot: „Leeren
 *      verwirft Wartende, nicht den Zeitplan“
 *   B  in auftragAbbrechen() planeNaechsten() entfernt → rot: „ein
 *      abgebrochener geplanter Lauf hinterlässt den nächsten Termin“
 *   C  in zeitplanNeuPlanen() zeitplanGeaendert('preise') entfernt → rot: „ein
 *      neues Intervall verschiebt den offenen Termin“
 *   D  in bricksetListe() `to_char(…)` durch den rohen Zeitstempel ersetzt →
 *      rot: „die Brickset-Liste behält ihre Felder“ (retry_after kein Datum)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');

test('Hintergrundarbeiten in der Verwaltung', { concurrency: 1 }, async (t) => {
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const NAME = `hgv_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash, is_admin, is_active) VALUES ($1,'x',1,1) RETURNING id`, [NAME])).id;
  await db.run('DELETE FROM auftraege');
  const Z = _req('src/auftraege/zeitplan.js');
  const A = Object.assign({}, _req('src/auftraege/auftraege.js'), _req('src/auftraege/repository/auftraege.js'));
  t.after(async () => {
    await db.run('DELETE FROM auftraege');
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await _req('db/pgNotify.js').close().catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const { base } = testServer(_req, {
    sitzung: { userId: uid, username: NAME, isAdmin: true },
    apiNutzer: { user_id: uid, is_admin: 1 },
    routen: { '/api/v1': 'routes/api_v1/index.js' }, t,
  });
  const rufe = async (methode, pfad, body) => {
    const r = await fetch(base + '/api/v1' + pfad, { method: methode,
      headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  const plan = (art) => db.get(`SELECT id::text AS id, status, faellig_ab FROM auftraege WHERE schluessel = $1 AND status = 'offen'`, [`plan:${art}`]);

  // Ein Intervall aus einem früheren Lauf liesse den Termin schon richtig stehen.
  await db.run(`DELETE FROM global_settings WHERE key = 'price_job_interval_minutes'`);
  await Z.planeAlle();
  const wartend = [];
  for (const sn of ['11111-1', '22222-1']) wartend.push(await A.stelleAuftragEin('anleitung', { set_number: sn }, { schluessel: `anleitung:${sn}` }));
  const kaputt = await A.stelleAuftragEin('nachlauf', { schritt: 'katalog' });
  await db.run(`UPDATE auftraege SET status = 'fehler', fehler = 'Quelle weg' WHERE id = $1`, [kaputt]);
  await db.run(`INSERT INTO laufzustand (schluessel, wert) VALUES ('jobs_lebenszeichen', NOW()::text)
                ON CONFLICT (schluessel) DO UPDATE SET wert = NOW()::text`);

  await t.test('die Liste zeigt Wartende, Geplante und Gescheiterte', async () => {
    const r = await rufe('GET', '/admin/auftraege');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const { auftraege, zusammenfassung, job_prozess } = r.body;
    assert.deepEqual(auftraege.filter(a => a.art === 'anleitung').map(a => a.set_number).sort(), ['11111-1', '22222-1']);
    assert.ok(auftraege.some(a => a.art === 'preise' && a.geplant === true), 'geplante Läufe fehlen');
    const f = auftraege.find(a => a.id === kaputt);
    assert.deepEqual([f.status, f.fehler], ['fehler', 'Quelle weg']);
    assert.ok(zusammenfassung.some(z => z.art === 'anleitung' && z.status === 'offen' && z.anzahl === 2));
    assert.equal(job_prozess.laeuft, true);
    assert.equal((await rufe('GET', '/admin/auftraege?art=gibtsnicht')).status, 400);
  });

  await t.test('wiederholen stellt einen gescheiterten neu ein', async () => {
    assert.equal((await rufe('POST', `/admin/auftraege/${kaputt}/wiederholen`)).status, 200);
    assert.equal((await db.get('SELECT status, versuche FROM auftraege WHERE id = $1', [kaputt])).status, 'offen');
    assert.equal((await rufe('POST', `/admin/auftraege/${kaputt}/wiederholen`)).status, 409, 'ein offener lässt sich nicht wiederholen');
  });

  await t.test('ein abgebrochener geplanter Lauf hinterlässt den nächsten Termin', async () => {
    const p = await plan('bild_nachlauf');
    assert.equal((await rufe('POST', `/admin/auftraege/${p.id}/abbrechen`)).status, 200);
    const neu = await plan('bild_nachlauf');
    assert.ok(neu && neu.id !== p.id, 'kein neuer Termin nach dem Abbruch');
  });

  await t.test('Leeren verwirft Wartende, nicht den Zeitplan', async () => {
    const r = await rufe('DELETE', '/admin/auftraege/art/anleitung');
    assert.deepEqual([r.status, r.body.entfernt], [200, 2]);
    await A.stelleAuftragEin('preise', {}, {});
    const r2 = await rufe('DELETE', '/admin/auftraege/art/preise');
    assert.equal(r2.body.entfernt, 1, 'der einzelne Preis-Auftrag ist weg');
    assert.ok(await plan('preise'), 'der geplante Preis-Lauf wurde mit geleert');
  });

  await t.test('Jetzt zieht den geplanten Lauf vor', async () => {
    const r = await rufe('POST', '/admin/auftraege/art/aufraeumen/jetzt');
    assert.deepEqual([r.status, r.body.gestartet], [200, true]);
    assert.ok(new Date((await plan('aufraeumen')).faellig_ab) <= new Date());
  });

  await t.test('ein neues Intervall verschiebt den offenen Termin', async () => {
    const r = await rufe('POST', '/admin/job-schedule', { name: 'priceJob', minutes: 600 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const in_min = (new Date((await plan('preise')).faellig_ab) - Date.now()) / 60_000;
    assert.ok(in_min > 590 && in_min <= 600, `Termin in ${Math.round(in_min)} min statt 600`);
    const stand = await rufe('GET', '/admin/job-status');
    assert.equal(stand.body.job.running, false);
    assert.equal(new Date(stand.body.job.nextRun).getTime(), new Date((await plan('preise')).faellig_ab).getTime());
    assert.equal((await rufe('POST', '/admin/trigger-price-job')).body.started, true);
  });

  await t.test('die Brickset-Liste behält ihre Felder', async () => {
    await _req('src/auftraege/bricksetAuftrag.js').bricksetVormerken('33333-1', 'Quota exceeded');
    const r = await rufe('GET', '/admin/brickset-queue');
    const e = r.body.entries.find(x => x.set_number === '33333-1');
    assert.ok(e, JSON.stringify(r.body));
    assert.match(e.retry_after, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual([e.attempts, e.last_error], [1, 'Quota exceeded']);
    assert.equal((await rufe('DELETE', '/admin/brickset-queue/33333-1')).status, 200);
    assert.equal((await rufe('GET', '/admin/brickset-queue')).body.entries.some(x => x.set_number === '33333-1'), false);
  });
});
