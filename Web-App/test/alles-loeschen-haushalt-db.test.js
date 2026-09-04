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
 * Voraussetzung: Test-DB über TEST_DATABASE_URL (Inhalt wird geleert!).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
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
  t.after(() => db.pool.end());

  await db.run(`INSERT INTO users (username, password_hash) VALUES ('haupt','x'), ('kind','x')`);
  const haupt = (await db.get(`SELECT id FROM users WHERE username='haupt'`)).id;
  const kind  = (await db.get(`SELECT id FROM users WHERE username='kind'`)).id;
  await db.run(`INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2)`, [haupt, kind]);

  // 75192-1 besitzen BEIDE — das ist der Fall, den eine Prüfung auf
  // „fremde Setnummern bleiben stehen" allein nicht fängt.
  await db.run(`INSERT INTO sets (user_id,set_number,name,quantity) VALUES
      ($1,'75192-1','Falcon',1), ($2,'75192-1','Falcon',1), ($2,'21318-1','Baumhaus',1)`, [haupt, kind]);
  await db.run(`INSERT INTO parts (user_id,set_number,part_number,color_id,quantity,source)
                VALUES ($1,'21318-1','3001',4,10,'set')`, [kind]);
  await db.run(`INSERT INTO minifigs (user_id,set_number,fig_number,quantity,source)
                VALUES ($1,'21318-1','fig1',1,'set')`, [kind]);

  const { base } = testServer(_req, {
    sitzung: { userId: haupt },
    apiNutzer: { user_id: haupt, is_admin: 0, username: 'haupt' },
    routen: { '/api/v1': 'routes/api_v1/index.js' },
    t,
  });
  const hole = async (pfad, methode = 'GET') =>
    (await fetch(base + pfad, { method: methode })).json();

  // Genau der Ablauf aus public/js/05-settings.js (btn-dall).
  const liste = await hole('/api/v1/sets?accounts=own');
  const nummern = (liste.sets || []).map(s => s.set_number);
  assert.deepEqual(nummern, ['75192-1'],
    'Die Liste zum Löschen muss NUR die eigenen Sets enthalten, nicht die des Haushalts');
  for (const nr of nummern) await hole(`/api/v1/sets/${nr}?accounts=own`, 'DELETE');

  const meine = await db.all(`SELECT set_number FROM sets WHERE user_id=$1`, [haupt]);
  assert.deepEqual(meine, [], 'Die eigenen Sets müssen weg sein');

  const seine = await db.all(`SELECT set_number FROM sets WHERE user_id=$1 ORDER BY set_number`, [kind]);
  assert.deepEqual(seine.map(r => r.set_number), ['21318-1', '75192-1'],
    'Das verknüpfte Konto behält ALLE seine Sets — auch die gemeinsame Nummer');
  const teile = await db.get(`SELECT COUNT(*)::int c FROM parts WHERE user_id=$1`, [kind]);
  const figuren = await db.get(`SELECT COUNT(*)::int c FROM minifigs WHERE user_id=$1`, [kind]);
  assert.equal(teile.c, 1, 'Teile des verknüpften Kontos bleiben');
  assert.equal(figuren.c, 1, 'Minifiguren des verknüpften Kontos bleiben');
});

test('accounts kann das Loesch-Blickfeld nur einschraenken, nie erweitern', () => {
  // Ein Blickfeld-Parameter, der etwas ÖFFNEN kann, wäre ein Zugriffsweg statt
  // einer Sicherung. Die Route schneidet deshalb gegen writableIds().
  const src = fs.readFileSync(path.join(ROOT, 'routes', 'api_v1', 'sets.ts'), 'utf8');
  const i = src.indexOf("router.delete('/sets/:setNumber'");
  assert.ok(i > 0, 'Löschroute nicht gefunden');
  const rumpf = src.slice(i, i + 900);
  assert.match(rumpf, /schreibbar\.includes\(/,
    'Die gewählte Menge muss gegen writableIds() geschnitten werden');
});

test('der Knopf gibt accounts=own beim Auflisten UND beim Loeschen mit', () => {
  // Eines von beiden allein genügt nicht: Ohne den ersten löscht der Knopf
  // fremde Setnummern, ohne den zweiten löscht er die eigene Nummer auch beim
  // verknüpften Konto.
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', '05-settings.js'), 'utf8');
  const i = src.indexOf("G('btn-dall')");
  assert.ok(i > 0, 'Knopf btn-dall nicht gefunden');
  const block = src.slice(i, src.indexOf('\n};', i));
  assert.match(block, /'\/v1\/sets\?accounts=own'/, 'Das Auflisten braucht accounts=own');
  assert.match(block, /\/v1\/sets\/\$\{[^}]+\}\?accounts=own/, 'Das Löschen braucht accounts=own');
});
