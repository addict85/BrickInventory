/**
 * Ein NEU angelegtes Set wird in beiden Erfassungs-Routen gleich beantwortet.
 *
 * ── Marcos Meldung vom 01.10. ───────────────────────────────────────────────
 *
 *   „Wenn ich ein Set mit einer Zahl hinzufügen möchte erscheint folgender
 *    Fehler in der Android-App:
 *    710-1 konnte nicht hinzugefügt werden: Field 'success' is required for
 *    type with serial name 'ch.brickinventoryapp.data.model.AddSetResponse',
 *    but it was missing at path: $"
 *
 * Das Set war angelegt. Nur meldete die App das Gegenteil und lud die Galerie
 * nicht nach — der Eintrag fehlte bis zum nächsten Start.
 *
 * ── Die Ursache: EINE Route, ZWEI Antwortformen ─────────────────────────────
 *
 * `addSet()` gibt `{action, set_number, name}` zurück, ohne `success`. Zwei
 * von drei Ausgängen wickelten das Ergebnis ein:
 *
 *   routes/api_v1/sets.ts  POST /sets        → `{ success:true, ...result }`
 *   routes/sets.ts         „schon im Blickfeld" → `{ success:true, action:'exists', … }`
 *   routes/sets.ts         `step:'done'`     → `{ step:'done', ...result }`   ← ohne
 *
 * Dieselbe Route antwortete also in zwei Formen, je nachdem ob das Set neu
 * war. Der Webapp fiel das nie auf, weil handleSseEvent() (public/js/
 * 02-gallery.js) nur `action` und `set_number` liest — ein Feld, das niemand
 * liest, kann auch niemandem fehlen.
 *
 * ── Warum der bestehende Test das nicht gefangen hat ────────────────────────
 *
 * set-add-exists-db.test.js fährt beide Routen, aber nur mit Sets, die SCHON
 * da sind — es ist der Test für genau diese Regel. Seine Konstante `NEU` wird
 * ausschliesslich für die exists-Vorabfrage benutzt, nie zum Anlegen. Der
 * Ausgang für ein wirklich neues Set war damit in keinem Test.
 *
 * ── Warum addSet() hier gestellt wird ───────────────────────────────────────
 *
 * Der Anlege-Zweig holt Stammdaten und Bild von Rebrickable. Ein Test, der
 * davon abhängt, prüft das Netz mit. Gestellt wird GENAU das, was die echte
 * Funktion für ein neues Set zurückgibt (utils/setService.ts, Ende von
 * addSetIntern) — und Schritt 1 belegt mit der ECHTEN Funktion, dass dort
 * wirklich kein `success` steht. Ohne diesen Schritt könnte die Stellung
 * stillschweigend etwas anderes behaupten als die Wirklichkeit.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

// Der Nachzug nach dem Erfassen haengt an einem setTimeout und laeuft NACH
// diesem Test, gegen einen dann geschlossenen Pool. Gleiche Vorsichtsmassnahme
// wie in set-add-exists-db.test.js.
//
// Im selben Zug wird addSet() durchgereicht oder gestellt: `null` heisst echt.
// Der Zugriff muss hier liegen und nicht spaeter, weil die Router ihr Modul
// EINMAL beim Laden holen — ein spaeteres Austauschen saehe keiner mehr.
let gestellteAddSet = null;
let stellungGerufen = 0;
const Module = require('node:module');
const _echtesRequire = Module.prototype.require;
Module.prototype.require = function (name) {
  const m = _echtesRequire.apply(this, arguments);
  if (typeof name === 'string' && /jobs[/\\]nachErfassung(\.js)?$/.test(name))
    return new Proxy(m, { get: (t, k) =>
      (k === 'zieheNach' || k === 'zieheNachNeuanlage') ? () => {} : t[k] });
  if (typeof name === 'string' && /utils[/\\]setService(\.js)?$/.test(name))
    return new Proxy(m, { get: (t, k) => {
      if (k !== 'addSet' || gestellteAddSet === null) return t[k];
      return async (...args) => { stellungGerufen++; return gestellteAddSet(...args); };
    } });
  return m;
};

const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
const { ohneKommentare } = require('./helpers/sources');
const db = _req('db/database.js');

test('ein neu angelegtes Set wird in beiden Routen gleich beantwortet',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const NUTZER = `neu-form-${process.pid}`;
  const basis = 96000 + (process.pid % 900);
  const DA    = `${basis}-1`;        // existiert, fuer Schritt 1
  const NEU_A = `${basis + 100}-1`;  // existiert nicht, fuer den Strom
  const NEU_B = `${basis + 200}-1`;  // existiert nicht, fuer die Token-Route

  const aufraeumen = async () => {
    for (const sn of [DA, NEU_A, NEU_B]) {
      await db.run(`DELETE FROM sets WHERE set_number=$1`, [sn]).catch(() => {});
      await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [sn]).catch(() => {});
    }
  };

  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;
  await aufraeumen();
  await db.run(`INSERT INTO sets (user_id, set_number, quantity) VALUES ($1,$2,1)`, [uid, DA]);
  await db.run(`INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                VALUES ($1,$2,10,'N',1)`, [uid, DA]);

  const { base, srv } = testServer(_req, {
    sitzung: { userId: uid },
    apiNutzer: { user_id: uid, is_admin: 0 },
    routen: { '/api/sets': 'routes/sets.js', '/api/v1': 'routes/api_v1/index.js' },
    t,
  });

  try {
    // ── 1. Die Praemisse, mit der ECHTEN Funktion ────────────────────────────
    //
    // Stuende `success` schon in addSet()s Ergebnis, pruefte alles Weitere
    // nichts: Die Routen muessten es dann gar nicht erst hinzufuegen. Der
    // „updated"-Zweig laeuft rein auf der Datenbank und braucht kein Netz.
    const { addSet } = _req('utils/setService.js');
    const echt = await addSet(DA, 1, uid, null, null, 'N');
    assert.equal(echt.action, 'updated', 'der Aufbau des Tests stimmt nicht mehr');
    assert.equal('success' in echt, false,
      'addSet() liefert jetzt selbst ein success — dann sagt dieser Test nichts mehr ueber die Routen');

    // ── 2. Der Strom: das `done`-Ereignis ───────────────────────────────────
    //
    // Gestellt wird GENAU die Form, die addSetIntern() fuer ein neues Set
    // zurueckgibt.
    gestellteAddSet = async (sn) => ({ action: 'added', set_number: sn, name: 'Testset' });
    const vorher = stellungGerufen;

    const strom = await fetch(`${base}/api/sets/add-stream`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ set_number: NEU_A, quantity: 1 }),
    });
    assert.equal(strom.status, 200);
    assert.match(strom.headers.get('content-type') || '', /text\/event-stream/,
      'fuer ein neues Set muss es der Ereignisstrom sein, nicht die JSON-Form');
    const roh = await strom.text();
    assert.ok(stellungGerufen > vorher,
      'addSet() wurde nicht gerufen — die Stellung greift nicht, der Test prueft nichts');

    const ereignisse = roh.split('\n')
      .filter(z => z.startsWith('data:'))
      .map(z => { try { return JSON.parse(z.slice(5).trim()); } catch { return null; } })
      .filter(Boolean);
    const fertig = ereignisse.find(e => e.step === 'done');
    assert.ok(fertig, `kein done-Ereignis im Strom: ${roh}`);

    // DIE Zusicherung. `=== true` und nicht `.ok()`: Ein fehlendes Feld ist
    // `undefined` und waere mit einer weichen Pruefung durchgerutscht — genau
    // der Zustand, den Marco gemeldet hat.
    assert.equal(fertig.success, true,
      'das done-Ereignis traegt kein success:true — die Android-App bricht damit ' +
      'beim Anlegen JEDES neuen Sets ab, obwohl das Set angelegt ist');
    assert.equal(fertig.action, 'added');
    assert.equal(fertig.set_number, NEU_A);

    // ── 3. Die Token-Route mit demselben Ergebnis ───────────────────────────
    const vorher2 = stellungGerufen;
    const token = await fetch(`${base}/api/v1/sets`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ set_number: NEU_B, quantity: 1 }),
    });
    assert.equal(token.status, 200);
    const tb = await token.json();
    assert.ok(stellungGerufen > vorher2, 'addSet() wurde auf der Token-Route nicht gerufen');
    assert.equal(tb.success, true);

    // ── 4. Eine Antwort, eine Form ──────────────────────────────────────────
    //
    // Beide Wege reichen DASSELBE Ergebnis durch. Laufen ihre Formen
    // auseinander, haengt es wieder am gewaehlten Weg, ob ein Client die
    // Antwort lesen kann — und das war der Fehler.
    const felder = o => Object.keys(o).filter(k => k !== 'step').sort();
    assert.deepEqual(felder(fertig), felder(tb),
      `Strom ${JSON.stringify(felder(fertig))} gegen Token-Route ` +
      `${JSON.stringify(felder(tb))} — dieselbe Auskunft in zwei Formen`);

    // ── 5. Die App verlangt nichts, was der Server nicht schickt ───────────
    //
    // Die GEGENRICHTUNG zur Regel in alarm-uebersicht-db.test.js. Die prueft,
    // dass jedes gelieferte Feld in der Kotlin-Klasse Platz hat — sonst kommt
    // es still als null an. Hier geht es umgekehrt: Ein Feld OHNE Vorgabewert
    // ist in kotlinx.serialization ein Pflichtfeld, und fehlt es in der
    // Antwort, bricht das Lesen mit einer Ausnahme ab. Das ist der Fehler vom
    // 01.10., nur allgemein formuliert.
    //
    // Verglichen wird gegen die ECHTEN Antworten von oben, nicht gegen eine
    // abgeschriebene Liste.
    const ktPfad = path.join(ROOT, '..', 'Android-App', 'app', 'src', 'main',
      'java', 'ch', 'brickinventoryapp', 'data', 'model', 'SetModels.kt');
    const kt = ohneKommentare(require('node:fs').readFileSync(ktPfad, 'utf8'));
    const ab = kt.indexOf('data class AddSetResponse(');
    assert.ok(ab >= 0, 'data class AddSetResponse nicht gefunden — Muster veraltet?');
    const rumpf = kt.slice(ab, kt.indexOf('\n)', ab));

    // Jede `val …`-Zeile der Klasse, mit der Angabe, ob sie einen
    // Vorgabewert traegt.
    const zeilen = [...rumpf.matchAll(/val\s+(\w+)\s*:\s*[^,\n]+/g)]
      .map(m => ({ name: m[1], pflicht: !m[0].includes('=') }));
    // Selbstnachweis gegen die stille Null: Findet die Zerlegung ueberhaupt
    // Felder? Die Zahl steht BEWUSST hier und nicht auf der Pflichtliste —
    // dass die LEER ist, ist das Ziel dieser Regel und darf sie nicht
    // entschaerfen.
    assert.ok(zeilen.length >= 5,
      `Nur ${zeilen.length} Felder in AddSetResponse erkannt — Zerlegung veraltet?`);

    const camel = k => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const geliefert = new Set([...Object.keys(fertig), ...Object.keys(tb)].map(camel));
    const verlangtUndFehlt = zeilen
      .filter(f => f.pflicht && !geliefert.has(f.name))
      .map(f => f.name);
    assert.deepEqual(verlangtUndFehlt, [],
      'AddSetResponse verlangt Felder, die beim Anlegen eines neuen Sets nicht ' +
      'ankommen:\n  ' + verlangtUndFehlt.join('\n  ') +
      '\nkotlinx.serialization bricht dann ab, und die App meldet einen Fehler ' +
      'fuer ein Set, das angelegt ist. Entweder schickt der Server das Feld, ' +
      'oder es bekommt einen Vorgabewert — „Feld fehlt" ist keine Aussage.');
  } finally {
    gestellteAddSet = null;
    await aufraeumen();
    await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
