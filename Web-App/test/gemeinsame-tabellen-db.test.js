/**
 * Tabellen ohne user_id teilen sich alle Konten. Welche das sind, steht unten
 * in GEMEINSAM, je Tabelle mit Art und ob Eingaben eines Kontos hinein dürfen.
 * Die Tabellen kommen aus dem echten Schema, die schreibenden Stellen aus dem
 * Quelltext (eine neue Stelle auf eine Katalogtabelle muss hier eingetragen
 * werden), und ein Lauf mit Eingaben zweier Konten prüft, dass deren Werte in
 * keiner Tabelle mit `eingabe: false` ankommen.
 *
 * Gegenproben (am 04.11.2026 gemessen, je eine Änderung, danach zurück):
 *   A  routes/api_v1/wanted.ts: merkeNummer schreibt immer merkeBlNummer →
 *      rot: „Eingaben eines Kontos landen in keiner gemeinsamen Tabelle“
 *      (bl_zuordnung trägt die Marke)
 *   B  merkeFigur() in src/katalog/katalogPflege.ts ohne den Zweig für `von` →
 *      rot: dieselbe Prüfung (minifigs_catalog)
 *   C  ein `INSERT INTO part_catalog` in src/teile/repository/manuelleTeile.ts
 *      → rot: „jede schreibende Stelle auf eine Katalogtabelle ist eingetragen“
 *   D  eine Tabelle `probe_gemeinsam (x int)` per Migration → rot: „jede
 *      Tabelle ohne user_id steht in der Liste“
 *
 * REQUIRE_DB=1.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, ohneKommentare } = require('./helpers/sources');
const _req = buildAndRequire();
const db = _req('db/database.js');
const { testServer } = require('./helpers/server');

// Ohne Netz: Rebrickable kennt nichts, dann bleibt nur die Eingabe selbst.
const rbPfad = require.resolve(path.join(ROOT, 'dist', 'clients/rebrickable.js'));
const echtRb = require(rbPfad);
require.cache[rbPfad].exports = Object.assign({}, echtRb, {
  lookupPart: async () => null, getMinifigInfo: async () => null, getSetInfo: async () => null,
});

const KATALOG = 'katalog';   // geprüfte Quellen (Rebrickable, BrickLink, Brickset, EZB)
const BETRIEB = 'betrieb';   // Zustand des Servers, keine Angaben über Teile
const KONTO   = 'konto';     // gehört einem Konto über einen anderen Schlüssel

/** art, eingabe (false oder warum Eingaben hinein dürfen), schreiber (nur Katalog). */
const GEMEINSAM = {
  bl_zuordnung:          { art: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/blZuordnung.ts'] },
  catalog_cache:         { art: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/katalogCache.ts', 'src/katalog/repository/rebrickableCache.ts', 'src/sets/repository/setDetail.ts'] },
  set_catalog:           { art: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/bildlage.ts', 'src/sets/repository/sets.ts'] },
  part_catalog:          { art: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/katalogStamm.ts'] },
  part_color_catalog:    { art: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/csvKatalog.ts', 'src/katalog/repository/katalogStamm.ts'] },
  minifigs_catalog:      { art: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/katalogStamm.ts'] },
  set_teile:             { art: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/katalogStamm.ts'] },
  set_figuren:           { art: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/katalogStamm.ts'] },
  subsets_cache:         { art: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/katalogCache.ts', 'src/katalog/repository/rebrickableCache.ts'] },
  minifig_parts_cache:   { art: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/rebrickableCache.ts'] },
  shared_instructions:   { art: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/anleitungen.ts'] },
  rb_colors:             { art: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/blZuordnung.ts'] },
  rb_inventories:        { art: KATALOG, eingabe: false, schreiber: [] },
  rb_inventory_minifigs: { art: KATALOG, eingabe: false, schreiber: [] },
  rb_inventory_parts:    { art: KATALOG, eingabe: false, schreiber: [] },
  rb_part_categories:    { art: KATALOG, eingabe: false, schreiber: [] },
  rb_parts:              { art: KATALOG, eingabe: false, schreiber: [] },
  rb_sets:               { art: KATALOG, eingabe: false, schreiber: [] },
  rb_themes:             { art: KATALOG, eingabe: false, schreiber: [] },
  price_cache:           { art: KATALOG, eingabe: false, schreiber: ['src/finanzen/repository/preisCache.ts', 'src/verwaltung/repository/verwaltung.ts'] },
  price_history:         { art: KATALOG, eingabe: false, schreiber: ['src/finanzen/repository/preisCache.ts', 'src/finanzen/repository/preisLauf.ts', 'src/finanzen/repository/preisverlauf.ts'] },
  part_price_cache:      { art: KATALOG, eingabe: false, schreiber: ['src/finanzen/repository/preisCache.ts'] },
  part_price_history:    { art: KATALOG, eingabe: false, schreiber: ['src/finanzen/repository/preisCache.ts'] },
  minifig_price_cache:   { art: KATALOG, eingabe: false, schreiber: ['src/finanzen/repository/marktpreise.ts', 'src/finanzen/repository/preisCache.ts'] },
  minifig_price_history: { art: KATALOG, eingabe: false, schreiber: ['src/finanzen/repository/marktpreise.ts', 'src/finanzen/repository/preisCache.ts'] },
  wechselkurse:          { art: KATALOG, eingabe: false, schreiber: ['src/finanzen/repository/wechselkurse.ts'] },
  image_misses:          { art: BETRIEB, eingabe: false },
  image_wanted:          { art: BETRIEB, eingabe: false },
  parts_katalog_offen:   { art: BETRIEB, eingabe: 'Nummern, deren Teile-Zusammenfassung nachzuziehen ist; sie ändern keine Angabe' },
  api_takt:              { art: BETRIEB, eingabe: false },
  auftrag_pausen:        { art: BETRIEB, eingabe: false },
  laufzustand:           { art: BETRIEB, eingabe: false },
  schema_migrations:     { art: BETRIEB, eingabe: false },
  global_settings:       { art: BETRIEB, eingabe: 'nur Verwalter (requireAdmin)' },
  app_logs:              { art: BETRIEB, eingabe: 'Protokollzeilen nennen Eingaben, steuern aber nichts' },
  rate_limit_attempts:   { art: BETRIEB, eingabe: 'Schlüssel aus Benutzername und Adresse der Anmeldebremse' },
  users:                 { art: KONTO, eingabe: 'Zeile des Kontos (id)' },
  user_sessions:         { art: KONTO, eingabe: 'Sitzung eines Kontos (sess.userId)' },
  account_links:         { art: KONTO, eingabe: 'Haushalt (main_user_id, sub_user_id)' },
  account_link_invites:  { art: KONTO, eingabe: 'Einladung des Hauptkontos (main_user_id)' },
  household_former_links:{ art: KONTO, eingabe: 'frühere Haushalte (main_user_id, sub_user_id)' },
  api_aufrufe:           { art: KONTO, eingabe: 'Zähler je Konto (konto)' },
  gutschein_guthaben_schranke: { art: KONTO, eingabe: 'je Gutschein (id = vouchers.id)' },
  verwaltungsprotokoll:  { art: KONTO, eingabe: 'Handlungen der Verwalter (verwalter_id)' },
};

/** Dateien mit Tabellennamen aus einer Variablen: Wohin sie schreiben, steht daneben. */
const DYNAMISCH = {
  'src/bestand/repository/kaufErfassungen.ts': 'set_/part_/minifig_acquisitions (user_id)',
  'src/bestand/repository/lagerort.ts':        'sets/parts/minifigs (user_id)',
  'src/bestand/repository/manuelleMengen.ts':  'part_/minifig_acquisitions (user_id)',
  'src/bestand/repository/papierkorb.ts':      'Bestandstabellen (user_id)',
  'src/gutscheine/repository/gutscheine.ts':   'vouchers (user_id)',
  'src/katalog/repository/csvTausch.ts':       'rb_* aus den Rebrickable-CSV-Dateien',
  'src/katalog/repository/teileAnreicherung.ts': 'part_catalog/part_color_catalog aus Rebrickable',
  'src/sets/repository/verschieben.ts':        'Bestand und Erfassungen (user_id)',
};

const MARKE = 'zzmarke7q';

/** Datei → geschriebene Tabellen, ohne Kommentare; `DO UPDATE SET` ist kein Tabellenname. */
function schreibendeStellen() {
  const tabellen = new Map(), dynamisch = new Set();
  (function lauf(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) {
        if (!['node_modules', 'dist', 'test', 'migrations', 'altbestand', 'public', 'docs', 'scripts'].includes(n)) lauf(p);
        continue;
      }
      if (!n.endsWith('.ts')) continue;
      const datei = path.relative(ROOT, p).split(path.sep).join('/');
      const s = ohneKommentare(fs.readFileSync(p, 'utf8'));
      const muster = /\b(?:INSERT INTO|DELETE FROM|TRUNCATE(?: TABLE)?)\s+([a-z_][a-z0-9_]*|\$\{)|(?<!DO )\bUPDATE\s+([a-z_][a-z0-9_]*|\$\{)[^;`'"]*?\bSET\b/g;
      for (const m of s.matchAll(muster)) {
        const t = m[1] ?? m[2];
        if (t === '${') dynamisch.add(datei);
        else (tabellen.get(t) ?? tabellen.set(t, new Set()).get(t)).add(datei);
      }
    }
  })(ROOT);
  return { tabellen, dynamisch };
}

test('gemeinsame Tabellen', { concurrency: 1, timeout: 120_000 }, async (t) => {
  try { await db.get('SELECT 1'); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  { const c = await db.pool.connect(); try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); } }
  t.after(() => db.pool.end().catch(() => {}));

  await t.test('jede Tabelle ohne user_id steht in der Liste', async () => {
    const ohne = (await db.all(`
      SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
       WHERE c.relkind IN ('r', 'p') AND NOT EXISTS (
         SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'user_id' AND NOT a.attisdropped)`)).map(z => z.t);
    assert.ok(ohne.length > 30, `nur ${ohne.length} Tabellen gefunden — greift die Abfrage noch?`);
    assert.deepEqual(ohne.sort(), Object.keys(GEMEINSAM).sort());
  });

  await t.test('jede schreibende Stelle auf eine Katalogtabelle ist eingetragen', () => {
    const { tabellen, dynamisch } = schreibendeStellen();
    assert.ok(tabellen.size > 40, `nur ${tabellen.size} Tabellen beschrieben — greift die Suche noch?`);
    const ist = {}, soll = {};
    for (const [name, e] of Object.entries(GEMEINSAM)) {
      if (e.art !== KATALOG) continue;
      ist[name] = [...(tabellen.get(name) ?? [])].sort();
      soll[name] = [...e.schreiber].sort();
    }
    assert.deepEqual(ist, soll, 'Eine Katalogtabelle bekommt einen neuen Schreiber: Kommt der Wert aus einer '
      + 'geprüften Quelle, hier eintragen; ist es eine Eingabe, gehört sie in eine Tabelle des Kontos.');
    assert.deepEqual([...dynamisch].sort(), Object.keys(DYNAMISCH).sort());
  });

  await t.test('Eingaben eines Kontos landen in keiner gemeinsamen Tabelle', async () => {
    const neu = async (name) => (await db.get(
      `INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [name])).id;
    const A = await neu('anna'), B = await neu('bruno');
    await db.run(`INSERT INTO part_catalog (part_number, part_name) VALUES ('3003','Brick 2 x 2')`);
    await db.run(`INSERT INTO minifigs_catalog (fig_number, fig_name, image_url) VALUES ('fig-000001','Han','https://cdn.rebrickable.com/f.jpg')`);
    await db.run(`INSERT INTO rb_colors (id, name, bl_color_id) VALUES (4,'Red',5)`);

    const { addManualPart } = _req('src/teile/manuelleTeile.js');
    const { addManualFig, updateManualFig, importiereFigurenCsv } = _req('src/figuren/manuelleFiguren.js');
    const bild = `https://cdn.rebrickable.com/${MARKE}.png`;
    await addManualPart(A, { part_number: '3005', color_id: 4, part_name: `${MARKE} Teil`, color_name: MARKE,
                             category_name: MARKE, image_url: bild, quantity: 1, unit_price: 1 });
    await addManualFig(A, { fig_number: 'fig-000002', fig_name: `${MARKE} Figur`, image_url: bild,
                            bl_fig_number: `${MARKE}1`, quantity: 1, unit_price: 1 });
    await addManualFig(B, { fig_number: 'fig-000001', quantity: 1, unit_price: 1 });
    await updateManualFig(B, 'fig-000001', { bl_fig_number: `${MARKE}2` });
    await importiereFigurenCsv(B, `fig_number,fig_name,bl_fig_number,quantity\nfig-000003,${MARKE} csv,${MARKE}3,1\n`);

    const srv = testServer(_req, { sitzung: { userId: A }, apiNutzer: { user_id: A, is_admin: 0 },
      routen: { '/api/v1': 'routes/api_v1/index.js' }, t });
    const fd = new FormData();
    fd.append('file', new Blob([`<?xml version="1.0"?><INVENTORY>
      <ITEM><ITEMTYPE>M</ITEMTYPE><ITEMID>${MARKE}4</ITEMID><MINQTY>1</MINQTY></ITEM>
      <ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>${MARKE}5</ITEMID><COLOR>5</COLOR><MINQTY>1</MINQTY></ITEM></INVENTORY>`],
      { type: 'text/xml' }), 'w.xml');
    fd.append('korrekturen', JSON.stringify([
      { index: 0, blId: `${MARKE}4`, art: 'fig', rbId: 'fig-000001' },
      { index: 1, blId: `${MARKE}5`, art: 'part', rbId: '3003', rbFarbe: 4 }]));
    const r = await fetch(`${srv.base}/api/v1/wanted-list/import/xml?schreiben=1`, { method: 'POST', body: fd });
    const bericht = await r.json();
    assert.equal(bericht.korrekturen?.angewandt, 2, JSON.stringify(bericht));

    const befallen = [];
    for (const [name, e] of Object.entries(GEMEINSAM)) {
      if (e.eingabe !== false) continue;
      const n = (await db.get(`SELECT count(*)::int AS n FROM ${name} x WHERE x::text LIKE $1`, [`%${MARKE}%`])).n;
      if (n) befallen.push(`${name} (${n})`);
    }
    assert.deepEqual(befallen, []);
    // Gegenstück: Die Eingaben stehen bei den Konten, sonst prüfte die Suche oben nichts.
    const eigen = await db.get(`SELECT
      (SELECT count(*) FROM bl_zuordnung_eigen e WHERE e::text LIKE '%${MARKE}%')::int AS bl,
      (SELECT count(*) FROM figur_eigen e WHERE e::text LIKE '%${MARKE}%')::int AS fig,
      (SELECT count(*) FROM teil_eigen e WHERE e::text LIKE '%${MARKE}%')::int AS teil`);
    assert.deepEqual(eigen, { bl: 5, fig: 2, teil: 1 });

  });
});
