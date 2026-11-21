/**
 * „Can I build this?" — what the inventory comparison counts.
 *
 * Counter-check (carried out): the LEFT JOIN including multiplication set back to
 * `SUM(p.quantity)` → step 1 turns red, the others stay green.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = testData();
const { ownedQuantitiesQuery } = _req('src/parts/queries.js');
const { holdsMinifig, holdsSet, holdsPart } = require('./helpers/inventory');

let UID = 0;

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

  await db.run(`INSERT INTO users (username, password_hash) VALUES ('bauer','x')`);
  UID = (await db.get(`SELECT id FROM users WHERE username='bauer'`)).id;

  // Two sets: one owned twice, one once.
  await holdsSet(db, UID, '60052-1', 2);
  await holdsSet(db, UID, '10276-1', 1);

  // Parts FROM the sets (source stays empty — exactly as partsImport.ts creates them).
  const setTeil = async (setNr, num, farbe, menge) => {
    // Description into the catalog, stock into parts (migration 0034).
    await db.run(
      `INSERT INTO part_catalog (part_number, part_name) VALUES ($1,'Brick')
                  ON CONFLICT (part_number) DO NOTHING`,
      [num],
    );
    await holdsPart(db, UID, num, { setNumber: setNr, menge: menge, colorId: farbe });
  };
  await setTeil('60052-1', '3001', 0, 3); // 3 per kit, owned twice → 6
  await setTeil('10276-1', '3002', 0, 5); // 5 per kit, owned once   → 5

  // Captured manually: hangs on no set.
  await holdsPart(db, UID, '3003', { menge: 7, colorId: 0 });

  // Part row whose set no longer stands in `sets` — the LEFT JOIN case.
  await setTeil('99999-1', '3004', 0, 4);

  // Minifigures: one from the set owned twice, one captured manually.
  await holdsMinifig(db, UID, 'trn241', { setNumber: '60052-1', menge: 1 });
  await holdsMinifig(db, UID, 'cty0500', { menge: 2 });
}

async function dbReachable() {
  try {
    await db.get('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

test('inventory reconciliation of the parts list', { concurrency: 1 }, async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    keineDb(t);
    return;
  }
  await seed();
  t.after(async () => {
    await db.pool.end().catch(() => {});
  });

  const frage = [
    { part_number: '3001', color_id: 0 },
    { part_number: '3002', color_id: 0 },
    { part_number: '3003', color_id: 0 },
    { part_number: '3004', color_id: 0 },
    // The parts list attaches minifigures as rows of their own — with the
    // FIGURE NUMBER as part_number and color 0 (init.js, plGenerate).
    { part_number: 'trn241', color_id: 0 },
    { part_number: 'cty0500', color_id: 0 },
  ];
  const bestand = await ownedQuantitiesQuery([UID], frage);

  await t.test('a set owned twice delivers its parts twice', () => {
    assert.equal(
      bestand['3001|0']?.gesamt,
      6,
      'Genau Marcos Befund: 3 Stück je Bausatz, das Set zweimal besessen — ' +
        `erwartet 6, bekommen ${bestand['3001|0']?.gesamt}. Zählt sets.quantity nicht mit?`,
    );
    assert.equal(bestand['3001|0']?.lose, 0, 'Ein Set-Teil ist nicht „lose"');
  });

  await t.test('a set owned once stays as it was', () => {
    // The opposite direction: the multiplication must not make more out of every
    // row, but only out of those with a piece count above one.
    assert.equal(bestand['3002|0']?.gesamt, 5);
  });

  await t.test('manually captured parts are NEVER multiplied', () => {
    assert.equal(bestand['3003|0']?.gesamt, 7);
    assert.equal(
      bestand['3003|0']?.lose,
      7,
      'Manuell erfasste Teile sind genau das, was „nur manuell erfasste Teile" zählt',
    );
  });

  await t.test('minifigures count too — also those from sets', () => {
    // The finding behind this check: the query asked in `parts`, and there
    // no figure stands. EVERY minifigure of a parts list therefore counted as
    // missing, even if it stood in the stock — silently, because „not
    // found" looks like „I don't have it".
    assert.equal(
      bestand['trn241|0']?.gesamt,
      2,
      'Die Figur steckt in einem zweimal besessenen Set — erwartet 2, bekommen ' +
        `${bestand['trn241|0']?.gesamt}. Wird die Tabelle minifigs gar nicht gelesen?`,
    );
    assert.equal(bestand['trn241|0']?.lose, 0, 'Eine Figur aus einem Set ist nicht „lose"');
  });

  await t.test('manually captured figures count as loose', () => {
    assert.equal(bestand['cty0500|0']?.gesamt, 2);
    assert.equal(bestand['cty0500|0']?.lose, 2);
  });

  await t.test('a part row without a set does not drop out of the response', () => {
    // The reason for LEFT instead of INNER: a deleted set would otherwise let its
    // part rows vanish without a trace — and the comparison would report a
    // part as missing that stands there.
    assert.equal(bestand['3004|0']?.gesamt, 4, 'Ohne passende sets-Zeile wurde der Posten ganz weggejoint');
  });
});

/**
 * Both sides of the comparison use THE SAME number.
 *
 * Counter-check (carried out): key set back to `${blNum}|…` →
 * this step turns red.
 */
test('demand and inventory are merged via the same number', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { ohneKommentare } = require('./helpers/sources');
  const src = ohneKommentare(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'init.js'), 'utf8'));

  assert.match(
    src,
    /const key = `\$\{p\.part_number\}\|\$\{p\.color_id\s*\|\|\s*0\}`/,
    'Der Bedarf wird nicht (mehr) nach der Rebrickable-Nummer zusammengefasst. ' +
      'Fasst er nach der BrickLink-Nummer zusammen, laufen Formvarianten zu einer ' +
      'Zeile zusammen, deren Bestand nur für eine der beiden Nummern gesucht wird.',
  );
  assert.ok(!/const key = `\$\{blNum\}/.test(src), 'Der alte BrickLink-Schlüssel steht wieder da');

  // The demand side: the same component, so that both match.
  assert.match(
    src,
    /const pkey = `\$\{(?:esc\()?p\.part_number\)?\}__\$\{p\.color_id\s*\|\|\s*0\}`/,
    'Die Bestandsabfrage fragt nicht mehr mit der Rebrickable-Nummer',
  );

  // And the display stays BrickLink — exactly Marco's specification.
  assert.match(
    src,
    /data-part="\$\{p\.bl_part_number\s*\|\|\s*p\.part_number\}"/,
    'Die Anzeige zeigt nicht mehr die BrickLink-Nummer',
  );
});

/**
 * The scope of the comparison comes from THIS view.
 *
 * Counter-check (carried out): `scopeQuery('parts')` reinserted → red.
 */
test('the inventory reconciliation reads its scope from its own choice', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { ohneKommentare } = require('./helpers/sources');
  const js = ohneKommentare(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'init.js'), 'utf8'));
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.ok(js.includes("G('pl-bestand-subs')"), 'Die Wahl „Unterkonten mit einbeziehen" wird nicht gelesen');
  assert.ok(
    js.includes("'?accounts=own'"),
    'Ohne Haken muss `accounts=own` mitreisen — sonst zählt der Haushalt immer mit',
  );
  assert.ok(
    !js.includes("scopeQuery('parts')"),
    'Der Abgleich hängt wieder am Kontofilter des Teile-Reiters. Der steht nach ' +
      'jeder Anmeldung auf „Alle Konten" und beantwortet hier eine Frage, die ' +
      'niemand an dieser Stelle gestellt hat.',
  );
  assert.ok(html.includes('id="pl-bestand-subs"'), 'Die Wahl fehlt im Markup');
});
