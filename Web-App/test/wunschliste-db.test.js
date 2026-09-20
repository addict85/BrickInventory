/**
 * Die Wunschliste — gegen eine echte Datenbank.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 * „Eine Wunschliste. Aus dem Katalog sollen in der Detailansicht Sets in die
 * Wunschliste hinzugefügt werden können inkl. Zustand und einem Preisalarm.
 * In der Wunschliste soll analog den Sets, neue Einträge per Barcodescanner
 * oder Setnummern hinzugefügt werden können. In der Wunschliste sollen
 * Einträge gelöscht oder direkt in die Galerie übernommen werden können."
 *
 * Dazu Marcos zwei Festlegungen auf Rückfrage:
 *   * Der Kontenbaum gilt wie überall — der Grossvater sieht die Enkel.
 *   * Bei der Übernahme verschwinden Eintrag UND Preisalarm.
 *
 * ── Warum mit DB ────────────────────────────────────────────────────────────
 *
 * Jede dieser Aussagen ist eine Aussage über DATEN, und keine davon lässt
 * sich am Quelltext prüfen:
 *
 *   1. Ein Wunsch ist KEIN Besitz — er darf in `sets` nichts anlegen, sonst
 *      zählte er in Galerie, Portfolio und Finanzen mit.
 *   2. Neu und gebraucht sind zwei Wünsche, nicht einer.
 *   3. Die Übernahme legt das Set über addSet() an — mit Erfassungszeile.
 *   4. Danach sind Wunsch UND Alarm weg.
 *
 * Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

const U = {};

async function seed() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); }
  finally { client.release(); }
  for (const name of ['opa', 'enkel']) {
    await db.run(`INSERT INTO users (username, password_hash) VALUES ($1,'x')`, [name]);
    U[name] = (await db.get('SELECT id FROM users WHERE username=$1', [name])).id;
  }
  // Ein Katalogeintrag, damit der LEFT JOIN etwas zu zeigen hat — und bewusst
  // NUR einer: Der zweite Wunsch prüft den Fall „Set nicht im Katalog".
  await db.run(
    `INSERT INTO rb_sets (set_num, name, year, theme_id, num_parts, set_img_url)
     VALUES ('75192-1', 'Millennium Falcon', 2017, 158, 7541, 'http://x/75192.jpg')`);
}

async function dbReachable() {
  try { await db.get('SELECT 1 AS ok'); return true; } catch { return false; }
}

test('Wunschliste gegen echte Datenbank', { concurrency: 1 }, async (t) => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    if (process.env.REQUIRE_DB === '1') {
      throw new Error('REQUIRE_DB=1, aber die Test-Datenbank ist nicht erreichbar.');
    }
    t.skip('Test-DB nicht erreichbar — Suite übersprungen');
    return;
  }
  await seed();
  const W = _req('utils/wunschliste.js');

  await t.test('ein Wunsch ist KEIN Besitz', async () => {
    const a = await W.legeWunschAn(U.opa, '75192-1', 'N', null);
    assert.equal(a.war_neu, true);

    // Die Kernaussage der ganzen Änderung. Stünde der Wunsch in `sets`, zählte
    // er in der Galerie, im Portfolio-Wert und in der Finanzansicht mit —
    // jede dieser Ansichten bräuchte ab dann einen Filter, den sie nicht hat.
    const inSets = await db.get('SELECT COUNT(*)::int AS n FROM sets WHERE user_id=$1', [U.opa]);
    assert.equal(inSets.n, 0, 'Der Wunsch hat eine Zeile in `sets` angelegt');
  });

  await t.test('die Stammdaten kommen aus dem Katalog, nicht aus einer Kopie', async () => {
    const [w] = await W.wuenscheVon([U.opa]);
    assert.equal(w.name, 'Millennium Falcon');
    assert.equal(w.year, 2017);
    assert.equal(w.num_parts, 7541);

    // Und sie sind NICHT mitgespeichert: Ändert der Katalog den Namen, ändert
    // ihn die Wunschliste mit. Genau dafür steht in 0021 keine name-Spalte.
    await db.run(`UPDATE rb_sets SET name='Millennium Falcon (UCS)' WHERE set_num='75192-1'`);
    const [nachher] = await W.wuenscheVon([U.opa]);
    assert.equal(nachher.name, 'Millennium Falcon (UCS)',
      'Der Name stammt aus einer Kopie und veraltet');
    await db.run(`UPDATE rb_sets SET name='Millennium Falcon' WHERE set_num='75192-1'`);
  });

  await t.test('ein Set, das der Katalog nicht kennt, zeigt seine Nummer', async () => {
    // Der benannte Preis dafür, dass hier keine Stammdaten liegen (0021).
    // Er soll SICHTBAR sein und nicht als Absturz auftreten.
    await W.legeWunschAn(U.opa, '99999-1', 'N', null);
    const w = (await W.wuenscheVon([U.opa])).find(x => x.set_number === '99999-1');
    assert.ok(w, 'Der Wunsch fehlt ganz — der LEFT JOIN ist ein INNER JOIN');
    assert.equal(w.name, null);
    assert.equal(w.year, null);
  });

  await t.test('neu und gebraucht sind ZWEI Wünsche', async () => {
    // Wer ein gebrauchtes zum Bauen und ein verpacktes zum Aufheben sucht, hat
    // zwei Wünsche mit zwei Schwellen. price_alerts führt den Zustand seit
    // 0019 genauso im Schlüssel.
    const b = await W.legeWunschAn(U.opa, '75192-1', 'U', 'zum Bauen');
    assert.equal(b.war_neu, true, 'Der gebrauchte Wunsch hat den neuen überschrieben');
    const beide = (await W.wuenscheVon([U.opa], '75192-1')).map(w => w.condition).sort();
    assert.deepEqual(beide, ['N', 'U']);
  });

  await t.test('denselben Wunsch zweimal eintragen ist kein zweiter Eintrag', async () => {
    const wieder = await W.legeWunschAn(U.opa, '75192-1', 'N', null);
    assert.equal(wieder.war_neu, false, 'war_neu meldet einen Neuzugang, den es nicht gab');
    const n = await db.get(
      `SELECT COUNT(*)::int AS n FROM wishlist WHERE user_id=$1 AND set_number='75192-1'`, [U.opa]);
    assert.equal(n.n, 2, 'N und U — nicht mehr');
  });

  await t.test('der Grossvater sieht die Wünsche des Enkels', async () => {
    // Marcos Festlegung. Hier ist der Kontenbaum nicht nur konsequent,
    // sondern der Zweck: Wer ein Geschenk sucht, schaut genau dort nach.
    await W.legeWunschAn(U.enkel, '75192-1', 'N', 'bitte zu Weihnachten');
    const nurOpa = await W.wuenscheVon([U.opa]);
    assert.ok(!nurOpa.some(w => w.user_id === U.enkel), 'Ohne Blickfeld kommen fremde Wünsche mit');

    const zusammen = await W.wuenscheVon([U.opa, U.enkel]);
    const vomEnkel = zusammen.find(w => w.user_id === U.enkel);
    assert.ok(vomEnkel, 'Der Wunsch des Enkels fehlt im gemeinsamen Blickfeld');
    assert.equal(vomEnkel.notiz, 'bitte zu Weihnachten');
  });

  await t.test('owned prüft das BLICKFELD, nicht nur das eigene Konto', async () => {
    // „Habe ich das inzwischen?" ist die Frage, die in der Liste sofort
    // aufkommt. Beim Grossvater heisst „ich habe es" auch: der Enkel hat es.
    await db.run(`INSERT INTO sets (user_id, set_number, quantity) VALUES ($1,'75192-1',1)`, [U.enkel]);
    const alleinOpa = await W.wuenscheVon([U.opa], '75192-1');
    assert.equal(alleinOpa[0].owned, false);
    const imBlickfeld = await W.wuenscheVon([U.opa, U.enkel], '75192-1');
    assert.ok(imBlickfeld.every(w => w.owned === true), 'owned sieht nur das eigene Konto an');
    await db.run(`DELETE FROM sets WHERE user_id=$1`, [U.enkel]);
  });

  await t.test('löschen trifft genau EINEN Zustand', async () => {
    const weg = await W.loescheWunsch(U.opa, '75192-1', 'U');
    assert.equal(weg, 1);
    const uebrig = (await W.wuenscheVon([U.opa], '75192-1')).map(w => w.condition);
    assert.deepEqual(uebrig, ['N'], 'Löschen hat den anderen Zustand mitgenommen');

    // Zweimal löschen ist kein Fehler — das Ziel ist erreicht.
    assert.equal(await W.loescheWunsch(U.opa, '75192-1', 'U'), 0);
  });

  await t.test('die Notiz wird beschnitten, nicht abgelehnt', async () => {
    const lang = 'x'.repeat(600);
    await W.legeWunschAn(U.opa, '10276-1', 'N', lang);
    const w = (await W.wuenscheVon([U.opa], '10276-1'))[0];
    assert.equal(w.notiz.length, 500);
    // Und leer heisst NULL, wie beim Lagerort.
    await W.legeWunschAn(U.enkel, '10276-1', 'N', '   ');
    assert.equal((await W.wuenscheVon([U.enkel], '10276-1'))[0].notiz, null);
  });

  await t.test('die Übernahme legt das Set über addSet() an — mit Erfassungszeile', async () => {
    // „Direkt in die Galerie übernehmen" muss dasselbe sein wie eine
    // Setnummer erfassen. Ein eigenes INSERT INTO sets hätte weder die
    // Erfassungszeile noch den Zustand noch die Anreicherung — und genau
    // daran würde man es erst in der Finanzansicht merken.
    await W.legeWunschAn(U.opa, '75192-1', 'N', null);
    const r = await W.uebernimm(U.opa, U.opa, '75192-1', 'N', { quantity: 2 });
    assert.equal(r.action, 'added');

    const set = await db.get(
      'SELECT quantity FROM sets WHERE user_id=$1 AND set_number=$2', [U.opa, '75192-1']);
    assert.ok(set, 'Das Set ist nicht in der Galerie gelandet');
    assert.equal(set.quantity, 2);

    const erf = await db.get(
      `SELECT COUNT(*)::int AS n FROM set_acquisitions WHERE user_id=$1 AND set_number=$2`,
      [U.opa, '75192-1']);
    assert.equal(erf.n, 1, 'Keine Erfassungszeile — die Übernahme ruft addSet() nicht');
  });

  await t.test('nach der Übernahme sind Wunsch UND Alarm weg', async () => {
    // Marcos Festlegung auf die Rückfrage: „Eintrag weg, Alarm auch."
    await W.legeWunschAn(U.enkel, '10276-1', 'U', null);
    const P = _req('utils/preisalarm.js');
    await P.setzeAlarm(U.enkel, '10276-1', 'EUR',
      { richtung: 'unter', schwelle: 249, condition: 'U' });
    assert.equal((await P.alarmeFuer(U.enkel, '10276-1')).length, 1, 'Aufbau: Alarm fehlt');

    await W.uebernimm(U.enkel, U.enkel, '10276-1', 'U', {});

    // Genau der U-Wunsch ist weg. Der N-Wunsch auf dasselbe Set (aus dem
    // Notiz-Test oben) bleibt stehen — er ist ein ANDERER Wunsch, und genau
    // dafuer steht der Zustand im Schluessel.
    //
    // Die erste Fassung dieser Zusicherung zaehlte stumpf auf 0 und war rot,
    // obwohl der Code recht hatte: Sie hat den N-Wunsch mitgezaehlt. Eine
    // Zahl, die zwei Dinge zusammenfasst, sagt nicht, welches davon schiefging.
    const uebrig = (await W.wuenscheVon([U.enkel], '10276-1')).map(w => w.condition);
    assert.deepEqual(uebrig, ['N'], 'Der U-Wunsch steht noch — oder der N-Wunsch wurde mitgenommen');
    assert.equal((await P.alarmeFuer(U.enkel, '10276-1')).length, 0, 'Der Alarm steht noch');
  });

  await t.test('die Übernahme eines Sets, das man schon hat, stockt NICHT auf', async () => {
    // Dieselbe Regel wie beim Erfassen (utils/setAdd.ts): Schon im Blickfeld
    // heisst „Detail öffnen", nicht „Menge erhöhen". Sie darf nicht davon
    // abhängen, über welchen der vier Wege jemand kommt.
    const vorher = await db.get(
      'SELECT quantity FROM sets WHERE user_id=$1 AND set_number=$2', [U.opa, '75192-1']);
    await W.legeWunschAn(U.opa, '75192-1', 'N', null);
    const r = await W.uebernimm(U.opa, U.opa, '75192-1', 'N', { quantity: 5 });
    assert.equal(r.action, 'exists');
    const nachher = await db.get(
      'SELECT quantity FROM sets WHERE user_id=$1 AND set_number=$2', [U.opa, '75192-1']);
    assert.equal(nachher.quantity, vorher.quantity, 'Die Menge wurde aufgestockt');
    // Erfüllt ist der Wunsch trotzdem — sonst bliebe er für ein Set stehen,
    // das man längst hat.
    assert.equal((await W.wuenscheVon([U.opa], '75192-1')).length, 0);
  });

  await t.test('Anzahl, Kaufpreis und Zustand lassen sich bei der Übernahme setzen', async () => {
    // Marcos Nachtrag: „gewisse Inhalte wie zB. Preis und Zustand, Anzahl
    // müssen beim Übernehmen angepasst werden."
    await W.legeWunschAn(U.opa, '10497-1', 'N', null);
    await W.uebernimm(U.opa, U.opa, '10497-1', 'N',
      { quantity: 3, purchase_price: 88.5, condition: 'U' });

    const set = await db.get(
      'SELECT quantity, purchase_price FROM sets WHERE user_id=$1 AND set_number=$2',
      [U.opa, '10497-1']);
    assert.equal(set.quantity, 3, 'Die Anzahl wurde nicht übernommen');
    assert.equal(parseFloat(set.purchase_price), 88.5, 'Der Kaufpreis wurde nicht übernommen');

    const erf = await db.get(
      `SELECT condition FROM set_acquisitions WHERE user_id=$1 AND set_number=$2`,
      [U.opa, '10497-1']);
    assert.equal(erf.condition, 'U',
      'Die Erfassung steht im Zustand des WUNSCHES statt in dem, was gekauft wurde');
  });

  await t.test('der Wunsch verschwindet nach SEINEM Zustand, nicht nach dem gekauften', async () => {
    // Der Fall, der vorher still falsch war: Wunsch „gebraucht", gekauft
    // wurde ein neues. Dann muss der GEBRAUCHTE Wunsch weg — den hat man
    // erfuellt — und das Set als neu in die Galerie.
    await W.legeWunschAn(U.enkel, '21034-1', 'U', null);
    await W.legeWunschAn(U.enkel, '21034-1', 'N', 'der andere Wunsch');

    await W.uebernimm(U.enkel, U.enkel, '21034-1', 'U', { condition: 'N' });

    const uebrig = (await W.wuenscheVon([U.enkel], '21034-1')).map(w => w.condition);
    assert.deepEqual(uebrig, ['N'],
      'Geräumt wurde nach dem GEKAUFTEN Zustand — damit trifft es den falschen Wunsch');
  });

  await t.test('Verbindungen schliessen', async () => { await db.pool.end(); });
});
