/**
 * Ein Set, das schon im Blickfeld steht, wird beim Erfassen NICHT erhöht.
 * Ausführlich: docs/begruendungen/test/set-add-exists-db.test.js.md#kopf
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

// Der Nachzug nach dem Erfassen (src/sets/nachErfassung.ts) wird abgefangen.
// Ausführlich: docs/begruendungen/test/set-add-exists-db.test.js.md#module
const Module = require('node:module');
const _echtesRequire = Module.prototype.require;
Module.prototype.require = function (name) {
  const m = _echtesRequire.apply(this, arguments);
  if (typeof name === 'string' && /sets[/\\]nachErfassung(\.js)?$/.test(name))
    return new Proxy(m, { get: (t, k) =>
      (k === 'zieheNach' || k === 'zieheNachNeuanlage') ? () => {} : t[k] });
  return m;
};

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { haeltSet } = require('./helpers/bestand');
const db = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));

test('vorhandenes Set: Erfassen meldet exists und schreibt nichts',
  { concurrency: 1 }, async (t) => {

  if (!await dbOderSkip(t, _req)) return;

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
    await haeltSet(db, besitzer, sn, 0);  // Menge 0: die Erfassung dahinter traegt sie
    await db.run(`INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                  VALUES ($1,$2,10,'N',1)`, [besitzer, sn]);
  };
  await anlegen(hauptId, EIGEN);
  await anlegen(subId,   KIND);

  const stand = async (sn) => ({
    // Aus den Erfassungen (Migration 0036), ueber ALLE Konten — der Test
    // fragt „wie viele Exemplare gibt es insgesamt".
    menge: (await db.get(
      `SELECT COALESCE(SUM(a.quantity),0)::int AS q
         FROM set_acquisitions a
         JOIN sets s ON s.user_id = a.user_id AND s.set_number = a.set_number
        WHERE a.set_number=$1`, [sn])).q,
    acqs:  (await db.get(`SELECT COUNT(*)::int AS c FROM set_acquisitions WHERE set_number=$1`, [sn])).c,
    zeilen:(await db.get(`SELECT COUNT(*)::int AS c FROM sets WHERE set_number=$1`, [sn])).c,
  });

  const { base, srv } = testServer(_req, {
    sitzung: { userId: hauptId },
    apiNutzer: { user_id: hauptId, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' },
    t,
  });

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
                                  ['Webapp (add-stream)', '/api/v1/sets/add-stream']]) {
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
    // Fundort: src/sets/erfassen.ts, erreichbar über den Einstieg src/sets.
    const { addSet } = _req('src/sets/index.js');
    const vorImport = await stand(KIND);
    const erg = await addSet({ setNumber: KIND, menge: 1, konto: subId, zustand: 'N' });
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
  // Warum das jetzt anders geprueft wird
  // Ausführlich: docs/begruendungen/test/set-add-exists-db.test.js.md#stelle
  const { normalizeSetNumber } = _req('src/sets/erfassen.js');
  const { sanitizeSetNumber }  = _req('src/sets/setService.js');
  assert.equal(typeof sanitizeSetNumber, 'function',
    'sanitizeSetNumber ist nicht mehr exportiert — dann prueft dieser Test nichts');
  for (const eingabe of ['75192', '75192-1', ' 75192 ', '75192; irgendwas', '75192 Falcon', 'ab-12', '4002!!']) {
    assert.equal(normalizeSetNumber(eingabe), sanitizeSetNumber(eingabe),
      `Abweichung bei "${eingabe}"`);
  }
  // Und beide sagen dasselbe wie die Stelle, an der die Regel steht.
  const { normalisiereSetNummer } = _req('src/infra/setNummer.js');
  for (const eingabe of ['75192', '75192-1', ' 75192 ', '75192; irgendwas', 'ab-12', '4002!!']) {
    assert.equal(normalizeSetNumber(eingabe), normalisiereSetNummer(eingabe),
      `Abweichung zur zentralen Fassung bei "${eingabe}"`);
  }
});
