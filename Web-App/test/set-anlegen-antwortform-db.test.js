/**
 * Ein NEU angelegtes Set wird in beiden Erfassungs-Routen gleich beantwortet.
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// Der Nachzug nach dem Erfassen haengt an einem setTimeout und laeuft NACH
// diesem Test, gegen einen dann geschlossenen Pool. Gleiche Vorsichtsmassnahme
// wie in set-add-exists-db.test.js.
let posedAddSet = null;
let positionCalled = 0;
const Module = require('node:module');
const _realRequire = Module.prototype.require;
Module.prototype.require = function (name, ...rest) {
  const m = _realRequire.call(this, name, ...rest);
  // Gestellt wird das Anlegen; das Ergänzen im Strom ohne Netz.
  if (typeof name === 'string' && /[/\\]addSet(\.js)?$/.test(name))
    return new Proxy(m, {
      // Die Fabrik bindet beim Bau (mit()): Der Ersatz prüft die Stellung erst beim Aufruf.
      get: (t, k) => {
        if (k === 'setSupplement')
          return (sk, ...a) => (posedAddSet !== null ? Promise.resolve({ name: 'Testset' }) : t[k](sk, ...a));
        if (k !== 'setErfassen') return t[k];
        return async (sk, ...args) => {
          if (posedAddSet === null) return t[k](sk, ...args);
          positionCalled++;
          return posedAddSet(...args);
        };
      },
    });
  return m;
};

const _req = require('./helpers/sources').buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { testData } = require('./helpers/sources');
const { holdsSet } = require('./helpers/bestand');
const db = testData();

test('ein neu angelegtes Set wird in beiden Routen gleich beantwortet', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const NUTZER = `neu-form-${process.pid}`;
  const basis = 96000 + (process.pid % 900);
  const DA = `${basis}-1`; // existiert, fuer Schritt 1
  const NEW_A = `${basis + 100}-1`; // existiert nicht, fuer den Strom
  const NEW_B = `${basis + 200}-1`; // existiert nicht, fuer die Token-Route

  const aufraeumen = async () => {
    for (const sn of [DA, NEW_A, NEW_B]) {
      await db.run(`DELETE FROM sets WHERE set_number=$1`, [sn]).catch(() => {});
      await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [sn]).catch(() => {});
    }
  };

  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;
  await aufraeumen();
  await holdsSet(db, uid, DA, 0); // Menge 0: die Erfassung dahinter traegt sie
  await db.run(
    `INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                VALUES ($1,$2,10,'N',1)`,
    [uid, DA],
  );

  const { base, srv } = testServer(_req, { sitzung: { userId: uid }, t });

  try {
    // ── 1. Die Praemisse, mit der ECHTEN Funktion ────────────────────────────
    //
    // Stuende `success` schon im Ergebnis von setErfassen(), pruefte alles Weitere
    // nichts: Die Routen muessten es dann gar nicht erst hinzufuegen. Der
    // „exists"-Zweig laeuft rein auf der Datenbank und braucht kein Netz.
    const { setErfassen } = require('./helpers/sources').areaPage('sets');
    const echt = await setErfassen({ requester: uid, setNumber: DA });
    assert.equal(echt.action, 'exists', 'der Aufbau des Tests stimmt nicht mehr');
    assert.equal(
      'success' in echt,
      false,
      'setErfassen() liefert jetzt selbst ein success — dann sagt dieser Test nichts mehr ueber die Routen',
    );

    // ── 2. Der Strom: das `done`-Ereignis ───────────────────────────────────
    //
    // Gestellt wird GENAU die Form, die setErfassen() fuer ein neues Set
    // zurueckgibt.
    posedAddSet = async e => ({
      action: 'added',
      set_number: e.setNumber,
      name: 'Testset',
      katalog_offen: true,
      ergaenzung: 'ausstehend',
      besitzer: e.requester,
    });
    const vorher = positionCalled;

    const strom = await fetch(`${base}/api/v1/sets/add-stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ set_number: NEW_A, quantity: 1 }),
    });
    assert.equal(strom.status, 200);
    assert.match(
      strom.headers.get('content-type') || '',
      /text\/event-stream/,
      'fuer ein neues Set muss es der Ereignisstrom sein, nicht die JSON-Form',
    );
    const roh = await strom.text();
    assert.ok(
      positionCalled > vorher,
      'setErfassen() wurde nicht gerufen — die Stellung greift nicht, der Test prueft nichts',
    );

    const ereignisse = roh
      .split('\n')
      .filter(z => z.startsWith('data:'))
      .map(z => {
        try {
          return JSON.parse(z.slice(5).trim());
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const fertig = ereignisse.find(e => e.step === 'done');
    assert.ok(fertig, `kein done-Ereignis im Strom: ${roh}`);

    // DIE Zusicherung. `=== true` und nicht `.ok()`: Ein fehlendes Feld ist
    // `undefined` und waere mit einer weichen Pruefung durchgerutscht — genau
    // der Zustand, den Marco gemeldet hat.
    assert.equal(
      fertig.success,
      true,
      'das done-Ereignis traegt kein success:true — die Android-App bricht damit ' +
        'beim Anlegen JEDES neuen Sets ab, obwohl das Set angelegt ist',
    );
    assert.equal(fertig.action, 'added');
    assert.equal(fertig.set_number, NEW_A);

    // ── 3. Die Token-Route mit demselben Ergebnis ───────────────────────────
    const vorher2 = positionCalled;
    const token = await fetch(`${base}/api/v1/sets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ set_number: NEW_B, quantity: 1 }),
    });
    assert.equal(token.status, 200);
    const tb = await token.json();
    assert.ok(positionCalled > vorher2, 'setErfassen() wurde auf der Token-Route nicht gerufen');
    assert.equal(tb.success, true);

    // ── 4. Eine Antwort, eine Form ──────────────────────────────────────────
    //
    // Beide Wege reichen DASSELBE Ergebnis durch. Laufen ihre Formen
    // auseinander, haengt es wieder am gewaehlten Weg, ob ein Client die
    // Antwort lesen kann — und das war der Fehler.
    const felder = o =>
      Object.keys(o)
        .filter(k => k !== 'step')
        .sort();
    assert.deepEqual(
      felder(fertig),
      felder(tb),
      `Strom ${JSON.stringify(felder(fertig))} gegen Token-Route ` +
        `${JSON.stringify(felder(tb))} — dieselbe Auskunft in zwei Formen`,
    );

    // 5. Die App verlangt nichts, was der Server nicht schickt: die Pflichtfelder ihres
    // Modells (shared/app-schnittstelle.json, aus ihrem Quelltext erzeugt).
    const model = require('./helpers/vertrag').appSchnittstelle().modelle.AddSetResponse;
    assert.ok(model && model.felder.length >= 5, 'Modell AddSetResponse nicht gefunden — umbenannt?');
    const zeilen = model.felder.map(name => ({ name, pflicht: model.pflicht.includes(name) }));

    const geliefert = new Set([...Object.keys(fertig), ...Object.keys(tb)]);
    const requiredAndMissing = zeilen.filter(f => f.pflicht && !geliefert.has(f.name)).map(f => f.name);
    assert.deepEqual(
      requiredAndMissing,
      [],
      'AddSetResponse verlangt Felder, die beim Anlegen eines neuen Sets nicht ' +
        'ankommen:\n  ' +
        requiredAndMissing.join('\n  ') +
        '\nkotlinx.serialization bricht dann ab, und die App meldet einen Fehler ' +
        'fuer ein Set, das angelegt ist. Entweder schickt der Server das Feld, ' +
        'oder es bekommt einen Vorgabewert — „Feld fehlt" ist keine Aussage.',
    );
  } finally {
    posedAddSet = null;
    await aufraeumen();
    await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
