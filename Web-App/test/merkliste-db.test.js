/**
 * Die Merkliste — gegen eine echte Datenbank.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 * „Eine Merkliste. Aus dem Katalog sollen in der Detailansicht Sets in die
 * Merkliste hinzugefügt werden können inkl. Zustand und einem Preisalarm.
 * In der Merkliste soll analog den Sets, neue Einträge per Barcodescanner
 * oder Setnummern hinzugefügt werden können. In der Merkliste sollen
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
 *   1. Ein Merkposten ist KEIN Besitz — er darf in `sets` nichts anlegen, sonst
 *      zählte er in Galerie, Portfolio und Finanzen mit.
 *   2. Neu und gebraucht sind zwei Merkposten, nicht einer.
 *   3. Die Übernahme legt das Set über addSet() an — mit Erfassungszeile.
 *   4. Danach sind Merkposten UND Alarm weg.
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
  // NUR einer: Der zweite Merkposten prüft den Fall „Set nicht im Katalog".
  await db.run(
    `INSERT INTO rb_sets (set_num, name, year, theme_id, num_parts, set_img_url)
     VALUES ('75192-1', 'Millennium Falcon', 2017, 158, 7541, 'http://x/75192.jpg')`);
}

async function dbReachable() {
  try { await db.get('SELECT 1 AS ok'); return true; } catch { return false; }
}

test('Merkliste gegen echte Datenbank', { concurrency: 1 }, async (t) => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    if (process.env.REQUIRE_DB === '1') {
      throw new Error('REQUIRE_DB=1, aber die Test-Datenbank ist nicht erreichbar.');
    }
    t.skip('Test-DB nicht erreichbar — Suite übersprungen');
    return;
  }
  await seed();
  const W = _req('utils/merkliste.js');

  await t.test('ein Merkposten ist KEIN Besitz', async () => {
    const a = await W.legeMerkpostenAn(U.opa, '75192-1', 'N');
    assert.equal(a.war_neu, true);

    // Die Kernaussage der ganzen Änderung. Stünde der Merkposten in `sets`, zählte
    // er in der Galerie, im Portfolio-Wert und in der Finanzansicht mit —
    // jede dieser Ansichten bräuchte ab dann einen Filter, den sie nicht hat.
    const inSets = await db.get('SELECT COUNT(*)::int AS n FROM sets WHERE user_id=$1', [U.opa]);
    assert.equal(inSets.n, 0, 'Der Merkposten hat eine Zeile in `sets` angelegt');
  });

  await t.test('die Stammdaten kommen aus dem Katalog, nicht aus einer Kopie', async () => {
    const [w] = await W.merkpostenVon([U.opa]);
    assert.equal(w.name, 'Millennium Falcon');
    assert.equal(w.year, 2017);
    assert.equal(w.num_parts, 7541);

    // Und sie sind NICHT mitgespeichert: Ändert der Katalog den Namen, ändert
    // ihn die Merkliste mit. Genau dafür steht in 0021 keine name-Spalte.
    await db.run(`UPDATE rb_sets SET name='Millennium Falcon (UCS)' WHERE set_num='75192-1'`);
    const [nachher] = await W.merkpostenVon([U.opa]);
    assert.equal(nachher.name, 'Millennium Falcon (UCS)',
      'Der Name stammt aus einer Kopie und veraltet');
    await db.run(`UPDATE rb_sets SET name='Millennium Falcon' WHERE set_num='75192-1'`);
  });

  await t.test('ein Set, das der Katalog nicht kennt, zeigt seine Nummer', async () => {
    // Der benannte Preis dafür, dass hier keine Stammdaten liegen (0021).
    // Er soll SICHTBAR sein und nicht als Absturz auftreten.
    await W.legeMerkpostenAn(U.opa, '99999-1', 'N');
    const w = (await W.merkpostenVon([U.opa])).find(x => x.set_number === '99999-1');
    assert.ok(w, 'Der Merkposten fehlt ganz — der LEFT JOIN ist ein INNER JOIN');
    assert.equal(w.name, null);
    assert.equal(w.year, null);
  });

  await t.test('neu und gebraucht sind ZWEI Merkposten', async () => {
    // Wer ein gebrauchtes zum Bauen und ein verpacktes zum Aufheben sucht, hat
    // zwei Merkposten mit zwei Schwellen. price_alerts führt den Zustand seit
    // 0019 genauso im Schlüssel.
    const b = await W.legeMerkpostenAn(U.opa, '75192-1', 'U');
    assert.equal(b.war_neu, true, 'Der gebrauchte Merkposten hat den neuen überschrieben');
    const beide = (await W.merkpostenVon([U.opa], '75192-1')).map(w => w.condition).sort();
    assert.deepEqual(beide, ['N', 'U']);
  });

  await t.test('denselben Merkposten zweimal eintragen ist kein zweiter Eintrag', async () => {
    const wieder = await W.legeMerkpostenAn(U.opa, '75192-1', 'N');
    assert.equal(wieder.war_neu, false, 'war_neu meldet einen Neuzugang, den es nicht gab');
    const n = await db.get(
      `SELECT COUNT(*)::int AS n FROM wanted WHERE user_id=$1 AND set_number='75192-1'`, [U.opa]);
    assert.equal(n.n, 2, 'N und U — nicht mehr');
  });

  await t.test('der Grossvater sieht die Merkposten des Enkels', async () => {
    // Marcos Festlegung. Hier ist der Kontenbaum nicht nur konsequent,
    // sondern der Zweck: Wer ein Geschenk sucht, schaut genau dort nach.
    await W.legeMerkpostenAn(U.enkel, '75192-1', 'N');
    const nurOpa = await W.merkpostenVon([U.opa]);
    assert.ok(!nurOpa.some(w => w.user_id === U.enkel), 'Ohne Blickfeld kommen fremde Merkposten mit');

    const zusammen = await W.merkpostenVon([U.opa, U.enkel]);
    const vomEnkel = zusammen.find(w => w.user_id === U.enkel);
    assert.ok(vomEnkel, 'Der Merkposten des Enkels fehlt im gemeinsamen Blickfeld');
    assert.equal(vomEnkel.set_number, '75192-1');
  });

  await t.test('owned prüft das BLICKFELD, nicht nur das eigene Konto', async () => {
    // „Habe ich das inzwischen?" ist die Frage, die in der Liste sofort
    // aufkommt. Beim Grossvater heisst „ich habe es" auch: der Enkel hat es.
    await db.run(`INSERT INTO sets (user_id, set_number, quantity) VALUES ($1,'75192-1',1)`, [U.enkel]);
    const alleinOpa = await W.merkpostenVon([U.opa], '75192-1');
    assert.equal(alleinOpa[0].owned, false);
    const imBlickfeld = await W.merkpostenVon([U.opa, U.enkel], '75192-1');
    assert.ok(imBlickfeld.every(w => w.owned === true), 'owned sieht nur das eigene Konto an');
    await db.run(`DELETE FROM sets WHERE user_id=$1`, [U.enkel]);
  });

  await t.test('löschen trifft genau EINEN Zustand', async () => {
    const weg = await W.loescheMerkposten(U.opa, '75192-1', 'U');
    assert.equal(weg, 1);
    const uebrig = (await W.merkpostenVon([U.opa], '75192-1')).map(w => w.condition);
    assert.deepEqual(uebrig, ['N'], 'Löschen hat den anderen Zustand mitgenommen');

    // Zweimal löschen ist kein Fehler — das Ziel ist erreicht.
    assert.equal(await W.loescheMerkposten(U.opa, '75192-1', 'U'), 0);
  });

  await t.test('die Übernahme legt das Set über addSet() an — mit Erfassungszeile', async () => {
    // „Direkt in die Galerie übernehmen" muss dasselbe sein wie eine
    // Setnummer erfassen. Ein eigenes INSERT INTO sets hätte weder die
    // Erfassungszeile noch den Zustand noch die Anreicherung — und genau
    // daran würde man es erst in der Finanzansicht merken.
    await W.legeMerkpostenAn(U.opa, '75192-1', 'N');
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

  await t.test('nach der Übernahme sind Merkposten UND Alarm weg', async () => {
    // Marcos Festlegung auf die Rückfrage: „Eintrag weg, Alarm auch."
    await W.legeMerkpostenAn(U.enkel, '10276-1', 'U');
    // Der zweite Merkposten auf dasselbe Set, im anderen Zustand — er ist die
    // eigentliche Aussage unten. Er stand frueher im Notiz-Test, den es seit
    // dem Ausbau des Feldes (Migration 0022) nicht mehr gibt.
    await W.legeMerkpostenAn(U.enkel, '10276-1', 'N');
    const P = _req('utils/preisalarm.js');
    await P.setzeAlarm(U.enkel, '10276-1', 'EUR',
      { richtung: 'unter', schwelle: 249, condition: 'U' });
    assert.equal((await P.alarmeFuer(U.enkel, '10276-1')).length, 1, 'Aufbau: Alarm fehlt');

    await W.uebernimm(U.enkel, U.enkel, '10276-1', 'U', {});

    // Genau der U-Merkposten ist weg. Der N-Merkposten auf dasselbe Set bleibt
    // stehen — er ist ein ANDERER Merkposten, und genau dafuer steht der Zustand
    // im Schluessel.
    //
    // Die erste Fassung dieser Zusicherung zaehlte stumpf auf 0 und war rot,
    // obwohl der Code recht hatte: Sie hat den N-Merkposten mitgezaehlt. Eine
    // Zahl, die zwei Dinge zusammenfasst, sagt nicht, welches davon schiefging.
    const uebrig = (await W.merkpostenVon([U.enkel], '10276-1')).map(w => w.condition);
    assert.deepEqual(uebrig, ['N'], 'Der U-Merkposten steht noch — oder der N-Merkposten wurde mitgenommen');
    assert.equal((await P.alarmeFuer(U.enkel, '10276-1')).length, 0, 'Der Alarm steht noch');
  });

  await t.test('die Übernahme eines Sets, das man schon hat, stockt NICHT auf', async () => {
    // Dieselbe Regel wie beim Erfassen (utils/setAdd.ts): Schon im Blickfeld
    // heisst „Detail öffnen", nicht „Menge erhöhen". Sie darf nicht davon
    // abhängen, über welchen der vier Wege jemand kommt.
    const vorher = await db.get(
      'SELECT quantity FROM sets WHERE user_id=$1 AND set_number=$2', [U.opa, '75192-1']);
    await W.legeMerkpostenAn(U.opa, '75192-1', 'N');
    const r = await W.uebernimm(U.opa, U.opa, '75192-1', 'N', { quantity: 5 });
    assert.equal(r.action, 'exists');
    const nachher = await db.get(
      'SELECT quantity FROM sets WHERE user_id=$1 AND set_number=$2', [U.opa, '75192-1']);
    assert.equal(nachher.quantity, vorher.quantity, 'Die Menge wurde aufgestockt');
    // Erledigt ist der Merkposten trotzdem — sonst bliebe er für ein Set stehen,
    // das man längst hat.
    assert.equal((await W.merkpostenVon([U.opa], '75192-1')).length, 0);
  });

  await t.test('Anzahl, Kaufpreis und Zustand lassen sich bei der Übernahme setzen', async () => {
    // Marcos Nachtrag: „gewisse Inhalte wie zB. Preis und Zustand, Anzahl
    // müssen beim Übernehmen angepasst werden."
    await W.legeMerkpostenAn(U.opa, '10497-1', 'N');
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
      'Die Erfassung steht im Zustand des MERKPOSTENS statt in dem, was gekauft wurde');
  });

  await t.test('der Merkposten verschwindet nach SEINEM Zustand, nicht nach dem gekauften', async () => {
    // Der Fall, der vorher still falsch war: Merkposten „gebraucht", gekauft
    // wurde ein neues. Dann muss der GEBRAUCHTE Merkposten weg — den hat man
    // erfuellt — und das Set als neu in die Galerie.
    await W.legeMerkpostenAn(U.enkel, '21034-1', 'U');
    await W.legeMerkpostenAn(U.enkel, '21034-1', 'N');

    await W.uebernimm(U.enkel, U.enkel, '21034-1', 'U', { condition: 'N' });

    const uebrig = (await W.merkpostenVon([U.enkel], '21034-1')).map(w => w.condition);
    assert.deepEqual(uebrig, ['N'],
      'Geräumt wurde nach dem GEKAUFTEN Zustand — damit trifft es den falschen Merkposten');
  });

  await t.test('der Preisvergleich haengt am Merkposten, nicht am Katalog', async () => {
    // Marco: „Der Link für den Vergleich fehlt noch auf der Detailseite der
    // Merkliste." Beide Oberflächen holten ihn aus /catalog/sets/:nr —
    // derselben Anfrage wie Thema und Teilezahl. Für ein Set, das rb_sets
    // nicht kennt, antwortet die Route 404, und der Knopf blieb aus. Dabei
    // braucht die Adresse nur die Setnummer.
    //
    // Gegenproben (durchgeführt, Ergebnis im Commit):
    //   a) `preisvergleich_url: fuerSet(...)` aus merkpostenVon() entfernt →
    //      beide Zusicherungen unten werden rot.
    //   b) fuerSet() nur mit der Nummer aufgerufen (Name weggelassen) → „der
    //      Name macht die Suche brauchbar" wird rot.
    // Frisch angelegt: Die Subtests davor löschen und übernehmen, der Merkposten
    // von oben muss hier nicht mehr stehen.
    await W.legeMerkpostenAn(U.opa, '75192-1', 'N');
    const [mitKatalog] = await W.merkpostenVon([U.opa], '75192-1');
    const url = decodeURIComponent(mitKatalog.preisvergleich_url || '');
    assert.ok(url.startsWith('http'), 'Ohne Adresse führt der Knopf ins Leere');
    assert.ok(url.includes('75192'), `Die Setnummer fehlt in der Adresse: ${url}`);
    assert.ok(url.includes('Millennium Falcon'),
      `Der Name macht die Suche brauchbar — "LEGO 75192 Millennium Falcon" findet, ` +
      `die blosse Nummer oft nicht: ${url}`);

    // Und der Fall, der den Knopf bisher verschwinden liess: ein Set, das im
    // Katalog gar nicht steht. Der Name fehlt dann — die Adresse nicht.
    await W.legeMerkpostenAn(U.opa, '99999-1', 'N');
    const [ohneKatalog] = await W.merkpostenVon([U.opa], '99999-1');
    assert.equal(ohneKatalog.name, null, 'Vorbedingung: dieses Set kennt der Katalog nicht');
    const url2 = decodeURIComponent(ohneKatalog.preisvergleich_url || '');
    assert.ok(url2.includes('99999'),
      `Gerade hier muss die Adresse stehen — der Katalog liefert für dieses Set ` +
      `nichts: ${url2}`);
  });

  await t.test('das Bild kommt lokal — und fehlt es, wird es bestellt', async () => {
    // Marcos zwei Befunde in einem Test:
    //
    //   „Die Bilder in der Merkliste werden nicht geladen. Anscheinend wird
    //    direkt das CDN aufgerufen."
    //   „Leider wird es auch nach ein paar Minuten noch über den Proxy
    //    geladen … als würde das Bild nicht im Hintergrund heruntergeladen."
    //
    // Beides hing an derselben Lücke: Die Merkliste war die einzige Liste
    // ohne image_local, und eine Notiz für den Bild-Job entsteht im Proxy nur
    // bei einer VORSCHAU-Anfrage (routes/imgProxy.ts) — das Detail fragt die
    // volle Auflösung.
    //
    // Gegenproben (durchgeführt, Ergebnis im Commit):
    //   a) merkeGebraucht()-Zeile aus merkpostenVon() entfernt → „bestellt" rot.
    //   b) image_local fest auf null → „die lokale Datei gewinnt" rot.
    const fs = require('node:fs');
    const path = require('node:path');
    const IQ = _req('jobs/imageQueue.js');
    const ORDNER = path.join(__dirname, '..', 'data', 'images', 'sets');

    // ZWEI Setnummern, und das ist kein Zufall: resolveIfExists() merkt sich
    // ein „gibt es nicht" zehn Minuten lang (utils/images.ts). Dieselbe Nummer
    // erst ohne und dann mit Datei zu prüfen, prüfte den Cache statt die Regel.
    const ohneDatei = `wlimg${process.pid}a-1`;
    const mitDatei  = `wlimg${process.pid}b-1`;
    const datei = path.join(ORDNER, `${mitDatei}.jpg`);
    // Die Datei VOR dem Anlegen des Merkpostens: legeMerkpostenAn() liest die Liste
    // selbst noch einmal, und dieser Blick würde das „gibt es nicht" für die
    // nächsten zehn Minuten festhalten.
    fs.mkdirSync(ORDNER, { recursive: true });
    fs.writeFileSync(datei, 'x');
    for (const sn of [ohneDatei, mitDatei]) {
      await db.run(
        `INSERT INTO rb_sets (set_num, name, year, theme_id, num_parts, set_img_url)
         VALUES ($1,'Testset',2024,158,100,$2)`,
        [sn, `http://cdn.example/media/sets/${sn}.jpg`]);
      await W.legeMerkpostenAn(U.opa, sn, 'N');
    }

    try {
      // ── Ohne Datei: kein image_local, dafür eine Bestellung ──────────────
      const [a] = await W.merkpostenVon([U.opa], ohneDatei);
      assert.equal(a.image_local, null, 'Vorbedingung: für dieses Set liegt keine Datei');
      await IQ._schreibePuffer();
      const notiz = await db.get(
        'SELECT set_number FROM image_wanted WHERE url=$1',
        [`http://cdn.example/media/sets/${ohneDatei}.jpg`]);
      assert.ok(notiz, 'Das fehlende Bild wurde nicht bestellt — dann holt es der ' +
        'Hintergrundjob nie, und die Anzeige bleibt für immer am Proxy hängen');
      assert.equal(notiz.set_number, ohneDatei);

      // ── Mit Datei: die lokale gewinnt ────────────────────────────────────
      const [b] = await W.merkpostenVon([U.opa], mitDatei);
      assert.ok(String(b.image_local || '').startsWith('/images/sets/'),
        `image_local fehlt oder zeigt woandershin: ${b.image_local}`);
    } finally {
      fs.rmSync(datei, { force: true });
      await db.run('DELETE FROM image_wanted WHERE url LIKE $1',
        ['http://cdn.example/media/sets/wlimg%']).catch(() => {});
    }
  });

  await t.test('der Inhaber laesst sich wechseln — mit Alarm und Datum', async () => {
    // Marcos Befund: „Auf dem Detail-Dialog der Merkliste kann der Inhaber
    // nicht geändert werden. Auch in der Android-App nicht."
    //
    // Gegenproben (durchgeführt, Ergebnis im Commit):
    //   a) In verschiebeMerkposten() das UPDATE der price_alerts entfernt →
    //      „der Alarm zieht mit" wird rot.
    //   b) Statt UPDATE ein Löschen und Neuanlegen → „das Aufnahmedatum
    //      bleibt" wird rot.
    //   c) Den `schon`-Zweig entfernt → „ein Merkposten, den das Ziel schon hat"
    //      wird rot (UNIQUE-Verletzung statt Zusammenführen).
    const P = _req('utils/preisalarm.js');
    const sn = `wlmv${process.pid}-1`;
    await db.run(
      `INSERT INTO rb_sets (set_num, name, year, theme_id, num_parts, set_img_url)
       VALUES ($1,'Umzugsset',2024,158,100,NULL)`, [sn]);

    await W.legeMerkpostenAn(U.opa, sn, 'N');
    await P.setzeAlarm(U.opa, sn, 'EUR', { richtung: 'unter', schwelle: 99, condition: 'N' });
    const [vorher] = await W.merkpostenVon([U.opa], sn);
    assert.ok(vorher, 'Aufbau: der Merkposten fehlt');

    // ── Derselbe Inhaber ist kein Umzug ─────────────────────────────────
    const nix = await W.verschiebeMerkposten(U.opa, sn, 'N', U.opa);
    assert.equal(nix.verschoben, false, 'Ein Umzug auf dasselbe Konto ist keiner');

    // ── Der Umzug ───────────────────────────────────────────────────────
    const r = await W.verschiebeMerkposten(U.opa, sn, 'N', U.enkel);
    assert.equal(r.verschoben, true);
    assert.equal(r.zusammengefuehrt, false);

    const beimOpa = await W.merkpostenVon([U.opa], sn);
    assert.deepEqual(beimOpa, [], 'Der Merkposten steht noch beim alten Konto');
    const [nachher] = await W.merkpostenVon([U.enkel], sn);
    assert.ok(nachher, 'Der Merkposten ist beim neuen Konto nicht angekommen');

    // Das Aufnahmedatum ist die einzige Angabe, die ein Merkposten über sich
    // selbst trägt — ein Neuanlegen setzte sie auf heute.
    assert.equal(new Date(nachher.created_at).getTime(),
                 new Date(vorher.created_at).getTime(),
      'Das Aufnahmedatum wurde neu gesetzt — dann ist es nicht derselbe Merkposten');

    assert.equal((await P.alarmeFuer(U.opa, sn)).length, 0,
      'Der Alarm blieb beim alten Konto — es bekäme Meldungen für etwas, ' +
      'das nicht mehr auf seiner Liste steht');
    const alarm = (await P.alarmeFuer(U.enkel, sn)).find(a => a.condition === 'N');
    assert.ok(alarm, 'Der Alarm ist nicht mitgezogen');
    assert.equal(parseFloat(alarm.schwelle), 99);

    // ── Und wenn das Ziel den Merkposten schon hat ──────────────────────────
    await W.legeMerkpostenAn(U.opa, sn, 'N');
    const r2 = await W.verschiebeMerkposten(U.opa, sn, 'N', U.enkel);
    assert.equal(r2.zusammengefuehrt, true,
      'Ein Merkposten, den das Ziel schon hat, muss zusammengeführt werden');
    assert.deepEqual(await W.merkpostenVon([U.opa], sn), [],
      'Die Quelle steht noch da');
    const nachMerge = (await P.alarmeFuer(U.enkel, sn)).find(a => a.condition === 'N');
    assert.equal(parseFloat(nachMerge.schwelle), 99,
      'Die Schwelle des ZIELS wurde überschrieben');
  });

  await t.test('Verbindungen schliessen', async () => { await db.pool.end(); });
});
