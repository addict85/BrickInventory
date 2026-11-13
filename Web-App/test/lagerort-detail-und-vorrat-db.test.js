/**
 * Der Lagerort muss im DETAIL stehen — und nur in den Konten, die ihn haben.
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = _req('db/database.js');
// Ein Bestand ist seit Migration 0036 ZWEI Zeilen: eine in `sets` („dieses
// Konto haelt dieses Set") und eine je Kauf in `set_acquisitions`. haeltSet()
// legt beide an — siehe test/helpers/bestand.js.
const { haeltSet, haeltTeil, katalogSet } = require('./helpers/bestand');
const { testServer } = require('./helpers/server');

test.after(async () => {
  await db.pool.end().catch(() => {});
});

const SN = '10179-1';
let HAUPT = 0,
  KIND = 0;

async function seed() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const client = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(client);
  } finally {
    client.release();
  }
  await db.run(`INSERT INTO users (username, password_hash) VALUES ('haupt','x'),('kind','x')`);
  HAUPT = (await db.get("SELECT id FROM users WHERE username='haupt'")).id;
  KIND = (await db.get("SELECT id FROM users WHERE username='kind'")).id;
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2)', [HAUPT, KIND]);
  // Der Setname steht seit Migration 0033 im Katalog, nicht an der
  // Bestandszeile; die Stueckzahl seit 0036 in der Erfassung. Hier stand
  // `INSERT INTO sets (user_id, set_number, name, quantity)` — beide Spalten
  // gibt es nicht mehr.
  await katalogSet(db, SN, { name: 'Falcon' });
  // Das Set gehört dem HAUPTKONTO. Das Unterkonto hat gar keine Zeile — genau
  // die Lage, in der ein Eintrag in seinem Vorrat nichts beschreibt.
  await haeltSet(db, HAUPT, SN, 1);
}

test('Lagerort: Detail und Vorrat gegen echte Datenbank', async t => {
  try {
    await db.get('SELECT 1 AS ok');
  } catch (e) {
    keineDb(t, e);
    return;
  }
  await seed();

  const L = { ..._req('src/bestand/lagerort.js'), ..._req('src/bestand/prozess.js').bestandBereich().lagerortDienst };
  const S = _req('src/sets/index.js');
  const household = {
    ..._req('src/haushalt/haushalt.js'),
    ..._req('src/haushalt/prozess.js').haushaltBereich().haushalt,
  };
  const schreibbar = await household.schreibbereich(HAUPT);
  // Vorbedingung: Das Blickfeld umfasst wirklich BEIDE Konten, sonst prüft
  // Befund 2 unten nichts.
  assert.ok(
    schreibbar.includes(HAUPT) && schreibbar.includes(KIND),
    `schreibbereich lieferte ${schreibbar} — der Haushalt steht nicht`,
  );

  assert.equal(
    await L.setzeLagerort('set', schreibbar, [SN], 'Estrich'),
    1,
    'Das Setzen muss genau die eine Zeile des Hauptkontos treffen',
  );

  await t.test('Befund 1: der Detail-Aufruf liefert den Namen des Lagerorts', async () => {
    const detail = await S.getSet(schreibbar, SN);
    assert.equal(
      detail.storage,
      'Estrich',
      `Das Detail liefert storage=${JSON.stringify(detail.storage)} — die Oberfläche zeigt ` +
        'dann ein leeres Feld, obwohl der Ort in der Datenbank steht',
    );

    // Liste und Detail müssen dasselbe sagen. Genau zwischen diesen beiden ist
    // schon die MENGE auseinandergelaufen (siehe getSet in src/sets/lesen.ts).
    const liste = await S.getSets(schreibbar, { page: 1, page_size: 10 });
    const zeile = (liste.sets || []).find(s => s.set_number === SN);
    assert.ok(zeile, 'Das Set fehlt in der Liste');
    assert.equal(
      zeile.storage,
      detail.storage,
      `Liste sagt ${JSON.stringify(zeile.storage)}, Detail sagt ` +
        `${JSON.stringify(detail.storage)} — zwei Antworten auf dieselbe Frage`,
    );

    // ── GEGENPROBE: die Abfrage in ihrer frueheren Form ────────────────────
    // `SELECT s.*` ohne aufgeloesten Namen. Sie liefert storage_id und kein
    // storage — genau das Bild aus Marcos Bericht.
    const alt = await db.get(`SELECT s.* FROM sets s WHERE s.user_id = ANY($1) AND s.set_number = $2 LIMIT 1`, [
      schreibbar,
      SN,
    ]);
    assert.equal(
      alt.storage,
      undefined,
      'Die frühere Form liefert plötzlich ein storage-Feld — dann prüft diese ' + 'Gegenprobe nicht mehr, was sie soll',
    );
    assert.ok(alt.storage_id > 0, 'Die frühere Form liefert keine storage_id — dann ist die Lage nicht die gedachte');
  });

  await t.test('Befund 2: der Ort entsteht nur im Konto, dessen Zeile er beschreibt', async () => {
    const haupt = (await L.orteVon([HAUPT])).map(o => o.name);
    const kind = (await L.orteVon([KIND])).map(o => o.name);
    assert.deepEqual(haupt, ['Estrich'], `Vorrat des Hauptkontos: ${haupt}`);
    assert.deepEqual(
      kind,
      [],
      `Der Vorrat des Unterkontos enthält ${kind} — diese Einträge stehen im ` +
        'Kontofilter und zeigen kein einziges Set',
    );

    // ── GEGENPROBE: der frühere INSERT ─────────────────────────────────────
    // Er legte den Ort für jedes schreibbare Konto an. Hier ausgeführt, muss
    // der Phantom-Eintrag im Unterkonto entstehen — und danach wieder weg.
    await db.run(
      `INSERT INTO storage_locations (user_id, name)
       SELECT id, $2 FROM users WHERE id = ANY($1)
       ON CONFLICT (user_id, lower(name)) DO NOTHING`,
      [schreibbar, 'Estrich'],
    );
    const kindNachAlt = (await L.orteVon([KIND])).map(o => o.name);
    assert.deepEqual(
      kindNachAlt,
      ['Estrich'],
      'Die frühere Form legt im Unterkonto KEINEN Eintrag an — dann prüft diese ' +
        'Gegenprobe nicht mehr, was sie soll',
    );
    const belegt = await db.get(`SELECT COUNT(*)::int AS n FROM sets WHERE user_id = $1 AND storage_id IS NOT NULL`, [
      KIND,
    ]);
    assert.equal(belegt.n, 0, 'Das Unterkonto hält plötzlich ein Set mit Lagerort — die Lage ist nicht die gedachte');
    await db.run('DELETE FROM storage_locations WHERE user_id = $1', [KIND]);
  });

  await t.test('ein Ort auf ein fremdes Set hinterlässt keinen Eintrag', async () => {
    // Diese Eigenschaft hatte der frühere Weg über eine Transaktion mit
    // Rücknahme. Sie muss bleiben, auch wenn die Rücknahme weggefallen ist:
    // Jetzt wird vorher gefragt, wer überhaupt eine Zeile hält.
    const n = await L.setzeLagerort('set', schreibbar, ['99999-1'], 'Garage');
    assert.equal(n, 0, 'Ein Set, das niemand hält, darf keine Zeile treffen');
    for (const [wer, id] of [
      ['Hauptkonto', HAUPT],
      ['Unterkonto', KIND],
    ]) {
      const orte = (await L.orteVon([id])).map(o => o.name);
      assert.ok(
        !orte.includes('Garage'),
        `Der Vorrat des ${wer} hat „Garage" bekommen, obwohl kein Set getroffen wurde: ${orte}`,
      );
    }
  });

  await t.test('das Unterkonto bekommt seinen eigenen Eintrag, sobald es eine Zeile hält', async () => {
    // Die Kehrseite von Befund 2: Nicht „nur das Hauptkonto", sondern „wer die
    // Zeile hält". Hält das Unterkonto ein Exemplar, gehört der Ort auch dorthin
    // — und zwar als EIGENE Zeile, weil ein Regal in einer Wohnung steht
    // (Migration 0020). …
    await haeltSet(db, KIND, SN, 1);
    const n = await L.setzeLagerort('set', schreibbar, [SN], 'Keller');
    assert.equal(n, 2, `${n} Zeilen getroffen, erwartet 2 (beide Konten halten das Set)`);
    for (const [wer, id] of [
      ['Hauptkonto', HAUPT],
      ['Unterkonto', KIND],
    ]) {
      const orte = (await L.orteVon([id])).map(o => o.name);
      assert.ok(orte.includes('Keller'), `Der Vorrat des ${wer} hat „Keller" nicht: ${orte}`);
    }
    // Und das Detail fasst beide zusammen, statt einen zu verschweigen.
    await L.setzeLagerort('set', [HAUPT], [SN], 'Estrich');
    const detail = await S.getSet(schreibbar, SN);
    assert.equal(
      detail.storage,
      'Estrich, Keller',
      `Das Detail zeigt ${JSON.stringify(detail.storage)} — bei zwei Besitzern in ` +
        'zwei Kisten muss es beide nennen, wie die Liste es tut',
    );
  });
});

/**
 * Befund 3: der Lagerortfilter der Set-Liste — über die ROUTE geprüft.
 *
 * ── Gegenproben (durchgeführt) ──────────────────────────────────────────────
 *
 *   a) `storage` aus der Weitergabe in routes/api_v1/sets.ts entfernt → der
 *      Fall wird rot („2 Sets statt 1"). Das ist der Zustand, den Marco
 *      gemeldet hat.
 *   b) Der Fall OHNE Filter prüft, dass dann wirklich beide Sets kommen —
 *      sonst wäre der Test auch grün, wenn die Liste immer leer wäre.
 */
test('der Lagerortfilter der Listen wirkt über die Route', async t => {
  try {
    await db.get('SELECT 1 AS ok');
  } catch (e) {
    keineDb(t, e);
    return;
  }
  await seed();

  const L = { ..._req('src/bestand/lagerort.js'), ..._req('src/bestand/prozess.js').bestandBereich().lagerortDienst };
  // Ein zweites Set OHNE Lagerort — ohne es hätte der Filter nichts
  // auszusieben, und „alle" wäre von „die richtigen" nicht zu unterscheiden.
  const OHNE = '21058-1';
  await katalogSet(db, OHNE, { name: 'Cheops' });
  await haeltSet(db, HAUPT, OHNE, 1);
  await L.setzeLagerort('set', [HAUPT], [SN], 'Estrich');

  // Ein Teil in derselben Kiste und eines ohne — für die Teileliste daneben.
  await db.run(`INSERT INTO part_catalog (part_number, part_name) VALUES
                  ('3001','Brick 2x4'), ('3002','Brick 2x3')
                ON CONFLICT (part_number) DO NOTHING`);
  await db.run(`INSERT INTO part_color_catalog (part_number, color_id, color_name) VALUES
                  ('3001',4,'Rot'), ('3002',4,'Rot')
                ON CONFLICT (part_number, color_id) DO NOTHING`);
  await haeltTeil(db, HAUPT, '3001', { setNumber: SN, menge: 2, colorId: 4 });
  await haeltTeil(db, HAUPT, '3002', { setNumber: OHNE, menge: 2, colorId: 4 });
  // Die Schluessel sind eine FLACHE Liste in der Reihenfolge von BEDINGUNG
  // (src/bestand/lagerort.ts): fuer ein Teil Nummer UND Farbe, also zwei Einträge.
  await L.setzeLagerort('part', [HAUPT], ['3001', 4], 'Estrich');

  const { base } = testServer(_req, {
    sitzung: { userId: HAUPT },
    apiNutzer: { user_id: HAUPT, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' },
    t,
  });
  const hole = async pfad => {
    const r = await fetch(base + pfad);
    assert.equal(r.status, 200, `${pfad} antwortete ${r.status}`);
    return r.json();
  };

  await t.test('Sets: ohne Filter kommen beide', async () => {
    const d = await hole('/api/v1/sets?page=1&page_size=60');
    const nummern = (d.sets || []).map(s => s.set_number).sort();
    assert.deepEqual(
      nummern,
      [OHNE, SN].sort(),
      `Vorbedingung: beide Sets müssen ohne Filter kommen, bekam ${JSON.stringify(nummern)}`,
    );
  });

  await t.test('Sets: mit storage=Estrich kommt NUR das Set in der Kiste', async () => {
    const d = await hole(`/api/v1/sets?page=1&page_size=60&storage=${encodeURIComponent('Estrich')}`);
    const nummern = (d.sets || []).map(s => s.set_number);
    assert.deepEqual(
      nummern,
      [SN],
      `Erwartet nur ${SN}, bekam ${JSON.stringify(nummern)}. Kommen BEIDE, hat die ` +
        'Route den Parameter weggelassen — der Filter in getSets() ist in Ordnung, ' +
        'er bekommt ihn nur nie zu sehen.',
    );
    assert.equal(
      Number(d.total),
      1,
      `total sagt ${d.total} statt 1 — dann zählt die Gesamtzahl ungefiltert, und ` +
        'die Oberfläche blättert in Sets, die sie nicht zeigt',
    );
  });

  await t.test('Sets: ein Ort, den es nicht gibt, liefert nichts', async () => {
    // Die Gegenrichtung: Ohne sie wäre der Fall darüber auch grün, wenn der
    // Filter jeden Wert auf dasselbe eine Set abbildete.
    const d = await hole('/api/v1/sets?page=1&page_size=60&storage=Dachboden');
    assert.deepEqual(
      (d.sets || []).map(s => s.set_number),
      [],
      'Ein unbekannter Lagerort muss eine leere Liste ergeben',
    );
  });

  await t.test('Teile: derselbe Filter, derselbe Weg', async () => {
    const alle = await hole('/api/v1/parts?page=1&page_size=60');
    const nummernAlle = (alle.parts || []).map(p => p.part_number).sort();
    assert.deepEqual(
      nummernAlle,
      ['3001', '3002'],
      `Vorbedingung: beide Teile ohne Filter, bekam ${JSON.stringify(nummernAlle)}`,
    );

    const d = await hole(`/api/v1/parts?page=1&page_size=60&storage=${encodeURIComponent('Estrich')}`);
    assert.deepEqual(
      (d.parts || []).map(p => p.part_number),
      ['3001'],
      `Erwartet nur 3001, bekam ${JSON.stringify((d.parts || []).map(p => p.part_number))}`,
    );
  });
});
