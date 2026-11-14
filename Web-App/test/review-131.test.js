/**
 * Prüfungen aus dem Review-Durchgang hardened-131.
 *
 * Gegenproben (08.11.2026 gemessen, je einzeln):
 *   A  in der Strom-Route der erste send() vor die Anmeldung der Hörer
 *      gezogen → rot: „der CSV-Fortschrittsstrom überlebt Gegendruck …“
 *      (ReferenceError in cleanup); csvImportBus.off() in cleanup gestrichen → rot
 * Gestrichen, weil anderswo ausgeführt: Sitzungsschlüssel in Produktion →
 * startverbot.test.js K/L, compose.yaml ohne SESSION_SECRET → compose-
 * geheimnisse A; Pfad-Normalisierung → sicherheit-querschnitt-db I.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { ROOT, buildAndRequire, ohneKommentare, testDaten, testZugang } = require('./helpers/sources');
const _reqCsv = buildAndRequire();
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = testDaten();

/** Datei ohne Kommentare lesen (siehe ohneKommentare() in helpers/sources.js). */
function quelle(...teile) {
  return ohneKommentare(fs.readFileSync(path.join(ROOT, ...teile), 'utf8'));
}

// ── Verhalten ───────────────────────────────────────────────────────────────

async function dbReachable() {
  try {
    await db.get('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

test('Teile-Rückfallebene für fremde Sets', async t => {
  if (!(await dbReachable())) {
    keineDb(t);
    return;
  }

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  // Und die Migrationen: Die Teileliste liest seit Migration 0034 aus
  // part_catalog und part_color_catalog, und die gibt es nur dort —
  // initSchema() legt sie nicht an.
  const c0 = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(c0);
  } finally {
    c0.release();
  }
  await db.run(`INSERT INTO users (username, password_hash) VALUES ('marco','x')`);
  const uid = (await db.get(`SELECT id FROM users WHERE username='marco'`)).id;

  const { getParts } = require('./helpers/sources').handlerModul(_req);

  await t.test('ohne eigene Teile kommt die Liste aus dem CSV-Bestand', async () => {
    await db.run(`INSERT INTO rb_inventories (id, set_num, version) VALUES (1,'10280-1',1)`);
    await db.run(
      `INSERT INTO rb_parts (part_num, name, part_img_url) VALUES ('3001','Brick 2x4','https://example.invalid/3001.png')`,
    );
    await db.run(`INSERT INTO rb_colors (id, name, rgb) VALUES (4,'Red','C91A09')`);
    await db.run(`INSERT INTO rb_inventory_parts (inventory_id, part_num, color_id, quantity, is_spare)
                  VALUES (1,'3001',4,6,false)`);

    const r = await getParts([uid], { set_number: '10280-1' });
    assert.equal(r.source, 'csv_cache', `Quelle war ${r.source}`);
    assert.equal(r.total, 1);
    assert.equal(r.parts[0].part_number, '3001');
  });

  await t.test('ohne CSV-Eintrag und ohne API-Schlüssel gibt es eine leere Liste statt eines Fehlers', async () => {
    // Der frühere Absturz lag genau hier: Die API-Rückfallebene rief einen
    // Namen auf, den das Teilemodul nie exportiert hat — TypeError statt
    // Antwort. Ohne Schlüssel wird der Zweig übersprungen; DASS er keinen
    // TypeError mehr wirft, sichert test/require-exports.test.js ab.
    const r = await getParts([uid], { set_number: '99999-1' });
    assert.equal(r.total, 0);
    assert.equal(r.source, 'db');
  });
});
test.after(() => db.pool.end().catch(() => {}));

// ── Regeln ──────────────────────────────────────────────────────────────────

test('Bilddownloads sind nach oben begrenzt', () => {
  const src = quelle('src/bilder/setImages.ts');
  const fn = src.slice(src.indexOf('async function setBildHerunterladen'));
  const ende = fn.indexOf('\n}\n');
  const körper = fn.slice(0, ende);

  assert.doesNotMatch(
    körper,
    /fs\.writeFileSync|fs\.existsSync/,
    'blockierende Dateizugriffe im Anfragepfad — dieselbe Sache wie in routes/parts.ts',
  );
  // holeBild (clients/bildCdn.ts) geht über denselben Helfer mit Umleitungsgrenze.
  assert.match(körper, /hole(?:Https|Bild)\(url, \{/, 'eigener Abruf statt des Helfers mit Umleitungsgrenze');
  assert.match(körper, /MAX_BYTES/, 'kein Grössendeckel — eine beliebig grosse Antwort landet komplett im Speicher');
});

test('Schreib-Endpunkte ohne Anmeldung tragen eine Drossel', () => {
  // routes/auth.ts ist der einzige Router ohne durchgehendes requireLogin —
  // hier stehen die Endpunkte, die naturgemäss vor der Anmeldung erreichbar
  // sind. Jeder schreibende darf entweder eine Anmeldung verlangen (per
  // Middleware oder im Rumpf), oder er zählt Versuche je IP. qr-login hatte …
  const src = ohneKommentare(require('./helpers/sources').anmeldeQuelle());
  const stellen = [...src.matchAll(/router\.(post|put|delete)\(\s*'([^']+)'/g)];
  assert.ok(stellen.length >= 6, `nur ${stellen.length} Endpunkte gefunden — die Prüfung liefe ins Leere`);

  const offen = [];
  for (let i = 0; i < stellen.length; i++) {
    const von = stellen[i].index;
    const bis = i + 1 < stellen.length ? stellen[i + 1].index : src.length;
    const rumpf = src.slice(von, bis);
    const geschuetzt =
      /requireLogin|requireToken|requireAdmin|ipThrottle|anmeldungErlaubt|pruefeAnmeldedaten|anmelden\(|req\.session\??\.?\.?userId/.test(
        rumpf,
      );
    if (!geschuetzt) offen.push(`${stellen[i][1].toUpperCase()} ${stellen[i][2]}`);
  }
  assert.deepEqual(offen, [], `weder Anmeldung noch Drossel: ${offen.join(', ')}`);
});

test('die Barcode-Suche zählt ihre Rebrickable-Aufrufe', () => {
  // Die Barcode-Suche (src/sets/barcode.ts) fragt Rebrickable nur über
  // rebrickableJson() — und das zählt und drosselt.
  const dienst = quelle('src/sets/barcode.ts');
  assert.match(dienst, /rebrickableJson\(/, 'die Barcode-Suche fragt Rebrickable nicht über den Client');
  assert.doesNotMatch(dienst, /https\.get\(/, 'eigener Abrufweg am Tageskontingent vorbei');
  const client = quelle('clients/rebrickable.ts');
  const rbJson = client.slice(
    client.indexOf('async function rebrickableJson'),
    client.indexOf('function httpsGetRobust'),
  );
  assert.match(rbJson, /tagesKontingentFrei/, 'rebrickableJson zählt nicht mit');
  assert.match(rbJson, /waitForSlot/, 'rebrickableJson umgeht die Drossel');
});

test('CSV-Export entschärft Formeln, der eigene Import macht es rückgängig', () => {
  const { csvField, entschaerfe, entschaerfungRueckgaengig, csvZeilenBereinigen } = _reqCsv('src/infra/csvExport.js');

  // Ein Feld, das Excel beim Öffnen ausführen würde.
  assert.equal(entschaerfe('=HYPERLINK("http://x";"Klick")'), `'=HYPERLINK("http://x";"Klick")`);
  for (const anfang of ['=', '+', '-', '@', '\t', '\r']) {
    assert.equal(entschaerfe(`${anfang}böse`)[0], "'", `${JSON.stringify(anfang)} nicht entschärft`);
  }

  // Zahlen bleiben Zahlen — sonst käme jeder negative Kaufpreis mit Hochkomma
  // zurück und der eigene Importer läse ihn als Text.
  for (const zahl of ['-5', '-5.00', '-5,00', '42']) {
    assert.equal(entschaerfe(zahl), zahl, `${zahl} wurde fälschlich entschärft`);
  }

  // Harmlose Texte bleiben unverändert.
  assert.equal(entschaerfe('Millennium Falcon'), 'Millennium Falcon');

  // Rundlauf: was der Export schreibt, liest der Import wieder als Original.
  const original = '=1+1';
  assert.equal(entschaerfungRueckgaengig(entschaerfe(original)), original);
  // Ein Feld, das echt mit Hochkomma beginnt, bleibt unangetastet.
  assert.equal(entschaerfungRueckgaengig("'Zitat"), "'Zitat");
  assert.deepEqual(csvZeilenBereinigen([{ a: "'=1+1", b: 'x', c: 3 }]), [{ a: '=1+1', b: 'x', c: 3 }]);

  // Und die Zitierung bleibt korrekt: Das Hochkomma steht INNERHALB der
  // Anführungszeichen, sonst wäre die Zeile kaputt.
  assert.equal(csvField('=A1,B1'), `"'=A1,B1"`);
});

/**
 * Semikolon, Tabulator und Wagenrücklauf trennen in Excel Felder bzw. Zeilen:
 * Ungequotet begänne die nächste Zelle mit einer Formel. Gegenproben
 * (03.11.2026 gemessen): A  csvField quotet wieder nur bei `",\n` → rot:
 * „Rot;=1+1 bleibt eine Zelle“; B  FORMEL_START ohne Leerraum und volle
 * Breite → rot: „ =1+1 …“.
 */
test('CSV-Export: Trennzeichen im Feld werden gequotet, Formeln auch nach Leerraum entschärft', () => {
  const { csvField, toCsv, entschaerfe, entschaerfungRueckgaengig, csvZeilenAusAnfrage } =
    _reqCsv('src/infra/csvExport.js');
  assert.equal(csvField('Rot;=1+1'), '"Rot;=1+1"', 'Rot;=1+1 bleibt eine Zelle');
  for (const t of ['a\rb', 'a\tb', 'a\nb', 'a,b', 'a"b']) assert.equal(csvField(t)[0], '"', JSON.stringify(t));
  for (const boese of [' =1+1', '\u3000=1+1', '＝1+1', '＋1', '\n=1']) {
    assert.equal(entschaerfe(boese)[0], "'", `${JSON.stringify(boese)} nicht entschärft`);
    assert.equal(entschaerfungRueckgaengig(entschaerfe(boese)), boese);
  }
  assert.equal(entschaerfe(' -5 '), ' -5 ', 'Zahlen mit Leerraum bleiben Zahlen');
  const csv = toCsv(['a', 'b'], [{ a: 'Rot;=1+1\r=2', b: ' @SUMME(1)' }]);
  assert.deepEqual(csvZeilenAusAnfrage(csv).bereinigt, [{ a: 'Rot;=1+1\r=2', b: ' @SUMME(1)' }], 'Rundlauf');
  const zeile = csv.split('\r\n')[1];
  assert.ok(zeile.startsWith('"Rot;=1+1\r=2",') && zeile.includes("' @SUMME(1)"), JSON.stringify(zeile));
});

test('alle drei CSV-Importwege entschärfen zurück', () => {
  // Die Zeilenleser der Importe laufen hier selbst: der der Sets und der
  // gemeinsame für Teile und Figuren (csvZeilenAusAnfrage). Dass beide
  // Importe ihn benutzen, zeigt test/csv-rundlauf-db.test.js.
  // Gegenprobe (29.10.2026): entschaerfungRueckgaengig in setCsvZeilen
  // weggelassen → rot („Sets: …“).
  const { setCsvZeilen } = _reqCsv('src/sets/csvImport.js');
  const { csvZeilenAusAnfrage } = _reqCsv('src/infra/csvExport.js');
  assert.equal(
    setCsvZeilen("set_number,quantity\n'-10001-1,1\n").rows[0].sn,
    '-10001-1',
    'Sets: ein hier erzeugter Export käme mit Hochkomma zurück',
  );
  assert.equal(
    csvZeilenAusAnfrage("part_number,quantity\n'=X1,1\n").bereinigt[0].part_number,
    '=X1',
    'Teile und Figuren: ein hier erzeugter Export käme mit Hochkomma zurück',
  );
});

test('der CSV-Fortschrittsstrom überlebt Gegendruck beim ersten Schreiben', async t => {
  if (!(await dbReachable())) {
    keineDb(t);
    return;
  }
  const uid = (
    await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [`strom_${process.pid}`])
  ).id;
  t.after(() => db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {}));
  // Ein voller Puffer schon beim ersten Schreiben: send() ruft dann sofort cleanup() auf.
  const express = require('express');
  const app = express();
  let geschrieben = 0;
  app.use((req, res, next) => {
    req.session = { userId: uid };
    const schreibe = res.write.bind(res);
    res.write = (...a) => {
      schreibe(...a);
      return ++geschrieben > 1;
    };
    next();
  });
  app.use('/api/v1', require('./helpers/sources').routerAus(_req, 'routes/api_v1/index.js'));
  const fehler = [];
  app.use((e, _req2, res, _next) => {
    fehler.push(e);
    res.end();
  });
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  // Der Strom hört auf NOTIFY anderer Worker; die Verbindung dafür hielte den Prozess offen.
  t.after(() => testZugang().benachrichtigung.close());
  const { csvImportBus } = _req('src/auftraege/importAuftrag.js');
  const r = await fetch(`http://localhost:${srv.address().port}/api/v1/sets/import/csv/stream`, {
    signal: AbortSignal.timeout(10_000),
  });
  const text = await r.text();
  assert.equal(r.status, 200);
  assert.match(text, /^data: \{/, 'Der erste Stand kommt nicht an');
  assert.deepEqual(
    fehler.map(e => e.message),
    [],
    'cleanup() greift auf noch nicht angelegte Hörer zu',
  );
  // Aufgeräumt: kein Hörer bleibt am Bus hängen.
  assert.equal(csvImportBus.listenerCount(`progress:${uid}`), 0);
});
