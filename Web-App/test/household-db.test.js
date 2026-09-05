/**
 * Haushalt gegen eine ECHTE Datenbank.
 *
 * test/household.test.js prüft die Regeln am Quelltext — das fängt
 * Doppelungen und vergessene Aufrufe, sagt aber nichts darüber, ob die
 * Abfragen tun, was sie sollen. Genau da liegen die Fehler, die man sonst erst
 * im Betrieb sieht: eine Gruppierung, die Konten statt Teile zählt, ein
 * Parameter, der als Liste ankommt, wo Postgres eine Zahl erwartet.
 *
 * Aufbau wie test/api-parity.test.js: echtes Schema, echte Handler, echte
 * Abfragen. Nichts gestubbt.
 *
 * Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL,
 * Default postgres://tester:test@localhost/cattest. Ohne DB: skip.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));

/**
 * Die ECHTE Verschiebe-Route aufrufen — mit injizierter Session, wie in
 * test/api-parity.test.js. Der Weg über die Route ist der Punkt: Rechteprüfung,
 * Sperre und Verschmelzen laufen nur dort zusammen; sie im Test nachzubauen
 * hiesse, etwas anderes zu prüfen als das, was im Betrieb läuft.
 */
let _srv, _base;
async function startApi() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { userId: _actingAs }; next(); });
  app.use('/api/sets', _req('routes/sets.js'));
  // Die Erfassungs-Routen liegen seit Nachtrag 70 nur noch in der gemeinsamen
  // Fabrik — eine Adresse für Webapp UND App.
  app.use('/api/v1', _req('routes/api_v1/index.js'));
  _srv = app.listen(0);
  _base = `http://localhost:${_srv.address().port}`;
}
let _actingAs = null;
async function apiGet(actor, path) {
  _actingAs = actor;
  const r = await fetch(_base + path);
  return { status: r.status, body: await r.json().catch(() => null) };
}
/**
 * Verschieben geht NUR über die Kaufpreise: acquisition_ids ist Pflicht.
 * Ohne Angabe holt dieser Helfer alle Zeilen des Absenders — „das ganze Set"
 * heisst jetzt „alle seine Kaufpreise", und genau so soll es auch in der
 * Oberfläche aussehen.
 */
async function moveSet(actor, sn, fromId, toId, acquisitionIds) {
  _actingAs = actor;
  const ids = acquisitionIds ?? (await db.all(
    'SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number=$2', [fromId, sn]
  )).map(r => r.id);
  const r = await fetch(`${_base}/api/v1/sets/${sn}/move`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from_user_id: fromId, to_user_id: toId, acquisition_ids: ids }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function dbReachable() {
  try { await db.get('SELECT 1 AS ok'); return true; } catch { return false; }
}

const U = {};   // eltern, kindA, kindB, fremd

async function seed() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  // initSchema() legt nur die Grundtabellen an; account_links und
  // account_link_invites kommen aus db/migrations/0005. Ohne diesen Schritt
  // liefe der Test gegen ein Schema, das es im Betrieb nicht gibt.
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); }
  finally { client.release(); }

  for (const name of ['eltern', 'kindA', 'kindB', 'fremd']) {
    await db.run(`INSERT INTO users (username, password_hash) VALUES ($1,'x')`, [name]);
    U[name] = (await db.get('SELECT id FROM users WHERE username=$1', [name])).id;
  }
  // Alle in derselben Währung — sonst lehnt das Verknüpfen ab (eigener Test).
  for (const id of Object.values(U)) {
    await db.run(`INSERT INTO user_settings (user_id,key,value) VALUES ($1,'currency','CHF')
                  ON CONFLICT (user_id,key) DO UPDATE SET value='CHF'`, [id]);
  }
}

/** Set + Erfassung für ein Konto anlegen. */
async function giveSet(uid, sn, qty, price, cond = 'N', day = null) {
  await db.run(
    `INSERT INTO sets (user_id, set_number, name, year, quantity, condition)
     VALUES ($1,$2,$3,2020,$4,$5)
     ON CONFLICT (user_id, set_number) DO UPDATE SET quantity = sets.quantity + $4`,
    [uid, sn, 'Set ' + sn, qty, cond]);
  await _req('utils/acquisitions.js').recordAcquisitionForDay('set', uid, [sn], {
    quantity: qty, price, condition: cond, createdAt: day,
  });
}

test('Haushalt gegen echte Datenbank', async (t) => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    // REQUIRE_DB=1 (CI) verbietet das Überspringen — sonst wäre ausgerechnet
    // die Suite grün, die am meisten absichert. Gleiche Regel wie in
    // test/api-parity.test.js.
    if (process.env.REQUIRE_DB === '1') {
      throw new Error('REQUIRE_DB=1, aber die Test-Datenbank ist nicht erreichbar.');
    }
    t.skip('Test-DB nicht erreichbar — Suite übersprungen');
    return;
  }
  await seed();
  await startApi();

  const household = _req('utils/household.js');
  const handlers  = require('./helpers/sources').handlerModul(_req);

  await t.test('Verknüpfen braucht beide Seiten und dieselbe Währung', async () => {
    const inv = await household.createInvite(U.eltern);
    assert.ok(inv.code, 'kein Code erzeugt');

    // Andere Währung → Ablehnung, und der Code bleibt benutzbar.
    await db.run(`UPDATE user_settings SET value='EUR' WHERE user_id=$1 AND key='currency'`, [U.kindA]);
    const bad = await household.redeemInvite(U.kindA, inv.code);
    // Auf den CODE statt auf den deutschen Satz (Nachtrag 130): Der Server
    // antwortet jetzt in der Sprache des Anfragenden, und ein Test, der die
    // Formulierung festhält, verbietet jede Übersetzung.
    assert.equal(bad.code, 'waehrung_ungleich', 'Währungsprüfung greift nicht');

    await db.run(`UPDATE user_settings SET value='CHF' WHERE user_id=$1 AND key='currency'`, [U.kindA]);
    const ok = await household.redeemInvite(U.kindA, inv.code);
    assert.equal(ok.code, undefined, `Einlösen scheiterte: ${ok.code}`);
    assert.equal(ok.linked_to.id, U.eltern);

    // Zweite Einlösung desselben Codes muss scheitern.
    const again = await household.redeemInvite(U.kindB, inv.code);
    // Auf den CODE (Nachtrag 130): redeemInvite liefert den Grund als
    // Schlüssel, den Satz baut erst die Route in der Sprache des Anfragenden.
    assert.match(again.code || '', /einladungscode/, 'Code war mehrfach einlösbar');

    const inv2 = await household.createInvite(U.eltern);
    assert.equal((await household.redeemInvite(U.kindB, inv2.code)).code, undefined);
  });

  await t.test('Blickfeld und Kontofilter', async () => {
    const all  = await household.scopeIds(U.eltern, 'all');
    const own  = await household.scopeIds(U.eltern, 'own');
    const subs = await household.scopeIds(U.eltern, 'subs');
    assert.deepEqual([...all].sort((a,b)=>a-b), [U.eltern, U.kindA, U.kindB].sort((a,b)=>a-b));
    assert.deepEqual(own, [U.eltern]);
    assert.deepEqual([...subs].sort((a,b)=>a-b), [U.kindA, U.kindB].sort((a,b)=>a-b));

    // Ein Kind sieht nur sich — auch wenn es 'all' fragt.
    assert.deepEqual(await household.scopeIds(U.kindA, 'all'), [U.kindA]);
    assert.deepEqual(await household.scopeIds(U.kindA, 'subs'), [U.kindA]);

    // Schreiben: nur die Richtung Eltern → eigenes Kind.
    assert.equal(await household.canWriteFor(U.eltern, U.kindA), true);
    assert.equal(await household.canWriteFor(U.kindA, U.kindB), false, 'Geschwister dürfen nicht');
    assert.equal(await household.canWriteFor(U.kindA, U.eltern), false, 'Kind darf nicht ins Elternkonto');
    assert.equal(await household.canWriteFor(U.eltern, U.fremd), false);
  });

  await t.test('nur eine Stufe', async () => {
    // Ein Kind kann keinen eigenen Haushalt aufmachen …
    assert.match((await household.createInvite(U.kindA)).code || '', /konto_bereits_verknuepft/);
    // … und das Elternkonto kann nicht Unterkonto werden.
    const inv = await household.createInvite(U.fremd);
    assert.match((await household.redeemInvite(U.eltern, inv.code)).code || '', /konto_hat_unterkonten/);
  });

  await t.test('dasselbe Set in zwei Konten wird zu EINER Zeile', async () => {
    await giveSet(U.kindA, '75192-1', 1, 100);
    await giveSet(U.kindB, '75192-1', 2, 160);
    await giveSet(U.kindA, '10290-1', 1, 50);

    const r = await handlers.getSets(await household.scopeIds(U.eltern, 'all'), {});
    const falcon = r.sets.filter(s => s.set_number === '75192-1');
    assert.equal(falcon.length, 1, 'Set erscheint mehrfach');
    assert.equal(falcon[0].quantity, 3, 'Mengen nicht addiert');
    assert.equal(r.total, 2, 'Gesamtzahl zählt Konten statt Sets');

    // Besitzer mit Namen — sonst steht dort nur eine Zahl.
    const owners = (falcon[0].owners || []).map(o => o.username).sort();
    assert.deepEqual(owners, ['kindA', 'kindB']);

    // Kaufpreis mengengewichtet: (1x100 + 2x160)/3 = 140
    assert.equal(Math.round(falcon[0].avg_purchase_price), 140);

    // Filter: eigene Sicht des Elternkontos ist leer, 'subs' zeigt beide Sets.
    assert.equal((await handlers.getSets(await household.scopeIds(U.eltern, 'own'), {})).sets.length, 0);
    assert.equal((await handlers.getSets(await household.scopeIds(U.eltern, 'subs'), {})).sets.length, 2);

    // Und ein Kind sieht nur seine eigenen.
    const kindB = await handlers.getSets(await household.scopeIds(U.kindB, 'all'), {});
    assert.deepEqual(kindB.sets.map(s => s.set_number), ['75192-1']);
    assert.equal(kindB.sets[0].quantity, 2, 'Kind sieht die Menge des Geschwisters mit');
    assert.equal(kindB.sets[0].owners, undefined, 'Besitzer-Plakette gehört nicht ins Einzelkonto');
  });

  await t.test('Kennzahlen folgen dem Filter', async () => {
    const all  = await handlers.getStats(await household.scopeIds(U.eltern, 'all'));
    const own  = await handlers.getStats(await household.scopeIds(U.eltern, 'own'));

    // ── Warum hier jetzt 2 steht und vorher 3 ───────────────────────────────
    // Die Vorlage: kindA hat 75192-1 (×1) und 10290-1 (×1), kindB 75192-1 (×2).
    // Das sind DREI Tabellenzeilen, aber ZWEI verschiedene Sets — und die
    // Galerie zeigt zwei Kacheln, weil sie nach set_number gruppiert.
    //
    // Die alte Zusicherung nagelte die Zeilenzahl fest, und ihre Beschriftung
    // sagte „(Mengen summiert)" — was COUNT(*) gerade nicht tut. Zwei
    // Zusicherungen weiter oben steht in DERSELBEN Datei
    // `getSets(..., 'subs').sets.length === 2`. Beide Zahlen standen hier
    // nebeneinander, verglichen hat sie nie jemand.
    //
    // Der Vergleich selbst steht jetzt in kennzahlen-haushalt-db.test.js;
    // hier bleiben die konkreten Zahlen der Vorlage.
    assert.equal(parseInt(all.total_sets), 2, 'verschiedene Sets im Haushalt — wie die Galerie sie zeigt');
    assert.equal(parseInt(all.total_quantity), 4, 'Exemplare: 1 + 2 + 1');
    assert.equal(parseInt(own.total_sets), 0);
  });

  await t.test('Verschieben nimmt Teile, Minifiguren und Anleitungen mit', async () => {
    // Inhalt für das Set von kindA anlegen — plus ein manuell erfasstes Teil,
    // das ausdrücklich NICHT mitwandern darf.
    await db.run(`INSERT INTO parts (user_id,set_number,part_number,color_id,quantity,source)
                  VALUES ($1,'75192-1','3001',4,10,'set'), ($1,'75192-1','3002',1,5,'set')`, [U.kindA]);
    await db.run(`INSERT INTO parts (user_id,part_number,color_id,quantity,source)
                  VALUES ($1,'9999',0,3,'manual')`, [U.kindA]);
    await db.run(`INSERT INTO minifigs (user_id,set_number,fig_number,quantity,source)
                  VALUES ($1,'75192-1','sw0001',2,'set')`, [U.kindA]);
    await db.run(`INSERT INTO instructions (user_id,set_number,url) VALUES ($1,'75192-1','http://x/1.pdf')`,
      [U.kindA]);

    const r = await moveSet(U.eltern, '75192-1', U.kindA, U.kindB);
    assert.equal(r.status, 200, `Verschieben fehlgeschlagen: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.merged, true, 'kindB besass das Set bereits — Verschmelzen erwartet');
    assert.equal(r.body.parts, 2);
    assert.equal(r.body.minifigs, 1);
    assert.equal(r.body.instructions, 1);

    // Beim Ziel angekommen …
    const atB = await db.get(
      `SELECT COUNT(*)::int AS n FROM parts WHERE user_id=$1 AND set_number='75192-1'`, [U.kindB]);
    assert.equal(atB.n, 2);
    // … bei der Quelle weg …
    const atA = await db.get(
      `SELECT COUNT(*)::int AS n FROM parts WHERE user_id=$1 AND set_number='75192-1'`, [U.kindA]);
    assert.equal(atA.n, 0, 'Teile blieben im Quellkonto zurück');
    // … und das manuelle Teil ist geblieben.
    const manual = await db.get(
      `SELECT COUNT(*)::int AS n FROM parts WHERE user_id=$1 AND source='manual'`, [U.kindA]);
    assert.equal(manual.n, 1, 'ein manuell erfasstes Teil wurde mitverschoben');

    // Pro Tag, Element und Benutzer EIN Kaufpreis: aus zwei Zeilen wird eine.
    const rows = await db.all(
      `SELECT quantity, purchase_price FROM set_acquisitions
        WHERE user_id=$1 AND set_number='75192-1'`, [U.kindB]);
    assert.equal(rows.length, 1, 'zwei Erfassungen desselben Tages nicht verschmolzen');
    assert.equal(parseInt(rows[0].quantity), 3);
    // Mengengewichtet: (2x160 + 1x100)/3 = 140
    assert.equal(Math.round(parseFloat(rows[0].purchase_price)), 140);

    // Im Haushalt steht das Set weiterhin einmal, jetzt mit einem Besitzer.
    const list = await handlers.getSets(await household.scopeIds(U.eltern, 'all'), {});
    const falcon = list.sets.find(s => s.set_number === '75192-1');
    assert.equal(falcon.quantity, 3);
    assert.deepEqual((falcon.owners || []).map(o => o.username), ['kindB']);
  });

  await t.test('verschieben darf nur, wer für beide Konten schreiben darf', async () => {
    // Ein Kind ins Nachbarkonto: verboten, obwohl beide im selben Haushalt.
    const bad = await moveSet(U.kindB, '10290-1', U.kindA, U.kindB, [1]);
    assert.equal(bad.status, 403, `erwartet 403, war ${bad.status}`);
    // Und der Bestand ist unangetastet.
    const still = await db.get(
      'SELECT COUNT(*)::int AS n FROM sets WHERE user_id=$1 AND set_number=$2', [U.kindA, '10290-1']);
    assert.equal(still.n, 1);
  });

  await t.test('die Finanz-Endpunkte antworten in JEDEM Kontofilter', async () => {
    // Diese Prüfung gibt es, weil genau hier ein Fehler durchgerutscht ist:
    // Nach der Umstellung auf user_id = ANY($1) bekam getSetting() die
    // ID-LISTE statt einer ID, und alle vier Endpunkte antworteten mit
    //   500 invalid input syntax for type integer: "{"2"}"
    // Im Browser hiess das: Finanzen-Reiter komplett leer.
    //
    // Die Struktur-Tests konnten das nicht sehen — der Code war „richtig
    // verdrahtet", nur eben mit dem falschen Wert. Und der Paritätstest ruft
    // die Endpunkte nur OHNE Filter auf; bei accounts=subs fällt das fragende
    // Konto aus der Liste, und ids[0] wäre dann die Währung eines Kindes.
    for (const mode of ['all', 'own', 'subs']) {
      const q = mode === 'all' ? '' : `?accounts=${mode}`;
      // Adressen seit Etappe 5 unter /api/v1 (zusammengelegt) — die Aussage
      // dieses Tests ist unverändert: Jeder Endpunkt antwortet in JEDEM
      // Kontofilter, und die Währung kommt vom fragenden Konto.
      for (const ep of ['/api/v1/finance/valuation', '/api/v1/finance/parts-valuation',
                        '/api/v1/finance/minifigs-valuation', '/api/v1/finance/pnl',
                        '/api/v1/finance/portfolio-history?period=month']) {
        const path = ep.includes('?') ? ep + q.replace('?', '&') : ep + q;
        const r = await apiGet(U.eltern, path);
        assert.equal(r.status, 200, `${path} → ${r.status}: ${JSON.stringify(r.body)}`);
        assert.equal(r.body.success, true, `${path} meldet keinen Erfolg`);
      }
    }
    // Und die Währung stammt IMMER vom fragenden Konto, auch wenn es in der
    // ID-Liste gar nicht vorkommt (accounts=subs).
    await db.run(`UPDATE user_settings SET value='SEK' WHERE user_id=$1 AND key='currency'`, [U.eltern]);
    const subs = await apiGet(U.eltern, '/api/v1/finance/valuation?accounts=subs');
    assert.equal(subs.body.currency, 'SEK',
      'Die Währung kam aus einem Unterkonto statt vom fragenden Konto');
    await db.run(`UPDATE user_settings SET value='CHF' WHERE user_id=$1 AND key='currency'`, [U.eltern]);
  });

  await t.test('Entkoppeln lässt die Daten beim Besitzer', async () => {
    await household.unlink(U.eltern, U.kindA);
    assert.deepEqual(await household.scopeIds(U.eltern, 'all'), [U.eltern, U.kindB]);
    // Das Kind behält seinen Bestand.
    const kindA = await handlers.getSets(await household.scopeIds(U.kindA, 'all'), {});
    assert.deepEqual(kindA.sets.map(s => s.set_number), ['10290-1']);
    // Und darf sich danach wieder verknüpfen lassen.
    const inv = await household.createInvite(U.eltern);
    assert.equal((await household.redeemInvite(U.kindA, inv.code)).code, undefined);
  });

  await t.test('einzelner Kaufpreis wechselt den Eigentümer', async () => {
    // Der Kaufpreis ist die Ebene, auf der ein Exemplar existiert: Ein Set mit
    // drei Erfassungen sind drei Käufe, die verschiedenen Kindern gehören
    // können. Hier wandert EINE Zeile — die Quelle behält den Rest samt Teilen.
    await giveSet(U.kindA, '21318-1', 1, 200, 'N', '2026-01-05');
    await giveSet(U.kindA, '21318-1', 1, 240, 'N', '2026-02-05');
    await db.run(`INSERT INTO parts (user_id,set_number,part_number,color_id,quantity,source)
                  VALUES ($1,'21318-1','3020',2,4,'set')`, [U.kindA]);
    await db.run(`INSERT INTO minifigs (user_id,set_number,fig_number,quantity,source)
                  VALUES ($1,'21318-1','fig-tree',1,'set')`, [U.kindA]);
    await db.run(`INSERT INTO instructions (user_id,set_number,url)
                  VALUES ($1,'21318-1','http://x/tree.pdf')`, [U.kindA]);

    const acqs = await db.all(
      `SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number='21318-1'
        ORDER BY created_at ASC`, [U.kindA]);
    assert.equal(acqs.length, 2);

    _actingAs = U.eltern;
    const r = await fetch(`${_base}/api/v1/sets/21318-1/acquisitions/${acqs[0].id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner_user_id: U.eltern, from_user_id: U.kindA }),
    });
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.source_emptied, false, 'die Quelle behält ein Exemplar');

    // Mengen stimmen auf beiden Seiten …
    const qty = async uid => (await db.get(
      'SELECT quantity FROM sets WHERE user_id=$1 AND set_number=$2', [uid, '21318-1']))?.quantity;
    assert.equal(await qty(U.kindA), 1, 'Quelle nicht heruntergezählt');
    assert.equal(await qty(U.eltern), 1);

    // … die Kaufpreise sind je Konto einer …
    const links = await db.all(
      `SELECT user_id, purchase_price FROM set_acquisitions WHERE set_number='21318-1'
        ORDER BY user_id`);
    assert.equal(links.length, 2, 'Erfassung wurde dupliziert statt verschoben');

    // … und die Teile stehen jetzt bei BEIDEN: Die Quelle behält ihr Exemplar,
    // das Ziel bekommt eine Kopie. Ein Umhängen hätte die Quelle mit einem
    // Exemplar ohne Teile zurückgelassen.
    // Wird EIN Kaufpreis von zweien umgehängt, muss ALLES in beiden Konten
    // stehen: das Set selbst, seine Teile, seine Minifiguren und seine
    // Anleitungen. Kopieren statt verschieben — der Absender behält ja ein
    // Exemplar, und ein Exemplar ohne Teile wäre ein halber Bestand.
    const inBeiden = async (table) => {
      const n = async uid => (await db.get(
        `SELECT COUNT(*)::int AS n FROM ${table} WHERE user_id=$1 AND set_number='21318-1'`,
        [uid])).n;
      return { quelle: await n(U.kindA), ziel: await n(U.eltern) };
    };
    for (const table of ['sets', 'parts', 'minifigs', 'instructions']) {
      const r = await inBeiden(table);
      assert.equal(r.quelle, 1, `${table}: Quelle verlor den Eintrag trotz verbleibendem Exemplar`);
      assert.equal(r.ziel,   1, `${table}: Ziel bekam keinen Eintrag`);
    }
    // Und zwar GENAU einmal je Konto — doppelte Zeilen zählte die
    // Teile-Zusammenfassung zweimal, die Menge steckt in sets.quantity.
    const doppelt = await db.get(
      `SELECT COUNT(*)::int AS n FROM parts
        WHERE set_number='21318-1' AND user_id=$1 AND part_number='3020'`, [U.eltern]);
    assert.equal(doppelt.n, 1, 'Teile wurden mehrfach kopiert');
  });

  await t.test('ein Unterkonto darf keinen Kaufpreis umhängen', async () => {
    const acq = await db.get(
      `SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number='21318-1' LIMIT 1`, [U.kindA]);
    _actingAs = U.kindA;
    const r = await fetch(`${_base}/api/v1/sets/21318-1/acquisitions/${acq.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner_user_id: U.kindB, from_user_id: U.kindA }),
    });
    assert.equal(r.status, 403, 'Geschwister-Verschiebung war erlaubt');
  });

  await t.test('der Eigentümerwechsel greift die ZEILE, nicht den Betrachter', async () => {
    // ── Woher dieser Test kommt ───────────────────────────────────────────
    // Die Webapp schickte als from_user_id den BETRACHTER mit. Zog das
    // Hauptkonto die Zeile eines Unterkontos zu sich, suchte der Server sie
    // unter dem falschen Konto → 404 „Kaufpreis nicht gefunden", obwohl das
    // Select im Dialog den richtigen Eigentümer längst anzeigte. Der Server
    // leitet den Absender jetzt selbst aus der Zeile ab
    // (acquisitionMoveSource); ein mitgeschickter from_user_id ist bedeutungslos.
    await giveSet(U.kindB, '31120-1', 1, 80);
    const acq = await db.get(
      `SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number='31120-1'`, [U.kindB]);

    // GENAU der alte Webapp-Request: Betrachter (eltern) als from_user_id,
    // obwohl die Zeile kindB gehört. Muss jetzt trotzdem ankommen.
    _actingAs = U.eltern;
    const r = await fetch(`${_base}/api/v1/sets/31120-1/acquisitions/${acq.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner_user_id: U.eltern, from_user_id: U.eltern }),
    });
    const body = await r.json();
    assert.equal(r.status, 200,
      `Zeile eines Unterkontos war nicht erreichbar: ${JSON.stringify(body)}`);
    assert.equal(body.from_user_id, U.kindB,
      'Der Absender muss aus der Zeile kommen, nicht aus dem Request');
    const owner = await db.get(
      `SELECT user_id FROM set_acquisitions WHERE set_number='31120-1'`);
    assert.equal(parseInt(owner.user_id), U.eltern, 'Die Zeile ist nicht angekommen');

    // Die Richtungsprüfung bleibt: Die Zeile gehört jetzt eltern — kindB darf
    // sie NICHT zurückholen, auch nicht mit dreist passendem from_user_id.
    _actingAs = U.kindB;
    const zurueck = await fetch(`${_base}/api/v1/sets/31120-1/acquisitions/${acq.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner_user_id: U.kindB, from_user_id: U.eltern }),
    });
    // 403 (fremde Zeile) oder 404 (die Zeilen-ID kann beim Verschmelzen im
    // Ziel neu vergeben worden sein) — Hauptsache: kein Erfolg.
    assert.ok([403, 404].includes(zurueck.status),
      `Ein Unterkonto konnte aus dem Hauptkonto ziehen (Status ${zurueck.status})`);
    const nachher = await db.get(
      `SELECT user_id FROM set_acquisitions WHERE set_number='31120-1'`);
    assert.equal(parseInt(nachher.user_id), U.eltern, 'Die Zeile wanderte zurück');
  });

  await t.test('der Filter kennt einzelne Konten — und greift auch bei manuellen Einträgen', async () => {
    // Der Filter führt jedes Unterkonto namentlich. Serverseitig heisst das:
    // accounts=<id>. Eine FREMDE ID darf nicht durchschlagen — sonst wäre der
    // Filter ein Zugriffsweg statt einer Ansichtshilfe.
    assert.deepEqual(await household.scopeIds(U.eltern, U.kindA), [U.kindA]);
    assert.deepEqual(await household.scopeIds(U.eltern, U.fremd),
      await household.scopeIds(U.eltern, 'all'),
      'eine kontofremde ID muss auf das ganze Blickfeld zurückfallen');
    // Ein Unterkonto kann sich damit nicht ins Geschwisterkonto sehen.
    assert.deepEqual(await household.scopeIds(U.kindA, U.kindB), [U.kindA]);

    // Manuell erfasste Teile und Minifiguren hängen an eigenen Endpunkten —
    // gemeldet war, dass der Filter dort nicht greift.
    await db.run(`INSERT INTO parts (user_id,part_number,color_id,quantity,source,part_name)
                  VALUES ($1,'m-A',0,1,'manual','Teil A'), ($2,'m-B',0,1,'manual','Teil B')`,
      [U.kindA, U.kindB]);
    await db.run(`INSERT INTO minifigs (user_id,fig_number,quantity,source,fig_name)
                  VALUES ($1,'mf-A',1,'manual','Figur A'), ($2,'mf-B',1,'manual','Figur B')`,
      [U.kindA, U.kindB]);

    const nummern = rows => rows.map(r => r.part_number ?? r.fig_number);
    const nurA = nummern(await handlers.getManualParts(await household.scopeIds(U.eltern, U.kindA)));
    const alle = nummern(await handlers.getManualParts(await household.scopeIds(U.eltern, 'all')));
    // kindA hat aus einem früheren Test noch ein manuelles Teil ('9999') —
    // deshalb auf Enthaltensein prüfen statt auf die exakte Liste.
    assert.ok(nurA.includes('m-A'), 'eigenes Teil fehlt');
    assert.ok(!nurA.includes('m-B'), 'der Filter zeigt das Teil des Geschwisterkontos');
    assert.ok(alle.includes('m-A') && alle.includes('m-B'), 'ohne Filter müssen beide erscheinen');

    const figsA = nummern(await handlers.getManualMinifigs(await household.scopeIds(U.eltern, U.kindA)));
    assert.ok(figsA.includes('mf-A'));
    assert.ok(!figsA.includes('mf-B'), 'der Filter zeigt die Figur des Geschwisterkontos');
  });

  await t.test('ein Set lässt sich NICHT als Ganzes verschieben', async () => {
    // Verschoben wird über den Kaufpreis. Ohne acquisition_ids antwortet die
    // Route mit 400 — die Regel hängt nicht an der Oberfläche, sondern am
    // Server: Ein Klient, der sie umgeht, bekommt keine Ausnahme.
    _actingAs = U.eltern;
    const r = await fetch(`${_base}/api/v1/sets/10290-1/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from_user_id: U.kindA, to_user_id: U.eltern }),
    });
    assert.equal(r.status, 400, 'Verschieben ohne Kaufpreise war erlaubt');
    const body = await r.json();
    assert.equal(body.code, 'kaufpreise_angeben');
  });

  await t.test('die Migration führt verwaiste Teile zu ihrem Set zurück', async () => {
    // Sets, die vor hardened-106 verschoben wurden, liessen Teile und
    // Minifiguren beim Absender zurück: Zeilen, die auf ein Set zeigen, das
    // ihr Konto nicht mehr besitzt. db/migrations/0006 räumt das einmalig auf.
    //
    // Ausgangslage nachstellen: kindB besitzt 10290-1, die Teile liegen aber
    // noch bei kindA — und ein FREMDES Konto besitzt dasselbe Set ebenfalls,
    // darf aber nichts abbekommen.
    await db.run(`INSERT INTO sets (user_id,set_number,name,quantity) VALUES ($1,'10290-1','x',1)
                  ON CONFLICT (user_id,set_number) DO NOTHING`, [U.kindB]);
    await db.run(`DELETE FROM sets WHERE user_id=$1 AND set_number='10290-1'`, [U.kindA]);
    await db.run(`INSERT INTO sets (user_id,set_number,name,quantity) VALUES ($1,'10290-1','x',1)
                  ON CONFLICT (user_id,set_number) DO NOTHING`, [U.fremd]);
    await db.run(`INSERT INTO parts (user_id,set_number,part_number,color_id,quantity,source)
                  VALUES ($1,'10290-1','3005',1,7,'set')`, [U.kindA]);
    await db.run(`INSERT INTO minifigs (user_id,set_number,fig_number,quantity,source)
                  VALUES ($1,'10290-1','fig-1',1,'set')`, [U.kindA]);

    const client = await db.pool.connect();
    try {
      // Migrationen sind einmalig verbucht — für den Test die Datei direkt
      // ausführen, sonst überspringt der Läufer sie.
      const sql = require('node:fs').readFileSync(
        require('node:path').join(ROOT, 'db/migrations/0006-verwaiste-teile-nach-verschieben.sql'), 'utf8');
      await client.query(sql);
    } finally { client.release(); }

    const bei = async (t, uid) => (await db.get(
      `SELECT COUNT(*)::int AS n FROM ${t} WHERE user_id=$1 AND set_number='10290-1'`, [uid])).n;
    assert.equal(await bei('parts', U.kindB), 1, 'Teile kamen nicht beim Besitzer an');
    assert.equal(await bei('parts', U.kindA), 0, 'verwaiste Teile blieben liegen');
    assert.equal(await bei('minifigs', U.kindB), 1);
    // Das fremde Konto darf nichts bekommen — sonst wäre die Migration ein
    // Datenleck über Haushaltsgrenzen hinweg.
    assert.equal(await bei('parts', U.fremd), 0, 'Teile wanderten in ein fremdes Konto');
  });

  await t.test('in ein fremdes Konto schreiben — die Richtung entscheidet', async () => {
    // ── Warum diese Prüfung hier steht (Nachtrag 149) ────────────────────────
    // Die Regel „owner_user_id wird geprüft, nicht bloss übernommen" lag
    // ausschliesslich als Quelltextprüfung vor (test/household.test.js,
    // „Schreiben in ein fremdes Konto verlangt die richtige Richtung"). Die
    // suchte nach `resolveWriteTarget(` und nach einem 403 irgendwo in
    // derselben Datei — beides wäre auch dann noch dagestanden, wenn der
    // Rückgabewert nicht mehr ausgewertet würde.
    //
    // Und das ist der teuerste denkbare stille Fehlalarm im ganzen Projekt:
    // Fällt die Prüfung aus, schreibt ein Konto in ein fremdes, ohne dass
    // irgendetwas rot wird. Deshalb wird sie jetzt über die ECHTEN Routen
    // gefahren, für alle drei Anlege-Pfade.

    /** Über die v1-Fabrik anlegen, mit gewähltem Zielkonto. */
    async function anlegen(actor, pfad, koerper) {
      _actingAs = actor;
      const r = await fetch(_base + pfad, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(koerper),
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    }

    // Eigene, sonst nirgends benutzte Nummern: Die vorherigen Prüfungen legen
    // 3001/3002/sw0001 für kindA an. Mit denselben Nummern zählte diese Prüfung
    // fremde Zeilen mit und wäre aus dem falschen Grund rot geworden.
    const faelle = [
      { name: 'Teile',       pfad: '/api/v1/parts',
        koerper: { part_number: '99991', color_id: 4, quantity: 1 },
        tabelle: 'parts',    wo: `part_number='99991'` },
      { name: 'Minifiguren', pfad: '/api/v1/minifigs',
        koerper: { fig_number: 'zz9999', quantity: 1 },
        tabelle: 'minifigs', wo: `fig_number='zz9999'` },
    ];

    const zaehle = (tabelle, wo, uid) =>
      db.get(`SELECT COUNT(*)::int AS c FROM ${tabelle} WHERE ${wo} AND user_id=$1`, [uid])
        .then(r => r.c);

    for (const f of faelle) {
      // 1. Hauptkonto → eigenes Unterkonto: erlaubt, und es landet DORT.
      const hin = await anlegen(U.eltern, f.pfad, { ...f.koerper, owner_user_id: U.kindA });
      assert.equal(hin.status, 200, `${f.name}: Hauptkonto durfte nicht ins eigene Unterkonto schreiben`);
      assert.equal(await zaehle(f.tabelle, f.wo, U.kindA), 1,
        `${f.name}: gelandet ist es nicht beim gewählten Konto`);
      assert.equal(await zaehle(f.tabelle, f.wo, U.eltern), 0,
        `${f.name}: es landete beim Absender statt beim Zielkonto`);

      // 2. Unterkonto → Geschwisterkonto: verboten. „Steht im Blickfeld"
      //    genügt NICHT — kindA und kindB sehen sich gegenseitig nicht einmal.
      const quer = await anlegen(U.kindA, f.pfad, { ...f.koerper, owner_user_id: U.kindB });
      assert.equal(quer.status, 403, `${f.name}: Unterkonto schrieb ins Geschwisterkonto`);

      // 3. Unterkonto → Hauptkonto: verboten. Die Richtung ist EINE.
      const rueck = await anlegen(U.kindA, f.pfad, { ...f.koerper, owner_user_id: U.eltern });
      assert.equal(rueck.status, 403, `${f.name}: Unterkonto schrieb ins Hauptkonto`);

      // 4. Konto von ausserhalb des Haushalts: verboten.
      const fremd = await anlegen(U.fremd, f.pfad, { ...f.koerper, owner_user_id: U.eltern });
      assert.equal(fremd.status, 403, `${f.name}: ein fremdes Konto schrieb in den Haushalt`);

      // 5. Und in KEINEM der drei abgelehnten Fälle darf still etwas entstehen —
      //    weder beim Ziel noch beim Absender. Genau das ist der Unterschied
      //    zwischen „403" und „schreibt heimlich ins eigene Konto".
      assert.equal(await zaehle(f.tabelle, f.wo, U.kindB), 0,
        `${f.name}: trotz 403 ist beim Zielkonto etwas entstanden`);
      assert.equal(await zaehle(f.tabelle, f.wo, U.fremd), 0,
        `${f.name}: trotz 403 ist beim fremden Konto etwas entstanden`);

      await db.run(`DELETE FROM ${f.tabelle} WHERE ${f.wo}`);
    }

    // Ohne Angabe bleibt es beim eigenen Konto — der Normalfall darf sich
    // durch die Prüfung nicht ändern.
    const ohne = await anlegen(U.kindA, '/api/v1/parts', { part_number: '99992', color_id: 4, quantity: 1 });
    assert.equal(ohne.status, 200);
    assert.equal(await zaehle('parts', `part_number='99992'`, U.kindA), 1,
      'Ohne owner_user_id muss es beim Erfasser landen');
    await db.run(`DELETE FROM parts WHERE part_number='99992'`);
  });

  await t.test('aufräumen', async () => {
    _srv?.close();
    await db.pool.end().catch(() => {});
  });
});