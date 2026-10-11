/**
 * Der Lagerort muss im DETAIL stehen — und nur in den Konten, die ihn haben.
 *
 * ── Marcos zwei Befunde ─────────────────────────────────────────────────────
 *
 *   „Die Lagerorte scheinen nicht korrekt zu funktionieren. Wenn ich einen
 *    setze und das Set später aufrufe ist er weg. Wenn ich in den Filtern nach
 *    einem Account filtere, erscheinen die falschen Lagerorte im Filter und in
 *    den Sets ist keiner gesetzt."
 *
 * Zwei getrennte Fehler, beide aus der Umstellung auf eine ID (Migration 0031).
 * NACHGEMESSEN, Hauptkonto mit einem Unterkonto, Set beim Hauptkonto, Ort
 * „Estrich" darauf gesetzt:
 *
 *     sets.storage_id in der Datenbank : 1
 *     Antwort der LISTE   → storage    : "Estrich"
 *     Antwort des DETAILS → storage    : undefined   ← Befund 1
 *     Vorrat Hauptkonto                : ['Estrich']
 *     Vorrat Unterkonto                : ['Estrich']  ← Befund 2
 *     Sets des Unterkontos MIT Lagerort: 0
 *
 *   Befund 1  Bis 0031 trug die sets-Zeile den NAMEN in einer Spalte `storage`,
 *             und `SELECT s.*` im Detail lieferte ihn mit. Seither trägt sie
 *             `storage_id`. Die LISTE löst die ID auf, das DETAIL nicht.
 *   Befund 2  setzeLagerort() legte den Ort in JEDEM Konto an, in das der
 *             Aufrufer schreiben darf (`FROM users WHERE id = ANY($1)`) — nicht
 *             nur in denen, deren Zeilen er beschreibt. Die leeren Einträge
 *             stehen danach im Kontofilter.
 *
 * ── Warum als Verhaltenstest mit der ALTEN Form daneben ─────────────────────
 *
 * Beide Gegenproben stehen unten im Test selbst: Er führt die frühere Fassung
 * der Abfrage beziehungsweise des INSERT noch einmal aus und zeigt, dass sie
 * genau das Bild von oben erzeugt. Damit hängt die Gegenprobe nicht daran, dass
 * jemand später denselben Quelltext nochmals von Hand verschlechtert — sie
 * läuft bei jedem Testlauf mit.
 *
 * Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

test.after(async () => { await db.pool.end().catch(() => {}); });

const SN = '10179-1';
let HAUPT = 0, KIND = 0;

async function seed() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); }
  finally { client.release(); }
  await db.run(`INSERT INTO users (username, password_hash) VALUES ('haupt','x'),('kind','x')`);
  HAUPT = (await db.get("SELECT id FROM users WHERE username='haupt'")).id;
  KIND  = (await db.get("SELECT id FROM users WHERE username='kind'")).id;
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2)', [HAUPT, KIND]);
  // Das Set gehört dem HAUPTKONTO. Das Unterkonto hat gar keine Zeile — genau
  // die Lage, in der ein Eintrag in seinem Vorrat nichts beschreibt.
  await db.run(`INSERT INTO sets (user_id, set_number, name, quantity) VALUES ($1,$2,'Falcon',1)`,
    [HAUPT, SN]);
}

test('Lagerort: Detail und Vorrat gegen echte Datenbank', async (t) => {
  try { await db.get('SELECT 1 AS ok'); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  await seed();

  const L = _req('utils/lagerort.js');
  const S = _req('utils/handlers/sets.js');
  const household = _req('utils/household.js');
  const schreibbar = await household.writableIds(HAUPT);
  // Vorbedingung: Das Blickfeld umfasst wirklich BEIDE Konten, sonst prüft
  // Befund 2 unten nichts.
  assert.ok(schreibbar.includes(HAUPT) && schreibbar.includes(KIND),
    `writableIds lieferte ${schreibbar} — der Haushalt steht nicht`);

  assert.equal(await L.setzeLagerort('set', schreibbar, [SN], 'Estrich'), 1,
    'Das Setzen muss genau die eine Zeile des Hauptkontos treffen');

  await t.test('Befund 1: der Detail-Aufruf liefert den Namen des Lagerorts', async () => {
    const detail = await S.getSet(schreibbar, SN);
    assert.equal(detail.storage, 'Estrich',
      `Das Detail liefert storage=${JSON.stringify(detail.storage)} — die Oberfläche zeigt ` +
      'dann ein leeres Feld, obwohl der Ort in der Datenbank steht');

    // Liste und Detail müssen dasselbe sagen. Genau zwischen diesen beiden ist
    // schon die MENGE auseinandergelaufen (siehe getSet in handlers/sets.ts).
    const liste = await S.getSets(schreibbar, { page: 1, page_size: 10 });
    const zeile = (liste.sets || []).find(s => s.set_number === SN);
    assert.ok(zeile, 'Das Set fehlt in der Liste');
    assert.equal(zeile.storage, detail.storage,
      `Liste sagt ${JSON.stringify(zeile.storage)}, Detail sagt ` +
      `${JSON.stringify(detail.storage)} — zwei Antworten auf dieselbe Frage`);

    // ── GEGENPROBE: die Abfrage in ihrer frueheren Form ────────────────────
    // `SELECT s.*` ohne aufgeloesten Namen. Sie liefert storage_id und kein
    // storage — genau das Bild aus Marcos Bericht.
    const alt = await db.get(
      `SELECT s.* FROM sets s WHERE s.user_id = ANY($1) AND s.set_number = $2 LIMIT 1`,
      [schreibbar, SN]);
    assert.equal(alt.storage, undefined,
      'Die frühere Form liefert plötzlich ein storage-Feld — dann prüft diese ' +
      'Gegenprobe nicht mehr, was sie soll');
    assert.ok(alt.storage_id > 0,
      'Die frühere Form liefert keine storage_id — dann ist die Lage nicht die gedachte');
  });

  await t.test('Befund 2: der Ort entsteht nur im Konto, dessen Zeile er beschreibt', async () => {
    const haupt = (await L.orteVon([HAUPT])).map(o => o.name);
    const kind  = (await L.orteVon([KIND])).map(o => o.name);
    assert.deepEqual(haupt, ['Estrich'], `Vorrat des Hauptkontos: ${haupt}`);
    assert.deepEqual(kind, [],
      `Der Vorrat des Unterkontos enthält ${kind} — diese Einträge stehen im ` +
      'Kontofilter und zeigen kein einziges Set');

    // ── GEGENPROBE: der frühere INSERT ─────────────────────────────────────
    // Er legte den Ort für jedes schreibbare Konto an. Hier ausgeführt, muss
    // der Phantom-Eintrag im Unterkonto entstehen — und danach wieder weg.
    await db.run(
      `INSERT INTO storage_locations (user_id, name)
       SELECT id, $2 FROM users WHERE id = ANY($1)
       ON CONFLICT (user_id, lower(name)) DO NOTHING`, [schreibbar, 'Estrich']);
    const kindNachAlt = (await L.orteVon([KIND])).map(o => o.name);
    assert.deepEqual(kindNachAlt, ['Estrich'],
      'Die frühere Form legt im Unterkonto KEINEN Eintrag an — dann prüft diese ' +
      'Gegenprobe nicht mehr, was sie soll');
    const belegt = await db.get(
      `SELECT COUNT(*)::int AS n FROM sets WHERE user_id = $1 AND storage_id IS NOT NULL`, [KIND]);
    assert.equal(belegt.n, 0,
      'Das Unterkonto hält plötzlich ein Set mit Lagerort — die Lage ist nicht die gedachte');
    await db.run('DELETE FROM storage_locations WHERE user_id = $1', [KIND]);
  });

  await t.test('ein Ort auf ein fremdes Set hinterlässt keinen Eintrag', async () => {
    // Diese Eigenschaft hatte der frühere Weg über eine Transaktion mit
    // Rücknahme. Sie muss bleiben, auch wenn die Rücknahme weggefallen ist:
    // Jetzt wird vorher gefragt, wer überhaupt eine Zeile hält.
    const n = await L.setzeLagerort('set', schreibbar, ['99999-1'], 'Garage');
    assert.equal(n, 0, 'Ein Set, das niemand hält, darf keine Zeile treffen');
    for (const [wer, id] of [['Hauptkonto', HAUPT], ['Unterkonto', KIND]]) {
      const orte = (await L.orteVon([id])).map(o => o.name);
      assert.ok(!orte.includes('Garage'),
        `Der Vorrat des ${wer} hat „Garage" bekommen, obwohl kein Set getroffen wurde: ${orte}`);
    }
  });

  await t.test('das Unterkonto bekommt seinen eigenen Eintrag, sobald es eine Zeile hält', async () => {
    // Die Kehrseite von Befund 2: Nicht „nur das Hauptkonto", sondern „wer die
    // Zeile hält". Hält das Unterkonto ein Exemplar, gehört der Ort auch dorthin
    // — und zwar als EIGENE Zeile, weil ein Regal in einer Wohnung steht
    // (Migration 0020).
    await db.run(`INSERT INTO sets (user_id, set_number, name, quantity) VALUES ($1,$2,'Falcon',1)`,
      [KIND, SN]);
    const n = await L.setzeLagerort('set', schreibbar, [SN], 'Keller');
    assert.equal(n, 2, `${n} Zeilen getroffen, erwartet 2 (beide Konten halten das Set)`);
    for (const [wer, id] of [['Hauptkonto', HAUPT], ['Unterkonto', KIND]]) {
      const orte = (await L.orteVon([id])).map(o => o.name);
      assert.ok(orte.includes('Keller'), `Der Vorrat des ${wer} hat „Keller" nicht: ${orte}`);
    }
    // Und das Detail fasst beide zusammen, statt einen zu verschweigen.
    await L.setzeLagerort('set', [HAUPT], [SN], 'Estrich');
    const detail = await S.getSet(schreibbar, SN);
    assert.equal(detail.storage, 'Estrich, Keller',
      `Das Detail zeigt ${JSON.stringify(detail.storage)} — bei zwei Besitzern in ` +
      'zwei Kisten muss es beide nennen, wie die Liste es tut');
  });
});
