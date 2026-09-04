/**
 * Die Zahl über der Galerie muss zu dem passen, was darunter steht.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 * Die Galerie gruppiert nach set_number: Besitzen im Haushalt zwei Konten
 * dasselbe Set, steht dort EINE Kachel mit beiden Besitzer-Plaketten.
 * getStats() zählte dagegen die Tabellenzeilen — `COUNT(*) FROM sets`.
 *
 * NACHGEMESSEN mit zwei verknüpften Konten (dasselbe Set bei beiden, ein
 * weiteres nur beim Kind):
 *
 *     Kopfzeile /v1/stats : 3 Sets
 *     Galerie darunter    : 2 Kacheln, total=2
 *
 * Beide Zahlen stehen übereinander auf demselben Bildschirm — in der Webapp
 * als hs-sets über dem Raster, in der App als Kachel „Sets" direkt darüber.
 *
 * Im Einzelkonto gibt es je Setnummer nur eine Zeile, dort sind beide Zahlen
 * gleich. Genau deshalb hat es niemand gesehen.
 *
 * ── Warum die Prüfung die beiden VERGLEICHT ─────────────────────────────────
 * Eine feste Erwartung („2 Sets") würde beim nächsten Umbau der Gruppierung
 * genauso falsch wie die alte Zahl. Verglichen wird deshalb die Kopfzeile mit
 * der Liste — dieselbe Frage, zwei Wege, ein Ergebnis.
 *
 * Voraussetzung: Test-DB über TEST_DATABASE_URL (Inhalt wird geleert!).
 */
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

async function erreichbar() {
  try { await db.get('SELECT 1'); return true; } catch { return false; }
}

after(() => db.pool.end());

test('Kopfzeile und Galerie zaehlen dieselben Sets', async (t) => {
  if (!await erreichbar()) {
    if (process.env.REQUIRE_DB === '1') assert.fail('Test-DB nicht erreichbar, REQUIRE_DB=1');
    t.skip('keine Test-DB'); return;
  }
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchemaOnce();

  await db.run(`INSERT INTO users (username,password_hash) VALUES ('haupt','x'),('kind','x')`);
  const id = async (n) => (await db.get(`SELECT id FROM users WHERE username=$1`, [n])).id;
  const haupt = await id('haupt'), kind = await id('kind');
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2)`, [haupt, kind]);

  // 75192-1 besitzen BEIDE — ohne diese Überschneidung stimmen Zeilenzahl und
  // Kachelzahl zufällig überein, und der Test prüfte nichts.
  await db.run(`INSERT INTO sets (user_id,set_number,name,quantity) VALUES
      ($1,'75192-1','Falcon',1), ($2,'75192-1','Falcon',1), ($2,'21318-1','Baumhaus',1)`, [haupt, kind]);

  const { scopeIds } = _req('utils/household.js');
  const { getStats } = _req('utils/handlers/stats.js');
  const { getSets } = _req('utils/handlers/sets.js');

  for (const modus of ['all', 'own']) {
    const uids = await scopeIds(haupt, modus);
    const kopf = await getStats(uids);
    const liste = await getSets(uids, { page_size: 60 });
    assert.equal(kopf.total_sets, liste.total,
      `Blickfeld ${modus}: Die Kopfzeile nennt ${kopf.total_sets} Sets, die Galerie ` +
      `zeigt ${liste.total}. Beide Zahlen stehen übereinander auf demselben ` +
      `Bildschirm — zählt eine die Tabellenzeilen und die andere die Kacheln, ` +
      `widersprechen sie sich im Haushalt.`);
    assert.equal(kopf.total_sets, (liste.sets || []).length,
      `Blickfeld ${modus}: total passt, die Anzahl der Kacheln aber nicht`);
  }

  // Die andere Lesart bleibt erhalten und steht in der App als eigene Kachel
  // daneben („Einheiten"). Ohne diese Zusicherung wäre die naheliegende
  // „Korrektur" — beide auf DISTINCT — unbemerkt geblieben.
  const alle = await getStats(await scopeIds(haupt, 'all'));
  assert.equal(alle.total_quantity, 3,
    'Exemplare zählen weiterhin einzeln: zwei Konten mit demselben Set plus eines');
  assert.equal(alle.total_sets, 2, 'verschiedene Sets im Haushalt');
});
