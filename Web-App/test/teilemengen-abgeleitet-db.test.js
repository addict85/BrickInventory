/**
 * Seit db/basis.sql gibt es den Stand VOR dieser Migration nicht mehr: Die
 * Fälle zu Riegel, Nachtrag und Zwischenstand sind entfallen. Geprüft werden
 * der Endstand und die Lesewege.
 *
 * Die Stückzahl eines Teils oder einer Figur steht nicht mehr an der Zeile.
 *
 * ── Marcos Befund ───────────────────────────────────────────────────────────
 *
 *   „Bei den Minifigs und parts gibt es noch immer ein quantity"
 *
 * Richtig, und er hätte es nicht selbst finden müssen. Migration 0036 hat
 * `sets.quantity` gelöscht; bei Teilen und Figuren blieb die Spalte stehen,
 * weil sie ZWEI Bedeutungen trug:
 *
 *   source='manual'  wie viele ich besitze    → Summe der Erfassungen
 *   source='set'     wie viele im SET stecken → set_parts_catalog.quantity
 *                                               bzw. set_minifigs_catalog
 *
 * Beide waren Abschriften. GEMESSEN: src/katalog/partsImport.ts schrieb denselben
 * Wert in DERSELBEN Schleife nach `parts.quantity` UND nach
 * `set_parts_catalog.quantity`; src/katalog/minifigsImport.ts wortgleich. Für die
 * manuellen Positionen war mengeNeuRechnen() in src/sets/bestandsmenge.ts der
 * einzige Schreiber — und der rechnete nichts anderes als die Summe der
 * Erfassungen.
 *
 * Migration 0038 löscht beide Spalten. Die Fallunterscheidung steht einmal,
 * in src/sets/bestandsmenge.ts (teilmengeJoin/teilmengeAus), und wird von den
 * Lesestellen eingesetzt — dieselbe Bauart wie mengeJoin/mengeAus für die
 * Sets.
 *
 * ── Was dieser Test prüft ───────────────────────────────────────────────────
 *
 *   1. Nach der GANZEN Kette gibt es die beiden Spalten nicht mehr — und
 *      VORHER gibt es sie, weil Schritt 1 und der Riegel von 0038 sie LESEN.
 *      Dazu: die vier Indizes, die 0038 setzt.
 *   2. Die Migration lässt nichts verschwinden. Sieben Läufe, jeder mit
 *      Gegenprobe: fehlende Katalogzeile (nachgetragen), Drift (angehalten),
 *      Doppelte (zusammengelegt) — und jeweils der Lauf OHNE den Schritt, der
 *      es verhindert, damit bewiesen ist, dass er es verhindert.
 *   3. Niemand SCHREIBT die beiden Spalten mehr.
 *   4. Die Lesewege liefern die Stückzahl weiter — aus dem Katalog für ein
 *      Set-Teil, aus den Erfassungen für eine manuelle Position. Mit
 *      Gegenproben: Ändert sich die Quelle, folgt die Antwort.
 *   5. Jede Lesestelle wird AUSGEFÜHRT. Das ist kein Beiwerk: teilmengeAus()
 *      liest den Alias `tm_e`, den erst teilmengeJoin() anhängt. Fehlt der
 *      JOIN, ist das kein stiller Fehler, sondern „missing FROM-clause entry
 *      for table tm_e" — GEMESSEN in getMinifigStats(), wo genau das passiert
 *      war. Ein Muster über den Quelltext hat diesen Fall NICHT gefunden
 *      (zwei seiner drei Treffer waren Fehlmeldungen: ein Bruchstück wird in
 *      eine Abfrage eingesetzt, die den JOIN trägt). Ausführen findet ihn.
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

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

// Dieselbe Begruendung wie in test/setmenge-aus-erfassungen-db.test.js: Diese
// Datei baut die Datenbank mehrfach von null auf. Wer danach laeuft, muss sie
// VOLLSTAENDIG vorfinden — Schema UND Migrationen. Ohne das erbt die naechste
// Datei eine halbe Datenbank, und ihr Fehlschlag sieht aus wie ihr eigener.
test.after(async () => {
  try {
    await db.run('DROP SCHEMA public CASCADE');
    await db.run('CREATE SCHEMA public');
    await db.initSchema();
    const c = await db.pool.connect();
    try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  } catch (e) {
    console.error('[teilemengen-abgeleitet] Aufraeumen fehlgeschlagen:', e.message);
  }
  await db.pool.end().catch(() => {});
});

const spaltenVon = async (tabelle) => (await db.all(
  `SELECT column_name FROM information_schema.columns WHERE table_name=$1`, [tabelle]))
  .map(r => r.column_name).sort();

const indizes = async () => (await db.all(
  `SELECT indexname FROM pg_indexes WHERE schemaname='public'`)).map(r => r.indexname);

const dbDa = async (t) => {
  try { await db.run('SELECT 1'); return true; }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return false;
  }
};

const MIG_DIR = path.join(ROOT, 'db/migrations');
const DATEI   = path.join(MIG_DIR, '0038-teilemengen-aus-katalog-und-erfassungen.sql');

/** Frische Datenbank, Schema, alle Migrationen. */
async function volleKette() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
}

test('nach der ganzen Kette tragen parts und minifigs keine quantity mehr',
  { concurrency: 1 }, async (t) => {
  if (!(await dbDa(t))) return;

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();

  // Den Vorstand vor den Migrationen gibt es nicht mehr: Eine leere
  // Datenbank bekommt db/basis.sql. Geprüft wird der Endstand.
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  for (const tab of ['parts', 'minifigs']) {
    assert.ok(!(await spaltenVon(tab)).includes('quantity'),
      `${tab}.quantity ist nach allen Migrationen noch da — Migration 0038 hat ` +
      `nicht geloescht, oder etwas legt die Spalte danach wieder an.`);
  }

  // Was eine Bestandszeile noch ist: DIESES Konto hat DIESES Teil, aus DEM
  // Set, an DEM Ort, in DEM Zustand.
  const teile = await spaltenVon('parts');
  for (const sp of ['id', 'user_id', 'part_number', 'color_id', 'set_number',
                    'source', 'storage_id']) {
    assert.ok(teile.includes(sp), `parts.${sp} fehlt — die Spalte gehoert zum Bestand`);
  }

  // Nicht verschwunden, sondern umgezogen — und zwar an ZWEI Stellen, je
  // nachdem, was die Zahl bedeutet.
  for (const [tab, sp] of [['set_parts_catalog', 'quantity'],
                           ['set_minifigs_catalog', 'quantity'],
                           ['part_acquisitions', 'quantity'],
                           ['minifig_acquisitions', 'quantity']]) {
    assert.ok((await spaltenVon(tab)).includes(sp),
      `${tab}.${sp} fehlt — dann gibt es die Stueckzahl nirgends mehr`);
  }

  // Die vier Indizes aus Schritt 5 und 6. Die beiden eindeutigen sind nicht
  // Kosmetik: Ohne sie war das `ON CONFLICT DO NOTHING` der Importe
  // WIRKUNGSLOS (es gab keinen Konflikt, auf den es treffen konnte), und
  // jeder erneute Import desselben Sets legte neue Zeilen an. Ab 0038 liest
  // jede Zeile dieselbe Katalogzahl — zwei Zeilen zaehlten doppelt.
  // Die beiden Gruppen-Indizes der Erfassungen hat Migration 0068 entfernt:
  // Sie waren der Anfang der eindeutigen Tagesindizes, die jede ihrer Suchen
  // bedienen (test/indizes-db.test.js).
  const ix = await indizes();
  for (const name of ['idx_parts_eindeutig', 'idx_minifigs_eindeutig',
                      'idx_part_acq_erfassungstag', 'idx_minifig_acq_erfassungstag']) {
    assert.ok(ix.includes(name), `${name} fehlt (Migration 0038, Schritt 5/6)`);
  }

  // Und sie sind wirklich EINDEUTIG — ein Index mit demselben Namen, aber
  // ohne UNIQUE, waere hier sonst nicht zu unterscheiden.
  for (const name of ['idx_parts_eindeutig', 'idx_minifigs_eindeutig']) {
    const r = await db.get(
      `SELECT indisunique FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE c.relname = $1`, [name]);
    assert.equal(r?.indisunique, true, `${name} ist nicht eindeutig`);
  }
});

test('niemand schreibt die Stückzahl eines Teils oder einer Figur mehr', () => {
  // Nur der QUELLTEXT, und nur die SCHREIBseite. Die Leseseite prueft nicht
  // dieser Test, sondern die Datenbank: Nach Migration 0038 gibt es die
  // Spalten nicht, jede verbliebene Lesestelle ist ein harter Fehler — und
  // genau deshalb laufen die Lesewege im naechsten Fall gegen eine migrierte
  // Datenbank, statt hier gegen ein Muster.
  const dateien = [];
  const lauf = (verz) => {
    for (const e of fs.readdirSync(verz, { withFileTypes: true })) {
      const p = path.join(verz, e.name);
      if (e.isDirectory()) { lauf(p); continue; }
      if (/\.(ts|js)$/.test(e.name)) dateien.push(p);
    }
  };
  for (const teil of ['routes', 'src', 'jobs', 'db', 'clients', 'scripts']) {
    const v = path.join(ROOT, teil);
    if (fs.existsSync(v)) lauf(v);
  }
  dateien.push(path.join(ROOT, 'server.ts'));
  assert.ok(dateien.length > 100, `Nur ${dateien.length} Quelldateien gefunden — der Pfad stimmt nicht`);

  // Zeilen ohne Kommentare: Ein Erklaertext, der eine Anweisung ZITIERT, ist
  // kein Schreibzugriff. Genau diese Falle hat in diesem Baum schon eine Regel
  // ihren eigenen Begruendungstext melden lassen — und die Kommentare in
  // src/sets/setMove.ts und db/migrations/0038 zitieren die entfernten
  // Anweisungen woertlich.
  const codeZeilen = (txt) => txt.split('\n')
    .filter(z => { const t = z.trim(); return !(t.startsWith('//') || t.startsWith('*')
                                             || t.startsWith('/*') || t.startsWith('--')); });

  // Nur parts und minifigs. Die Katalog- und Erfassungstabellen schreiben ihre
  // quantity natuerlich fort — sie sind die Wahrheit, nicht die Abschrift.
  const muster = [
    ['setzt parts',        /UPDATE\s+parts\s+SET\s+[^;`']*\bquantity\s*=/i],
    ['setzt minifigs',     /UPDATE\s+minifigs\s+SET\s+[^;`']*\bquantity\s*=/i],
    ['parts bei Konflikt', /INSERT\s+INTO\s+parts\b[^;]*DO\s+UPDATE\s+SET\s+[^;]*\bquantity\s*=/i],
    ['figs bei Konflikt',  /INSERT\s+INTO\s+minifigs\b[^;]*DO\s+UPDATE\s+SET\s+[^;]*\bquantity\s*=/i],
    // Und die Spalten duerfen nicht wieder angelegt werden — ein
    // `ADD COLUMN quantity` brachte die Abschrift zurueck, ohne eine einzige
    // der Regeln darueber zu verletzen.
    ['legt parts an',      /ALTER\s+TABLE\s+parts\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?quantity/i],
    ['legt minifigs an',   /ALTER\s+TABLE\s+minifigs\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?quantity/i],
  ];

  const stellen = [];
  for (const datei of dateien) {
    const rel = path.relative(ROOT, datei);
    const txt = fs.readFileSync(datei, 'utf8');
    for (const z of codeZeilen(txt)) {
      for (const [was, m] of muster) {
        if (m.test(z)) stellen.push(`${rel} (${was}): ${z.trim().slice(0, 90)}`);
      }
    }
  }
  assert.deepEqual(stellen, [],
    'Diese Stellen schreiben die Stueckzahl eines Teils oder einer Figur:\n  ' +
    stellen.join('\n  ') +
    '\nSie steht seit Migration 0038 im Set-Katalog (fuer source=set) bzw. in den ' +
    'Erfassungen (fuer source=manual). Eine Abschrift daneben laeuft auseinander — ' +
    'genau das war bei sets.quantity gemessen worden: 10 bei drei Erfassungen mit Summe 7.');

  // ── Selbstbeweis ─────────────────────────────────────────────────────────
  //
  // Die Muster finden jetzt nichts — das ist der Punkt, sagt aber allein noch
  // nicht, dass sie ueberhaupt etwas finden KOENNTEN. Also an Zeilen
  // nachgewiesen, die in genau dieser Form im Baum standen (die ersten drei
  // woertlich aus src/sets/bestandsmenge.ts und src/katalog/partsImport.ts, Fassung vor
  // 0038).
  const proben = [
    ['UPDATE parts SET quantity = $1 WHERE user_id=$2', 'setzt parts'],
    ['UPDATE minifigs SET quantity = $2 WHERE user_id=$1', 'setzt minifigs'],
    [`INSERT INTO parts (user_id,part_number,quantity) VALUES ($1,$2,$3)
        ON CONFLICT (user_id,part_number) DO UPDATE SET quantity = EXCLUDED.quantity`,
      'parts bei Konflikt'],
    [`INSERT INTO minifigs (user_id,fig_number,quantity) VALUES ($1,$2,$3)
        ON CONFLICT (user_id,fig_number) DO UPDATE SET quantity = EXCLUDED.quantity`,
      'figs bei Konflikt'],
    ['ALTER TABLE parts ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1', 'legt parts an'],
    ['ALTER TABLE minifigs ADD COLUMN quantity INTEGER DEFAULT 1', 'legt minifigs an'],
  ];
  for (const [zeile, name] of proben) {
    const m = muster.find(([was]) => was === name)[1];
    assert.ok(m.test(zeile),
      `Das Muster „${name}" greift nicht mehr auf seine eigene Probe: ${zeile.slice(0, 60)}`);
  }
  // Und die Gegenrichtung: Was erlaubt ist, darf NICHT greifen. Ohne diese
  // Haelfte waere ein Muster, das auf jede Zeile passt, auch gruen.
  for (const zeile of [
    'UPDATE part_acquisitions SET quantity = quantity - $1 WHERE id=$2',
    'UPDATE minifig_acquisitions SET quantity = $1 WHERE id=$2',
    `INSERT INTO set_teile (set_number,part_number,color_id,quantity) VALUES ($1,$2,$3,$4)
       ON CONFLICT (set_number,part_number,color_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
    'UPDATE sets SET storage_id = $1 WHERE id=$2',
  ]) {
    for (const [was, m] of muster) {
      assert.ok(!m.test(zeile),
        `Das Muster „${was}" meldet eine erlaubte Zeile: ${zeile.trim().slice(0, 70)}`);
    }
  }
});

test('die Lesewege liefern die Stückzahl aus Katalog und Erfassungen',
  { concurrency: 1 }, async (t) => {
  if (!(await dbDa(t))) return;

  await volleKette();

  const haupt = (await db.get(
    `INSERT INTO users (username,password_hash) VALUES ('tmleser','x') RETURNING id`)).id;
  const kind = (await db.get(
    `INSERT INTO users (username,password_hash) VALUES ('tmleser_kind','x') RETURNING id`)).id;
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2)`,
    [haupt, kind]);
  const SN = '75192-1';

  // ── Die Lage ─────────────────────────────────────────────────────────────
  //
  // Beide Konten halten dasselbe Set, das Hauptkonto ZWEI Exemplare. Darin
  // steckt ein Teil sechsmal und eine Figur einmal. Daneben hält das
  // Hauptkonto eine manuelle Position mit zwei Erfassungen (2 + 3) und eine
  // manuelle Figur (2).
  //
  // Diese Lage trennt alles, was sich verwechseln lässt: Katalogzahl gegen
  // Erfassungssumme, Set-Zweig gegen manuellen Zweig, ein Konto gegen den
  // Haushalt, und die Multiplikation mit der Setmenge gegen ihr Ausbleiben
  // bei einer manuellen Position.
  await db.run(`INSERT INTO set_catalog (set_number,name,year,pieces)
                VALUES ($1,'Millennium Falcon',2017,7541)
                ON CONFLICT (set_number) DO NOTHING`, [SN]);
  await db.run(`INSERT INTO sets (user_id,set_number) VALUES ($1,$2),($3,$2)`,
    [haupt, SN, kind]);
  // Verschiedene Tage: idx_set_acq_tag_zustand (Migration 0008) erlaubt je Konto, Set
  // und TAG nur eine Erfassung.
  await db.run(`INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition,created_at)
                VALUES ($1,$2,2,100,'N', NOW() - INTERVAL '3 days'),
                       ($3,$2,1, 90,'N', NOW() - INTERVAL '2 days')`, [haupt, SN, kind]);

  await db.run(`INSERT INTO part_catalog (part_number,part_name) VALUES
                  ('3001','Brick 2x4'), ('3070b','Tile 1x1')
                ON CONFLICT (part_number) DO NOTHING`);
  await db.run(`INSERT INTO part_color_catalog (part_number,color_id,color_name) VALUES
                  ('3001',4,'Rot'), ('3070b',0,'Schwarz')
                ON CONFLICT (part_number,color_id) DO NOTHING`);
  await db.run(`INSERT INTO minifigs_catalog (fig_number,fig_name) VALUES
                  ('sw0001','Han Solo'), ('fig-m','Eigenbau')
                ON CONFLICT (fig_number) DO NOTHING`);

  // Set-Teil: die Stückzahl steht EINMAL im Katalog des Sets — gemeinsam für
  // alle Konten, die das Set halten.
  await db.run(`INSERT INTO set_teile (set_number,part_number,color_id,quantity)
                VALUES ($1,'3001',4,6)`, [SN]);
  await db.run(`INSERT INTO parts (user_id,set_number,part_number,color_id,source)
                VALUES ($1,$2,'3001',4,'set'), ($3,$2,'3001',4,'set')`, [haupt, SN, kind]);
  await db.run(`INSERT INTO set_figuren (set_number,fig_number,quantity)
                VALUES ($1,'sw0001',1)`, [SN]);
  await db.run(`INSERT INTO minifigs (user_id,set_number,fig_number,source)
                VALUES ($1,$2,'sw0001','set'), ($3,$2,'sw0001','set')`, [haupt, SN, kind]);

  // Manuelle Position: die Stückzahl ist die Summe ihrer Erfassungen.
  await db.run(`INSERT INTO parts (user_id,part_number,color_id,source)
                VALUES ($1,'3070b',0,'manual')`, [haupt]);
  await db.run(`INSERT INTO part_acquisitions (user_id,part_number,color_id,quantity,unit_price,condition,created_at)
                VALUES ($1,'3070b',0,2,0.50,'N', NOW() - INTERVAL '2 days'),
                       ($1,'3070b',0,3,0.60,'N', NOW() - INTERVAL '1 day')`, [haupt]);
  await db.run(`INSERT INTO minifigs (user_id,fig_number,source)
                VALUES ($1,'fig-m','manual')`, [haupt]);
  await db.run(`INSERT INTO minifig_acquisitions (user_id,fig_number,quantity,unit_price,condition)
                VALUES ($1,'fig-m',2,9.00,'N')`, [haupt]);

  const P = _req('src/teile/abfragen.js');
  const M = _req('src/figuren/abfragen.js');
  const S = _req('src/bestand/kennzahlen.js');
  const SH = _req('src/bestand/gemeinsam.js');

  // ── Kennzahlen, ein Konto ────────────────────────────────────────────────
  //
  // 6 im Set × 2 Exemplare = 12, dazu 5 manuell = 17. Die manuelle Position
  // darf NICHT mit der Setmenge multipliziert werden — sie gehört zu keinem
  // Set. Stünde hier 22, wäre genau das passiert.
  const st1 = await S.getStats([haupt]);
  assert.equal(Number(st1.total_parts), 17,
    `Ein Konto: 6 im Set × 2 Exemplare + 5 manuell = 17, bekam ${st1.total_parts}`);
  assert.equal(Number(st1.total_minifigs), 4,
    `Ein Konto: 1 im Set × 2 Exemplare + 2 manuell = 4, bekam ${st1.total_minifigs}`);

  // ── Kennzahlen, Haushalt ─────────────────────────────────────────────────
  //
  // Dazu das eine Exemplar des Kindes: 6 × 1 = 6, also 23. Die Katalogzahl ist
  // für beide Konten DIESELBE — das ist der Punkt des Umzugs: Vorher trug
  // jedes Konto seine eigene Abschrift, und zwei Abschriften derselben Zahl
  // können auseinanderlaufen.
  const st2 = await S.getStats([haupt, kind]);
  assert.equal(Number(st2.total_parts), 23,
    `Haushalt: 12 + 5 + 6 = 23, bekam ${st2.total_parts}`);
  assert.equal(Number(st2.total_minifigs), 5,
    `Haushalt: 2 + 2 + 1 = 5, bekam ${st2.total_minifigs}`);

  // ── Die Listen ───────────────────────────────────────────────────────────
  const liste = await P.getParts([haupt], { page_size: 60 });
  const zeileVon = (l, nr) => (l.parts || []).find(x => x.part_number === nr);
  assert.equal(Number(zeileVon(liste, '3001').total_quantity), 12,
    'Die Teileliste multipliziert die Katalogzahl nicht mit der Setmenge');
  assert.equal(Number(zeileVon(liste, '3070b').total_quantity), 5,
    'Die Teileliste liest die manuelle Position nicht aus den Erfassungen');
  // Der Treiber liefert BIGINT als ZEICHENKETTE. Ohne den ::int-Cast haengt
  // der JSON-Typ daran, welcher Zweig geantwortet hat — genau dieser Fehler
  // ist in src/teile/abfragen.ts schon einmal aufgeflogen.
  assert.equal(typeof zeileVon(liste, '3001').total_quantity, 'number',
    'total_quantity muss eine Zahl sein, keine Zeichenkette');

  const figListe = await M.getMinifigs([haupt], { page_size: 60 });
  const figVon = (l, nr) => (l.figs || []).find(x => x.fig_number === nr);
  assert.equal(Number(figVon(figListe, 'sw0001').total_quantity), 2,
    'Die Figurenliste multipliziert nicht mit der Setmenge');
  assert.equal(Number(figVon(figListe, 'fig-m').total_quantity), 2,
    'Die Figurenliste liest die manuelle Figur nicht aus den Erfassungen');

  assert.equal(Number((await M.getMinifigStats([haupt])).total_quantity), 4,
    'Die Figuren-Kennzahl rechnet nicht mit');
  // getPartsStats zaehlt ABSICHTLICH nur Set-Teile — manuell erfasste haben in
  // der Oberflaeche ihren eigenen Bereich (der Filter steht in
  // src/teile/partsSummary.ts und im Rueckfall darunter). Also 12, nicht 17. Diese
  // Zahl ist hier kein Nebenbefund: Stuende 17, zaehlte die Kennzahl die
  // manuelle Position doppelt zum eigenen Bereich dazu, und zwar je nachdem,
  // ob die Zusammenfassung gerade frisch ist — genau der sporadische
  // Unterschied, der schon einmal in api-parity aufgefallen ist.
  assert.equal(Number((await P.getPartsStats([haupt])).total_parts), 12,
    'Die Teile-Kennzahl zaehlt nur Set-Teile: 6 × 2 Exemplare = 12');

  // ── Die Listen der MANUELLEN Positionen ─────────────────────────────────
  const man = await P.getManualParts([haupt], haupt, { page_size: 60 });
  const manZeile = man.find(x => x.part_number === '3070b');
  assert.ok(manZeile, 'Die manuelle Position fehlt in der Liste');
  assert.equal(Number(manZeile.quantity), 5,
    `Manuelle Teileliste: 2 + 3 = 5, bekam ${manZeile.quantity}`);
  const manFig = (await M.getManualMinifigs([haupt], haupt, { page_size: 60 }))
    .find(x => x.fig_number === 'fig-m');
  assert.ok(manFig, 'Die manuelle Figur fehlt in der Liste');
  assert.equal(Number(manFig.quantity), 2, `Manuelle Figurenliste: 2, bekam ${manFig.quantity}`);

  // ── „Kann ich das bauen?" ───────────────────────────────────────────────
  //
  // getOwnedQuantities trennt GESAMT von LOSE: Ein Teil, das in einem Set
  // steckt, ist vorhanden, aber nicht greifbar. Genau diese Trennung braucht
  // die Fallunterscheidung an zwei Stellen in EINER Abfrage.
  const besitz = await P.getOwnedQuantities([haupt], [
    { part_number: '3001', color_id: 4 }, { part_number: '3070b', color_id: 0 },
  ]);
  assert.equal(besitz['3001|4']?.gesamt, 12, 'Set-Teil: 6 × 2 Exemplare');
  assert.equal(besitz['3001|4']?.lose, 0, 'Ein Teil im Set ist nicht lose');
  assert.equal(besitz['3070b|0']?.gesamt, 5, 'Manuelle Position: 2 + 3');
  assert.equal(besitz['3070b|0']?.lose, 5, 'Eine manuelle Position ist lose');

  // ── Der Dialog „in welchen Sets steckt das?" ────────────────────────────
  //
  // Hier zeigt sich die gemeinsame Katalogzahl am deutlichsten: Zwei Konten,
  // ein Set, EINE Zahl — und zwar die JE EXEMPLAR, ohne Multiplikation, weil
  // der Dialog das Set zeigt, nicht den Bestand.
  const verw = await SH.verwendendeSets([haupt, kind], 'parts',
    { part_number: '3001', color_id: 4 });
  assert.equal(verw.sets.length, 2,
    `Beide Konten halten das Set, erwartet zwei Zeilen, bekam ${verw.sets.length}`);
  for (const s of verw.sets) {
    assert.equal(Number(s.quantity), 6,
      `Jede Zeile muss die Katalogzahl 6 tragen, bekam ${s.quantity}`);
  }

  // ── Farben und Zusammenfassung ──────────────────────────────────────────
  const farben = await P.getPartsColors([haupt]);
  assert.ok(Array.isArray(farben) && farben.length > 0,
    'Die Farbliste ist leer — sie zaehlt mit teilmengeAus() und muesste zwei Farben haben');

  // rebuildNow() und nicht rebuild(): Die Listenaufrufe darueber haben ueber
  // ensureFresh() schon einen HINTERGRUNDaufbau angestossen, und der haelt
  // die Sperre pg_try_advisory_xact_lock. rebuild() direkt gerufen sieht die
  // Sperre, kehrt stillschweigend zurueck („ein anderer baut gerade") und baut
  // nichts — GEMESSEN: parts_summary war danach LEER. rebuildNow() wartet auf
  // den laufenden Aufbau, statt daneben einen zweiten zu versuchen.
  const { rebuildNow } = _req('src/teile/partsSummary.js');
  await rebuildNow(haupt);
  const zus = await db.get(
    `SELECT total_quantity FROM parts_summary WHERE user_id=$1 AND part_number='3001'`,
    [haupt]);
  assert.ok(zus, 'Die Zusammenfassung hat das Set-Teil nicht aufgenommen');
  assert.equal(Number(zus.total_quantity), 12,
    `Die vorberechnete Zahl ist 6 × 2 = 12, bekam ${zus.total_quantity}`);

  // ── Bewertung und CSV ───────────────────────────────────────────────────
  //
  // Beide tragen die Fallunterscheidung ebenfalls. Hier wird nur AUSGEFÜHRT
  // und auf die Stückzahl gesehen — der Geldbetrag haengt an den Marktpreisen
  // und ist Sache von test/bewertung-abfragen-db.test.js.
  // Beide Bewertungen rechnen NUR die manuellen Positionen — ein Set-Teil
  // wird ueber sein Set bewertet, nicht einzeln (die Bedingung
  // `p.source = 'manual'` steht in src/finanzen/rechnung/bewertung.ts). Also auf die
  // manuelle Position gesehen; deren Stueckzahl ist die Erfassungssumme.
  const B = _req('src/finanzen/rechnung/bewertung.js');
  const bewP = await B.computePartsValuation(haupt, [haupt]);
  const bewZeile = (bewP.parts || []).find(x => x.part_number === '3070b');
  assert.ok(bewZeile,
    `Die Teile-Bewertung kennt die manuelle Position nicht: ${JSON.stringify(bewP).slice(0, 200)}`);
  assert.equal(Number(bewZeile.quantity), 5,
    `Die Bewertung liest 2 + 3 = 5, bekam ${bewZeile.quantity}`);
  assert.ok(!(bewP.parts || []).some(x => x.part_number === '3001'),
    'Das Set-Teil steht in der Teile-Bewertung — dann wird es zweimal bewertet, ' +
    'einmal hier und einmal ueber sein Set');
  const bewM = await B.computeMinifigsValuation(haupt, [haupt]);
  const bewFig = (bewM.figs || []).find(x => x.fig_number === 'fig-m');
  assert.ok(bewFig,
    `Die Figuren-Bewertung kennt die manuelle Figur nicht: ${JSON.stringify(bewM).slice(0, 200)}`);
  assert.equal(Number(bewFig.quantity), 2,
    `Die Figuren-Bewertung liest 2, bekam ${bewFig.quantity}`);

  const csvP = await _req('src/bestand/bestandExport.js').buildPartsCsv(haupt);
  assert.match(csvP, /3070b/, 'Der Teile-Export laesst die manuelle Position aus');
  const csvM = await _req('src/bestand/bestandExport.js').buildFigsCsv(haupt);
  assert.match(csvM, /fig-m/, 'Der Figuren-Export laesst die manuelle Figur aus');

  // ── GEGENPROBE 1: die KATALOGZAHL ändern ────────────────────────────────
  //
  // Der Kern dieses Falls. Ohne ihn könnten alle Zahlen oben zufällig stimmen
  // — etwa aus einer anderen Quelle, die gerade dasselbe sagt. Erst wenn die
  // Antwort einer Änderung FOLGT, ist bewiesen, woher sie kommt. Und sie muss
  // bei BEIDEN Konten folgen: Der Katalog ist gemeinsam.
  await db.run(`UPDATE set_teile SET quantity = 9
                 WHERE set_number=$1 AND part_number='3001'`, [SN]);
  assert.equal(Number((await S.getStats([haupt])).total_parts), 23,
    'Nach 6 → 9 muss ein Konto 9 × 2 + 5 = 23 zaehlen — dann liest die Kennzahl ' +
    'die Zahl nicht aus set_parts_catalog');
  assert.equal(Number((await S.getStats([kind])).total_parts), 9,
    'Das Kind muss der GEMEINSAMEN Katalogzahl ebenso folgen: 9 × 1 = 9');
  assert.equal(Number(zeileVon(await P.getParts([haupt], { page_size: 60 }), '3001').total_quantity), 18,
    'Die Liste folgt der Katalogzahl nicht: 9 × 2 = 18');

  // ── GEGENPROBE 2: eine ERFASSUNG ändern ─────────────────────────────────
  //
  // Dieselbe Probe für den anderen Zweig. Dass beide Gegenproben gebraucht
  // werden, ist der ganze Grund, warum teilmengeAus() eine FALLunterscheidung
  // ist und keine einzelne Abfrage.
  const eine = await db.get(
    `SELECT id FROM part_acquisitions WHERE user_id=$1 AND part_number='3070b'
      ORDER BY id ASC LIMIT 1`, [haupt]);
  await db.run(`UPDATE part_acquisitions SET quantity = 7 WHERE id=$1`, [eine.id]);
  assert.equal(Number(zeileVon(await P.getParts([haupt], { page_size: 60 }), '3070b').total_quantity), 10,
    'Nach 2 → 7 muss die manuelle Position 10 sein (7 + 3) — dann liest die Liste ' +
    'sie nicht aus part_acquisitions');

  // ── Und ohne Erfassung ist die Menge 0, nicht 1 ─────────────────────────
  //
  // Eine manuelle Bestandszeile ohne Erfassung sollte es nicht geben
  // (Migration 0035 traegt fuer jede eine nach), aber sie darf die Liste
  // nicht LEEREN — deshalb LEFT JOIN in src/sets/bestandsmenge.ts. Sie bedeutet
  // dann null Stueck, nicht eines.
  await db.run(`DELETE FROM part_acquisitions WHERE user_id=$1 AND part_number='3070b'`,
    [haupt]);
  const leer = zeileVon(await P.getParts([haupt], { page_size: 60 }), '3070b');
  assert.ok(leer, 'Die Zeile ohne Erfassung ist aus der Liste verschwunden — ein ' +
    'INNER JOIN statt LEFT JOIN leert den Bestand, statt 0 zu zeigen');
  assert.equal(Number(leer.total_quantity), 0,
    `Ohne Erfassung sind es 0 Stueck, nicht ${leer.total_quantity} — der ` +
    'Rueckfallwert 1 gilt nur fuer den SET-Zweig (ein Set-Teil steckt mindestens einmal drin)');
});
