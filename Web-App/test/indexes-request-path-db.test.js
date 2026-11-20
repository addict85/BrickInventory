/**
 * Drei Indizes für Abfragen, die im Anfragepfad ohne sie die ganze Tabelle lesen.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const db = testData();

// idx_parts_blnum stand hier und ist weg: Er war ein Teilindex auf
// parts.bl_part_number, und Migration 0037 hat die Spalte geloescht (die
// BrickLink-Nummer steht jetzt in bl_mapping). Postgres entfernt
// abhaengige Indizes beim DROP COLUMN selbst.
const EXPECTED = ['idx_set_figuren_fig', 'idx_sets_setnum'];

/**
 * Den Plan einer Abfrage holen — ohne Tabellenscan-Ausweg.
 *
 * Eine EIGENE Verbindung, weil `SET enable_seqscan` an der Sitzung hängt: Über
 * den Pool kann die nächste Abfrage auf einer anderen Verbindung landen, und
 * die Einstellung wäre dort nie gesetzt.
 */
async function plan(sql) {
  const c = await db.ownConnection();
  try {
    await c.query('SET enable_seqscan = off');
    const r = await c.query(`EXPLAIN ${sql}`);
    return r.rows.map(z => z['QUERY PLAN']).join('\n');
  } finally {
    await c.end().catch(() => {});
  }
}

test('request path: the three indexes exist and the planner can take them', async t => {
  try {
    await db.get('SELECT 1');
  } catch {
    return t.skip('no test database reachable');
  }

  try {
    // initSchema() direkt, nicht initSchemaOnce(): Letzteres überspringt die
    // Arbeit, wenn in schema_meta schon die Fassung dieses Deployments steht
    // (siehe db/database.ts). Für den Test ist genau das falsch — er will
    // wissen, was der Schema-Aufbau ANLEGT, nicht was er sich sparen darf.
    await db.initSchema();

    // ── 1. Angelegt ────────────────────────────────────────────────────────
    const da = (
      await db.all('SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname = ANY($2)', [
        'public',
        EXPECTED,
      ])
    )
      .map(r => r.indexname)
      .sort();
    assert.deepEqual(
      da,
      [...EXPECTED].sort(),
      `db/database.ts legt nicht alle erwarteten Indizes an — gefunden: ${da.join(', ') || '(keine)'}`,
    );

    // GEGENPROBE: Die Abfrage darf nicht einfach alles bestätigen.
    const invented = await db.all('SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname = ANY($2)', [
      'public',
      ['idx_gibt_es_nicht'],
    ]);
    assert.equal(invented.length, 0, 'Gegenprobe: die Index-Abfrage meldet auch erfundene Namen als vorhanden');

    // ── 2. Der Planer kann sie nehmen ──────────────────────────────────────
    //
    // Die BrickLink-Nachschlage zuerst, und dafuer braucht es die
    // MIGRATIONEN: bl_mapping wird in 0037 angelegt, nicht in
    // db/basis.sql (eine Tabelle gehoert an genau eine Stelle,
    // scripts/check-schema-am-start.js prueft das).
    const c0 = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c0);
    } finally {
      c0.release();
    }

    // Zeichengleich die Abfrage aus src/catalog/blMapping.ts (blFetchNumber).
    const blPlan = await plan(
      `SELECT COALESCE(bl_id, rb_id) AS nr FROM bl_mapping
        WHERE type = 'part' AND rb_id = 'x'`,
    );
    assert.match(
      blPlan,
      /Index (Only )?Scan.* on bl_mapping/,
      `Die BrickLink-Nachschlage laeuft nicht ueber einen Index:\n${blPlan}`,
    );

    const minifigPlan = await plan(`SELECT set_number FROM set_minifigs_catalog WHERE fig_number = 'x' LIMIT 1`);
    assert.match(minifigPlan, /idx_set_figuren_fig/, `Plan:\n${minifigPlan}`);

    const setPlan = await plan(`SELECT user_id FROM sets WHERE set_number = 'x' ORDER BY user_id`);
    assert.match(setPlan, /idx_sets_setnum/, `Plan:\n${setPlan}`);

    // GEGENPROBE zur BrickLink-Nachschlage: Eine Spalte, auf der KEIN Index
    // sitzt, muss zu einem Tabellenscan fuehren. Sonst waere die
    // Zusicherung oben blind dafuer, ob der Planer ueberhaupt zwischen
    // beidem unterscheidet.
    const withoutIndex = await plan(`SELECT rb_id FROM bl_mapping WHERE fetched_at < NOW()`);
    assert.match(
      withoutIndex,
      /Seq Scan on bl_mapping/,
      `Gegenprobe: auch ohne Index kam kein Tabellenscan:\n${withoutIndex}`,
    );
  } finally {
    await db.pool.end().catch(() => {});
  }
});
