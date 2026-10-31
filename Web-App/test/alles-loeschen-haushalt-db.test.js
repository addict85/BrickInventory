/**
 * „Alle meine Sets löschen" löscht MEINE Sets — nicht die des Haushalts.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 * Der Knopf in den Einstellungen tat zwei Dinge:
 *
 *     const s = await api('GET','/v1/sets');
 *     for (const set of s.sets||[]) await api('DELETE', `/v1/sets/${…}`);
 *
 * Beides ohne Blickfeld. `/v1/sets` liefert ohne `accounts` den ganzen
 * HAUSHALT, und `DELETE /v1/sets/:nr` löschte mit writableIds(), also im
 * vollen Schreib-Blickfeld.
 *
 * NACHGEMESSEN mit zwei verknüpften Konten (Hauptkonto besitzt 75192-1, das
 * Unterkonto 75192-1 und 21318-1 samt Teilen und Minifiguren):
 *
 *     „Alle meine Sets loeschen" listet: [75192-1, 21318-1]
 *     DELETE laeuft ueber writableIds(haupt) = [2, 3]
 *     NACHHER  haupt: Sets [], kind: Sets [], Teile 0, Figuren 0
 *
 * Das Unterkonto verlor seine gesamte Sammlung — darunter ein Set, das das
 * Hauptkonto nie besass. Der Knopf heisst „Alle MEINE Sets löschen", der
 * Text verspricht „Deine gesamte Sammlung".
 *
 * ── Warum der Test gegen die ECHTE Route läuft ──────────────────────────────
 * Eine Quelltextprüfung hätte hier nur die beiden `accounts=own` bestätigt.
 * Der Schaden entsteht aber erst aus dem Zusammenspiel von Auflisten und
 * Löschen — und genau das prüft nur ein Durchlauf gegen die Datenbank.
 *
 * ── Seit dem Papierkorb ─────────────────────────────────────────────────────
 * Der Knopf ruft jetzt EINEN Endpunkt (DELETE /api/v1/bestand), der Sets,
 * manuelle Teile und Figuren des EIGENEN Kontos in den Papierkorb legt. Die
 * Regel „nur meine" steht damit am Server; geprüft wird sie hier am selben
 * Haushalt wie zuvor.
 *
 * Voraussetzung: Test-DB über TEST_DATABASE_URL (Inhalt wird geleert!).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
const { haeltFigur, haeltSet, haeltTeil } = require('./helpers/bestand');
const db = _req('db/database.js');

async function erreichbar() {
  try { await db.get('SELECT 1'); return true; } catch { return false; }
}

test('Alles-Loeschen fasst die verknuepften Konten nicht an', async (t) => {
  if (!await erreichbar()) {
    // Kein stilles Bestehen: Ohne DB ist hier nichts geprüft, und in CI läuft
    // sie. REQUIRE_DB=1 macht daraus einen Fehler statt eines Übersprungs.
    if (process.env.REQUIRE_DB === '1') assert.fail('Test-DB nicht erreichbar, REQUIRE_DB=1');
    t.skip('keine Test-DB'); return;
  }
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchemaOnce();
  // ── Und die MIGRATIONEN, nicht nur das Schema ───────────────────────────
  //
  // Diese Datei loescht das Schema und baut es neu auf. initSchemaOnce()
  // laeuft dabei voll durch (die Marke in schema_meta ist mit weg), bleibt
  // aber auf dem Stand von db/schema.sql — also VOR allen Migrationen. Das
  // ist nicht nur fuer diese Datei falsch, sondern fuer jede danach: Sie erbt
  // eine halbe Datenbank.
  //
  // GEMESSEN beim Umzug der Teilemengen (Migration 0038): db/schema.sql legt
  // `parts.quantity DEFAULT 1` an, die Katalogzeilen tragen die echte Zahl.
  // Die naechste Datei, die die Migrationen laufen liess, brach ab — „Bei 8
  // Set-Teilen weicht parts.quantity vom Katalog ab". Der Riegel hatte recht.
  {
    const mc = await db.pool.connect();
    try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }
  }
  t.after(() => db.pool.end());

  await db.run(`INSERT INTO users (username, password_hash) VALUES ('haupt','x'), ('kind','x')`);
  const haupt = (await db.get(`SELECT id FROM users WHERE username='haupt'`)).id;
  const kind  = (await db.get(`SELECT id FROM users WHERE username='kind'`)).id;
  await db.run(`INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2)`, [haupt, kind]);

  // 75192-1 besitzen BEIDE — das ist der Fall, den eine Prüfung auf
  // „fremde Setnummern bleiben stehen" allein nicht fängt.
  await haeltSet(db, haupt, '75192-1', 1);
  await haeltSet(db, kind, '75192-1', 1);
  await haeltSet(db, kind, '21318-1', 1);
  await haeltTeil(db, kind, '3001', { setNumber: '21318-1', menge: 10, colorId: 4 });
  await haeltFigur(db, kind, 'fig1', { setNumber: '21318-1', menge: 1 });
  // Manuelle Elemente auf beiden Seiten: Die des Kindes müssen bleiben.
  await haeltTeil(db, kind, '3003', { colorId: 1, menge: 2 });
  await haeltFigur(db, kind, 'fig2', { menge: 1 });
  await haeltTeil(db, haupt, '3004', { colorId: 1, menge: 2 });

  const { base } = testServer(_req, {
    sitzung: { userId: haupt },
    apiNutzer: { user_id: haupt, is_admin: 0, username: 'haupt' },
    routen: { '/api/v1': 'routes/api_v1/index.js' },
    t,
  });
  const hole = async (pfad, methode = 'GET') =>
    (await fetch(base + pfad, { method: methode })).json();

  // Genau der Aufruf aus public/js/05-settings.js (btn-dall).
  const r = await hole('/api/v1/bestand', 'DELETE');
  assert.equal(r.success, true, JSON.stringify(r));
  assert.deepEqual([r.sets, r.teile, r.figuren], [1, 1, 0], 'Gezählt wird nur das eigene Konto');

  const meine = await db.all(`SELECT set_number FROM sets WHERE user_id=$1`, [haupt]);
  assert.deepEqual(meine, [], 'Die eigenen Sets müssen weg sein');

  const seine = await db.all(`SELECT set_number FROM sets WHERE user_id=$1 ORDER BY set_number`, [kind]);
  assert.deepEqual(seine.map(r => r.set_number), ['21318-1', '75192-1'],
    'Das verknüpfte Konto behält ALLE seine Sets — auch die gemeinsame Nummer');
  const teile = await db.get(`SELECT COUNT(*)::int c FROM parts WHERE user_id=$1`, [kind]);
  const figuren = await db.get(`SELECT COUNT(*)::int c FROM minifigs WHERE user_id=$1`, [kind]);
  assert.equal(teile.c, 2, 'Teile des verknüpften Kontos bleiben (aus dem Set und manuell)');
  assert.equal(figuren.c, 2, 'Minifiguren des verknüpften Kontos bleiben (aus dem Set und manuell)');
  const meineTeile = await db.get(`SELECT COUNT(*)::int c FROM parts WHERE user_id=$1`, [haupt]);
  assert.equal(meineTeile.c, 0, 'Das eigene manuelle Teil muss weg sein');
});

test('accounts kann das Loesch-Blickfeld nur einschraenken, nie erweitern', () => {
  // Ein Blickfeld-Parameter, der etwas ÖFFNEN kann, wäre ein Zugriffsweg statt
  // einer Sicherung. Die Route schneidet deshalb gegen writableIds().
  const src = fs.readFileSync(path.join(ROOT, 'routes/api_v1/sets.ts'), 'utf8');
  const i = src.indexOf("router.delete('/sets/:setNumber'");
  assert.ok(i > 0, 'Löschroute nicht gefunden');
  const rumpf = src.slice(i, i + 900);
  assert.match(rumpf, /schreibbar\.includes\(/,
    'Die gewählte Menge muss gegen writableIds() geschnitten werden');
});

test('der Knopf überlässt die Auswahl dem Server', () => {
  // Früher listete der Knopf selbst und löschte Nummer für Nummer — mit der
  // Falle, dass ein fehlendes accounts=own den Haushalt mitlöschte. Jetzt
  // entscheidet der Server, und zwar nur über das eigene Konto.
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', '05-settings.js'), 'utf8');
  const i = src.indexOf("G('btn-dall')");
  assert.ok(i > 0, 'Knopf btn-dall nicht gefunden');
  const block = src.slice(i, src.indexOf('\n};', i));
  assert.match(block, /api\('DELETE','\/v1\/bestand'\)/, 'Der Knopf ruft DELETE /v1/bestand');
  assert.doesNotMatch(block, /\/v1\/sets/, 'Der Knopf listet und löscht wieder selbst');
  const loeschen = fs.readFileSync(path.join(ROOT, 'utils/loeschen.ts'), 'utf8');
  assert.match(loeschen, /deleteSet\(\[uid\]/, 'Sets werden nur im EIGENEN Konto gelöscht');
});

