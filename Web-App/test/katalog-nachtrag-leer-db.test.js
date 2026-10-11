/**
 * „Leer" und „fehlt" müssen in Migration 0034 DASSELBE bedeuten.
 *
 * ── Marcos Befund, auf der laufenden Installation ───────────────────────────
 *
 *     ❌ Database initialisation failed: Migration 0034 … fehlgeschlagen:
 *        228 Teil/Farb-Paare wuerden ihre Farbbezeichnung verlieren
 *        — nichts geaendert.
 *
 * Der Riegel hatte nicht recht. Nachtrag und Riegel lasen „fehlt"
 * VERSCHIEDEN, und deshalb konnte die Migration auf diesen Daten NIE
 * durchlaufen:
 *
 *   Nachtrag: `COALESCE(vorhandener_wert, NEUER)` — eine LEERE Zeichenkette
 *             ist nicht NULL, also gewann sie, und der Name aus dem Bestand
 *             kam nie im Katalog an.
 *   Riegel:   `COALESCE(x, '') <> ''` — leer gilt ALS fehlend, also zählte er
 *             genau diese Paare als Verlust.
 *
 * Dazu ein zweiter Fall derselben Art: `parts.part_number` ist NOT NULL, aber
 * die LEERE Zeichenkette ist erlaubt. Der Nachtrag liess solche Zeilen aus
 * (`part_number <> ''` — die Nummer IST der Katalogschlüssel), der Riegel
 * zählte sie mit. Auch das hielt für immer an, und von Hand war nichts zu
 * entscheiden.
 *
 * ── Was dieser Test prüft ───────────────────────────────────────────────────
 *
 *   1. Fall A (leere Zeichenkette im Set-Teilekatalog, echter Name im
 *      Bestand): Die Migration läuft durch, und der Katalog trägt danach den
 *      ECHTEN Namen — nicht die leere Zeichenkette.
 *   2. GEGENPROBE zu 1: ohne den Nachtrag hält der Riegel weiter an, und die
 *      Spalte überlebt. Ohne diesen Fall könnte der Flicken den Riegel
 *      einfach entschärft haben.
 *   3. Fall B (leere Teilenummer): Die Migration läuft durch und SAGT es —
 *      lieber ein Satz im Startprotokoll als eine Zeile, die stumm ihre
 *      Beschreibung verliert.
 *   4. Dieselbe Regel für Name und Kategorie des Teils und für den
 *      Figurennamen, nicht nur für die Farbbezeichnung: Es sind sechs
 *      Nachtragsstellen, und eine einzeln geprüfte beweist die anderen nicht.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip, ausser
 * REQUIRE_DB=1.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

// Diese Datei baut die Datenbank mehrfach von null auf. Wer danach laeuft,
// muss sie VOLLSTAENDIG vorfinden — Schema UND Migrationen.
test.after(async () => {
  try {
    await db.run('DROP SCHEMA public CASCADE');
    await db.run('CREATE SCHEMA public');
    await db.initSchema();
    const c = await db.pool.connect();
    try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  } catch (e) {
    console.error('[katalog-nachtrag-leer] Aufraeumen fehlgeschlagen:', e.message);
  }
  await db.pool.end().catch(() => {});
});

const MIG_DIR = path.join(ROOT, 'db', 'migrations');
const DATEI   = path.join(MIG_DIR, '0034-teile-und-minifiguren-stammdaten-im-katalog.sql');

const spaltenVon = async (tabelle) => (await db.all(
  `SELECT column_name FROM information_schema.columns WHERE table_name=$1`, [tabelle]))
  .map(r => r.column_name).sort();

test('Migration 0034 liest „leer" als „fehlt" — im Nachtrag wie im Riegel',
  { concurrency: 1 }, async (t) => {
  try { await db.run('SELECT 1'); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  const skript = fs.readFileSync(DATEI, 'utf8');
  const nachtrag = skript.slice(skript.indexOf('DO $nachtrag$'),
                               skript.indexOf('END $nachtrag$;') + 15);
  assert.ok(nachtrag.length > 100, 'Der Nachtrag wurde nicht gefunden — der Anker hat sich geaendert');

  /**
   * Frische Datenbank, alle Migrationen VOR 0034, eine gewählte Lage, dann
   * das übergebene Skript.
   *
   * @returns {Promise<string|null>} Fehlermeldung von Postgres, sonst null
   */
  const LAGEN = {
    // Fall A: Der Set-Teilekatalog trägt eine LEERE Farbbezeichnung (nicht
    // NULL), der Bestand eine echte. Genau Marcos Lage.
    leererKatalog: `
      INSERT INTO set_parts_catalog (set_number, part_number, color_id, quantity, color_name, part_name, category_name)
        VALUES ('75192-1','3001',4,6,'','','');
      INSERT INTO parts (user_id, set_number, part_number, color_id, quantity, source,
                         part_name, color_name, category_name)
        SELECT id,'75192-1','3001',4,6,'set','Brick 2x4','Rot','Bricks'
          FROM users WHERE username='nl'`,
    // Fall B: leere Teilenummer mit Beschreibung. Kein Katalogschlüssel
    // möglich — die Migration darf trotzdem nicht anhalten.
    leereNummer: `
      INSERT INTO parts (user_id, part_number, color_id, quantity, source, color_name)
        SELECT id,'',7,1,'manual','Blau' FROM users WHERE username='nl'`,
    // Fall C: dasselbe für die FIGUREN — leerer Name im Set-Figurenkatalog,
    // echter im Bestand.
    leererFigKatalog: `
      INSERT INTO set_minifigs_catalog (set_number, fig_number, quantity, fig_name)
        VALUES ('75192-1','sw0001',1,'');
      INSERT INTO minifigs (user_id, set_number, fig_number, quantity, source, fig_name)
        SELECT id,'75192-1','sw0001',1,'set','Han Solo' FROM users WHERE username='nl'`,
  };

  const lauf = async (sql, lage) => {
    await db.run('DROP SCHEMA public CASCADE');
    await db.run('CREATE SCHEMA public');
    await db.initSchema();
    const c = await db.pool.connect();
    try {
      await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
      for (const f of fs.readdirSync(MIG_DIR).filter(x => x.endsWith('.sql')).sort()) {
        if (f.startsWith('0034')) break;
        await c.query(fs.readFileSync(path.join(MIG_DIR, f), 'utf8'));
        await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
      }
      await c.query(`INSERT INTO users (username,password_hash) VALUES ('nl','x')`);
      await c.query(`INSERT INTO set_catalog (set_number,name) VALUES ('75192-1','Falcon')`);
      await c.query(`INSERT INTO sets (user_id,set_number,quantity)
                     SELECT id,'75192-1',1 FROM users WHERE username='nl'`);
      await c.query(LAGEN[lage]);
      await c.query('BEGIN');
      try { await c.query(sql); await c.query('COMMIT'); return null; }
      catch (e) { await c.query('ROLLBACK').catch(() => {}); return e.message; }
    } finally { c.release(); }
  };

  // ── Fall A: der echte Name gewinnt gegen die leere Zeichenkette ─────────
  assert.equal(await lauf(skript, 'leererKatalog'), null,
    'Die Migration muss auf Marcos Lage durchlaufen — eine leere Zeichenkette ' +
    'im Katalog ist kein Wert, der den Namen aus dem Bestand verdraengen darf');
  const farbe = await db.get(
    `SELECT color_name FROM part_color_catalog WHERE part_number='3001' AND color_id=4`);
  assert.equal(farbe?.color_name, 'Rot',
    `Der Katalog traegt ${JSON.stringify(farbe?.color_name)} statt „Rot" — dann hat ` +
    'die leere Zeichenkette gewonnen, und die Teileliste zeigt eine leere Zelle');
  // Punkt 4: Name und Kategorie des Teils folgen derselben Regel. Die
  // Farbbezeichnung allein zu pruefen bewiese die anderen fuenf Stellen nicht.
  const teil = await db.get(`SELECT part_name, category_name FROM part_catalog WHERE part_number='3001'`);
  assert.equal(teil?.part_name, 'Brick 2x4', 'Der Teilename ist nicht nachgetragen');
  assert.equal(teil?.category_name, 'Bricks', 'Die Kategorie ist nicht nachgetragen');
  assert.ok(!(await spaltenVon('parts')).includes('color_name'),
    'Schritt 3 hat die Spalte nicht geloescht');

  // ── GEGENPROBE: ohne den Nachtrag muss der Riegel WEITER anhalten ───────
  //
  // Der Kern. Fall A zeigt nur, dass es durchlaeuft; erst dieser Lauf zeigt,
  // dass der Riegel dabei nicht entschaerft wurde — er greift noch, wenn die
  // Bezeichnung wirklich nirgends sonst steht.
  const ohneNachtrag = skript.replace(nachtrag, '');
  assert.notEqual(ohneNachtrag, skript, 'Der Nachtrag wurde nicht herausgeschnitten');
  const meldung = await lauf(ohneNachtrag, 'leererKatalog');
  // Zwei der drei Pruefungen des Riegels treffen diese Lage (Teilename UND
  // Farbbezeichnung stehen nur im Bestand), und er meldet die ERSTE — welche,
  // entscheidet die Reihenfolge der RAISE-Anweisungen, nicht die Schwere.
  // Darauf festzulegen hiesse, eine Reihenfolge zuzusichern, die niemand
  // zugesagt hat.
  assert.match(String(meldung),
    /wuerden ihren Namen verlieren|wuerden ihre Farbbezeichnung verlieren/,
    `Der Riegel hat nicht gegriffen. Postgres sagte: ${meldung}`);
  assert.ok((await spaltenVon('parts')).includes('color_name'),
    'parts.color_name ist trotz Abbruch weg — dann rollt die Transaktion nicht zurueck');

  // ── Fall B: leere Teilenummer haelt nicht an, wird aber GESAGT ──────────
  assert.equal(await lauf(skript, 'leereNummer'), null,
    'Eine Bestandszeile mit leerer Teilenummer darf die Migration nicht anhalten — ' +
    'sie kann keine Katalogzeile haben, und von Hand ist nichts zu entscheiden');
  const uebrig = await db.get(`SELECT COUNT(*)::int c FROM parts WHERE part_number=''`);
  assert.equal(uebrig.c, 1,
    'Die Zeile selbst muss stehenbleiben — geloescht wird hier nichts, nur ihre ' +
    'Beschreibung ist nicht in den Katalog zu retten');

  // ── Fall C: dieselbe Regel bei den Figuren ─────────────────────────────
  assert.equal(await lauf(skript, 'leererFigKatalog'), null,
    'Der Figuren-Zweig muss dieselbe Regel tragen wie der Teile-Zweig');
  const fig = await db.get(`SELECT fig_name FROM minifigs_catalog WHERE fig_number='sw0001'`);
  assert.equal(fig?.fig_name, 'Han Solo',
    `Der Figurenkatalog traegt ${JSON.stringify(fig?.fig_name)} statt „Han Solo"`);
});

test('kein Nachtrag in 0034 laesst eine leere Zeichenkette gewinnen', () => {
  // Die Regel über den Quelltext, nicht über die Datenbank: Es sind SECHS
  // Nachtragsstellen (drei aus den Set-Katalogen, drei aus dem Bestand), und
  // der Test oben fährt drei davon an. Diese Regel fängt die siebte, die
  // jemand später dazuschreibt.
  const skript = fs.readFileSync(DATEI, 'utf8');
  const codeZeilen = skript.split('\n')
    .filter(z => !z.trim().startsWith('--'));

  // `COALESCE(<tabelle>.<spalte>, EXCLUDED…` ohne NULLIF ist genau der Fehler:
  // Der vorhandene Wert gewinnt, auch wenn er leer ist.
  const falsch = codeZeilen.filter(z =>
    /=\s*COALESCE\((?:part_catalog|part_color_catalog|minifigs_catalog)\.[a-z_]+\s*,/.test(z));
  assert.deepEqual(falsch, [],
    'Diese Stellen lassen eine leere Zeichenkette gewinnen:\n  ' + falsch.join('\n  ') +
    '\nDer Riegel darunter zaehlt leer ALS fehlend — damit kann die Migration auf ' +
    'solchen Daten nie durchlaufen. Richtig ist COALESCE(NULLIF(x, \'\'), EXCLUDED.x).');

  // ── Selbstbeweis ─────────────────────────────────────────────────────────
  //
  // Die Regel findet jetzt nichts. Das sagt allein noch nicht, dass sie etwas
  // finden KOENNTE — also an der Zeile nachgewiesen, die woertlich im Baum
  // stand, und an der richtigen Fassung daneben.
  const muster = /=\s*COALESCE\((?:part_catalog|part_color_catalog|minifigs_catalog)\.[a-z_]+\s*,/;
  assert.ok(muster.test("   SET color_name  = COALESCE(part_color_catalog.color_name,  EXCLUDED.color_name),"),
    'Die Regel greift nicht mehr auf ihre eigene Probe');
  assert.ok(!muster.test("   SET color_name  = COALESCE(NULLIF(part_color_catalog.color_name, ''),  EXCLUDED.color_name),"),
    'Die Regel meldet die RICHTIGE Fassung — dann ist sie nicht zu gebrauchen');

  // Und die Gegenrichtung zur Vollstaendigkeit: Es muss ueberhaupt
  // Nachtragsstellen geben. Ohne diese Zusicherung waere die Regel auch gruen,
  // wenn jemand Schritt 1 ganz entfernt.
  // GEMESSEN am geflickten Skript: 4 + 8 + 6 = 18. Jede Tabelle wird ZWEIMAL
  // gefuellt (aus dem Set-Katalog und aus dem Bestand), und jede Fuellung hat
  // ihr eigenes DO UPDATE — part_catalog mit 2 Spalten, part_color_catalog mit
  // 4, minifigs_catalog mit 3.
  const je = (t) => (skript.match(new RegExp(`COALESCE\\(NULLIF\\(${t}\\.`, 'g')) || []).length;
  assert.deepEqual(
    { part_catalog: je('part_catalog'), part_color_catalog: je('part_color_catalog'),
      minifigs_catalog: je('minifigs_catalog') },
    { part_catalog: 4, part_color_catalog: 8, minifigs_catalog: 6 },
    'Die Zahl der abgesicherten Nachtragsstellen hat sich geaendert. Je Tabelle zwei ' +
    'Fuellungen (Set-Katalog und Bestand) mal die Zahl ihrer Spalten — weicht das ab, ' +
    'ist eine Fuellung dazugekommen oder weggefallen, und die Regel darueber hat sie ' +
    'nicht gesehen.');
});
