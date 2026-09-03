/**
 * Der Papierkorb löscht die Karte, auf die geklickt wurde.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 * Der manuelle Bereich zeigt im Haushalt die Einträge ALLER Konten — mit
 * Besitzer-Plakette und einem Papierkorb je Karte (getManualParts und
 * getManualMinifigs lesen `user_id = ANY(uids)`). Die Löschroute bekam aber
 * nur Nummer und Farbe und löschte damit immer die Zeile des AUFRUFERS.
 *
 * NACHGEMESSEN mit zwei verknüpften Konten, beide mit einem manuellen Teil
 * 3001/Farbe 4:
 *
 *     Manueller Bereich zeigt 2 Karten: [{owner:2, ×5}, {owner:3, ×9}]
 *     Hauptkonto klickt den Papierkorb der Karte des Kindes
 *     DELETE /api/v1/parts/3001/4  ->  {"success":true}
 *     NACHHER: nur noch user 3: ×9
 *
 * Geklickt war die fremde Karte, gelöscht wurde die eigene, und die Antwort
 * sagte „success". Die fremde Karte blieb stehen.
 *
 * ── Die Lösung, und warum sie so aussieht ───────────────────────────────────
 * `?owner=<id>` sagt, WESSEN Zeile gemeint ist; ob das erlaubt ist, entscheidet
 * resolveWriteTarget() über canWriteFor() — derselbe Helfer, den das ERFASSEN
 * schon benutzt (owner_user_id). Ohne den Parameter bleibt es beim eigenen
 * Konto, ein Client, der ihn nicht kennt, läuft also unverändert weiter.
 *
 * Voraussetzung: Test-DB über TEST_DATABASE_URL (Inhalt wird geleert!).
 */
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');

async function erreichbar() {
  try { await db.get('SELECT 1'); return true; } catch { return false; }
}

// EINMAL fuer die Datei, nicht je Test: Ein t.after(() => db.pool.end()) im
// ersten Test schloss den Pool, bevor der zweite lief — der meldete dann
// „Test-DB nicht erreichbar" statt zu pruefen. Auf Dateiebene laeuft es nach
// dem letzten Test, auch wenn eine Zusicherung vorher scheitert.
after(() => db.pool.end());

test('der Papierkorb trifft die geklickte Karte, nicht die eigene', async (t) => {
  if (!await erreichbar()) {
    if (process.env.REQUIRE_DB === '1') assert.fail('Test-DB nicht erreichbar, REQUIRE_DB=1');
    t.skip('keine Test-DB'); return;
  }
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchemaOnce();

  await db.run(`INSERT INTO users (username,password_hash) VALUES ('haupt','x'),('kind','x'),('fremd','x')`);
  const id = async (n) => (await db.get(`SELECT id FROM users WHERE username=$1`, [n])).id;
  const haupt = await id('haupt'), kind = await id('kind'), fremd = await id('fremd');
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2)`, [haupt, kind]);

  // Dieselbe Nummer bei beiden — genau der Fall, den die Route nicht
  // unterscheiden konnte.
  await db.run(`INSERT INTO parts (user_id,part_number,color_id,part_name,quantity,source)
                VALUES ($1,'3001',4,'Brick 2x4',5,'manual'), ($2,'3001',4,'Brick 2x4',9,'manual')`, [haupt, kind]);
  await db.run(`INSERT INTO minifigs (user_id,fig_number,fig_name,quantity,source)
                VALUES ($1,'sw0001','Luke',1,'manual'), ($2,'sw0001','Luke',2,'manual')`, [haupt, kind]);

  const { base } = testServer(_req, {
    sitzung: { userId: haupt },
    apiNutzer: { user_id: haupt, is_admin: 0, username: 'haupt' },
    routen: { '/api/v1': 'routes/api_v1/index.js' },
    t,
  });
  const ruf = async (pfad, methode = 'GET') => {
    const r = await fetch(base + pfad, { method: methode });
    return { status: r.status, body: await r.json() };
  };
  const teile = async () => (await db.all(
    `SELECT user_id, quantity FROM parts WHERE part_number='3001' ORDER BY user_id`))
    .map(r => `${r.user_id}:${r.quantity}`);
  const figuren = async () => (await db.all(
    `SELECT user_id FROM minifigs WHERE fig_number='sw0001' ORDER BY user_id`)).map(r => r.user_id);

  assert.deepEqual(await teile(), [`${haupt}:5`, `${kind}:9`], 'Vorlage');

  // Die Karte des KINDES löschen.
  const a = await ruf(`/api/v1/parts/3001/4?owner=${kind}`, 'DELETE');
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.deepEqual(await teile(), [`${haupt}:5`],
    'Geklickt war die Karte des Unterkontos — genau die muss weg sein, und die eigene bleiben');

  // Danach die eigene, ohne Parameter (Verhalten wie vorher).
  const b = await ruf('/api/v1/parts/3001/4', 'DELETE');
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.deepEqual(await teile(), [], 'Ohne owner das eigene Konto');

  // Dasselbe für Minifiguren.
  assert.deepEqual(await figuren(), [haupt, kind], 'Vorlage Minifiguren');
  const c = await ruf(`/api/v1/minifigs/sw0001?owner=${kind}`, 'DELETE');
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.deepEqual(await figuren(), [haupt], 'Die Figur des Unterkontos muss weg sein');

  // ── Dasselbe beim ÄNDERN ────────────────────────────────────────────────
  // NACHGEMESSEN: Das Hauptkonto setzte auf der Karte des Kindes die Menge auf
  // 99 — geändert wurde die EIGENE Zeile (vorher 5|9, nachher 99|9), und die
  // Antwort sagte „success". Lesen und Löschen zu prüfen und das Schreiben
  // auszulassen hiesse, denselben Fehler an der dritten Stelle stehen zu lassen.
  await db.run(`INSERT INTO parts (user_id,part_number,color_id,part_name,quantity,source)
                VALUES ($1,'3020',0,'Plate',5,'manual'), ($2,'3020',0,'Plate',9,'manual')`, [haupt, kind]);
  const mengen = async () => (await db.all(
    `SELECT user_id, quantity FROM parts WHERE part_number='3020' ORDER BY user_id`))
    .map(r => `${r.user_id}:${r.quantity}`);
  const setze = async (pfad, menge) => (await fetch(base + pfad, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ quantity: menge }),
  })).status;

  assert.equal(await setze(`/api/v1/parts/3020/0?owner=${kind}`, 99), 200);
  assert.deepEqual(await mengen(), [`${haupt}:5`, `${kind}:99`],
    'Geändert werden muss die Karte des Unterkontos — die eigene bleibt');
  assert.equal(await setze(`/api/v1/parts/3020/0?owner=${fremd}`, 42), 403,
    'Ein Konto ausserhalb des Haushalts wird abgelehnt');
  assert.deepEqual(await mengen(), [`${haupt}:5`, `${kind}:99`], 'und nichts angefasst');

  // Ein Konto ausserhalb des Haushalts geht nicht — der Parameter ist eine
  // Angabe der Ansicht, kein Zugriffsweg.
  const d = await ruf(`/api/v1/minifigs/sw0001?owner=${fremd}`, 'DELETE');
  assert.equal(d.status, 403, 'Fremdes Konto muss abgelehnt werden, nicht stillschweigend ignoriert');
  assert.deepEqual(await figuren(), [haupt], 'und nichts anfassen');
});

/**
 * Damit eine Ansicht den Besitzer MITGEBEN kann, muss sie ihn erst BEKOMMEN.
 *
 * NACHGEMESSEN in einem Haushalt aus zwei Konten: Die Figuren-Bewertung trug
 * user_id und owners, die Teile-Bewertung weder das eine noch das andere —
 * computePartsValuation() zählt seine Felder einzeln auf und liess user_id
 * weg, während die Figuren-Fassung `{ ...fig }` streut. withOwnerNames()
 * hängt `owners` aber nur an Zeilen MIT user_id an.
 *
 * Sichtbar war das in der Android-App: Die manuelle Teile-Kachel zeichnet
 * OwnerBadges(part.owners) — die Plakette blieb immer leer, während sie auf
 * der Figuren-Kachel erschien. Die Absicht stand im Code, der Wert kam nie an.
 */
test('beide Bewertungen fuehren den Besitzer mit', async (t) => {
  if (!await erreichbar()) {
    if (process.env.REQUIRE_DB === '1') assert.fail('Test-DB nicht erreichbar, REQUIRE_DB=1');
    t.skip('keine Test-DB'); return;
  }
  // KEIN zweites DROP SCHEMA: Der erste Test in dieser Datei hat das Schema
  // schon frisch aufgebaut, und jedes weitere Fallenlassen ist eine Sperre
  // mehr, die mit dem Verbindungspool einer gerade beendeten Testdatei
  // zusammentreffen kann. Die Vorlage hier benutzt deshalb eigene Namen (h2,
  // k2) und eigene Nummern, damit sie sich mit der ersten nicht ins Gehege
  // kommt. initSchemaOnce() bleibt, damit der Test auch einzeln läuft.
  await db.initSchemaOnce();

  await db.run(`INSERT INTO users (username,password_hash) VALUES ('h2','x'),('k2','x')`);
  const id = async (n) => (await db.get(`SELECT id FROM users WHERE username=$1`, [n])).id;
  const haupt = await id('h2'), kind = await id('k2');
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2)`, [haupt, kind]);
  await db.run(`INSERT INTO parts (user_id,part_number,color_id,part_name,quantity,source,unit_price)
                VALUES ($1,'3001',4,'Brick',5,'manual',0.5), ($2,'3020',0,'Plate',9,'manual',0.3)`, [haupt, kind]);
  await db.run(`INSERT INTO minifigs (user_id,fig_number,fig_name,quantity,source,unit_price)
                VALUES ($1,'sw0001','Luke',1,'manual',12.0), ($2,'sw0002','Leia',2,'manual',9.0)`, [haupt, kind]);

  const { base } = testServer(_req, {
    sitzung: { userId: haupt },
    apiNutzer: { user_id: haupt, is_admin: 0, username: 'h2' },
    routen: { '/api/v1': 'routes/api_v1/index.js' },
    t,
  });
  const hole = async (p) => (await fetch(base + p)).json();

  // Beide Arten in EINER Schleife: Die Zusicherung soll für beide gleich
  // lauten, sonst driften sie wieder auseinander.
  for (const [pfad, feld, art] of [
    ['/api/v1/finance/parts-valuation', 'parts', 'Teile'],
    ['/api/v1/finance/minifigs-valuation', 'figs', 'Minifiguren'],
  ]) {
    const zeilen = (await hole(pfad))[feld] || [];
    assert.equal(zeilen.length, 2, `${art}: Vorlage hat zwei Einträge`);
    for (const z of zeilen) {
      assert.ok(z.user_id, `${art}: user_id fehlt — ohne das hängt withOwnerNames() nichts an`);
      assert.equal(z.owners?.length, 1, `${art}: genau eine Besitzer-Plakette erwartet`);
      assert.equal(z.owners[0].id, z.user_id, `${art}: Plakette muss zum Besitzer passen`);
    }
  }
});
