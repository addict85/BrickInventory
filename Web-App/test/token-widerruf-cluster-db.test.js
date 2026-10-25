/**
 * Ein Token-Widerruf wirkt in allen Workern sofort, nicht erst nach 60 s.
 *
 * Jeder Worker hält einen eigenen Token-Cache (TOKEN_TTL_MS). Widerruft
 * Worker A, bediente Worker B den Token bis zur Frist weiter. Hier wird der
 * zweite Worker nachgestellt: Der Cache ist gefüllt, die Zeile wird „von
 * aussen" gelöscht, und erst das Signal leert ihn.
 *
 * Gegenproben (am 25.10. gemessen):
 *   A  horcheAufTokenWiderruf() leer gemacht      → rot: „bedient den
 *      widerrufenen Token weiter"
 *   B  meldeTokenWiderruf() in revokeAllTokens weg → rot: „kein NOTIFY"
 *
 * Dass server.ts den Empfang in jedem Worker anmeldet, prüft
 * signale-zwei-worker-db.test.js am echten Cluster.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db     = _req('db/database.js');
const auth   = _req('utils/auth.js');
const notify = _req('utils/pgNotify.js');

const warte = (ms) => new Promise(r => setTimeout(r, ms));

/** Wartet, bis der eigene Lauscher eine Meldung mit Payload sieht. */
function naechsteMeldung(lauscher, sekunden = 3) {
  return new Promise((auf, ab) => {
    const uhr = setTimeout(() => ab(new Error(
      `kein NOTIFY auf "${auth.TOKEN_KANAL}" innerhalb von ${sekunden} s`)), sekunden * 1000);
    const h = (m) => {
      if (m.channel !== auth.TOKEN_KANAL) return;
      clearTimeout(uhr); lauscher.removeListener('notification', h); auf(m);
    };
    lauscher.on('notification', h);
  });
}

test('Token-Widerruf gilt clusterweit', { concurrency: 1 }, async (t) => {
  try { await db.get('SELECT 1'); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  const name = `tw_${process.pid}`;
  const uid = (await db.get(
    `INSERT INTO users (username, password_hash) VALUES ($1,'x')
       ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`, [name])).id;

  let lauscher = null;
  try {
    lauscher = await db.eigeneVerbindung();
    await lauscher.query(`LISTEN ${auth.TOKEN_KANAL}`);

    await t.test('alle vier Widerrufswege senden das Signal', async () => {
      for (const [was, ausloesen] of [
        ['invalidateToken (Abmelden)',          () => auth.invalidateToken('irgendein-token')],
        ['leereTokenCache (Token-Verwaltung)',  () => auth.leereTokenCache()],
        ['revokeAllTokens (Passwortwechsel)',   () => auth.revokeAllTokens(uid)],
        ['deleteToken',                         () => auth.deleteToken('irgendein-token')],
      ]) {
        const kommt = naechsteMeldung(lauscher);
        await ausloesen();
        await assert.doesNotReject(kommt, `${was}: die anderen Worker erfahren nichts`);
      }
    });

    await t.test('ein anderer Worker leert seinen Cache auf das Signal', async () => {
      // Empfang anmelden wie server.ts, und abwarten, bis die Verbindung steht
      // (beim Verbinden wird einmal geleert — das darf nicht mitgezählt werden).
      auth.horcheAufTokenWiderruf();
      let verbunden = false;
      notify.listen(auth.TOKEN_KANAL, () => { verbunden = true; });
      for (let i = 0; i < 50 && !verbunden; i++) await warte(100);
      assert.ok(verbunden, 'pgNotify hat sich nicht verbunden');

      const token = await auth.createToken(uid, 'Test');
      assert.ok(await auth.validateToken(token), 'Vorbedingung: der Token gilt');

      // Der Widerruf auf „Worker A": Zeile weg, ohne den Cache HIER zu leeren.
      await db.run('DELETE FROM api_tokens WHERE user_id = $1', [uid]);
      assert.ok(await auth.validateToken(token),
        'Gegenprobe: ohne Signal bedient der Cache den gelöschten Token noch — ' +
        'sonst prüft der Fall darunter nichts');

      // Das Signal von „Worker A" — über die Datenbank, wie im Betrieb.
      const kommt = naechsteMeldung(lauscher);
      await notify.notify(auth.TOKEN_KANAL);
      await kommt;
      await warte(200);   // der Empfänger hängt an einer eigenen Verbindung
      assert.equal(await auth.validateToken(token), null,
        'Nach dem Signal bedient dieser Worker den widerrufenen Token weiter');
    });

  } finally {
    if (lauscher) await lauscher.end().catch(() => {});
    await notify.close().catch(() => {});
    await db.run('DELETE FROM api_tokens WHERE user_id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
