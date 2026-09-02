/**
 * Ein Set, das schon im Blickfeld steht, wird beim Erfassen NICHT erhöht.
 *
 * ── Marcos Festlegung ───────────────────────────────────────────────────────
 * „Besitzt der Account oder einer der Unteraccounts das Set bereits, soll sich
 * nur der Detail-Dialog des Sets öffnen. Egal ob die Erfassung via
 * Barcodescanner, OCR oder per Nummer-Erfassung erfolgt."
 *
 * Vorher hing das am Client: Die App prüfte selbst vor dem Anlegen, die Webapp
 * gar nicht — dort erhöhte der Server still die Menge und meldete
 * „aktualisiert". Dieselbe Eingabe, zwei Ausgänge.
 *
 * Jetzt entscheidet utils/setAdd.ts, und beide Erfassungs-Routen fragen es.
 * Der Test prüft die WIRKUNG, nicht den Wortlaut: Nach dem Aufruf muss die
 * Menge unverändert sein und keine neue Erfassung entstanden sein — genau das
 * würde ein Rückfall auf das alte Verhalten verletzen, auch wenn die Antwort
 * weiterhin `success: true` sagt.
 *
 * ── Die Ausnahme, die mitgeprüft wird ───────────────────────────────────────
 * Der CSV-Import ruft addSet() direkt und soll weiterhin zusammenfassen. Wer
 * 500 Zeilen einliest, will keine 500 Rückfragen. Ohne diesen Teilschritt
 * würde ein späterer Umbau die Regel womöglich in addSet() selbst schieben und
 * den Import dabei stillschweigend lahmlegen.
 *
 * Gegenprobe (durchgeführt): den findSetInScope-Zweig aus routes/api_v1/sets.ts
 * entfernt → der erste Teilschritt wird rot (Menge 1 → 2).
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL (Migrationen für account_links).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

// Der Nachzug nach dem Erfassen (jobs/nachErfassung.ts) wird abgefangen.
//
// Er haengt an einem setTimeout von zwei bis fuenf Sekunden und laeuft damit
// NACH diesem Test — gegen einen dann geschlossenen Verbindungspool:
//   [weiter-trotz-fehler] instr-queue:trigger: Cannot use a pool after ...
// Sichtbar war nur dieser eine Schritt, weil nur er protokolliert; die
// uebrigen sechs schluckten ihren Fehler und liefen genauso ins Leere.
const Module = require('node:module');
const _echtesRequire = Module.prototype.require;
Module.prototype.require = function (name) {
  const m = _echtesRequire.apply(this, arguments);
  if (typeof name === 'string' && /jobs[/\\]nachErfassung(\.js)?$/.test(name))
    return new Proxy(m, { get: (t, k) =>
      (k === 'zieheNach' || k === 'zieheNachNeuanlage') ? () => {} : t[k] });
  return m;
};

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));

test('vorhandenes Set: Erfassen meldet exists und schreibt nichts',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const HAUPT = `ex-haupt-${process.pid}`, SUB = `ex-sub-${process.pid}`;
  // Endung bewusst „-1": sanitizeSetNumber() hängt an eine Nummer OHNE Suffix
  // immer „-1" an. Ein Set 97001-42 wäre über die blosse Eingabe „97001" also
  // gar nicht auffindbar — das ist die bestehende Regel des Projekts und nicht
  // Gegenstand dieses Tests. Teilschritt 2 prüft die Normalisierung deshalb an
  // Nummern, für die sie überhaupt greifen kann.
  const basis = 97000 + (process.pid % 900);
  const EIGEN = `${basis}-1`;       // gehört dem Hauptkonto
  const KIND  = `${basis + 1000}-1`; // gehört dem Unterkonto
  const NEU   = `${basis + 2000}-1`; // gibt es nirgends

  const aufraeumen = async () => {
    for (const sn of [EIGEN, KIND, NEU]) {
      await db.run(`DELETE FROM sets WHERE set_number=$1`, [sn]).catch(() => {});
      await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [sn]).catch(() => {});
    }
  };

  await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [HAUPT, SUB]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x'),($2,'x')`, [HAUPT, SUB]);
  const hauptId = (await db.get(`SELECT id FROM users WHERE username=$1`, [HAUPT])).id;
  const subId   = (await db.get(`SELECT id FROM users WHERE username=$1`, [SUB])).id;
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
               [hauptId, subId]);
  await aufraeumen();

  const anlegen = async (besitzer, sn) => {
    await db.run(`INSERT INTO sets (user_id,set_number,name,quantity) VALUES ($1,$2,'T',1)`, [besitzer, sn]);
    await db.run(`INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                  VALUES ($1,$2,10,'N',1)`, [besitzer, sn]);
  };
  await anlegen(hauptId, EIGEN);
  await anlegen(subId,   KIND);

  const stand = async (sn) => ({
    menge: (await db.get(`SELECT COALESCE(SUM(quantity),0)::int AS q FROM sets WHERE set_number=$1`, [sn])).q,
    acqs:  (await db.get(`SELECT COUNT(*)::int AS c FROM set_acquisitions WHERE set_number=$1`, [sn])).c,
    zeilen:(await db.get(`SELECT COUNT(*)::int AS c FROM sets WHERE set_number=$1`, [sn])).c,
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: hauptId };
    req.apiUser = { user_id: hauptId, is_admin: 0 };
    next();
  });
  app.use('/api/sets', _req('routes/sets.js'));
  app.use('/api/v1',   _req('routes/api_v1/index.js'));
  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}`;

  const erfassen = async (pfad, sn) => {
    const r = await fetch(base + pfad, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ set_number: sn, quantity: 1 }),
    });
    return { status: r.status, typ: r.headers.get('content-type') || '', body: await r.json().catch(() => null) };
  };

  try {
    // 1. EIGENES Set und Set des UNTERKONTOS — beide Wege, beide Sets.
    for (const [wer, sn] of [['eigenes', EIGEN], ['Unterkonto', KIND]]) {
      for (const [name, pfad] of [['Android/Webapp (v1)', '/api/v1/sets'],
                                  ['Webapp (add-stream)', '/api/sets/add-stream']]) {
        const vor = await stand(sn);
        const r = await erfassen(pfad, sn);
        assert.equal(r.status, 200, `${wer}/${name}: ${r.status}`);
        assert.equal(r.body?.action, 'exists',
          `${wer}/${name}: erwartet action=exists, war ${JSON.stringify(r.body)}`);
        assert.match(r.typ, /application\/json/,
          `${wer}/${name}: die Antwort muss gewöhnliches JSON sein — es gibt nichts zu verfolgen`);
        const nach = await stand(sn);
        assert.deepEqual(nach, vor,
          `${wer}/${name}: es wurde geschrieben, obwohl das Set schon da ist`);
      }
    }

    // 2. Die Nummer wird VOR der Prüfung normalisiert — sonst gälte "97001"
    //    als neu, obwohl "97001-1" längst existiert, und genau daran hängt
    //    die ganze Regel.
    const ohneSuffix = EIGEN.replace(/-\d+$/, '');
    const vor = await stand(EIGEN);
    const r = await erfassen('/api/v1/sets', ohneSuffix);
    assert.equal(r.body?.action, 'exists',
      'ohne Suffix eingegeben muss dasselbe Set erkannt werden');
    assert.deepEqual(await stand(EIGEN), vor);

    // 3. Die Vorabfrage sagt dasselbe wie das Erfassen — sonst könnte der
    //    Scanner einen Zwischendialog zeigen für ein Set, das danach als
    //    „schon vorhanden" abgewiesen wird.
    for (const [sn, erwartet] of [[EIGEN, true], [KIND, true], [NEU, false], [ohneSuffix, true]]) {
      const e = await (await fetch(`${base}/api/v1/sets/exists/${encodeURIComponent(sn)}`)).json();
      assert.equal(e.exists, erwartet, `exists für ${sn}`);
      if (erwartet) assert.ok(e.owner_user_id > 0, `Besitzer fehlt für ${sn}`);
    }
    // Das eigene Konto gewinnt, wenn beide dasselbe Set haben.
    await anlegen(subId, EIGEN);
    const beide = await (await fetch(`${base}/api/v1/sets/exists/${EIGEN}`)).json();
    assert.equal(beide.owner_user_id, hauptId,
      'bei zwei Besitzern muss die eigene Zeile gewinnen — die Detailansicht soll die eigene zeigen');
    assert.equal(beide.is_self, true);

    // 4. AUSNAHME: Der CSV-Import ruft addSet() direkt und fasst weiterhin
    //    zusammen. Die Regel darf nicht dort hineingerutscht sein.
    // Fundort seit Nachtrag 131: utils/setService.js.
    const { addSet } = _req('utils/setService.js');
    const vorImport = await stand(KIND);
    const erg = await addSet(KIND, 1, subId, null, null, 'N');
    assert.equal(erg.action, 'updated',
      'addSet() selbst muss weiterhin zusammenfassen — sonst steht der CSV-Import still');
    assert.equal((await stand(KIND)).menge, vorImport.menge + 1);
  } finally {
    await aufraeumen();
    await db.run(`DELETE FROM account_links WHERE main_user_id=$1`, [hauptId]).catch(() => {});
    await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [HAUPT, SUB]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});

test('normalizeSetNumber stimmt mit sanitizeSetNumber überein', () => {
  // Die beiden Fassungen stehen absichtlich getrennt (ein Import aus
  // routes/sets.ts baute einen Kreis). Weichen sie ab, prüft die Regel eine
  // ANDERE Nummer als die, die danach geschrieben wird — und das Set landet
  // trotz Prüfung doppelt.
  const fs = require('node:fs');
  const { normalizeSetNumber } = _req('utils/setAdd.js');
  const setsSrc = require('./helpers/sources').setKernQuelle();
  // funktionsRumpf() statt eigener Extraktion: Der frühere Anker trug den
  // Parameternamen mit ('...(input) {') und zerbrach an der Typannotation —
  // OHNE es zu melden. Der Helfer sucht nur `function name(` und wirft, wenn
  // er nichts findet.
  const sanitize = new Function('input',
    require('./helpers/sources').funktionsRumpf(setsSrc, 'sanitizeSetNumber'));
  for (const eingabe of ['75192', '75192-1', ' 75192 ', '75192; irgendwas', '75192 Falcon', 'ab-12', '4002!!']) {
    assert.equal(normalizeSetNumber(eingabe), sanitize(eingabe),
      `Abweichung bei "${eingabe}"`);
  }
});
