/**
 * Ein manuell erfasstes Stück hat EINEN Zustand — egal, wer danach fragt.
 */
// Abgleich Web↔App: läuft in web-ci auch bei Änderungen unter Android-App/ (paths-Filter).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');
const { getManualParts }    = _req('src/teile/abfragen.js');
const { getManualMinifigs } = _req('src/figuren/abfragen.js');
const { computePartsValuation, computeMinifigsValuation } = _req('src/finanzen/financeCalc.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const { haeltFigur, haeltTeil } = require('./helpers/bestand');

const NAME = 'zustand_eine_regel';

test('manuelle Teile und Figuren: Liste und Bewertung sagen denselben Zustand',
  { concurrency: 1 }, async (t) => {

  if (!await dbOderSkip(t, _req)) return;

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  await db.run(
    'INSERT INTO users (username,password_hash,is_active,email_verified) VALUES ($1,$2,true,true)',
    [NAME, await bcrypt.hash('x', 4)]);
  const uid = (await db.get('SELECT id FROM users WHERE username=$1', [NAME])).id;

  try {
    // Die Regel: Sobald EINE Erfassung gebraucht ist, gilt das Stueck als
    // gebraucht. Ohne Erfassung gilt „Neu".
    const faelle = [
      { nr: '3001', erfassungen: [],         erwartet: 'N' },
      { nr: '3002', erfassungen: ['N'],      erwartet: 'N' },
      { nr: '3003', erfassungen: ['U'],      erwartet: 'U' },
      { nr: '3004', erfassungen: ['N', 'U'], erwartet: 'U' },
      { nr: '3005', erfassungen: ['N', 'N'], erwartet: 'N' },
    ];
    for (const f of faelle) {
      // Name und Farbbezeichnung in die Kataloge (Migration 0034).
      await db.run(`INSERT INTO part_catalog (part_number,part_name) VALUES ($1,$2)
                    ON CONFLICT (part_number) DO NOTHING`, [f.nr, 'Teil ' + f.nr]);
      await db.run(`INSERT INTO part_color_catalog (part_number,color_id,color_name)
                    VALUES ($1,4,'Rot') ON CONFLICT (part_number,color_id) DO NOTHING`, [f.nr]);
      await haeltTeil(db, uid, f.nr, { menge: 0, colorId: 4 });  // Menge 0: die Erfassung dahinter traegt sie
      await db.run(`INSERT INTO minifigs_catalog (fig_number,fig_name) VALUES ($1,$2)
                    ON CONFLICT (fig_number) DO NOTHING`, ['fig' + f.nr, 'Figur ' + f.nr]);
      await haeltFigur(db, uid, 'fig' + f.nr, { menge: 0 });  // Menge 0: die Erfassung dahinter traegt sie
      // Verschiedene Tage, damit „die neueste Erfassung" eindeutig ist.
      for (const [i, z] of f.erfassungen.entries()) {
        await db.run(`INSERT INTO part_acquisitions (user_id,part_number,color_id,quantity,unit_price,condition,created_at)
                      VALUES ($1,$2,4,1,0.5,$3, NOW() - make_interval(days => $4))`,
                     [uid, f.nr, z, f.erfassungen.length - i]);
        await db.run(`INSERT INTO minifig_acquisitions (user_id,fig_number,quantity,unit_price,condition,created_at)
                      VALUES ($1,$2,1,0.5,$3, NOW() - make_interval(days => $4))`,
                     [uid, 'fig' + f.nr, z, f.erfassungen.length - i]);
      }
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
      const beschreibung = `Teil ${f.nr} (` +
        (f.erfassungen.length ? `Erfassungen ${f.erfassungen.join('+')}` : 'ohne Erfassung') + ')';

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
    assert.deepEqual(Object.keys(bewertung).sort(), ['currency', 'kaufpreise_fremde_waehrung', 'kaufpreise_umgerechnet', 'parts', 'preise_ausstehend', 'total_value', 'wert_gesamt']);
    assert.deepEqual(Object.keys(figBewertung).sort(), ['currency', 'figs', 'kaufpreise_fremde_waehrung', 'kaufpreise_umgerechnet', 'preise_ausstehend', 'total_value', 'wert_gesamt']);
  } finally {
    await db.run('DELETE FROM users WHERE username = $1', [NAME]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});

test('beide Oberflaechen holen die manuellen Stuecke aus derselben Adresse', () => {
  // Der Befund
  const fs = require('node:fs');
  const path = require('node:path');
  const kotlin = [];
  const gehen = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) gehen(abs);
      else if (e.name.endsWith('.kt')) kotlin.push(abs);
    }
  };
  for (const w of require('./helpers/android').quellwurzeln()) gehen(w);
  // Selbstnachweis: Faende die Suche nichts, waere die Regel leer wahr.
  assert.ok(kotlin.length >= 40, `Nur ${kotlin.length} App-Quellen gefunden`);

  // FinanceSections.kt ist ausgenommen: Der Finanz-Reiter zeigt die BEWERTUNG
  // — dort gehoert partsValuation hin. Verboten ist, die LISTE der manuellen
  // Stuecke daraus zu nehmen.
  const quelle = kotlin.filter(f => !f.endsWith('FinanceSections.kt'))
    .map(f => fs.readFileSync(f, 'utf8')).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

  assert.match(quelle, /api\/v1\/parts\/manual/,
    'Die App ruft /parts/manual nicht — dann hat die Liste wieder zwei Quellen');
  assert.match(quelle, /api\/v1\/minifigs\/manual/,
    'Die App ruft /minifigs/manual nicht');
  // Und sie nimmt die Liste NICHT mehr aus der Bewertung.
  assert.doesNotMatch(quelle, /partsValuation\?\.parts/,
    'Die manuellen Teile kommen wieder aus der Bewertung statt aus ihrer eigenen Adresse');
  assert.doesNotMatch(quelle, /figsValuation\?\.figs/,
    'Die manuellen Figuren kommen wieder aus der Bewertung');
});
