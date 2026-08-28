/**
 * Prüfungen aus dem Review-Durchgang hardened-131.
 *
 * Zwei Sorten, bewusst getrennt gehalten:
 *   - Verhalten gegen echte Datenbank: die Teile-Rückfallebene für Sets, zu
 *     denen der Nutzer selbst nichts erfasst hat.
 *   - Regeln am Quelltext dort, wo sich Verhalten nur mit Netzzugriff oder
 *     einem Prozessabbruch prüfen liesse (Weiterleitungsgrenze, Fail-fast,
 *     Drossel). Kommentare werden vorher ausgeblendet — sonst hält der
 *     Erklärtext über einer Regel die Prüfung selbst grün.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const { ROOT, buildAndRequire, ohneKommentare } = require('./helpers/sources');
const _reqCsv = buildAndRequire();
const _req = buildAndRequire();
const db   = _req('db/database.js');

/** Datei ohne Kommentare lesen (siehe ohneKommentare() in helpers/sources.js). */
function quelle(...teile) {
  return ohneKommentare(fs.readFileSync(path.join(ROOT, ...teile), 'utf8'));
}

// ── Verhalten ───────────────────────────────────────────────────────────────

async function dbReachable() {
  try { await db.get('SELECT 1 AS ok'); return true; } catch { return false; }
}

test('Teile-Rückfallebene für fremde Sets', async (t) => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    if (process.env.REQUIRE_DB === '1') {
      throw new Error('REQUIRE_DB=1, aber die Test-Datenbank ist nicht erreichbar.');
    }
    t.skip('Test-DB nicht erreichbar — Suite übersprungen');
    return;
  }

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  await db.run(`INSERT INTO users (username, password_hash) VALUES ('marco','x')`);
  const uid = (await db.get(`SELECT id FROM users WHERE username='marco'`)).id;

  const { getParts } = require('./helpers/sources').handlerModul(_req);

  await t.test('ohne eigene Teile kommt die Liste aus dem CSV-Bestand', async () => {
    await db.run(`INSERT INTO rb_inventories (id, set_num, version) VALUES (1,'10280-1',1)`);
    await db.run(`INSERT INTO rb_parts (part_num, name, part_img_url) VALUES ('3001','Brick 2x4','https://example.invalid/3001.png')`);
    await db.run(`INSERT INTO rb_colors (id, name, rgb) VALUES (4,'Red','C91A09')`);
    await db.run(`INSERT INTO rb_inventory_parts (inventory_id, part_num, color_id, quantity, is_spare)
                  VALUES (1,'3001',4,6,'f')`);

    const r = await getParts([uid], { set_number: '10280-1' });
    assert.equal(r.source, 'csv_cache', `Quelle war ${r.source}`);
    assert.equal(r.total, 1);
    assert.equal(r.parts[0].part_number, '3001');
  });

  await t.test('ohne CSV-Eintrag und ohne API-Schlüssel gibt es eine leere Liste statt eines Fehlers', async () => {
    // Der frühere Absturz lag genau hier: Die API-Rückfallebene rief einen
    // Namen auf, den routes/parts.ts nie exportiert hat — TypeError statt
    // Antwort. Ohne Schlüssel wird der Zweig übersprungen; DASS er keinen
    // TypeError mehr wirft, sichert test/require-exports.test.js ab.
    const r = await getParts([uid], { set_number: '99999-1' });
    assert.equal(r.total, 0);
    assert.equal(r.source, 'db');
  });

  await db.pool.end().catch(() => {});
});

// ── Regeln ──────────────────────────────────────────────────────────────────

test('Bilddownloads sind nach oben begrenzt', () => {
  const src = quelle('utils', 'setImages.ts');
  const fn  = src.slice(src.indexOf('async function downloadSetImage'));
  const ende = fn.indexOf('\n}\n');
  const körper = fn.slice(0, ende);

  assert.doesNotMatch(körper, /fs\.writeFileSync|fs\.existsSync/,
    'blockierende Dateizugriffe im Anfragepfad — dieselbe Sache wie in routes/parts.ts');
  assert.match(körper, /tryGet\([^)]*,\s*\d+\s*\)/,
    'Weiterleitungen ohne Zähler — eine Kette im Kreis läuft endlos');
  assert.match(körper, /MAX_BYTES/,
    'kein Grössendeckel — eine beliebig grosse Antwort landet komplett im Speicher');
});

test('Schreib-Endpunkte ohne Anmeldung tragen eine Drossel', () => {
  // routes/auth.ts ist der einzige Router ohne durchgehendes requireLogin —
  // hier stehen die Endpunkte, die naturgemäss vor der Anmeldung erreichbar
  // sind. Jeder schreibende darf entweder eine Anmeldung verlangen (per
  // Middleware oder im Rumpf), oder er zählt Versuche je IP. qr-login hatte
  // als einziger keins von beidem.
  const src = quelle('routes', 'auth.ts');
  const stellen = [...src.matchAll(/router\.(post|put|delete)\('([^']+)'/g)];
  assert.ok(stellen.length >= 6, `nur ${stellen.length} Endpunkte gefunden — die Prüfung liefe ins Leere`);

  const offen = [];
  for (let i = 0; i < stellen.length; i++) {
    const von = stellen[i].index;
    const bis = i + 1 < stellen.length ? stellen[i + 1].index : src.length;
    const rumpf = src.slice(von, bis);
    const geschuetzt = /requireLogin|requireToken|requireAdmin|ipThrottle|checkLoginAllowed|req\.session\??\.?\.?userId/.test(rumpf);
    if (!geschuetzt) offen.push(`${stellen[i][1].toUpperCase()} ${stellen[i][2]}`);
  }
  assert.deepEqual(offen, [], `weder Anmeldung noch Drossel: ${offen.join(', ')}`);
});

test('der Sitzungsschlüssel darf in Produktion kein Beispielwert sein', () => {
  const src = quelle('server.ts');
  const compose = fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');
  const beispiel = compose.match(/SESSION_SECRET:\s*(\S+)/)?.[1];
  assert.ok(beispiel, 'compose.yaml nennt keinen SESSION_SECRET-Wert');
  assert.ok(src.includes(`'${beispiel}'`),
    `server.ts weist den Beispielwert aus compose.yaml (${beispiel}) nicht zurück`);
  assert.match(src, /SESSION_SECRET[\s\S]{0,1200}?length\s*<\s*\d+/,
    'keine Mindestlänge für SESSION_SECRET');
});

test('Pfade werden an genau EINER Stelle normalisiert', () => {
  const src = quelle('server.ts');
  const treffer = [...src.matchAll(/req\.url\.startsWith\('\/\/'\)/g)];
  assert.equal(treffer.length, 1,
    `${treffer.length} Middlewares ziehen doppelte Schrägstriche zusammen — eine reicht`);
});

test('die Barcode-Suche zählt ihre Rebrickable-Aufrufe', () => {
  const src = quelle('routes', 'api_v1', 'sets.ts');
  assert.match(src, /consumeRebrickableDaily/,
    'eigener Abrufweg am Tageskontingent vorbei');
  const rbGet = src.slice(src.indexOf('const rbGet'), src.indexOf('async function enrichResult'));
  assert.match(rbGet, /consumeRebrickableDaily/, 'rbGet zählt nicht mit');
  assert.match(rbGet, /waitForSlot/,            'rbGet umgeht die Drossel');
});

test('CSV-Export entschärft Formeln, der eigene Import macht es rückgängig', () => {
  const { csvField, entschaerfe, entschaerfungRueckgaengig, csvZeilenBereinigen }
    = _reqCsv('utils/csvExport.js');

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

test('alle drei CSV-Importwege entschärfen zurück', () => {
  for (const [datei, marke] of [
    ['routes/sets.ts', 'entschaerfungRueckgaengig'],
    ['routes/parts.ts', 'csvZeilenBereinigen'],
    ['routes/minifigs.ts', 'csvZeilenBereinigen'],
  ]) {
    const src = quelle(...datei.split('/'));
    assert.match(src, new RegExp(marke),
      `${datei}: ein hier erzeugter Export käme mit Hochkomma zurück`);
  }
});

test('der CSV-Fortschrittsstrom überlebt Gegendruck beim ersten Schreiben', () => {
  // Gemeldet als 500er im Serverprotokoll, direkt nach dem Gegendruck-Hinweis:
  //   ReferenceError: Cannot access 'onProgress' before initialization
  // send() ruft bei vollem Puffer sofort cleanup() auf. Stand der erste
  // send()-Aufruf VOR den Anmeldungen, griff cleanup() auf ein const zu, das
  // es noch nicht gab. Geprüft wird deshalb die Reihenfolge: Der erste
  // Statusversand muss NACH allen Dingen stehen, die cleanup() anfasst.
  const src = require('./helpers/sources').setKernQuelle();
  const strom = src.slice(src.indexOf("res.setHeader('Content-Type', 'text/event-stream')"),
                          src.indexOf('function cleanup()'));

  // Genau zwei Leerzeichen Einrückung = oberste Ebene des Handlers. Tiefer
  // eingerückte send()-Aufrufe stehen INNERHALB der Rückrufe (onNotify, die
  // Zeitgeber) und laufen erst später.
  const ersterVersand = strom.search(/^  send\(/m);
  assert.ok(ersterVersand > 0, 'kein Statusversand auf oberster Ebene gefunden');

  for (const name of ['const onProgress', 'const onNotify', 'const fallbackTimer', 'const heartbeat']) {
    const pos = strom.indexOf(name);
    assert.ok(pos > 0, `${name} nicht gefunden`);
    assert.ok(pos < ersterVersand,
      `${name} entsteht erst NACH dem ersten send() — Gegendruck beim ersten Schreiben endet dann im ReferenceError`);
  }
});
