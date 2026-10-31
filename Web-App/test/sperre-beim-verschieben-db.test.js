/**
 * Die Verschiebung eines Sets serialisiert über das QUELLKONTO.
 *
 * ── Die Zusicherung, um die es geht ─────────────────────────────────────────
 *
 * test/household.test.js:387 sagt:
 *
 *     assert.ok(src.includes('withInventoryLock(fromId, sn'),
 *               'Serialisiert über das Quellkonto');
 *
 * Das liest den Quelltext. Es beweist, dass jemand die Zeile hingeschrieben
 * hat — nicht, dass die Sperre greift, und schon gar nicht, dass sie auf dem
 * richtigen Schlüssel greift. Genau diese Form hat an einem Tag zwei Fehler
 * durchgelassen (der Lagerortfilter kam nie an der Route an;
 * moveManualAcquisition löschte beim Absender alles), und daraus kam die Regel:
 *
 *     Eine Behauptung der Form „der Weg A → B lebt" braucht einen Lauf über
 *     diesen Weg.
 *
 * Von 26 solchen Zusicherungen über Routen-Quelltext war diese die letzte ohne
 * Lauf. Ich hatte sie als „ein Lauf wäre wackelig" stehengelassen. Das galt
 * für die naheliegende Bauart, nicht für die Sache.
 *
 * ── Warum das hier NICHT wackelt ────────────────────────────────────────────
 *
 * Die naheliegende Bauart schickt zwei Verschiebungen gleichzeitig los und
 * hofft, dass eine verliert. Das ist ein Wettlauf: Er hängt davon ab, wie
 * schnell die Maschine gerade ist, und er kann grün sein, ohne dass eine
 * Sperre existiert.
 *
 * Hier läuft kein Wettlauf. Die Sperre wird von einer EIGENEN Verbindung
 * genommen — mit genau derselben Anweisung, die db/txLock.ts benutzt — und
 * dann gehalten. Danach wird die echte Route angestossen und in `pg_locks`
 * nachgesehen, ob dort ein WARTER steht. Das ist ein ZUSTAND, keine Dauer:
 *
 *   * Nimmt die Route die Sperre, kann sie nicht fertig werden, solange der
 *     Halter sie hat — der Warter erscheint und bleibt.
 *   * Nimmt sie sie NICHT, wird sie sofort fertig, und zwar während der Halter
 *     noch hält. Das wird direkt festgestellt, nicht an einer Zeit gemessen.
 *
 * Beide Fälle sind einander logisch ausschliessend. Es gibt kein Zeitfenster,
 * in dem beides oder keines zutrifft, und deshalb keinen Zufall im Befund.
 *
 * ── Wie ein Warter in pg_locks aussieht (GEMESSEN, nicht angenommen) ────────
 *
 * Zwei psql-Sitzungen, die zweite will dieselbe Sperre:
 *
 *      locktype | classid |   objid    | objsubid | granted
 *     ----------+---------+------------+----------+---------
 *      advisory |       7 | 3504355179 |        2 | t        ← Halter
 *      advisory |       7 | 3504355179 |        2 | f        ← Warter
 *
 * `pg_advisory_xact_lock(a, b)` ist die ZWEITEILIGE Fassung, daher
 * `objsubid = 2`. `classid` ist das Konto, `objid` der Hash des Schlüssels:
 * hashtext('75192-1') = -790612117, und `objid` ist vom Typ `oid` (ohne
 * Vorzeichen), also 3504355179. Deshalb steht im Prädikat unten
 * `hashtext($2)::oid` — ein Vergleich gegen die vorzeichenbehaftete Zahl
 * fände nie etwas.
 *
 * ── Warum DREI Fälle und nicht einer ────────────────────────────────────────
 *
 * „Die Route wartet" allein wäre auch erfüllt, wenn sie eine GLOBALE Sperre
 * nähme oder grundsätzlich hinge. Die Zusicherung sagt aber mehr, nämlich
 * `(fromId, sn)` — beide Teile:
 *
 *   A. Sperre auf (Quellkonto, Set)         → die Verschiebung wartet
 *   B. Sperre auf (Quellkonto, ANDERES Set) → sie wartet NICHT
 *   C. Sperre auf (ZIELkonto, Set)          → sie wartet NICHT
 *
 * Was jeder Fall für sich fängt — GEMESSEN an fünf verdrehten Fassungen der
 * Route, nicht überlegt (die Befunde stehen unten):
 *
 *   * A fängt die fehlende Sperre und jeden Schlüssel, der nicht auf
 *     (Quellkonto, Set) kommt — eine Konstante, das falsche Konto.
 *   * B fängt einen Schlüssel, der nicht davon abhängt, WELCHES Set wandert:
 *     Steht dort eine feste Setnummer, wartet die Verschiebung eines anderen
 *     Sets mit — und alle Verschiebungen eines Kontos stehen hintereinander
 *     an. A ist in diesem Fall grün.
 *   * C fängt eine Sperre auf dem ZIELkonto, und auch eine auf beiden Konten:
 *     dann wäre A grün und nur C rot.
 *
 * Erst zusammen sagen sie dasselbe wie die Textregel, nur geprüft. Einzeln
 * sagt keiner davon „der Schlüssel ist (fromId, sn)" — A und B zusammen sagen
 * es: DERSELBE gehaltene Schlüssel hält die eine Verschiebung auf und die
 * andere nicht, also hängt der Schlüssel der Route am wandernden Set.
 *
 * ── Die Textregel bleibt ────────────────────────────────────────────────────
 *
 * Sie fängt eine gelöschte Zeile, und das ist etwas anderes als ein Lauf.
 * Ergänzt, nicht ersetzt.
 *
 * ── Gegenproben (durchgeführt, Befunde gemessen) ────────────────────────────
 *
 *   a) withInventoryLock → db.transaction (Sperre weg)  → A rot, B+C grün
 *   b) fromId → toId                                    → A+C rot, B grün
 *   c) Schlüssel 'alle' statt sn                        → A rot, B+C grün
 *   d) Schlüssel fest '75192-1' statt sn                → B rot, A+C grün
 *   e) Sperre auf BEIDEN Konten (fromId und toId)       → C rot, A+B grün
 *
 * Bei (c) hatte ich B rot VORHERGESAGT und lag falsch: Ein konstanter
 * Schlüssel kollidiert mit keinem der gehaltenen, also wartet in B nichts —
 * rot wird A, weil die Verschiebung dort durchläuft. Festgehalten, weil die
 * Begründung eines Falls so lange nicht stimmt, wie sie nicht gemessen ist:
 * Mein erster Kommentar behauptete, B fange „eine globale oder kontoweite
 * Sperre". Tut es nicht — die kollidiert mit nichts. B fängt (d), und das
 * fängt sonst keiner.
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

let HAUPT = 0, KIND = 0;
// Drei Sets, weil jeder Fall eine eigene, noch nicht verschobene Erfassung
// braucht: Eine gelungene Verschiebung verbraucht sie.
const SN_A = '75192-1', SN_B = '10179-1', SN_C = '21309-1';

/**
 * Die Sperre, wie db/txLock.ts sie stellt — Halter oder Warter.
 *
 * Dasselbe SQL wie dort, absichtlich wörtlich: Würde hier eine andere
 * Schlüsselbildung stehen, prüfte dieser Test eine Sperre, die es so nicht
 * gibt.
 */
const SPERR_SQL = 'SELECT pg_advisory_xact_lock($1, hashtext($2))';
const { LOCKS } = _req('src/infra/lockNamespaces.js');
const schluessel = (userId, scopeKey) => [LOCKS.INVENTAR, `${userId}|${scopeKey}`];

async function sperrZeilen(userId, scopeKey, erteilt) {
  const z = await db.get(
    `SELECT COUNT(*)::int AS c FROM pg_locks
      WHERE locktype = 'advisory' AND classid = $1::oid
        AND objid = hashtext($2)::oid AND objsubid = 2
        AND granted = $3
        -- pg_locks gilt für den ganzen Server; parallele Testdateien halten in
        -- ihrer eigenen Datenbank dieselben Schlüssel.
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
    [...schluessel(userId, scopeKey), erteilt]);
  return Number(z.c);
}

/**
 * Wartet, bis auf genau diesem Schlüssel ein Warter steht — oder bis die
 * Route fertig ist.
 *
 * Der Rückgabewert ist der BEFUND, nicht ein Erfolg: 'wartet', 'fertig'
 * (die Route lief durch, obwohl die Sperre gehalten wurde — also keine
 * Sperre) oder 'nichts' (sie blockiert, aber nicht auf diesem Schlüssel).
 * Alle drei sind aussagekräftig, deshalb wirft diese Funktion nicht selbst.
 */
async function befundWarter(userId, scopeKey, istFertig, grenzeMs = 5000) {
  const bis = Date.now() + grenzeMs;
  for (;;) {
    if (istFertig()) return 'fertig';
    if (await sperrZeilen(userId, scopeKey, false) > 0) return 'wartet';
    if (Date.now() > bis) return 'nichts';
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Die Verschiebung, mit einer Schranke, damit ein Hänger eine Meldung wird. */
function verschiebe(base, sn, acqIds, grenzeMs = 10000) {
  const lauf = fetch(`${base}/api/v1/sets/${sn}/move`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to_user_id: KIND, acquisition_ids: acqIds }),
  });
  const zustand = { fertig: false };
  const verfolgt = lauf.then((r) => { zustand.fertig = true; return r; },
                             (e) => { zustand.fertig = true; throw e; });
  zustand.antwort = verfolgt;
  // Der Wecker wird GELÖSCHT, sobald die Antwort da ist. Ohne das bleibt ein
  // offener Timer von zehn Sekunden stehen, hält den Prozess am Leben und
  // schiebt das Ende der Datei nach hinten — in einem Lauf mit achtzig
  // Dateien ist das nicht nichts.
  let wecker;
  zustand.mitSchranke = Promise.race([
    verfolgt,
    new Promise((_, ab) => { wecker = setTimeout(
      () => ab(new Error(`Die Verschiebung von ${sn} war nach ${grenzeMs} ms nicht fertig — ` +
                         'sie hängt an einer Sperre, die sie nicht nehmen dürfte')), grenzeMs); }),
  ]).finally(() => clearTimeout(wecker));
  return zustand;
}

async function erfassungsIds(userId, sn) {
  const z = await db.all(
    'SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number=$2 ORDER BY id', [userId, sn]);
  return z.map((r) => r.id);
}

async function aufbau() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  await db.run(`INSERT INTO users (username,password_hash) VALUES ('haupt','x'),('kind','x')`);
  const id = async (n) => (await db.get(`SELECT id FROM users WHERE username=$1`, [n])).id;
  HAUPT = await id('haupt'); KIND = await id('kind');
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2)`, [HAUPT, KIND]);
  for (const sn of [SN_A, SN_B, SN_C]) {
    await db.run(`INSERT INTO set_catalog (set_number,name) VALUES ($1,$1)
                  ON CONFLICT (set_number) DO NOTHING`, [sn]);
    await haeltSet(db, HAUPT, sn, 1, { preis: 100 });
  }
}

test('die Verschiebung sperrt auf (Quellkonto, Set)', { concurrency: 1 }, async (t) => {
  try { await db.get('SELECT 1'); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  await aufbau();

  const srv = testServer(_req, {
    sitzung: { userId: HAUPT }, apiNutzer: { user_id: HAUPT, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' }, t,
  });

  /**
   * Nimmt die Sperre auf eigener Verbindung, führt `fn` aus, gibt sie frei.
   *
   * Die eigene Verbindung ist der Kern: Über `db.run()` liefe das auf einer
   * Verbindung aus dem Vorrat, die danach sofort zurückgeht — und eine
   * Transaktionssperre endet mit der Transaktion. Sie wäre weg, bevor die
   * Route sie bemerken könnte.
   */
  async function mitSperre(userId, scopeKey, fn) {
    const halter = await db.pool.connect();
    try {
      await halter.query('BEGIN');
      await halter.query(SPERR_SQL, schluessel(userId, scopeKey));
      assert.equal(await sperrZeilen(userId, scopeKey, true), 1,
        `Vorbedingung: der Halter hat die Sperre (${userId}, ${scopeKey}) nicht bekommen — ` +
        'dann sagt dieser Fall nichts über die Route');
      return await fn(() => halter.query('COMMIT'));
    } finally {
      // ROLLBACK auch nach einem COMMIT: dann ein wirkungsloser Hinweis, aber
      // nach einer gescheiterten Zusicherung die einzige Stelle, die die
      // offene Transaktion (und damit die Sperre) wieder aufräumt.
      await halter.query('ROLLBACK').catch(() => {});
      halter.release();
    }
  }

  await t.test('A. Sperre auf (Quellkonto, Set) — die Verschiebung wartet', async () => {
    const acq = await erfassungsIds(HAUPT, SN_A);
    assert.equal(acq.length, 1, `Vorbedingung: eine Erfassung für ${SN_A}`);

    await mitSperre(HAUPT, SN_A, async (freigeben) => {
      const v = verschiebe(srv.base, SN_A, acq);
      const befund = await befundWarter(HAUPT, SN_A, () => v.fertig);

      assert.equal(befund, 'wartet', {
        fertig: `Die Verschiebung lief DURCH, während die Sperre auf (${HAUPT}, ${SN_A}) ` +
                'gehalten wurde. Dann nimmt die Route die Sperre nicht — zwei gleichzeitige ' +
                'Verschiebungen desselben Sets lesen denselben Stand, und die zweite ' +
                'schreibt die erste tot.',
        nichts: `Es erschien kein Warter auf (${HAUPT}, ${SN_A}), und fertig wurde die ` +
                'Verschiebung auch nicht. Sie hängt also an etwas anderem — nicht an der ' +
                'Sperre, um die es hier geht.',
      }[befund]);

      // ── Und die Gegenrichtung: nach dem Freigeben muss sie durchgehen ────
      //
      // Ohne diesen Teil wäre „wartet" auch von einer Route erfüllt, die
      // dauerhaft hängt. Eine Sperre, die nie aufgeht, ist kein Fortschritt.
      await freigeben();
      const r = await v.mitSchranke;
      assert.equal(r.status, 200,
        `Nach dem Freigeben kam ${r.status} statt 200 — die Verschiebung lief in die ` +
        'Sperre und kam nicht wieder heraus');
      assert.equal((await db.get(
        `SELECT COUNT(*)::int c FROM set_acquisitions WHERE user_id=$1 AND set_number=$2`,
        [KIND, SN_A])).c, 1,
        'Die Antwort war 200, aber beim Kind liegt keine Erfassung — dann hat die ' +
        'Verschiebung nur quittiert, nicht verschoben');
    });
  });

  await t.test('B. Sperre auf einem ANDEREN Set — sie wartet nicht', async () => {
    // Der Schlüssel der Route muss davon abhängen, WELCHES Set wandert.
    // GEMESSEN: Steht in der Route eine feste Setnummer statt sn, wartet
    // diese Verschiebung mit, und nur dieser Fall wird rot — A bleibt grün.
    // Ohne B stünden alle Verschiebungen eines Kontos hintereinander an, auch
    // die völlig unbeteiligten, und nichts würde es sagen.
    const acq = await erfassungsIds(HAUPT, SN_B);
    assert.equal(acq.length, 1, `Vorbedingung: eine Erfassung für ${SN_B}`);

    await mitSperre(HAUPT, SN_A, async () => {
      const v = verschiebe(srv.base, SN_B, acq);
      const r = await v.mitSchranke;   // wirft, falls sie doch hängt
      assert.equal(r.status, 200,
        `Die Verschiebung von ${SN_B} kam mit ${r.status} zurück, während die Sperre auf ` +
        `(${HAUPT}, ${SN_A}) lag — ein anderes Set darf davon nicht betroffen sein`);
      assert.equal(await sperrZeilen(HAUPT, SN_A, false), 0,
        `Es stand ein Warter auf (${HAUPT}, ${SN_A}) — dann sperrt die Route auf dem ` +
        'Konto und nicht auf (Konto, Set), und zwei fremde Sets blockieren sich');
    });
  });

  await t.test('C. Sperre auf dem ZIELkonto — sie wartet nicht', async () => {
    // Das ist der eigentliche Inhalt von `fromId`: Serialisiert wird über das
    // Konto, aus dem etwas WEGgeht — dort wird gelesen, gerechnet und
    // gelöscht. GEMESSEN: Steht `toId` in der Route, werden A UND dieser Fall
    // rot. Und allein fängt dieser Fall eine Sperre auf BEIDEN Konten: auch
    // GEMESSEN (Gegenprobe e) — A und B bleiben dabei grün, weil (fromId, sn)
    // ja mitgenommen wird, und nur dieser Fall wird rot.
    const acq = await erfassungsIds(HAUPT, SN_C);
    assert.equal(acq.length, 1, `Vorbedingung: eine Erfassung für ${SN_C}`);

    await mitSperre(KIND, SN_C, async () => {
      const v = verschiebe(srv.base, SN_C, acq);
      const r = await v.mitSchranke;
      assert.equal(r.status, 200,
        `Die Verschiebung kam mit ${r.status} zurück, während die Sperre auf dem ZIELkonto ` +
        `(${KIND}, ${SN_C}) lag. Die Route sperrt dann über das falsche Konto.`);
      assert.equal(await sperrZeilen(KIND, SN_C, false), 0,
        `Es stand ein Warter auf (${KIND}, ${SN_C}) — die Route sperrt über das Zielkonto`);
    });
  });
});
