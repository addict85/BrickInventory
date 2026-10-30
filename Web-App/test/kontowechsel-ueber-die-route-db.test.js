/**
 * Der Kontowechsel einer Erfassung — über die ROUTE, nicht über ein Muster.
 *
 * ── Warum es diese Datei gibt ───────────────────────────────────────────────
 *
 * An EINEM Tag sind zwei Fehler durchgerutscht, und beide hatten dieselbe
 * Form: Eine Prüfung las den QUELLTEXT und bestand, während die Funktion das
 * Falsche tat.
 *
 *   1. Der Lagerortfilter der Set-Liste. Die Route zerlegte req.query in eine
 *      Auswahl ohne `storage`; der Filter kam nie an. Geprüft war, dass
 *      getSets() den Filter BAUT — nicht, dass die Route ihn WEITERREICHT.
 *   2. moveManualAcquisition() löschte beim Absender alles, weil es eine
 *      Spalte las, die Migration 0038 entfernt hat. Geprüft war, dass der
 *      Endpunkt die Funktion RUFT — nicht, was sie tut.
 *
 * Die Regel dahinter ist nicht „Quelltextprüfungen sind schlecht". Viele sind
 * das einzig Mögliche: „hier darf kein `s.*` stehen", „diese entfernte
 * Anweisung darf nicht zurückkommen", „beide Clients nutzen DIESELBE
 * Umsetzung". Die Regel ist enger:
 *
 *     Eine Behauptung der Form „der Weg A → B lebt" braucht einen Lauf über
 *     diesen Weg. Ein Muster, das den Aufruf im Quelltext findet, beweist nur,
 *     dass jemand ihn hingeschrieben hat.
 *
 * ── Was hier läuft ─────────────────────────────────────────────────────────
 *
 * Die drei Arten gehen durch DENSELBEN Dienst (utils/dienste/erfassungen.ts) und
 * dieselbe Umsetzung (moveManualAcquisition bzw. moveSetBetweenAccounts).
 * Geprüft werden alle drei über ihre echten Adressen, dazu die beiden
 * Abweisungen, die bisher nur als Muster zugesichert waren:
 *
 *   PUT /api/v1/sets/:sn/acquisitions/:id
 *   PUT /api/v1/parts/:nr/:farbe/acquisitions/:id
 *   PUT /api/v1/minifigs/:nr/acquisitions/:id
 *
 * Die Mengenerhaltung beim TEILE-Weg steht in
 * test/erfassung-verschieben-rest-bleibt-db.test.js — hier geht es um den
 * Weg selbst und um die Arten daneben.
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
const { haeltSet } = require('./helpers/bestand');

test.after(async () => { await db.pool.end().catch(() => {}); });

const SN = '75192-1';
let HAUPT = 0, KIND = 0, FREMD = 0;

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
  // Nur haupt+kind sind ein Haushalt. `fremd` steht bewusst daneben — ohne
  // ihn liesse sich „403 fuer ein fremdes Konto" nicht pruefen.
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2)`,
    [HAUPT, KIND]);

  await db.run(`INSERT INTO set_catalog (set_number,name) VALUES ($1,'Millennium Falcon')
                ON CONFLICT (set_number) DO NOTHING`, [SN]);
  await db.run(`INSERT INTO part_catalog (part_number,part_name) VALUES ('3001','Brick 2x4')
                ON CONFLICT (part_number) DO NOTHING`);
  await db.run(`INSERT INTO part_color_catalog (part_number,color_id,color_name)
                VALUES ('3001',4,'Rot') ON CONFLICT (part_number,color_id) DO NOTHING`);
  await db.run(`INSERT INTO minifigs_catalog (fig_number,fig_name) VALUES ('sw0001','Han Solo')
                ON CONFLICT (fig_number) DO NOTHING`);

  // Set mit einer Erfassung beim Hauptkonto.
  await haeltSet(db, HAUPT, SN, 2, { preis: 100 });
  // Manuelles Teil und manuelle Figur, je eine Erfassung.
  await db.run(`INSERT INTO parts (user_id,part_number,color_id,source)
                VALUES ($1,'3001',4,'manual')`, [HAUPT]);
  await db.run(`INSERT INTO part_acquisitions
                  (user_id,part_number,color_id,quantity,unit_price,condition)
                VALUES ($1,'3001',4,4,0.50,'N')`, [HAUPT]);
  await db.run(`INSERT INTO minifigs (user_id,fig_number,source)
                VALUES ($1,'sw0001','manual')`, [HAUPT]);
  await db.run(`INSERT INTO minifig_acquisitions
                  (user_id,fig_number,quantity,unit_price,condition)
                VALUES ($1,'sw0001',3,12.00,'N')`, [HAUPT]);
}

test('eine Erfassung wechselt das Konto — alle drei Arten über ihre Route',
  { concurrency: 1 }, async (t) => {
  try { await db.get('SELECT 1'); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  await aufbau();

  const { base } = testServer(_req, {
    sitzung: { userId: HAUPT },
    apiNutzer: { user_id: HAUPT, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' },
    t,
  });
  const setze = async (pfad, koerper) => {
    const r = await fetch(base + pfad, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(koerper),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const erfassungId = async (tab, feld, wert) => (await db.get(
    `SELECT id FROM ${tab} WHERE ${feld} = $1 ORDER BY id LIMIT 1`, [wert])).id;
  const besitzer = async (tab, feld, wert) => (await db.all(
    `SELECT user_id FROM ${tab} WHERE ${feld} = $1 ORDER BY user_id`, [wert]))
    .map(r => Number(r.user_id));

  await t.test('Set: die Erfassung UND die Bestandszeile sind danach beim Kind', async () => {
    const id = await erfassungId('set_acquisitions', 'set_number', SN);
    const a = await setze(`/api/v1/sets/${SN}/acquisitions/${id}`, { owner_user_id: KIND });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.deepEqual(await besitzer('set_acquisitions', 'set_number', SN), [KIND],
      'Die Erfassung ist nicht beim Kind gelandet');
    assert.ok((await besitzer('sets', 'set_number', SN)).includes(KIND),
      'Das Kind hat keine Bestandszeile bekommen — die Erfassung haengt dann in der Luft');
    // Und der Absender haelt es nicht mehr: Es war seine einzige Erfassung.
    assert.ok(!(await besitzer('sets', 'set_number', SN)).includes(HAUPT),
      'Beim Absender ist die leere Set-Zeile stehengeblieben');
  });

  await t.test('Teil: dieselbe Fabrik, andere Adresse', async () => {
    const id = await erfassungId('part_acquisitions', 'part_number', '3001');
    const a = await setze(`/api/v1/parts/3001/4/acquisitions/${id}`, { owner_user_id: KIND });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.deepEqual(await besitzer('part_acquisitions', 'part_number', '3001'), [KIND]);
    assert.deepEqual(await besitzer('parts', 'part_number', '3001'), [KIND],
      'Die Bestandszeile ist nicht mitgewandert');
  });

  await t.test('Figur: der dritte Zweig, und er wird sonst nirgends ausgeführt', async () => {
    // Bis hierher war fuer die Figuren NUR zugesichert, dass der Quelltext
    // `moveManualAcquisition(tx, 'fig'` enthaelt. Genau diese Art Zusicherung
    // hat heute zweimal bestanden, waehrend der Weg kaputt war.
    const id = await erfassungId('minifig_acquisitions', 'fig_number', 'sw0001');
    const a = await setze(`/api/v1/minifigs/sw0001/acquisitions/${id}`, { owner_user_id: KIND });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.deepEqual(await besitzer('minifig_acquisitions', 'fig_number', 'sw0001'), [KIND]);
    assert.deepEqual(await besitzer('minifigs', 'fig_number', 'sw0001'), [KIND],
      'Die Bestandszeile der Figur ist nicht mitgewandert');
  });

  await t.test('ein Konto AUSSERHALB des Haushalts wird mit 403 abgewiesen', async () => {
    // Bisher ein Muster: /if \(to === null\)\s*\n\s*return sendeFehler\(req, res, 403/.
    // Das faengt eine geloeschte Zeile — nicht eine Bedingung, die nie
    // zutrifft, oder ein resolveWriteTarget(), das zu viel erlaubt.
    await aufbau();
    const id = await erfassungId('part_acquisitions', 'part_number', '3001');
    const a = await setze(`/api/v1/parts/3001/4/acquisitions/${id}`, { owner_user_id: FREMD });
    assert.equal(a.status, 403,
      `Erwartet 403, bekam ${a.status}: ${JSON.stringify(a.body)}. Ein Konto ausserhalb ` +
      'des Haushalts darf nichts bekommen — und schon gar nicht stillschweigend das ' +
      'eigene Konto behalten.');
    // Und NICHTS ist angefasst. Ohne diese Haelfte waere der Fall auch gruen,
    // wenn die Route erst verschoebe und dann 403 antwortete.
    assert.deepEqual(await besitzer('part_acquisitions', 'part_number', '3001'), [HAUPT],
      'Trotz 403 ist die Erfassung gewandert');
    assert.deepEqual(await besitzer('parts', 'part_number', '3001'), [HAUPT],
      'Trotz 403 ist die Bestandszeile gewandert');
  });

  await t.test('dasselbe Konto heisst „nichts zu tun", nicht „Fehler"', async () => {
    // Der Weg daneben: Wer auf sein eigenes Konto schiebt, bekommt 200 und
    // `unchanged`. Ohne diesen Fall koennte die Route jeden Wechsel ablehnen
    // und der 403-Fall darueber waere trotzdem gruen.
    const id = await erfassungId('part_acquisitions', 'part_number', '3001');
    const a = await setze(`/api/v1/parts/3001/4/acquisitions/${id}`, { owner_user_id: HAUPT });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body?.unchanged, true,
      'Ein Wechsel auf das eigene Konto muss als „unveraendert" antworten');
    assert.deepEqual(await besitzer('part_acquisitions', 'part_number', '3001'), [HAUPT]);
  });
});
