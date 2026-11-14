/**
 * Tabellen ohne user_id teilen sich alle Konten. Welche das sind, steht unten
 * in GEMEINSAM, je Tabelle mit Art und ob Eingaben eines Kontos hinein dürfen.
 * Die Tabellen kommen aus dem echten Schema, die schreibenden Stellen aus dem
 * Quelltext (eine neue Stelle auf eine Katalogtabelle muss hier eingetragen …
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
 * Jede Tabelle hat einen Besitzer-Bereich (BESITZER); nur er schreibt hinein,
 * andere rufen seinen Dienst. Gegenproben (10.11.2026 gemessen):
 *   E  `DELETE FROM price_cache` zurück nach src/verwaltung/repository/verwaltung.ts
 *      → rot: „jede Tabelle hat einen Besitzer, nur er schreibt hinein“ (und
 *      „jede schreibende Stelle auf eine Katalogtabelle …“)
 *   F  merkeKatalogCache zurück nach src/sets/repository/setDetail.ts → rot: dieselbe
 *      Prüfung (und „jede schreibende Stelle auf eine Katalogtabelle …“)
 *   G  die Zeile 'src/sammlung/repository/loeschen.ts → part_acquisitions' aus
 *      FREMDSCHREIBER gestrichen → rot: dieselbe Prüfung
 *
 * Die Eingaben macht jedes Konto in seinem Namen (alsKonto) als Laufzeitrolle, wie im
 * Betrieb; Testdaten und die Suche danach laufen über die Eigentümerin.
 *
 * REQUIRE_DB=1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, ohneKommentare, testDaten, alsKonto, testQuellen } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const { importWorker } = require('./helpers/auftraege');
const db = testDaten();
const { testServer } = require('./helpers/server');

// Ohne Netz: Rebrickable kennt nichts (testQuellen), dann bleibt nur die Eingabe selbst.
testQuellen(null, {
  lookupPart: async () => null,
  getMinifigInfo: async () => null,
  getSetInfo: async () => null,
});

const KATALOG = 'katalog'; // geprüfte Quellen (Rebrickable, BrickLink, Brickset, EZB)
const BETRIEB = 'betrieb'; // Zustand des Servers, keine Angaben über Teile
const KONTO = 'konto'; // gehört einem Konto über einen anderen Schlüssel

/** art, eingabe (false oder warum Eingaben hinein dürfen), schreiber (nur Katalog). */
const GEMEINSAM = {
  bl_zuordnung: { art: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/blZuordnung.ts'] },
  catalog_cache: {
    art: KATALOG,
    eingabe: false,
    schreiber: ['src/katalog/repository/katalogCache.ts', 'src/katalog/repository/rebrickableCache.ts'],
  },
  set_catalog: {
    art: KATALOG,
    eingabe: false,
    schreiber: [
      'src/bilder/repository/bildlage.ts',
      'src/katalog/repository/csvTausch.ts',
      'src/katalog/repository/setStamm.ts',
    ],
  },
  part_catalog: { art: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/katalogStamm.ts'] },
  part_color_catalog: {
    art: KATALOG,
    eingabe: false,
    schreiber: ['src/katalog/repository/csvKatalog.ts', 'src/katalog/repository/katalogStamm.ts'],
  },
  minifigs_catalog: { art: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/katalogStamm.ts'] },
  set_teile: { art: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/katalogStamm.ts'] },
  set_figuren: { art: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/katalogStamm.ts'] },
  subsets_cache: {
    art: KATALOG,
    eingabe: false,
    schreiber: ['src/katalog/repository/katalogCache.ts', 'src/katalog/repository/rebrickableCache.ts'],
  },
  minifig_parts_cache: { art: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/rebrickableCache.ts'] },
  shared_instructions: { art: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/anleitungen.ts'] },
  rb_colors: { art: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/blZuordnung.ts'] },
  rb_inventories: { art: KATALOG, eingabe: false, schreiber: [] },
  rb_inventory_minifigs: { art: KATALOG, eingabe: false, schreiber: [] },
  rb_inventory_parts: { art: KATALOG, eingabe: false, schreiber: [] },
  rb_part_categories: { art: KATALOG, eingabe: false, schreiber: [] },
  rb_parts: { art: KATALOG, eingabe: false, schreiber: [] },
  rb_sets: {
    art: KATALOG,
    eingabe: false,
    schreiber: [
      'src/bilder/repository/bildlage.ts',
      'src/katalog/repository/csvTausch.ts',
      'src/katalog/repository/setStamm.ts',
    ],
  },
  rb_themes: { art: KATALOG, eingabe: false, schreiber: [] },
  price_cache: { art: KATALOG, eingabe: false, schreiber: ['src/finanzen/repository/preisCache.ts'] },
  price_history: {
    art: KATALOG,
    eingabe: false,
    schreiber: [
      'src/finanzen/repository/preisCache.ts',
      'src/finanzen/repository/preisLauf.ts',
      'src/finanzen/repository/preisverlauf.ts',
    ],
  },
  part_price_cache: { art: KATALOG, eingabe: false, schreiber: ['src/finanzen/repository/preisCache.ts'] },
  part_price_history: { art: KATALOG, eingabe: false, schreiber: ['src/finanzen/repository/preisCache.ts'] },
  minifig_price_cache: {
    art: KATALOG,
    eingabe: false,
    schreiber: ['src/finanzen/repository/marktpreise.ts', 'src/finanzen/repository/preisCache.ts'],
  },
  minifig_price_history: {
    art: KATALOG,
    eingabe: false,
    schreiber: ['src/finanzen/repository/marktpreise.ts', 'src/finanzen/repository/preisCache.ts'],
  },
  wechselkurse: { art: KATALOG, eingabe: false, schreiber: ['src/finanzen/repository/wechselkurse.ts'] },
  image_misses: { art: BETRIEB, eingabe: false },
  image_wanted: { art: BETRIEB, eingabe: false },
  parts_katalog_offen: {
    art: BETRIEB,
    eingabe: 'Nummern, deren Teile-Zusammenfassung nachzuziehen ist; sie ändern keine Angabe',
  },
  api_takt: { art: BETRIEB, eingabe: false },
  auftrag_pausen: { art: BETRIEB, eingabe: false },
  auftrag_exklusiv: { art: BETRIEB, eingabe: false },
  auftrags_arten: { art: BETRIEB, eingabe: false },
  laufzustand: { art: BETRIEB, eingabe: false },
  schema_migrations: { art: BETRIEB, eingabe: false },
  global_settings: { art: BETRIEB, eingabe: 'nur Verwalter (requireAdmin)' },
  app_logs: { art: BETRIEB, eingabe: 'Protokollzeilen nennen Eingaben, steuern aber nichts' },
  rate_limit_attempts: { art: BETRIEB, eingabe: 'Schlüssel aus Benutzername und Adresse der Anmeldebremse' },
  users: { art: KONTO, eingabe: 'Zeile des Kontos (id)' },
  user_sessions: { art: KONTO, eingabe: 'Sitzung eines Kontos (sess.userId)' },
  account_links: { art: KONTO, eingabe: 'Haushalt (main_user_id, sub_user_id)' },
  account_link_invites: { art: KONTO, eingabe: 'Einladung des Hauptkontos (main_user_id)' },
  household_former_links: { art: KONTO, eingabe: 'frühere Haushalte (main_user_id, sub_user_id)' },
  api_aufrufe: { art: KONTO, eingabe: 'Zähler je Konto (konto)' },
  gutschein_guthaben_schranke: { art: KONTO, eingabe: 'je Gutschein (id = vouchers.id)' },
  verwaltungsprotokoll: { art: KONTO, eingabe: 'Handlungen der Verwalter (verwalter_id)' },
};

/** Dateien mit Tabellennamen aus einer Variablen: Wohin sie schreiben, steht daneben. */
const DYNAMISCH = {
  'db/migrate.ts': 'Kopien vor Migrationen (vor_migration_*, Spalten mit user_id)',
  'src/bestand/repository/kaufErfassungen.ts': 'set_/part_/minifig_acquisitions (user_id)',
  'src/bestand/repository/lagerort.ts': 'sets/parts/minifigs (user_id)',
  'src/bestand/repository/manuelleMengen.ts': 'part_/minifig_acquisitions (user_id)',
  'src/bestand/repository/papierkorb.ts': 'Bestandstabellen (user_id)',
  'src/gutscheine/repository/gutscheine.ts': 'vouchers (user_id)',
  'src/katalog/repository/csvTausch.ts': 'rb_* aus den Rebrickable-CSV-Dateien',
  'src/katalog/repository/teileAnreicherung.ts': 'part_catalog/part_color_catalog aus Rebrickable',
  'src/sammlung/repository/erfassungen.ts': 'set_/part_/minifig_acquisitions (user_id)',
  'src/sets/repository/verschieben.ts': 'Bestand und Erfassungen (user_id)',
};

/** Je Bereich die Tabellen, in die nur er schreibt (INSERT, UPDATE, DELETE). */
const BESITZER = {
  db: ['schema_migrations'],
  'src/auftraege': ['auftraege', 'auftrag_exklusiv', 'auftrag_pausen', 'auftrags_arten', 'import_stand', 'laufzustand'],
  'src/bestand': ['minifigs', 'papierkorb', 'parts', 'storage_locations'],
  'src/einstellungen': ['global_settings', 'user_settings'],
  'src/figuren': ['minifig_acquisitions'],
  'src/finanzen': [
    'minifig_price_cache',
    'minifig_price_history',
    'part_price_cache',
    'part_price_history',
    'price_alerts',
    'price_cache',
    'price_history',
    'wechselkurse',
  ],
  'src/gutscheine': ['gutschein_guthaben_schranke', 'vouchers'],
  'src/haushalt': ['account_link_invites', 'account_links', 'household_former_links'],
  'src/bilder': ['image_misses', 'image_wanted'],
  'src/fremdquellen': ['api_aufrufe', 'api_takt'],
  'src/idempotenz': ['idempotenz'],
  'src/infra': ['app_logs'],
  'src/katalog': [
    'bl_zuordnung',
    'bl_zuordnung_eigen',
    'catalog_cache',
    'figur_eigen',
    'minifig_parts_cache',
    'minifigs_catalog',
    'part_catalog',
    'part_color_catalog',
    'rb_colors',
    'rb_inventories',
    'rb_inventory_minifigs',
    'rb_inventory_parts',
    'rb_part_categories',
    'rb_parts',
    'rb_sets',
    'rb_themes',
    'set_catalog',
    'set_figuren',
    'set_teile',
    'shared_instructions',
    'subsets_cache',
    'teil_eigen',
    'teil_farbe_eigen',
  ],
  'src/konto': [
    'api_tokens',
    'api_tokens_verbraucht',
    'geraete_nonces',
    'geraete_schluessel',
    'passkeys',
    'qr_login_tokens',
    'rate_limit_attempts',
    'schritt_challenges',
    'schritt_freigaben',
    'user_sessions',
    'users',
    'verwaltungsprotokoll',
    'webauthn_challenges',
    'zweiter_faktor',
    'zweiter_faktor_codes',
  ],
  'src/merkliste': ['wanted'],
  'src/sets': ['instructions', 'set_acquisitions', 'sets'],
  'src/teile': [
    'part_acquisitions',
    'parts_katalog_offen',
    'parts_summary',
    'parts_summary_state',
    'parts_version_user',
  ],
};

/** Wer heute noch in eine fremde Tabelle schreibt — eine Ratsche: nur streichen, nie ergänzen. */
const FREMDSCHREIBER = [
  // Der Schemastart schreibt die Zeitzone, bevor es Dienste gibt.
  'db/schemaStart.ts → global_settings',
  // Teile und Figuren eines Sets: Der Katalog liegt unter dem Bestand und kann ihn nicht rufen.
  'src/katalog/repository/setInhalt.ts → minifigs',
  'src/katalog/repository/setInhalt.ts → parts',
  // Das Set-Bild im Katalogeintrag: Die Bilder liegen unter dem Katalog und können ihn nicht rufen.
  'src/bilder/repository/bildlage.ts → rb_sets',
  'src/bilder/repository/bildlage.ts → set_catalog',
  'src/figuren/repository/manuelleFiguren.ts → minifigs',
  'src/teile/repository/manuelleTeile.ts → parts',
  'src/teile/repository/teilFarbe.ts → parts',
  'src/sammlung/repository/loeschen.ts → minifig_acquisitions',
  'src/sammlung/repository/loeschen.ts → part_acquisitions',
  'src/gutscheine/repository/guthabenSchranke.ts → rate_limit_attempts',
  'src/katalog/repository/anleitungen.ts → rate_limit_attempts',
  'src/konto/repository/waehrung.ts → user_settings',
];

const bereichVon = datei => (datei.startsWith('src/') ? datei.split('/').slice(0, 2).join('/') : datei.split('/')[0]);

const MARKE = 'zzmarke7q';

/** Datei → geschriebene Tabellen, ohne Kommentare; `DO UPDATE SET` ist kein Tabellenname. */
function schreibendeStellen() {
  const tabellen = new Map(),
    dynamisch = new Set();
  (function lauf(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) {
        if (!['node_modules', 'dist', 'test', 'migrations', 'altbestand', 'public', 'docs', 'scripts'].includes(n))
          lauf(p);
        continue;
      }
      if (!n.endsWith('.ts')) continue;
      const datei = path.relative(ROOT, p).split(path.sep).join('/');
      const s = ohneKommentare(fs.readFileSync(p, 'utf8'));
      const muster =
        /\b(?:INSERT INTO|DELETE FROM|TRUNCATE(?: TABLE)?)\s+([a-z_][a-z0-9_]*|\$\{)|(?<!DO )\bUPDATE\s+([a-z_][a-z0-9_]*|\$\{)[^;`'"]*?\bSET\b/g;
      for (const m of s.matchAll(muster)) {
        const t = m[1] ?? m[2];
        if (t === '${') dynamisch.add(datei);
        else (tabellen.get(t) ?? tabellen.set(t, new Set()).get(t)).add(datei);
      }
    }
  })(ROOT);
  return { tabellen, dynamisch };
}

test('gemeinsame Tabellen', { concurrency: 1, timeout: 120_000 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    keineDb(t, e);
    return;
  }
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  importWorker(t, _req);
  {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }
  t.after(() => db.pool.end().catch(() => {}));

  await t.test('jede Tabelle ohne user_id steht in der Liste', async () => {
    const ohne = (
      await db.all(`
      SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
       WHERE c.relkind IN ('r', 'p') AND NOT EXISTS (
         SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'user_id' AND NOT a.attisdropped)`)
    ).map(z => z.t);
    assert.ok(ohne.length > 30, `nur ${ohne.length} Tabellen gefunden — greift die Abfrage noch?`);
    assert.deepEqual(ohne.sort(), Object.keys(GEMEINSAM).sort());
  });

  await t.test('jede schreibende Stelle auf eine Katalogtabelle ist eingetragen', () => {
    const { tabellen, dynamisch } = schreibendeStellen();
    assert.ok(tabellen.size > 40, `nur ${tabellen.size} Tabellen beschrieben — greift die Suche noch?`);
    const ist = {},
      soll = {};
    for (const [name, e] of Object.entries(GEMEINSAM)) {
      if (e.art !== KATALOG) continue;
      ist[name] = [...(tabellen.get(name) ?? [])].sort();
      soll[name] = [...e.schreiber].sort();
    }
    assert.deepEqual(
      ist,
      soll,
      'Eine Katalogtabelle bekommt einen neuen Schreiber: Kommt der Wert aus einer ' +
        'geprüften Quelle, hier eintragen; ist es eine Eingabe, gehört sie in eine Tabelle des Kontos.',
    );
    assert.deepEqual([...dynamisch].sort(), Object.keys(DYNAMISCH).sort());
  });

  await t.test('jede Tabelle hat einen Besitzer, nur er schreibt hinein', async () => {
    const alle = (
      await db.all(`SELECT c.relname AS t FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' WHERE c.relkind IN ('r', 'p')`)
    ).map(z => z.t);
    const besitzer = new Map(Object.entries(BESITZER).flatMap(([b, ts]) => ts.map(x => [x, b])));
    assert.ok(alle.length > 60, `nur ${alle.length} Tabellen gefunden — greift die Abfrage noch?`);
    assert.deepEqual(alle.filter(x => !besitzer.has(x)).sort(), [], 'Tabelle ohne Besitzer: in BESITZER eintragen');
    assert.deepEqual(
      [...besitzer.keys()].filter(x => !alle.includes(x)).sort(),
      [],
      'BESITZER nennt eine Tabelle, die es nicht gibt',
    );
    const fremd = [];
    // Tabellen ausserhalb des Schemas (Kopien vor Migrationen, temporäre) haben keinen Besitzer.
    for (const [tabelle, dateien] of schreibendeStellen().tabellen)
      for (const d of dateien)
        if (besitzer.has(tabelle) && bereichVon(d) !== besitzer.get(tabelle)) fremd.push(`${d} → ${tabelle}`);
    assert.deepEqual(
      fremd.sort(),
      [...FREMDSCHREIBER].sort(),
      'Schreib-SQL gehört in den Besitzer-Bereich der Tabelle; andere Bereiche rufen dessen Dienst.',
    );
  });

  await t.test('Eingaben eines Kontos landen in keiner gemeinsamen Tabelle', async () => {
    const neu = async name =>
      (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [name])).id;
    const A = await neu('anna'),
      B = await neu('bruno');
    await db.run(`INSERT INTO part_catalog (part_number, part_name) VALUES ('3003','Brick 2 x 2')`);
    await db.run(
      `INSERT INTO minifigs_catalog (fig_number, fig_name, image_url) VALUES ('fig-000001','Han','https://cdn.rebrickable.com/f.jpg')`,
    );
    await db.run(`INSERT INTO rb_colors (id, name, bl_color_id) VALUES (4,'Red',5)`);

    const { addManualPart } = _req('src/teile/manuelleTeile.js');
    const { addManualFig, updateManualFig, importiereFigurenCsv } = _req('src/figuren/manuelleFiguren.js');
    const bild = `https://cdn.rebrickable.com/${MARKE}.png`;
    await alsKonto(A, async () => {
      await addManualPart(A, {
        part_number: '3005',
        color_id: 4,
        part_name: `${MARKE} Teil`,
        color_name: MARKE,
        category_name: MARKE,
        image_url: bild,
        quantity: 1,
        unit_price: 1,
      });
      await addManualFig(A, {
        fig_number: 'fig-000002',
        fig_name: `${MARKE} Figur`,
        image_url: bild,
        bl_fig_number: `${MARKE}1`,
        quantity: 1,
        unit_price: 1,
      });
    });
    await alsKonto(B, async () => {
      await addManualFig(B, { fig_number: 'fig-000001', quantity: 1, unit_price: 1 });
      await updateManualFig(B, 'fig-000001', { bl_fig_number: `${MARKE}2` });
      await importiereFigurenCsv(
        B,
        `fig_number,fig_name,bl_fig_number,quantity\nfig-000003,${MARKE} csv,${MARKE}3,1\n`,
      );
    });

    const srv = testServer(_req, { sitzung: { userId: A }, t });
    const fd = new FormData();
    fd.append(
      'file',
      new Blob(
        [
          `<?xml version="1.0"?><INVENTORY>
      <ITEM><ITEMTYPE>M</ITEMTYPE><ITEMID>${MARKE}4</ITEMID><MINQTY>1</MINQTY></ITEM>
      <ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>${MARKE}5</ITEMID><COLOR>5</COLOR><MINQTY>1</MINQTY></ITEM></INVENTORY>`,
        ],
        { type: 'text/xml' },
      ),
      'w.xml',
    );
    fd.append(
      'korrekturen',
      JSON.stringify([
        { index: 0, blId: `${MARKE}4`, art: 'fig', rbId: 'fig-000001' },
        { index: 1, blId: `${MARKE}5`, art: 'part', rbId: '3003', rbFarbe: 4 },
      ]),
    );
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
