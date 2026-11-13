/**
 * Eine Abfrage mit Konto ausserhalb einer Transaktion (db/database.ts abfrage()):
 * BEGIN mit Kontext, Abfrage und COMMIT gehen in der Pipeline zugleich hinaus. Ein
 * Roundtrip, und der Kontext endet mit der Transaktion, auch wenn die Abfrage scheitert.
 * Geprüft als Laufzeitrolle mit einer einzigen Verbindung, damit jede Anfrage die
 * Verbindung der vorigen erbt.
 *
 * Gegenproben (am 13.11.2026 gemessen, je einzeln):
 *   A  kontextSql(): set_config(…, false) statt true → rot: „nach einer Anfrage mit
 *      Konto …“, „nach einer gescheiterten …“, „abwechselnd …“
 *   B  abfrage() wieder nacheinander (await je Teil) → rot: „ein Roundtrip …“ (3)
 *   C  in abfrage() ohne 'COMMIT' und ohne die Leerlaufprüfung → rot: „nach einer
 *      Anfrage mit Konto …“, „nach einer gescheiterten …“, „abwechselnd …“; ohne
 *      'COMMIT' allein grün: Die Prüfung verwirft die Verbindung.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const q = require('./helpers/sources');
const _req = q.buildAndRequire();
const { zugangOderSkip, fehltVoraussetzung } = require('./helpers/db');
const { erzeugeDb, dbKonfigAusUmgebung } = require(path.join(q.DIST, 'db', 'database.js'));
const { imNamenVon } = _req('src/infra/kontoKontext.js');

const als = (uid, f) => imNamenVon({ apiUser: { user_id: uid } }, f);
const ids = zeilen => [...new Set(zeilen.map(z => Number(z.user_id)))].sort((x, y) => x - y);

/** Zählt Richtungswechsel: Schickt der Client nach einer Antwort wieder, beginnt ein neuer Roundtrip. */
function zaehlenderVermittler(ziel) {
  const stand = { roundtrips: 0, antwortKam: true };
  const srv = net.createServer(a => {
    const b = net.connect(Number(ziel.port || 5432), ziel.hostname);
    a.on('data', d => {
      if (stand.antwortKam) stand.roundtrips++;
      stand.antwortKam = false;
      b.write(d);
    });
    b.on('data', d => {
      stand.antwortKam = true;
      a.write(d);
    });
    for (const [x, y] of [
      [a, b],
      [b, a],
    ]) {
      x.on('error', () => y.destroy());
      x.on('close', () => y.destroy());
    }
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, stand })));
}

test('Kontext je Abfrage in der Pipeline', { concurrency: 1 }, async t => {
  const zugang = await zugangOderSkip(t, _req);
  if (!zugang) return;
  t.after(() => zugang.pool.end().catch(() => {}));
  if (!process.env.TEST_DB_EIGEN_URL || (await zugang.alsSuperuserVerbunden()))
    return fehltVoraussetzung(t, 'die App läuft als Superuser (nur npm test trennt Rollen)');
  const k = dbKonfigAusUmgebung();
  // Testdaten schreibt die Eigentümerin, am Zeilenschutz vorbei.
  const eigen = erzeugeDb({ ...k, verbindung: { connectionString: process.env.TEST_DB_EIGEN_URL }, system: null });
  const app = erzeugeDb({ ...k, pool: { ...k.pool, max: 1 } });
  t.after(async () => {
    await app.pool.end().catch(() => {});
    await eigen.pool.end().catch(() => {});
  });

  const konto = async name =>
    (
      await eigen.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [
        `kp_${name}_${process.pid}`,
      ])
    ).id;
  const A = await konto('a'),
    B = await konto('b');
  for (const u of [A, B]) await eigen.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '10001-1')`, [u]);
  const alleSets = () => app.all('SELECT user_id FROM sets');
  const konto_ = () => app.get(`SELECT current_setting('app.konto', true) AS k`);

  await t.test('nach einer Anfrage mit Konto sieht die nächste ohne Konto nichts', async () => {
    assert.deepEqual(ids(await als(A, alleSets)), [A]);
    assert.deepEqual(await alleSets(), []);
    assert.ok(!(await konto_())?.k, 'die Verbindung trägt kein Konto weiter');
  });

  await t.test('nach einer gescheiterten Abfrage mit Konto bleibt kein Kontext an der Verbindung', async () => {
    await assert.rejects(
      als(A, () => app.all('SELECT 1 / (count(*) - count(*)) FROM sets')),
      /division by zero/,
    );
    await assert.rejects(
      als(A, () => app.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '10002-1')`, [B])),
      /row-level security/,
    );
    assert.deepEqual(await alleSets(), []);
    assert.deepEqual(ids(await als(B, alleSets)), [B], 'die Verbindung ist danach benutzbar');
    assert.equal((await eigen.get(`SELECT count(*)::int AS n FROM sets WHERE set_number = '10002-1'`)).n, 0);
  });

  await t.test('abwechselnd und gleichzeitig: jede Anfrage sieht nur ihr Konto', async () => {
    const wer = Array.from({ length: 30 }, (_, i) => [A, B, null][i % 3]);
    const gesehen = await Promise.all(wer.map(u => (u ? als(u, alleSets) : alleSets())));
    for (const [i, zeilen] of gesehen.entries()) assert.deepEqual(ids(zeilen), wer[i] ? [wer[i]] : [], `Anfrage ${i}`);
  });

  await t.test('ein Roundtrip für eine Abfrage mit Konto', async () => {
    const ziel = new URL(process.env.DATABASE_URL);
    const { srv, stand } = await zaehlenderVermittler(ziel);
    const ueber = new URL(ziel);
    ueber.hostname = '127.0.0.1';
    ueber.port = String(srv.address().port);
    const nah = erzeugeDb({ ...k, verbindung: { connectionString: ueber.toString() }, pool: { ...k.pool, max: 1 } });
    try {
      await nah.get('SELECT 1');
      stand.roundtrips = 0;
      assert.deepEqual(ids(await als(A, () => nah.all('SELECT user_id FROM sets'))), [A]);
      assert.equal(stand.roundtrips, 1);
    } finally {
      await nah.pool.end();
      srv.close();
    }
  });
});
