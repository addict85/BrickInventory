/**
 * „Alle meine Sets löschen" löscht MEINE Sets — nicht die des Haushalts.
 *
 * Gegenprobe (01.11.2026 gemessen): bestaetigePasswort() aus DELETE /bestand
 * entfernt → rot: „ohne Passwort gelöscht“ (Code fehlt in der Antwort).
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
const { keineDb } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { haeltFigur, haeltSet, haeltTeil } = require('./helpers/bestand');
const db = _req('db/database.js');

async function erreichbar() {
  try { await db.get('SELECT 1'); return true; } catch { return false; }
}

test('Alles-Loeschen fasst die verknuepften Konten nicht an', async (t) => {
  if (!await erreichbar()) {
    keineDb(t); return;
  }
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchemaOnce();
  // Und die MIGRATIONEN, nicht nur das Schema
  {
    const mc = await db.pool.connect();
    try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }
  }
  t.after(() => db.pool.end());

  const PASS = 'eigenes-Passwort-1';
  await db.run(`INSERT INTO users (username, password_hash) VALUES ('haupt', $1), ('kind','x')`,
    [require(path.join(ROOT, 'node_modules', 'bcryptjs')).hashSync(PASS, 4)]);
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
  const hole = async (pfad, methode = 'GET', body) => (await fetch(base + pfad, { method: methode,
    ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) })).json();

  // Ohne Passwort bleibt alles stehen: Ein erbeutetes App-Token allein soll nicht alles löschen.
  const ohne = await hole('/api/v1/bestand', 'DELETE');
  assert.equal(ohne.code, 'aktuelles_passwort_falsch', JSON.stringify(ohne));
  assert.equal((await db.all('SELECT 1 FROM sets WHERE user_id = $1', [haupt])).length, 1, 'ohne Passwort gelöscht');

  // Genau der Aufruf aus public/js/settings.js (btn-dall).
  const r = await hole('/api/v1/bestand', 'DELETE', { password: PASS });
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
  // einer Sicherung. Der Dienst schneidet deshalb gegen schreibbereich(); die
  // Route gibt nur die Sicht weiter (Verhalten: blickfeld-dienste-db.test.js).
  const src = fs.readFileSync(path.join(ROOT, 'routes/api_v1/sets.ts'), 'utf8');
  const i = src.indexOf("router.delete('/sets/:setNumber'");
  assert.ok(i > 0, 'Löschroute nicht gefunden');
  assert.match(src.slice(i, i + 900), /loescheSetFuer\(sichtVon\(req\)/, 'Die Route löscht nicht über den Dienst');
  const dienst = require('./helpers/sources').funktionsRumpf(
    fs.readFileSync(path.join(ROOT, 'src/sets/loeschen.ts'), 'utf8'), 'loescheSetFuer');
  assert.match(dienst, /schreibbar\.includes\(/,
    'Die gewählte Menge muss gegen schreibbereich() geschnitten werden');
});

test('der Knopf überlässt die Auswahl dem Server', () => {
  // Früher listete der Knopf selbst und löschte Nummer für Nummer — mit der
  // Falle, dass ein fehlendes accounts=own den Haushalt mitlöschte. Jetzt
  // entscheidet der Server, und zwar nur über das eigene Konto.
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'settings.js'), 'utf8');
  const i = src.indexOf("G('btn-dall')");
  assert.ok(i > 0, 'Knopf btn-dall nicht gefunden');
  const block = src.slice(i, src.indexOf('\n};', i));
  assert.match(block, /api\('DELETE','\/v1\/bestand',\s*\{\s*password\b/, 'Der Knopf ruft DELETE /v1/bestand mit Passwort');
  assert.doesNotMatch(block, /\/v1\/sets/, 'Der Knopf listet und löscht wieder selbst');
  const loeschen = fs.readFileSync(path.join(ROOT, 'src/sammlung/loeschen.ts'), 'utf8');
  assert.match(loeschen, /loescheSet\(\[uid\]/, 'Sets werden nur im EIGENEN Konto gelöscht');
});

