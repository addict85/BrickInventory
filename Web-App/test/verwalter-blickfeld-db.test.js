/**
 * Auch der Verwalter erfährt über seine Werkzeuge nicht, welches Konto
 * welches Set führt: Bild-Diagnose und Auftragsliste antworten ohne
 * `user_id`. Die Testdaten tragen beides (Set eines fremden Kontos, Auftrag
 * mit Konto und Setnummer), damit das Feld vorkäme. Antworten laufen gegen
 * den Vertrag (VERTRAG_PRUEFEN=1 aus buildAndRequire).
 *
 * Gegenproben (05.11.2026 gemessen, je einzeln):
 *   A  in auftragsListe() wieder `user_id` mitgelesen → rot: „die
 *      Auftragsliste …“ (die Antwort trägt user_id)
 *   B  bildZeilenDerKonten() liest zusätzlich `MAX(s.user_id) AS user_id` →
 *      rot: „die Bild-Diagnose …“
 *   C  im Vertrag `user_id` wieder in Auftrag → rot: „kein Antwortschema
 *      nennt user_id“ und „die Auftragsliste …“ (die Antwort weicht vom
 *      Vertrag ab, weil die Abfrage das Feld nicht liefert)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { routeZu } = _req('src/infra/vertrag/index.js');
const { z } = require('zod');

/** Kommt ein Schlüssel irgendwo im JSON vor? */
const enthaeltSchluessel = (wert, name) =>
  wert &&
  typeof wert === 'object' &&
  (Object.prototype.hasOwnProperty.call(wert, name) || Object.values(wert).some(v => enthaeltSchluessel(v, name)));

test('kein Antwortschema der Verwaltung nennt user_id', () => {
  for (const r of ['GET /api/v1/admin/auftraege', 'GET /api/v1/admin/image-diag/:setNumber']) {
    const schema = JSON.stringify(z.toJSONSchema(routeZu(r).antwort, { io: 'output', unrepresentable: 'any' }));
    assert.doesNotMatch(schema, /"user_id"/, r);
  }
});

test('Verwalterwerkzeuge verraten keine Besitzer', { concurrency: 1 }, async t => {
  const db = await dbOderSkip(t, _req);
  if (!db) return;
  const P = process.pid,
    SN = `9${P % 100000}-1`;
  const namen = [`vbf_chef_${P}`, `vbf_fremd_${P}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  const ids = [];
  for (const [i, n] of namen.entries())
    ids.push(
      (
        await db.get(
          `INSERT INTO users (username, password_hash, is_admin, is_active, email_verified)
      VALUES ($1, 'x', $2, true, true) RETURNING id`,
          [n, i === 0],
        )
      ).id,
    );
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2)', [ids[1], SN]);
  const auftrag = (
    await db.get(
      `INSERT INTO auftraege (art, nutzlast, user_id, status) VALUES ('brickset', $1, $2, 'fehler') RETURNING id`,
      [JSON.stringify({ set_number: SN }), ids[1]],
    )
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM auftraege WHERE id = $1', [auftrag]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const { base } = testServer(_req, {
    sitzung: { userId: ids[0], username: namen[0], isAdmin: true },
    apiNutzer: { user_id: ids[0], is_admin: 1 },
    routen: { '/api/v1': 'routes/api_v1/index.js' },
    t,
  });

  await t.test('die Bild-Diagnose zählt Konten, nennt sie aber nicht', async () => {
    const r = await fetch(`${base}/api/v1/admin/image-diag/${SN}`);
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.datenbank.anzahl_konten, 1);
    assert.equal(enthaeltSchluessel(body, 'user_id'), false, JSON.stringify(body.datenbank));
    assert.ok(!JSON.stringify(body).includes(`"${ids[1]}"`) && !body.hinweise.includes('Kein Konto führt dieses Set.'));
  });

  await t.test('die Auftragsliste ohne Konto', async () => {
    const r = await fetch(`${base}/api/v1/admin/auftraege?status=fehler`);
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    const eintrag = body.auftraege.find(a => a.id === String(auftrag));
    assert.ok(eintrag, 'Vorbedingung: der Auftrag steht in der Liste');
    assert.equal(eintrag.set_number, SN);
    assert.equal(enthaeltSchluessel(body, 'user_id'), false, JSON.stringify(eintrag));
  });
});
