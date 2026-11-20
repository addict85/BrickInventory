/**
 * Ein manuell erfasstes Stück hat EINEN Zustand — egal, wer danach fragt.
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { manualPartsList } = _req('src/parts/queries.js');
const { readManualMinifigs } = _req('src/minifigs/queries.js');
const { valueParts, valueMinifigs } = _req('src/finanzen/financeCalc.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const { holdsMinifig, holdsPart } = require('./helpers/bestand');

const NAME = 'zustand_eine_regel';

test('manuelle Teile und Figuren: Liste und Bewertung sagen denselben Zustand', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  await db.run('INSERT INTO users (username,password_hash,is_active,email_verified) VALUES ($1,$2,true,true)', [
    NAME,
    await bcrypt.hash('x', 4),
  ]);
  const uid = (await db.get('SELECT id FROM users WHERE username=$1', [NAME])).id;

  try {
    // Die Regel: Sobald EINE Erfassung gebraucht ist, gilt das Stueck als
    // gebraucht. Ohne Erfassung gilt „Neu".
    const faelle = [
      { nr: '3001', erfassungen: [], erwartet: 'N' },
      { nr: '3002', erfassungen: ['N'], erwartet: 'N' },
      { nr: '3003', erfassungen: ['U'], erwartet: 'U' },
      { nr: '3004', erfassungen: ['N', 'U'], erwartet: 'U' },
      { nr: '3005', erfassungen: ['N', 'N'], erwartet: 'N' },
    ];
    for (const f of faelle) {
      // Name und Farbbezeichnung in die Kataloge (Migration 0034).
      await db.run(
        `INSERT INTO part_catalog (part_number,part_name) VALUES ($1,$2)
                    ON CONFLICT (part_number) DO NOTHING`,
        [f.nr, 'Teil ' + f.nr],
      );
      await db.run(
        `INSERT INTO part_color_catalog (part_number,color_id,color_name)
                    VALUES ($1,4,'Rot') ON CONFLICT (part_number,color_id) DO NOTHING`,
        [f.nr],
      );
      await holdsPart(db, uid, f.nr, { menge: 0, colorId: 4 }); // Menge 0: die Erfassung dahinter traegt sie
      await db.run(
        `INSERT INTO minifigs_catalog (fig_number,fig_name) VALUES ($1,$2)
                    ON CONFLICT (fig_number) DO NOTHING`,
        ['fig' + f.nr, 'Figur ' + f.nr],
      );
      await holdsMinifig(db, uid, 'fig' + f.nr, { menge: 0 }); // Menge 0: die Erfassung dahinter traegt sie
      // Verschiedene Tage, damit „die neueste Erfassung" eindeutig ist.
      for (const [i, z] of f.erfassungen.entries()) {
        await db.run(
          `INSERT INTO part_acquisitions (user_id,part_number,color_id,quantity,unit_price,condition,created_at)
                      VALUES ($1,$2,4,1,0.5,$3, NOW() - make_interval(days => $4))`,
          [uid, f.nr, z, f.erfassungen.length - i],
        );
        await db.run(
          `INSERT INTO minifig_acquisitions (user_id,fig_number,quantity,unit_price,condition,created_at)
                      VALUES ($1,$2,1,0.5,$3, NOW() - make_interval(days => $4))`,
          [uid, 'fig' + f.nr, z, f.erfassungen.length - i],
        );
      }
    }

    const [liste, bewertung, figList, figValuation] = await Promise.all([
      manualPartsList([uid]),
      valueParts(uid, [uid]),
      readManualMinifigs([uid]),
      valueMinifigs(uid, [uid]),
    ]);

    // Selbstbeweis: Kämen leere Listen zurück, wäre jeder Vergleich darunter
    // trivial erfüllt und der Test grün, ohne etwas geprüft zu haben.
    for (const [was, l] of [
      ['/parts/manual', liste],
      ['parts-valuation', bewertung.parts],
      ['/minifigs/manual', figList],
      ['minifigs-valuation', bewertung.parts],
    ])
      assert.equal(l.length, faelle.length, `${was}: ${l.length} statt ${faelle.length} Einträgen`);

    const zustand = (liste, schluessel, wert) => liste.find(x => x[schluessel] === wert)?.condition;

    for (const f of faelle) {
      const beschreibung =
        `Teil ${f.nr} (` + (f.erfassungen.length ? `Erfassungen ${f.erfassungen.join('+')}` : 'ohne Erfassung') + ')';

      const fromList = zustand(liste, 'part_number', f.nr);
      const fromValuation = zustand(bewertung.parts, 'part_number', f.nr);
      assert.equal(
        fromList,
        fromValuation,
        `${beschreibung}: /parts/manual sagt ${fromList}, die Bewertung sagt ${fromValuation}. ` +
          'Die Webapp liest die eine Antwort, die App die andere — dasselbe Teil ' +
          'trüge in den beiden Oberflächen verschiedene Plaketten.',
      );
      assert.equal(fromList, f.erwartet, `${beschreibung}: erwartet ${f.erwartet}, bekommen ${fromList}`);

      const figFromList = zustand(figList, 'fig_number', 'fig' + f.nr);
      const figFromValuation = zustand(figValuation.figs, 'fig_number', 'fig' + f.nr);
      assert.equal(
        figFromList,
        figFromValuation,
        `Figur fig${f.nr}: /minifigs/manual sagt ${figFromList}, die Bewertung sagt ${figFromValuation}`,
      );
      assert.equal(figFromList, f.erwartet, `Figur fig${f.nr}: erwartet ${f.erwartet}, bekommen ${figFromList}`);
    }

    // Und die Hülle der beiden Bewertungen ist gleich geformt. Das oberste
    // `condition` der Teile-Bewertung trug die PREIS-Vorgabe und stand direkt
    // neben dem `condition` je Stück, das etwas anderes meint — genau die
    // Verwechslung, aus der der Fehler oben entstand. Niemand hat es gelesen
    // (nachgesehen in beiden Clients).
    assert.deepEqual(Object.keys(bewertung).sort(), [
      'currency',
      'kaufpreise_fremde_waehrung',
      'kaufpreise_umgerechnet',
      'parts',
      'preise_ausstehend',
      'total_value',
      'wert_gesamt',
    ]);
    assert.deepEqual(Object.keys(figValuation).sort(), [
      'currency',
      'figs',
      'kaufpreise_fremde_waehrung',
      'kaufpreise_umgerechnet',
      'preise_ausstehend',
      'total_value',
      'wert_gesamt',
    ]);
  } finally {
    await db.run('DELETE FROM users WHERE username = $1', [NAME]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});

test('die App holt die manuellen Stücke aus ihrer eigenen Adresse', () => {
  // Was die App ruft, steht in shared/app-schnittstelle.json (aus ihrem Quelltext erzeugt).
  const gerufen = new Set(
    require('./helpers/vertrag')
      .appSchnittstelle()
      .routen.map(r => `${r.methode} ${r.pfad}`),
  );
  assert.ok(gerufen.has('GET /api/v1/parts/manual'), 'Die App ruft /parts/manual nicht');
  assert.ok(gerufen.has('GET /api/v1/minifigs/manual'), 'Die App ruft /minifigs/manual nicht');
});
