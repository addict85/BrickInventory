/**
 * Ein manuell erfasstes Stück hat EINEN Zustand — egal, wer danach fragt.
 *
 * ── Warum es diese Datei gibt ───────────────────────────────────────────────
 * Dieselbe Frage („ist dieses Teil neu oder gebraucht?") wird an zwei Stellen
 * beantwortet, und beide lagen falsch — in ENTGEGENGESETZTE Richtungen:
 *
 *   /api/v1/finance/parts-valuation   meldete JEDES Stück als gebraucht
 *   /api/v1/parts/manual              meldete ein gebrauchtes Stück als neu
 *
 * Das fiel niemandem auf, weil jede Oberfläche nur EINE der beiden liest: Die
 * Webapp nimmt ihre Liste aus /parts/manual, die Android-App aus der Bewertung
 * (PartsScreen.kt: financeState.partsValuation?.parts). Am selben Teil zeigte
 * die eine App „Neu" und die andere „Gebraucht" — und die Bewertung holte den
 * Marktpreis zum falschen Zustand, der Fehler stand also auch im Geld.
 *
 * Die Ursachen waren verschieden, die Bauart war dieselbe:
 *   • Bewertung: `stored = (p.condition === 'U') ? 'U' : DEFAULT_PRICE_CONDITION`
 *     — und die Konstante ist fest 'U'. Eine Fallunterscheidung, die keine war.
 *   • /parts/manual: Die Spaltenliste der Abfrage enthielt `condition` nicht.
 *     Der Rückfall bekam undefined. Die Schwesterfunktion für Minifiguren
 *     macht SELECT * und hatte den Fehler deshalb nie.
 *
 * ── Warum VERGLEICHEND statt je Stelle ──────────────────────────────────────
 * Eine Prüfung je Endpunkt hätte jede der beiden Fassungen für sich für
 * richtig erklären können — man muss ja wissen, was herauskommen SOLL. Der
 * Vergleich braucht das nicht: Zwei Antworten auf dieselbe Frage müssen
 * übereinstimmen, egal welche stimmt. Und die vier Fälle darunter nageln fest,
 * welche es ist.
 *
 * Voraussetzung: Test-DB (Inhalt wird angefasst!) via TEST_DATABASE_URL.
 * Ohne DB: skip. Ausführen: REQUIRE_DB=1 npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { getManualParts }    = _req('utils/handlers/parts.js');
const { getManualMinifigs } = _req('utils/handlers/minifigs.js');
const { computePartsValuation, computeMinifigsValuation } = _req('utils/financeCalc.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const NAME = 'zustand_eine_regel';

test('manuelle Teile und Figuren: Liste und Bewertung sagen denselben Zustand',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  await db.run(
    'INSERT INTO users (username,password_hash,is_active,email_verified) VALUES ($1,$2,1,1)',
    [NAME, await bcrypt.hash('x', 4)]);
  const uid = (await db.get('SELECT id FROM users WHERE username=$1', [NAME])).id;

  try {
    // Die vier Fälle, die es gibt. Ohne Erfassung zählt der gespeicherte Wert;
    // mit Erfassungen zählen die Erfassungen (eine gebrauchte genügt).
    const faelle = [
      { nr: '3001', gespeichert: 'N', erfassung: null, erwartet: 'N' },
      { nr: '3002', gespeichert: 'U', erfassung: null, erwartet: 'U' },
      { nr: '3003', gespeichert: 'N', erfassung: 'U',  erwartet: 'U' },
      { nr: '3004', gespeichert: 'U', erfassung: 'N',  erwartet: 'N' },
    ];
    for (const f of faelle) {
      await db.run(`INSERT INTO parts (user_id,part_number,part_name,color_id,color_name,quantity,source,condition)
                    VALUES ($1,$2,$3,4,'Rot',1,'manual',$4)`, [uid, f.nr, 'Teil ' + f.nr, f.gespeichert]);
      if (f.erfassung)
        await db.run(`INSERT INTO part_acquisitions (user_id,part_number,color_id,quantity,unit_price,condition)
                      VALUES ($1,$2,4,1,0.5,$3)`, [uid, f.nr, f.erfassung]);
      await db.run(`INSERT INTO minifigs (user_id,fig_number,fig_name,quantity,source,condition)
                    VALUES ($1,$2,$3,1,'manual',$4)`, [uid, 'fig' + f.nr, 'Figur ' + f.nr, f.gespeichert]);
      if (f.erfassung)
        await db.run(`INSERT INTO minifig_acquisitions (user_id,fig_number,quantity,unit_price,condition)
                      VALUES ($1,$2,1,0.5,$3)`, [uid, 'fig' + f.nr, f.erfassung]);
    }

    const [liste, bewertung, figListe, figBewertung] = await Promise.all([
      getManualParts([uid]),
      computePartsValuation(uid, [uid]),
      getManualMinifigs([uid]),
      computeMinifigsValuation(uid, [uid]),
    ]);

    // Selbstbeweis: Kämen leere Listen zurück, wäre jeder Vergleich darunter
    // trivial erfüllt und der Test grün, ohne etwas geprüft zu haben.
    for (const [was, l] of [['/parts/manual', liste], ['parts-valuation', bewertung.parts],
                            ['/minifigs/manual', figListe], ['minifigs-valuation', bewertung.parts]])
      assert.equal(l.length, faelle.length, `${was}: ${l.length} statt ${faelle.length} Einträgen`);

    const zustand = (liste, schluessel, wert) =>
      liste.find(x => x[schluessel] === wert)?.condition;

    for (const f of faelle) {
      const beschreibung = `Teil ${f.nr} (gespeichert ${f.gespeichert}` +
        (f.erfassung ? `, Erfassung ${f.erfassung}` : ', ohne Erfassung') + ')';

      const ausListe    = zustand(liste, 'part_number', f.nr);
      const ausBewertung = zustand(bewertung.parts, 'part_number', f.nr);
      assert.equal(ausListe, ausBewertung,
        `${beschreibung}: /parts/manual sagt ${ausListe}, die Bewertung sagt ${ausBewertung}. ` +
        'Die Webapp liest die eine Antwort, die App die andere — dasselbe Teil ' +
        'trüge in den beiden Oberflächen verschiedene Plaketten.');
      assert.equal(ausListe, f.erwartet, `${beschreibung}: erwartet ${f.erwartet}, bekommen ${ausListe}`);

      const figAusListe     = zustand(figListe, 'fig_number', 'fig' + f.nr);
      const figAusBewertung = zustand(figBewertung.figs, 'fig_number', 'fig' + f.nr);
      assert.equal(figAusListe, figAusBewertung,
        `Figur fig${f.nr}: /minifigs/manual sagt ${figAusListe}, die Bewertung sagt ${figAusBewertung}`);
      assert.equal(figAusListe, f.erwartet,
        `Figur fig${f.nr}: erwartet ${f.erwartet}, bekommen ${figAusListe}`);
    }

    // Und die Hülle der beiden Bewertungen ist gleich geformt. Das oberste
    // `condition` der Teile-Bewertung trug die PREIS-Vorgabe und stand direkt
    // neben dem `condition` je Stück, das etwas anderes meint — genau die
    // Verwechslung, aus der der Fehler oben entstand. Niemand hat es gelesen
    // (nachgesehen in beiden Clients).
    assert.deepEqual(Object.keys(bewertung).sort(), ['currency', 'parts', 'total_value']);
    assert.deepEqual(Object.keys(figBewertung).sort(), ['currency', 'figs', 'total_value']);
  } finally {
    await db.run('DELETE FROM users WHERE username = $1', [NAME]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
