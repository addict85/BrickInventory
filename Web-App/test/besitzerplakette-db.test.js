/**
 * Wo ein Client eine Besitzer-Plakette zeichnet, muss die Antwort sie tragen.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 * NACHGEMESSEN in einem Haushalt aus zwei Konten, in dem nur das Unterkonto
 * etwas besitzt:
 *
 *   /v1/sets (Galerie)          Plakette JA    Client zeichnet: ja
 *   /v1/parts (Set-Teile)       Plakette nein  Client zeichnet: nein
 *   /v1/parts/manual            Plakette JA    Client zeichnet: ja
 *   /v1/minifigs (Set-Figuren)  Plakette nein  Client zeichnet: JA   ← Lücke
 *   /v1/minifigs/manual         Plakette JA    Client zeichnet: ja
 *
 * Die Set-Figurenliste gruppiert dieselbe Figur über alle Konten des Haushalts
 * (GROUP BY fig_number, source) und hatte danach keine einzelne user_id mehr —
 * withOwners() konnte also nichts anhängen. Gezeichnet haben die Plakette
 * beide Clients trotzdem: `ownerBadges(f)` in public/js/06-minifigs.js und
 * `OwnerBadges(fig.owners)` in MinifigsScreen.kt. Die Absicht stand im Code,
 * der Wert kam nie an — dieselbe Form wie bei der Teile-Bewertung.
 *
 * Die Galerie löst dasselbe Problem seit jeher mit `array_agg(DISTINCT
 * user_id)`; die Figurenliste tut es jetzt genauso.
 *
 * ── Warum EINE Schleife für alle vier ───────────────────────────────────────
 * Vier gleichlautende Zusicherungen, getrennt aufgeschrieben, sind vier
 * Stellen, die auseinanderlaufen können — genau so ist die Lücke entstanden.
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

test('jede Liste mit Plakette im Client traegt sie auch in der Antwort', async (t) => {
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

  // NUR das Unterkonto besitzt etwas. Damit ist die Plakette aussagekräftig:
  // Steht dort das eigene Konto, ist die Zuordnung falsch; fehlt sie, sieht
  // das Hauptkonto einen Bestand ohne Herkunft.
  await db.run(`INSERT INTO sets (user_id,set_number,name,quantity)
                VALUES ($1,'75192-1','Falcon',1)`, [kind]);
  await db.run(`INSERT INTO parts (user_id,set_number,part_number,color_id,part_name,quantity,source)
                VALUES ($1,'75192-1','3001',4,'Brick',10,'set'),
                       ($1,NULL,'3020',0,'Plate',3,'manual')`, [kind]);
  await db.run(`INSERT INTO minifigs (user_id,set_number,fig_number,fig_name,quantity,source)
                VALUES ($1,'75192-1','sw0001','Luke',1,'set'),
                       ($1,NULL,'sw0002','Leia',2,'manual')`, [kind]);

  const { scopeIds } = _req('utils/household.js');
  const uids = await scopeIds(haupt, 'all');
  const S = _req('utils/handlers/sets.js');
  const P = _req('utils/handlers/parts.js');
  const M = _req('utils/handlers/minifigs.js');

  const listen = [
    ['/v1/sets',            async () => (await S.getSets(uids, { page_size: 60 })).sets],
    // getManualParts/getManualMinifigs liefern ein NACKTES Array; die Route
    // verpackt es. Die drei anderen Listen liefern ein Objekt mit `total`.
    ['/v1/parts/manual',    async () => await P.getManualParts(uids, {})],
    ['/v1/minifigs',        async () => (await M.getMinifigs(uids, { source: 'set' })).figs],
    ['/v1/minifigs/manual', async () => await M.getManualMinifigs(uids, {})],
  ];

  for (const [name, hole] of listen) {
    const zeilen = await hole();
    assert.ok(zeilen?.length, `${name}: Vorlage liefert keine Zeile — dann prüft der Rest nichts`);
    for (const z of zeilen) {
      assert.ok(Array.isArray(z.owners) && z.owners.length === 1,
        `${name}: keine Besitzer-Plakette in der Antwort. Beide Clients zeichnen sie ` +
        `an dieser Stelle (ownerBadges / OwnerBadges) — ohne den Wert bleibt sie leer.`);
      assert.equal(z.owners[0].id, kind, `${name}: falsches Konto in der Plakette`);
      assert.equal(z.owners[0].username, 'kind', `${name}: Plakette ohne Namen nützt nichts`);
    }
  }

  // Die Set-Teileliste ist die eine Ausnahme, und zwar begründet: Sie gruppiert
  // nach Teilenummer UND Farbe über den ganzen Haushalt, und keiner der beiden
  // Clients zeichnet dort eine Plakette. Kommt eine dazu, schlägt diese
  // Zusicherung an — dann gehört auch das Aggregat in die Abfrage.
  const teile = (await P.getParts(uids, { page_size: 60, exclude_manual: '1' })).parts;
  assert.ok(teile?.length, 'Vorlage: Set-Teile fehlen');
  for (const z of teile) {
    assert.equal(z.owners, undefined,
      'Die Set-Teileliste trägt jetzt Besitzer — dann muss auch ein Client sie ' +
      'zeichnen, sonst ist es Ballast in jeder Antwort.');
  }
});

test('im Einzelkonto steht keine Plakette', async (t) => {
  if (!await erreichbar()) {
    if (process.env.REQUIRE_DB === '1') assert.fail('Test-DB nicht erreichbar, REQUIRE_DB=1');
    t.skip('keine Test-DB'); return;
  }
  // Kein zweites DROP SCHEMA — eigene Kontonamen genügen (siehe
  // manuell-loeschen-besitzer-db.test.js).
  await db.initSchemaOnce();
  await db.run(`INSERT INTO users (username,password_hash) VALUES ('allein','x')`);
  const allein = (await db.get(`SELECT id FROM users WHERE username='allein'`)).id;
  await db.run(`INSERT INTO sets (user_id,set_number,name,quantity)
                VALUES ($1,'21318-1','Baumhaus',1)`, [allein]);
  await db.run(`INSERT INTO minifigs (user_id,set_number,fig_number,fig_name,quantity,source)
                VALUES ($1,'21318-1','sw0003','Rey',1,'set')`, [allein]);

  const { scopeIds } = _req('utils/household.js');
  const uids = await scopeIds(allein, 'all');
  const S = _req('utils/handlers/sets.js');
  const M = _req('utils/handlers/minifigs.js');

  // „gehört mir" an jeder Kachel wäre nur Rauschen — und zusätzliche Felder in
  // jeder Antwort. Dieselbe Entscheidung wie bei den Sets seit jeher.
  for (const [name, zeilen] of [
    ['/v1/sets', (await S.getSets(uids, { page_size: 60 })).sets],
    ['/v1/minifigs', (await M.getMinifigs(uids, { source: 'set' })).figs],
  ]) {
    assert.ok(zeilen?.length, `${name}: Vorlage liefert keine Zeile`);
    for (const z of zeilen) {
      assert.equal(z.owners, undefined, `${name}: Plakette gehört nicht ins Einzelkonto`);
      assert.equal(z.owner_ids, undefined, `${name}: owner_ids gehört nicht ins Einzelkonto`);
    }
  }
});
