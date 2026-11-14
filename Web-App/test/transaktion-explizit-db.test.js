/**
 * Eine Transaktionsform: In k.transaktion(t => …) fragt der Rumpf über `t`. Eine Abfrage
 * über den ungebundenen Zugang (k.db, ein gefangenes k) wirft UngebundeneAbfrage, statt
 * still in die Transaktion umgeleitet zu werden; Dienste anderer Bereiche, über `t`
 * gerufen, laufen in ihr. Bestandssperren sind eine Option von k.transaktion.
 *
 * Gegenproben (14.11.2026 gemessen, je einzeln):
 *   A  in txStand() (db/database.ts) die Zeile `if (freigabe.getStore() !== t) throw …`
 *      gestrichen → rot: „k.db im Rumpf wirft …“, „ein gefangenes k …“, „ein Dienst eines
 *      anderen Bereichs …“ (k.haushalt lief still in der Transaktion)
 *   B  in gebundenAn() (src/infra/bereich.ts) die Abhängigkeiten ungehüllt weitergereicht
 *      (`aus[name] = wert`) → rot: „ein Dienst eines anderen Bereichs über t …“
 *      (UngebundeneAbfrage aus dem Haushalt)
 *   C  in transaction() (db/database.ts) den Vorlauf mit sperreBestaende() gestrichen → rot:
 *      „eine Bestandssperre hält …“ und „Gegenrichtungen …“ (niemand wartete, bis() lief ab);
 *      ebenso test/lock-namespaces-db.test.js „die Bestandssperre eines Kontos …“
 *   D  in sperreBestaende() die Sortierung gestrichen → rot: „Gegenrichtungen …“
 *      (die zweite wartete auf die Sperre des grösseren Kontos)
 *   F  in anTransaktion() die Zeile `benachrichtigung: huelle(…)` gestrichen → rot: „ein Signal
 *      über t …“ (notify() lief über den ungebundenen Zugang und verschluckte UngebundeneAbfrage)
 *   E  in imSystemrahmen() (src/infra/bereich.ts) statt zu werfen wieder `return f()`
 *      → rot: „ein Dienst im Systemrahmen in einer Transaktion ohne ihn wirft“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testKontext, testZugang, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const dbModul = require(path.join(__dirname, '..', 'dist', 'db', 'database.js'));
const { alsAnfrage, imSystemkontext } = require(path.join(__dirname, '..', 'dist', 'src', 'infra', 'kontoKontext.js'));
const { SystemrahmenInTransaktion } = require(path.join(__dirname, '..', 'dist', 'src', 'infra', 'bereich.js'));

const PID = 'SELECT pg_backend_pid() AS p';
const { bis } = require('./helpers/zeit');
const { LOCKS } = require(path.join(__dirname, '..', 'dist', 'src', 'infra', 'lockNamespaces.js'));

test('Transaktion: ausdrücklich über t', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;
  const k = testKontext('sets');
  const uid = (
    await testDaten().get(
      `INSERT INTO users (username, password_hash) VALUES ('tx_explizit_${process.pid}', 'x') RETURNING id`,
    )
  ).id;
  t.after(async () => {
    await testDaten().run('DELETE FROM users WHERE id = $1', [uid]);
    await testZugang()
      .pool.end()
      .catch(() => {});
  });

  await t.test('k.db im Rumpf wirft, t.db geht über die Transaktion', async () => {
    await k.transaktion(async tt => {
      const eigene = (await tt.db.get(PID)).p;
      await assert.rejects(k.db.get(PID), dbModul.UngebundeneAbfrage);
      await assert.rejects(
        k.db.transaction(async () => {}),
        dbModul.UngebundeneAbfrage,
      );
      assert.equal((await tt.db.get(PID)).p, eigene, 'die Transaktion bleibt benutzbar');
    });
    // Danach ist k wieder frei.
    assert.ok((await k.db.get(PID)).p > 0);
  });

  await t.test('ein Signal über t gehört zur Transaktion und kommt mit dem COMMIT an', async () => {
    const kanal = `tx_explizit_${process.pid}`;
    const horcher = await testZugang().eigeneVerbindung();
    try {
      const gehoert = [];
      horcher.on('notification', m => gehoert.push(m.channel));
      await horcher.query(`LISTEN ${kanal}`);
      await k.transaktion(async tt => {
        await tt.db.benachrichtigung.notify(kanal);
      });
      await bis(() => gehoert.length > 0);
      assert.deepEqual(gehoert, [kanal]);
    } finally {
      await horcher.end();
    }
  });

  await t.test('ein gefangenes k in einer inneren Transaktion wirft ebenso', async () => {
    await k.transaktion(async aussen => {
      await aussen.transaktion(async innen => {
        await innen.db.get('SELECT 1');
        await assert.rejects(k.db.get('SELECT 1'), dbModul.UngebundeneAbfrage);
      });
    });
  });

  await t.test('ein Dienst eines anderen Bereichs über t läuft in der Transaktion', async () => {
    const r = await k.transaktion(async tt => {
      await tt.db.run(`UPDATE users SET username = username WHERE id = $1`, [uid]);
      // blickfeldIds fragt den Haushalt über seinen eigenen Zugang; über t gerufen gehört er dazu.
      const ids = await tt.haushalt.blickfeldIds(uid);
      await assert.rejects(k.haushalt.schreibbereich(uid), dbModul.UngebundeneAbfrage);
      return ids;
    });
    assert.deepEqual(r, [uid]);
  });

  /** Worauf eine andere Verbindung gerade wartet: die Bestandssperre zu diesem Schlüssel? */
  const wartetAuf = async schluessel =>
    !!(await testDaten().get(
      `SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND classid = $1
          AND objid = ((hashtext($2)::bigint + 4294967296) % 4294967296)::oid`,
      [LOCKS.INVENTAR, schluessel],
    ));

  /** Die erste Transaktion hält ihre Sperren, bis `frei()`; die zweite startet von aussen (ein
   * Start im Rumpf der ersten fragte über den ungebundenen Zugang). */
  const halte = async sperren => {
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
    const erste = await halte(sperren);
    const zweite = k.transaktion(async () => ablauf.push('zweite an'), { sperren });
    await bis(() => wartetAuf(`${uid}|probe`));
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
    const erste = await halte([auf(uid), auf(zwei)]);
    const zweite = k.transaktion(async () => {}, { sperren: [auf(zwei), auf(uid)] });
    await bis(async () => (await wartetAuf(`${uid}|x`)) || (await wartetAuf(`${zwei}|x`)));
    const aufKleineres = await wartetAuf(`${uid}|x`);
    erste.frei();
    await Promise.all([erste.fertig, zweite]);
    assert.equal(aufKleineres, true, 'die zweite wartet auf die Sperre des kleineren Kontos');
  });

  await t.test('ein Dienst im Systemrahmen in einer Transaktion ohne ihn wirft', async () => {
    const konto = testKontext('konto');
    await alsAnfrage({ apiUser: { user_id: uid } }, () =>
      konto.transaktion(async tt => {
        await assert.rejects(async () => tt.zugaenge.gueltigerToken('gibt-es-nicht'), SystemrahmenInTransaktion);
      }),
    );
    // Im Systemrahmen geöffnet, gilt er auch für den Dienst.
    assert.equal(
      await imSystemkontext('probe', () => konto.transaktion(tt => tt.zugaenge.gueltigerToken('gibt-es-nicht'))),
      undefined,
    );
  });
});
