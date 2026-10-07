/**
 * Nach einem Masseneinfuegen wird die Tabelle aufgefrischt — sonst nimmt der
 * Planer den falschen Index.
 *
 * ── Woher dieser Test kommt ─────────────────────────────────────────────────
 *
 * Mit den Trigramm-Indizes aus Migration 0029 kam eine Eigenheit mit, die ich
 * beim Messen zuerst falsch gedeutet habe. GEMESSEN an 72 000 Zeilen in
 * parts_summary, Suche nach einem seltenen Begriff:
 *
 *   direkt nach dem Masseneinfuegen        94,1 / 100,2 ms
 *   nach ANALYZE                            4,8 /  10,3 ms
 *   nach VACUUM (Statistik war schon da)     0,2 /   0,8 ms
 *
 * Zwei verschiedene Fehler: ANALYZE richtet die PLANWAHL (ohne frische
 * Statistik schaetzt der Planer eine Zeile und greift zu einem beliebigen
 * anderen Index — gemessen idx_parts_summary_cat, der dann alle 72 000 Zeilen
 * durchgeht), VACUUM leert die WARTELISTE von GIN. Keiner ersetzt den anderen.
 *
 * ── Warum pg_stat_user_tables und keine Zeitmessung ─────────────────────────
 *
 * Die naheliegende Zusicherung waere „die Suche dauert jetzt unter 1 ms". Die
 * waere auf einem ausgelasteten Laeufer wackelig und haette mit der Regel nichts
 * zu tun: Geprueft werden soll, dass die Pflege STATTFINDET, nicht wie schnell
 * die Maschine ist. `last_vacuum` und `last_analyze` beantworten genau das, und
 * zwar eindeutig.
 *
 * Voraussetzung: Test-DB. Ohne DB: skip (mit REQUIRE_DB=1: Fehler).
 *
 * ── Gegenproben (durchgefuehrt) ─────────────────────────────────────────────
 *
 *   a) pflegeTabelle() wirft nicht, wenn das Ausfuehren scheitert — eigener
 *      Fall unten, mit einem Ausfuehrer, der immer wirft.
 *   b) Ein Name, der kein einfacher Tabellenname ist, fuehrt NICHTS aus —
 *      eigener Fall, der mitzaehlt, wie oft der Ausfuehrer gerufen wurde.
 *   c) Der Aufruf in rebuild() entfernt → der Fall „rebuild frischt auf" wird
 *      rot (last_vacuum bewegt sich nicht).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const db = _req('db/database.js');
const { pflegeTabelle } = _req('utils/tabellePflegen.js');

/** Wann wurde die Tabelle zuletzt aufgeraeumt und vermessen? */
async function stand(tabelle) {
  const r = await db.get(
    `SELECT last_vacuum, last_analyze FROM pg_stat_user_tables WHERE relname = $1`, [tabelle]);
  return { vacuum: r?.last_vacuum ? new Date(r.last_vacuum).getTime() : 0,
           analyze: r?.last_analyze ? new Date(r.last_analyze).getTime() : 0 };
}

/**
 * Auf die Statistik warten. Postgres schreibt sie nicht synchron zum Befehl —
 * ohne diese Schleife haengt der Test an der Laune des Sammlers.
 */
async function wartenAufStand(tabelle, vorher, ms = 5000) {
  const ende = Date.now() + ms;
  for (;;) {
    const jetzt = await stand(tabelle);
    if (jetzt.vacuum > vorher.vacuum && jetzt.analyze > vorher.analyze) return jetzt;
    if (Date.now() > ende) return jetzt;
    await new Promise(r => setTimeout(r, 100));
  }
}

test('Auffrischen nach Masseneinfuegen', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }
  t.after(async () => { await db.pool.end().catch(() => {}); });

  await t.test('pflegeTabelle raeumt auf UND vermisst neu', async () => {
    // Erst etwas einfuegen, damit es auch etwas zu tun gibt.
    await db.run(`INSERT INTO parts_summary (user_id, part_key, color_id, part_number,
        part_name, total_quantity, in_sets)
      SELECT 90001, 'pflege'||g, 0, 'p'||g, 'Brick '||g, 1, 'x'
      FROM generate_series(1, 200) g ON CONFLICT DO NOTHING`);
    const vorher = await stand('parts_summary');
    await new Promise(r => setTimeout(r, 1100));   // Zeitstempel haben Sekunden-Auflösung in der Anzeige

    const ok = await pflegeTabelle((sql) => db.exec(sql), 'parts_summary');
    assert.equal(ok, true, 'pflegeTabelle hat aufgegeben — laeuft der Test als Eigentuemer der Tabelle?');

    const nachher = await wartenAufStand('parts_summary', vorher);
    assert.ok(nachher.vacuum > vorher.vacuum,
      `last_vacuum hat sich nicht bewegt (${nachher.vacuum} vs ${vorher.vacuum}). Ohne VACUUM ` +
      `bleibt die Warteliste von GIN stehen, und jede Suche geht sie zusaetzlich durch.`);
    assert.ok(nachher.analyze > vorher.analyze,
      `last_analyze hat sich nicht bewegt. Ohne frische Statistik schaetzt der Planer die ` +
      `Tabelle auf eine Zeile und greift zum falschen Index.`);
  });

  await t.test('ein Name, der kein Tabellenname ist, fuehrt NICHTS aus', async () => {
    const gerufen = [];
    const fuehreAus = async (sql) => { gerufen.push(sql); };
    for (const name of ['parts_summary; DROP TABLE users', 'parts summary', '"parts"',
                        'public.parts_summary', '', 'Parts_Summary']) {
      const ok = await pflegeTabelle(fuehreAus, name);
      assert.equal(ok, false, `"${name}" haette abgelehnt werden muessen.`);
    }
    assert.deepEqual(gerufen, [],
      `Fuer einen abgelehnten Namen wurde trotzdem SQL ausgefuehrt: ${gerufen.join(' | ')}`);
  });

  await t.test('ein Fehlschlag bleibt ein Fehlschlag und wird kein Absturz', async () => {
    // VACUUM braucht Rechte. Ein Import, der an der NACHSORGE scheitert, waere
    // das falsche Ergebnis — die Daten sind dann vollstaendig da.
    const ok = await pflegeTabelle(async () => { throw new Error('permission denied for table'); },
      'parts_summary');
    assert.equal(ok, false);
  });

  await t.test('rebuild() frischt parts_summary auf', async () => {
    const { rebuild } = _req('utils/partsSummary.js');
    const nutzer = 90002;
    await db.run(`INSERT INTO users (id, username, password_hash) VALUES ($1, $2, 'x')
                  ON CONFLICT (id) DO NOTHING`, [nutzer, 'pflege-tester']);
    await db.run(`INSERT INTO parts (user_id, set_number, part_number, part_name, color_id,
        color_name, quantity) SELECT $1, '75192-1', 'p'||g, 'Brick '||g, 0, 'Red', 1
      FROM generate_series(1, 300) g ON CONFLICT DO NOTHING`, [nutzer]);

    const vorher = await stand('parts_summary');
    await new Promise(r => setTimeout(r, 1100));
    await rebuild(nutzer);
    const nachher = await wartenAufStand('parts_summary', vorher);

    assert.ok(nachher.vacuum > vorher.vacuum && nachher.analyze > vorher.analyze,
      `rebuild() hat parts_summary nicht aufgefrischt (vacuum ${nachher.vacuum} vs ` +
      `${vorher.vacuum}, analyze ${nachher.analyze} vs ${vorher.analyze}). DELETE + INSERT ` +
      `aller Zeilen eines Nutzers ist ein Masseneinfuegen — danach ist die Statistik schief.`);
  });
});
