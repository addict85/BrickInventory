/**
 * Die Merkliste geht als CSV hinaus und kommt als Merkliste zurück.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 *   „Merklisten sollen ebenfalls analog den anderen Seiten exportiert und
 *    importiert werden können."
 *
 * ── Was hier LÄUFT und nicht gelesen wird ───────────────────────────────────
 *
 * Der Rundlauf geht über die echten Adressen: Der Export über
 * GET /api/v1/settings/export/data (das ZIP, in dem auch sets.csv, teile.csv
 * und minifiguren.csv liegen), der Import über
 * POST /api/v1/wanted/import/csv. Dazwischen wird die Tabelle GELEERT — ohne
 * das wäre ein Import, der gar nichts tut, nicht von einem erfolgreichen zu
 * unterscheiden.
 *
 * Genau diese Form hat in diesem Baum zwei Fehler gefangen, die eine
 * Quelltextprüfung durchgelassen hätte (siehe
 * test/verdrahtung-laeuft-db.test.js).
 *
 * ── Warum das ZIP wirklich entpackt wird ────────────────────────────────────
 *
 * Es wäre einfacher, buildMerklisteCsv() direkt zu rufen. Dann bliebe aber
 * ungeprüft, was Marco verlangt hat: dass die Datei IM ARCHIV liegt. Ein
 * `archive.append`, das jemand entfernt, fiele sonst niemandem auf.
 *
 * ── Gegenproben (durchgeführt, Befunde GEMESSEN) ────────────────────────────
 *
 *   a) archive.append für merkliste.csv entfernt → 1, 2, 3 rot; 4, 5, 6 grün
 *   b) created_at im Import weggelassen          → 3 rot (Datum wird heute)
 *   c) resolveWriteTarget im Import entfernt     → 5 rot
 *   d) condition im Export weggelassen           → 2 UND 3 rot
 *
 * Zwei Dinge daran sind nicht so ausgegangen, wie ich sie vorher aufgeschrieben
 * hatte, und beide stehen hier, weil sie etwas über den Test sagen:
 *
 * Bei (a) wurden im ERSTEN Versuch fünf Fälle rot statt drei. 4 und 5 lasen
 * `csvText` aus Fall 1 weiter und 4 verliess sich zusätzlich auf die von Fall 3
 * gefüllte Tabelle — sie fielen also mit, ohne selbst etwas gefunden zu haben.
 * Eine Meldung, die auf den Import zeigt, während der Fehler im Export liegt,
 * ist schlechter als keine. Seitdem bauen 4, 5 und 6 ihre Datei selbst
 * (csvAusPosten) und 4 stellt seine Vorbedingung selbst her. Fall 3 behält die
 * Kopplung — genau sie IST der Rundlauf.
 *
 * Bei (d) hatte ich nur Fall 2 erwartet. Rot wurde auch 3, und das ist richtig:
 * Ohne Zustandsspalte legt der Import (75192-1, U) als (75192-1, N) an, und
 * damit ist die Liste nicht wiederhergestellt. Die Vorhersage war zu eng, nicht
 * der Befund falsch.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip, ausser
 * REQUIRE_DB=1.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { testServer } = require('./helpers/server');

test.after(async () => { await db.pool.end().catch(() => {}); });

let HAUPT = 0, KIND = 0, FREMD = 0;

/** Die drei Merkposten des Aufbaus — zwei Sets, eines in beiden Zuständen. */
const POSTEN = [
  { sn: '75192-1', c: 'N', am: '2024-03-01' },
  { sn: '75192-1', c: 'U', am: '2024-05-17' },
  { sn: '10179-1', c: 'N', am: '2025-01-09' },
];

async function aufbau() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  await db.run(`INSERT INTO users (username,password_hash)
                VALUES ('haupt','x'),('kind','x'),('fremd','x')`);
  const id = async (n) => (await db.get(`SELECT id FROM users WHERE username=$1`, [n])).id;
  HAUPT = await id('haupt'); KIND = await id('kind'); FREMD = await id('fremd');
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2)`, [HAUPT, KIND]);
  for (const p of POSTEN) {
    await db.run(`INSERT INTO set_catalog (set_number,name) VALUES ($1,$1)
                  ON CONFLICT (set_number) DO NOTHING`, [p.sn]);
    await db.run(`INSERT INTO wanted (user_id,set_number,condition,created_at)
                  VALUES ($1,$2,$3,$4::timestamptz)`, [HAUPT, p.sn, p.c, p.am]);
  }
}

/** Eine Datei aus dem ZIP holen — ohne Entpack-Bibliothek. */
function ausZip(buf, name) {
  const zlib = require('node:zlib');
  // Die lokalen Dateikopf-Signaturen durchgehen (PK\003\004). Das genuegt
  // hier: Das Archiv ist unverschluesselt, ohne Zip64 und ohne Spannung, und
  // archiver schreibt je Datei genau einen solchen Kopf.
  for (let i = 0; i + 30 <= buf.length; i++) {
    if (buf.readUInt32LE(i) !== 0x04034b50) continue;
    const methode   = buf.readUInt16LE(i + 8);
    const namLen    = buf.readUInt16LE(i + 26);
    const extraLen  = buf.readUInt16LE(i + 28);
    const datName   = buf.slice(i + 30, i + 30 + namLen).toString('utf-8');
    if (datName !== name) continue;
    const start = i + 30 + namLen + extraLen;
    // Gepackte Groesse steht im Kopf nur, wenn kein Datendeskriptor benutzt
    // wird (Bit 3 des Flaggenfelds). archiver stroemt und setzt das Bit —
    // dann ist die Groesse 0 und der Rest des Puffers wird entpackt, bis
    // zlib das Ende des Stroms erkennt. inflateRawSync kann das.
    const roh = buf.slice(start);
    if (methode === 0) return roh.toString('utf-8');
    return zlib.inflateRawSync(roh, { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('utf-8');
  }
  return null;
}

/**
 * Dieselbe CSV, aber aus POSTEN gebaut statt aus dem Export geholt.
 *
 * ── Warum es die gibt (beim Gegenprobieren gelernt) ─────────────────────────
 *
 * Faelle 4 bis 6 lasen anfangs `csvText` aus Fall 1 weiter. Als ich fuer die
 * Gegenprobe das `archive.append` entfernte, wurden deshalb FUENF Faelle rot
 * statt der drei, die wirklich etwas mit dem Archiv zu tun haben — 4 und 5
 * nur, weil sie nichts zum Hochladen hatten. Das ist eine Kettenreaktion, kein
 * Befund: Die Meldung zeigte auf den Import, der Fehler lag im Export.
 *
 * Fall 3 BEHAELT die Kopplung mit Absicht — genau sie ist der Rundlauf: Was
 * der Export erzeugt, muss der Import lesen koennen. Faelle 4 und 5 fragen
 * etwas anderes (verdoppelt der Import? prueft er das Konto?) und bekommen
 * deshalb ihre eigene Datei.
 */
function csvAusPosten() {
  return 'set_number,condition,created_at\n'
    + POSTEN.map(p => `${p.sn},${p.c},${p.am}`).join('\n') + '\n';
}

/** Zeilen einer CSV als Objekte — die Kopfzeile bestimmt die Schluessel. */
function csvZeilen(text) {
  const ohneBom = text.replace(/^﻿/, '');
  const [kopf, ...rest] = ohneBom.trim().split(/\r?\n/);
  const spalten = kopf.split(',').map(s => s.replace(/^"|"$/g, ''));
  return rest.filter(z => z.trim()).map(z => {
    const werte = z.split(',').map(s => s.replace(/^"|"$/g, ''));
    return Object.fromEntries(spalten.map((s, i) => [s, werte[i] ?? '']));
  });
}

test('Merkliste: Rundlauf über die echten Adressen', { concurrency: 1 }, async (t) => {
  try { await db.get('SELECT 1'); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  await aufbau();

  const srv = testServer(_req, {
    sitzung: { userId: HAUPT }, apiNutzer: { user_id: HAUPT, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js', '/api/v1/settings': 'routes/settings.js' }, t,
  });

  let csvText = '';

  await t.test('1. merkliste.csv liegt im ZIP des Daten-Exports', async () => {
    const r = await fetch(`${srv.base}/api/v1/settings/export/data`);
    assert.equal(r.status, 200, `Der Export antwortete mit ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    assert.equal(buf.slice(0, 2).toString(), 'PK', 'Das ist kein ZIP-Archiv');

    csvText = ausZip(buf, 'merkliste.csv');
    assert.ok(csvText !== null,
      'merkliste.csv liegt NICHT im Archiv. Marcos Vorgabe war „analog den anderen ' +
      'Seiten" — die drei anderen liegen dort, diese muss es auch.');
    // Und die drei bestehenden sind noch da: Ein Export, der die neue Datei
    // mitbringt und eine alte verliert, ist kein Fortschritt.
    for (const n of ['sets.csv', 'teile.csv', 'minifiguren.csv']) {
      assert.ok(ausZip(buf, n) !== null, `${n} ist aus dem Archiv verschwunden`);
    }
  });

  await t.test('2. die Datei trägt Nummer, Zustand und Datum jedes Merkpostens', () => {
    const zeilen = csvZeilen(csvText);
    assert.equal(zeilen.length, POSTEN.length,
      `${zeilen.length} Zeilen statt ${POSTEN.length} — exportiert wird die ganze Liste`);
    for (const p of POSTEN) {
      const z = zeilen.find(x => x.set_number === p.sn && x.condition === p.c);
      assert.ok(z, `(${p.sn}, ${p.c}) fehlt im Export. Ohne den Zustand in der Datei ` +
                   'fallen „neu" und „gebraucht" desselben Sets zu einer Zeile zusammen.');
      assert.equal(z.created_at, p.am,
        `Das Aufnahmedatum von (${p.sn}, ${p.c}) kam als „${z.created_at}" heraus, ` +
        `erwartet ${p.am}`);
    }
  });

  await t.test('3. dieselbe Datei stellt die geleerte Liste wieder her — samt Datum', async () => {
    await db.run('DELETE FROM wanted');
    assert.equal((await db.get('SELECT COUNT(*)::int c FROM wanted')).c, 0,
      'Vorbedingung: die Liste ist leer');

    const fd = new FormData();
    fd.append('file', new Blob([csvText], { type: 'text/csv' }), 'merkliste.csv');
    const r = await fetch(`${srv.base}/api/v1/wanted/import/csv`, { method: 'POST', body: fd });
    const b = await r.json();
    assert.equal(r.status, 200, `Der Import antwortete mit ${r.status}: ${JSON.stringify(b)}`);
    assert.equal(b.added, POSTEN.length, `${b.added} angelegt statt ${POSTEN.length}`);
    assert.equal(b.errors, 0, `${b.errors} Fehler: ${JSON.stringify(b.results)}`);

    const wieder = await db.all(
      `SELECT set_number, condition,
              TO_CHAR(created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS am
         FROM wanted WHERE user_id=$1 ORDER BY set_number, condition`, [HAUPT]);
    assert.equal(wieder.length, POSTEN.length, 'Nicht alle Merkposten sind zurück');
    for (const p of POSTEN) {
      const z = wieder.find(x => x.set_number === p.sn && x.condition === p.c);
      assert.ok(z, `(${p.sn}, ${p.c}) kam nicht zurück`);
      // Der Kern von Punkt 3: Das Datum ist das ALTE, nicht heute. „Auf der
      // Liste seit" ist die einzige Angabe, die ein Merkposten über sich
      // selbst macht — ein Import, der sie auf heute setzt, verliert sie für
      // die ganze Liste auf einmal.
      assert.equal(z.am, p.am,
        `(${p.sn}, ${p.c}) liegt jetzt auf „${z.am}" statt auf ${p.am} — das ` +
        'Aufnahmedatum wurde beim Import überschrieben');
    }
  });

  await t.test('4. ein zweiter Import verdoppelt nichts und verschiebt kein Datum', async () => {
    // Die Gegenrichtung zu Fall 3: Der Import muss auch auf eine GEFUELLTE
    // Liste anwendbar sein. Ohne diesen Fall waere ein Import „richtig", der
    // nur auf der leeren Tabelle funktioniert.
    //
    // Eigene Datei (csvAusPosten) und eigene Vorbedingung — beides aus
    // derselben Lehre: Las dieser Fall `csvText` aus Fall 1 und verliess sich
    // auf die von Fall 3 gefuellte Tabelle, wurde er bei JEDER Stoerung im
    // Export mit rot, ohne selbst etwas gefunden zu haben.
    const einlesen = async () => {
      const fd = new FormData();
      fd.append('file', new Blob([csvAusPosten()], { type: 'text/csv' }), 'merkliste.csv');
      const r = await fetch(`${srv.base}/api/v1/wanted/import/csv`, { method: 'POST', body: fd });
      return r.json();
    };
    await db.run('DELETE FROM wanted');
    const erst = await einlesen();
    assert.equal(erst.added, POSTEN.length,
      `Vorbedingung: der erste Import legt ${POSTEN.length} an, bekam ${erst.added}`);

    const b = await einlesen();
    assert.equal(b.added, 0, `${b.added} neu angelegt — die Posten gab es schon alle`);
    assert.equal(b.updated, POSTEN.length, `${b.updated} als bestehend gemeldet statt ${POSTEN.length}`);
    assert.equal((await db.get('SELECT COUNT(*)::int c FROM wanted')).c, POSTEN.length,
      'Die Liste hat sich verdoppelt — ON CONFLICT greift nicht');
  });

  await t.test('5. in ein FREMDES Konto lässt sich nichts importieren', async () => {
    // resolveWriteTarget prueft die RICHTUNG, nicht bloss die Mitgliedschaft.
    // „fremd" ist kein Unterkonto von „haupt" — ohne diese Pruefung schriebe
    // eine hochgeladene Datei in jedes Konto der Installation.
    const fd = new FormData();
    fd.append('file', new Blob([csvAusPosten()], { type: 'text/csv' }), 'merkliste.csv');
    fd.append('owner_user_id', String(FREMD));
    const r = await fetch(`${srv.base}/api/v1/wanted/import/csv`, { method: 'POST', body: fd });
    assert.equal(r.status, 403, `Erwartet 403, bekam ${r.status}`);
    assert.equal((await db.get('SELECT COUNT(*)::int c FROM wanted WHERE user_id=$1', [FREMD])).c, 0,
      'Das fremde Konto hat trotz Ablehnung Merkposten bekommen');

    // Gegenrichtung: in das eigene UNTERkonto darf importiert werden. Ohne
    // diesen Fall waere die Regel auch erfuellt, wenn JEDER owner_user_id
    // abgelehnt wuerde.
    const fd2 = new FormData();
    fd2.append('file', new Blob([csvAusPosten()], { type: 'text/csv' }), 'merkliste.csv');
    fd2.append('owner_user_id', String(KIND));
    const r2 = await fetch(`${srv.base}/api/v1/wanted/import/csv`, { method: 'POST', body: fd2 });
    assert.equal(r2.status, 200, `Der Import für das Unterkonto antwortete mit ${r2.status}`);
    assert.equal((await db.get('SELECT COUNT(*)::int c FROM wanted WHERE user_id=$1', [KIND])).c,
      POSTEN.length, 'Das Unterkonto hat die Liste nicht bekommen');
  });

  await t.test('6. eine Datei ohne Zustandsspalte nimmt die Vorgabe des Kontos', async () => {
    // Nicht diese Route entscheidet den Standardzustand, sondern
    // zustandOder() in utils/merkliste.ts — also die Einstellung des Kontos.
    // Geprueft wird, dass die Route ihn NICHT selbst setzt: Auf 'U' gestellt,
    // muss eine Zeile ohne Zustand als 'U' landen.
    await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1,'user_default_condition','U')
                  ON CONFLICT (user_id, key) DO UPDATE SET value='U'`, [HAUPT]);
    await db.run('DELETE FROM wanted WHERE user_id=$1', [HAUPT]);

    const fd = new FormData();
    fd.append('file', new Blob(['set_number\n21309-1\n'], { type: 'text/csv' }), 'ohne.csv');
    const r = await fetch(`${srv.base}/api/v1/wanted/import/csv`, { method: 'POST', body: fd });
    const b = await r.json();
    assert.equal(b.added, 1, `${b.added} angelegt statt 1: ${JSON.stringify(b.results)}`);
    const z = await db.get('SELECT condition FROM wanted WHERE user_id=$1 AND set_number=$2',
      [HAUPT, '21309-1']);
    assert.equal(z?.condition, 'U',
      `Der Zustand wurde „${z?.condition}" statt „U". Dann setzt die Route eine eigene ` +
      'Vorgabe statt der Einstellung des Kontos — eine zweite Wahrheit über denselben Wert.');
  });
});
