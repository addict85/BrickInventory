/**
 * Eine Transaktionsform: In k.transaktion(t => …) fragt der Rumpf über `t`. Eine Abfrage
 * über den ungebundenen Zugang (k.db, ein gefangenes k) wirft UnboundQuery, statt
 * still in die Transaktion umgeleitet zu werden; Dienste anderer Bereiche, über `t`
 * gerufen, laufen in ihr. Bestandssperren sind eine Option von k.transaktion.
 *
 * Gegenproben (14.11.2026 gemessen, je einzeln):
 *   A  in txStand() (db/database.ts) die Zeile `if (freigabe.getStore() !== t) throw …`
 *      gestrichen → rot: „k.db im Rumpf wirft …“, „ein gefangenes k …“, „ein Dienst eines
 *      anderen Bereichs …“ (k.household lief still in der Transaktion)
 *   B  in gebundenAn() (src/infra/area.ts) die Abhängigkeiten ungehüllt weitergereicht
 *      (`aus[name] = wert`) → rot: „ein Dienst eines anderen Bereichs über t …“
 *      (UnboundQuery aus dem Haushalt)
 *   C  in transaction() (db/database.ts) den Vorlauf mit lockInventories() gestrichen → rot:
 *      „eine Bestandssperre hält …“ und „Gegenrichtungen …“ (niemand wartete, bis() lief ab);
 *      ebenso test/lock-namespaces-db.test.js „die Bestandssperre eines Kontos …“
 *   D  in lockInventories() die Sortierung gestrichen → rot: „Gegenrichtungen …“
 *      (die zweite wartete auf die Sperre des grösseren Kontos)
 *   F  in anTransaktion() die Zeile `notification: huelle(…)` gestrichen → rot: „ein Signal
 *      über t …“ (notify() lief über den ungebundenen Zugang und verschluckte UnboundQuery)
 *   E  in imSystemrahmen() (src/infra/area.ts) statt zu werfen wieder `return f()`
 *      → rot: „ein Dienst im Systemrahmen in einer Transaktion ohne ihn wirft“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testContext, testAccess, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const dbModule = require(path.join(__dirname, '..', 'dist', 'db', 'database.js'));
const { asRequest, inSystemContext } = require(path.join(__dirname, '..', 'dist', 'src', 'infra', 'accountContext.js'));
const { SystemrahmenInTransaction } = require(path.join(__dirname, '..', 'dist', 'src', 'infra', 'area.js'));

const PID = 'SELECT pg_backend_pid() AS p';
const { bis } = require('./helpers/time');
const { LOCKS } = require(path.join(__dirname, '..', 'dist', 'src', 'infra', 'lockNamespaces.js'));

test('Transaktion: ausdrücklich über t', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const k = testContext('sets');
  const uid = (
    await testData().get(
      `INSERT INTO users (username, password_hash) VALUES ('tx_explizit_${process.pid}', 'x') RETURNING id`,
    )
  ).id;
  t.after(async () => {
    await testData().run('DELETE FROM users WHERE id = $1', [uid]);
    await testAccess()
      .pool.end()
      .catch(() => {});
  });

  await t.test('k.db im Rumpf wirft, t.db geht über die Transaktion', async () => {
    await k.transaktion(async tt => {
      const eigene = (await tt.db.get(PID)).p;
      await assert.rejects(k.db.get(PID), dbModule.UnboundQuery);
      await assert.rejects(
        k.db.transaction(async () => {}),
        dbModule.UnboundQuery,
      );
      assert.equal((await tt.db.get(PID)).p, eigene, 'die Transaktion bleibt benutzbar');
    });
    // Danach ist k wieder frei.
    assert.ok((await k.db.get(PID)).p > 0);
  });

  await t.test('ein Signal über t gehört zur Transaktion und kommt mit dem COMMIT an', async () => {
    const kanal = `tx_explizit_${process.pid}`;
    const listener = await testAccess().ownConnection();
    try {
      const gehoert = [];
      listener.on('notification', m => gehoert.push(m.channel));
      await listener.query(`LISTEN ${kanal}`);
      await k.transaktion(async tt => {
        await tt.db.notification.notify(kanal);
      });
      await bis(() => gehoert.length > 0);
      assert.deepEqual(gehoert, [kanal]);
    } finally {
      await listener.end();
    }
  });

  await t.test('ein gefangenes k in einer inneren Transaktion wirft ebenso', async () => {
    await k.transaktion(async aussen => {
      await aussen.transaktion(async innen => {
        await innen.db.get('SELECT 1');
        await assert.rejects(k.db.get('SELECT 1'), dbModule.UnboundQuery);
      });
    });
  });

  await t.test('ein Dienst eines anderen Bereichs über t läuft in der Transaktion', async () => {
    const r = await k.transaktion(async tt => {
      await tt.db.run(`UPDATE users SET first_name = first_name WHERE id = $1`, [uid]);
      // scopeIds fragt den Haushalt über seinen eigenen Zugang; über t gerufen gehört er dazu.
      const ids = await tt.household.scopeIds(uid);
      await assert.rejects(k.household.schreibbereich(uid), dbModule.UnboundQuery);
      return ids;
    });
    assert.deepEqual(r, [uid]);
  });

  /** Worauf eine andere Verbindung gerade wartet: die Bestandssperre zu diesem Schlüssel? */
  const waitsOn = async schluessel =>
    !!(await testData().get(
      `SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND classid = $1
          AND objid = ((hashtext($2)::bigint + 4294967296) % 4294967296)::oid`,
      [LOCKS.INVENTORY, schluessel],
    ));

  /** Die erste Transaktion hält ihre Sperren, bis `frei()`; die zweite startet von aussen (ein
   * Start im Rumpf der ersten fragte über den ungebundenen Zugang). */
  const hold = async sperren => {
    /** @type {(w?: unknown) => void} */
    let drin = () => {};
    /** @type {(w?: unknown) => void} */
    let frei = () => {};
    const innen = new Promise(r => {
      drin = r;
    });
    const raus = new Promise(r => {
      frei = r;
    });
    const fertig = k.transaktion(
      async () => {
        drin();
        await raus;
      },
      { sperren },
    );
    await innen;
    return { frei, fertig };
  };

  await t.test('eine Bestandssperre hält die zweite Transaktion auf, bis die erste endet', async () => {
    const sperren = [{ konto: uid, schluessel: 'probe' }];
    const ablauf = [];
    const erste = await hold(sperren);
    const zweite = k.transaktion(async () => ablauf.push('zweite an'), { sperren });
    await bis(() => waitsOn(`${uid}|probe`));
    ablauf.push('erste aus');
    erste.frei();
    await Promise.all([erste.fertig, zweite]);
    assert.deepEqual(ablauf, ['erste aus', 'zweite an']);
  });

  await t.test('Gegenrichtungen verklemmen nicht: gesperrt wird aufsteigend', async () => {
    // Hält die erste beide Sperren, wartet die zweite auf ihre ERSTE. Aufsteigend ist das die
    // des kleineren Kontos, egal in welcher Reihenfolge sie genannt sind.
    const zwei = uid + 1_000_000;
    const auf = konto => ({ konto, schluessel: 'x' });
    const erste = await hold([auf(uid), auf(zwei)]);
    const zweite = k.transaktion(async () => {}, { sperren: [auf(zwei), auf(uid)] });
    await bis(async () => (await waitsOn(`${uid}|x`)) || (await waitsOn(`${zwei}|x`)));
    const onSmaller = await waitsOn(`${uid}|x`);
    erste.frei();
    await Promise.all([erste.fertig, zweite]);
    assert.equal(onSmaller, true, 'die zweite wartet auf die Sperre des kleineren Kontos');
  });

  await t.test('ein Dienst im Systemrahmen in einer Transaktion ohne ihn wirft', async () => {
    const konto = testContext('account');
    await asRequest({ apiUser: { user_id: uid } }, () =>
      konto.transaktion(async tt => {
        await assert.rejects(async () => tt.zugaenge.validToken('gibt-es-nicht'), SystemrahmenInTransaction);
      }),
    );
    // Im Systemrahmen geöffnet, gilt er auch für den Dienst.
    assert.equal(
      await inSystemContext('probe', () => konto.transaktion(tt => tt.zugaenge.validToken('gibt-es-nicht'))),
      undefined,
    );
  });
});
