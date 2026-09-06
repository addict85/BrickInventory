/**
 * Drei Indizes für Abfragen, die im Anfragepfad ohne sie die ganze Tabelle lesen.
 *
 * ── Was gemessen wurde ──────────────────────────────────────────────────────
 * EXPLAIN (ANALYZE, BUFFERS) an je 100'000 Zeilen:
 *
 *   parts, BL-Rückfall in resolveBlPartNumber (utils/financeCalc.ts) —
 *   läuft einmal je Teil der Bewertung:
 *       ohne Index   Seq Scan,   2479 Buffer, 10,1   ms
 *       mit  Index   Index Scan,    2 Buffer,  0,012 ms   (Teilindex, 8 KB)
 *
 *   set_minifigs_catalog nach fig_number (routes/api_v1/minifigs.ts):
 *       ohne Index   Seq Scan,    572 Buffer, 5,19  ms
 *       mit  Index   Index Scan,    4 Buffer, 0,041 ms   (3 MB)
 *
 *   sets nach set_number OHNE user_id (routes/api_v1/admin.ts):
 *       Der vorhandene Index beginnt mit user_id, das diese Abfrage nicht
 *       nennt — sie las bisher die Sets aller Konten.
 *
 * ── Warum der Test den PLAN prüft und nicht nur den Namen ───────────────────
 * Ein Teilindex hilft nur, wenn sein Prädikat zur WHERE-Bedingung passt. Wer
 * die Abfrage später um eine Bedingung ergänzt oder das Prädikat ändert,
 * bekommt einen Index, den es GIBT und den der Planer trotzdem nie nimmt —
 * ein Fehler, den eine reine Namensprüfung nicht sieht.
 *
 * `enable_seqscan = off` statt 100'000 Testzeilen: Bei einer kleinen Tabelle
 * ist der Tabellenscan die richtige Wahl, der Planer nähme den Index also zu
 * Recht nicht. Abgeschaltet zeigt sich, ob er ihn überhaupt NEHMEN KÖNNTE —
 * und genau das ist die Eigenschaft, die kaputtgehen kann.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip.
 * Ausführen: REQUIRE_DB=1 npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const db = _req('db/database.js');

const ERWARTET = ['idx_parts_blnum', 'idx_set_minifigs_fig', 'idx_sets_setnum'];

/**
 * Den Plan einer Abfrage holen — ohne Tabellenscan-Ausweg.
 *
 * Eine EIGENE Verbindung, weil `SET enable_seqscan` an der Sitzung hängt: Über
 * den Pool kann die nächste Abfrage auf einer anderen Verbindung landen, und
 * die Einstellung wäre dort nie gesetzt.
 */
async function plan(sql) {
  const c = await db.eigeneVerbindung();
  try {
    await c.query('SET enable_seqscan = off');
    const r = await c.query(`EXPLAIN ${sql}`);
    return r.rows.map(z => z['QUERY PLAN']).join('\n');
  } finally { await c.end().catch(() => {}); }
}

test('Anfragepfad: die drei Indizes gibt es und der Planer kann sie nehmen', async (t) => {
  try { await db.get('SELECT 1'); }
  catch { return t.skip('keine Test-Datenbank erreichbar'); }

  try {
    // initSchema() direkt, nicht initSchemaOnce(): Letzteres überspringt die
    // Arbeit, wenn in schema_meta schon die Fassung dieses Deployments steht
    // (siehe db/database.ts). Für den Test ist genau das falsch — er will
    // wissen, was der Schema-Aufbau ANLEGT, nicht was er sich sparen darf.
    await db.initSchema();

    // ── 1. Angelegt ────────────────────────────────────────────────────────
    const da = (await db.all(
      'SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname = ANY($2)',
      ['public', ERWARTET])).map(r => r.indexname).sort();
    assert.deepEqual(da, [...ERWARTET].sort(),
      `db/database.ts legt nicht alle drei Indizes an — gefunden: ${da.join(', ') || '(keine)'}`);

    // GEGENPROBE: Die Abfrage darf nicht einfach alles bestätigen.
    const erfunden = await db.all(
      'SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname = ANY($2)',
      ['public', ['idx_gibt_es_nicht']]);
    assert.equal(erfunden.length, 0,
      'Gegenprobe: die Index-Abfrage meldet auch erfundene Namen als vorhanden');

    // ── 2. Der Planer kann sie nehmen ──────────────────────────────────────
    // Zeichengleich die Abfrage aus utils/financeCalc.ts (ladeBlNummernVor
    // fragt mit ANY, der Einzelweg mit =; beide brauchen dasselbe Prädikat).
    const teilePlan = await plan(
      `SELECT bl_part_number FROM parts
        WHERE part_number = 'x' AND bl_part_number IS NOT NULL AND bl_part_number <> ''
        LIMIT 1`);
    assert.match(teilePlan, /idx_parts_blnum/,
      `Der Teilindex passt nicht mehr zur Abfrage:\n${teilePlan}`);

    const figurPlan = await plan(
      `SELECT set_number FROM set_minifigs_catalog WHERE fig_number = 'x' LIMIT 1`);
    assert.match(figurPlan, /idx_set_minifigs_fig/, `Plan:\n${figurPlan}`);

    const setPlan = await plan(
      `SELECT user_id FROM sets WHERE set_number = 'x' ORDER BY user_id`);
    assert.match(setPlan, /idx_sets_setnum/, `Plan:\n${setPlan}`);

    // GEGENPROBE zum Teilindex: OHNE die beiden bl_part_number-Bedingungen
    // darf er NICHT genommen werden. Sonst wäre die Zusicherung oben blind
    // dafür, ob das Prädikat wirklich passt.
    const ohnePraedikat = await plan(
      `SELECT bl_part_number FROM parts WHERE part_number = 'x' LIMIT 1`);
    assert.doesNotMatch(ohnePraedikat, /idx_parts_blnum/,
      `Gegenprobe: der Teilindex wurde auch ohne sein Prädikat genommen:\n${ohnePraedikat}`);
  } finally {
    await db.pool.end().catch(() => {});
  }
});
