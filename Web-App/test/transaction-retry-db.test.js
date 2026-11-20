/**
 * Eine Transaktion, die in einen Deadlock (40P01) oder Serialisierungsfehler
 * (40001) läuft, beginnt mit der Option repeatAtConflict bis zu zweimal
 * neu; ohne Option bleibt der Fehler. Die Verschiebe- und Nachtragswege
 * setzen sie, weil sie Zeilen zweier Konten in wechselnder Reihenfolge sperren.
 *
 * Gegenproben (am 07.11.2026 gemessen, je einzeln):
 *   A  die Wiederholungsschleife in transaction() entfernt → rot: „ein echter
 *      Deadlock wird mit der Option wiederholt“, „Serialisierungsfehler …“,
 *      „der abgebrochene Anlauf hinterlässt nichts“, dazu die drei Aufrufer
 *   B  40001 aus TX_CONFLICT entfernt → rot: „Serialisierungsfehler …“ und
 *      „der abgebrochene Anlauf hinterlässt nichts“
 *   C  die Option aus verschiebeSet() entfernt → rot: „moveSet
 *      wiederholt bei Konflikt“; aus setEstimatedPrice() → rot:
 *      „setEstimatedPrice wiederholt bei Konflikt“
 *      (Der Verschiebeweg in changeAcquisition() braucht ein Haushaltskonto und
 *      ist hier nicht abgedeckt; er teilt k.transaktion mit Sperren mit verschiebeSet.)
 *   D  mitInventarSperre() reicht die Option nicht an transaction() → rot:
 *      „mitInventarSperre reicht die Option weiter“, „moveSet …“
 *      (14.11.2026, jetzt k.transaktion mit `sperren`: in buildContext() die Optionen
 *      nicht an transaction() gereicht → rot: „k.transaktion mit Sperren …“,
 *      „moveSet …“, „setEstimatedPrice …“)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, testContext } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();

const TABELLE = `tx_wiederholung_${process.pid}`;
const MIT = { repeatAtConflict: true };

/** Ein Fehler wie von PostgreSQL gemeldet: nur der Code zählt. */
const pgError = code => Object.assign(new Error(`simuliert ${code}`), { code });

test('Transaktion: Wiederholung bei Deadlock und Serialisierungsfehler', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  await db.run(`CREATE TABLE ${TABELLE} (id int PRIMARY KEY, n int NOT NULL DEFAULT 0)`);
  await db.run(`INSERT INTO ${TABELLE} (id) VALUES (1), (2)`);
  t.after(async () => {
    await db.run(`DROP TABLE IF EXISTS ${TABELLE}`).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  /** Beide Transaktionen sperren zuerst "ihre" Zeile, dann die der anderen; erst wenn beide die erste halten, geht es weiter. */
  const cross = o => {
    let angekommen = 0;
    let versuche = 0;
    /** @type {() => void} */
    let weiter = () => {};
    const beide = new Promise(frei => {
      weiter = () => frei(undefined);
    });
    const lauf = async (erste, zweite) => {
      await db.transaction(async tx => {
        const versuch = ++versuche;
        await tx.run(`UPDATE ${TABELLE} SET n = n + 1 WHERE id = $1`, [erste]);
        // Nur die ersten zwei Anläufe warten aufeinander; die Wiederholung läuft frei.
        if (versuch <= 2) {
          if (++angekommen === 2) weiter();
          await beide;
        }
        await tx.run(`UPDATE ${TABELLE} SET n = n + 1 WHERE id = $1`, [zweite]);
      }, o);
    };
    return { lauf, versuche: () => versuche };
  };

  await t.test('ein echter Deadlock wird mit der Option wiederholt', async () => {
    await db.run(`UPDATE ${TABELLE} SET n = 0`);
    const k = cross(MIT);
    await Promise.all([k.lauf(1, 2), k.lauf(2, 1)]);
    assert.equal(k.versuche(), 3, 'genau ein Gegenspieler wurde abgebrochen und lief neu');
    // Jede Transaktion hat beide Zeilen einmal erhöht; der abgebrochene Anlauf zählt nicht.
    assert.deepEqual(
      (await db.all(`SELECT n FROM ${TABELLE} ORDER BY id`)).map(z => z.n),
      [2, 2],
    );
  });

  await t.test('ohne die Option bleibt der Deadlock ein Fehler', async () => {
    await db.run(`UPDATE ${TABELLE} SET n = 0`);
    const k = cross({});
    const r = await Promise.allSettled([k.lauf(1, 2), k.lauf(2, 1)]);
    const abgelehnt = r.filter(e => e.status === 'rejected');
    assert.equal(abgelehnt.length, 1);
    assert.equal(abgelehnt[0].reason.code, '40P01');
    assert.equal(k.versuche(), 2);
  });

  await t.test('Serialisierungsfehler wird wiederholt, genau zweimal', async () => {
    let n = 0;
    const r = await db.transaction(async () => {
      if (++n < 3) throw pgError('40001');
      return 'fertig';
    }, MIT);
    assert.deepEqual([r, n], ['fertig', 3]);

    let m = 0;
    await assert.rejects(
      db.transaction(async () => {
        m++;
        throw pgError('40001');
      }, MIT),
      { code: '40001' },
    );
    assert.equal(m, 3, 'ein Versuch und zwei Wiederholungen');
  });

  await t.test('andere Fehler und fehlende Option werden nicht wiederholt', async () => {
    let n = 0;
    await assert.rejects(
      db.transaction(async () => {
        n++;
        throw pgError('23505');
      }, MIT),
      { code: '23505' },
    );
    assert.equal(n, 1);
    let m = 0;
    await assert.rejects(
      db.transaction(async () => {
        m++;
        throw pgError('40P01');
      }),
      { code: '40P01' },
    );
    assert.equal(m, 1);
  });

  await t.test('der abgebrochene Anlauf hinterlässt nichts', async () => {
    await db.run(`UPDATE ${TABELLE} SET n = 0`);
    let n = 0;
    await db.transaction(async tx => {
      await tx.run(`UPDATE ${TABELLE} SET n = n + 1 WHERE id = 1`);
      if (++n === 1) throw pgError('40001');
    }, MIT);
    assert.equal((await db.get(`SELECT n FROM ${TABELLE} WHERE id = 1`)).n, 1);
  });

  // Die Aufrufer: Ein Trigger wirft beim ersten Aufruf einen Deadlock (40P01), den die
  // Sequenz auch nach dem Zurückrollen nicht vergisst; der zweite Anlauf geht durch.
  const onceError = async (tabelle, ereignis, bedingung) => {
    const name = `tx_einmal_${tabelle}_${process.pid}`;
    await db.run(`DROP SEQUENCE IF EXISTS ${name}`);
    await db.run(`CREATE SEQUENCE ${name}`);
    await db.run(`CREATE OR REPLACE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN
        IF nextval('${name}') = 1 THEN RAISE EXCEPTION 'simulierter Deadlock' USING ERRCODE = '40P01'; END IF;
        RETURN NEW;
      END $f$`);
    await db.run(`DROP TRIGGER IF EXISTS ${name} ON ${tabelle}`);
    await db.run(
      `CREATE TRIGGER ${name} BEFORE ${ereignis} ON ${tabelle} FOR EACH ROW WHEN (${bedingung}) EXECUTE FUNCTION ${name}()`,
    );
    return {
      aufrufe: async () => Number((await db.get(`SELECT last_value, is_called FROM ${name}`)).last_value),
      weg: async () => {
        await db.run(`DROP TRIGGER IF EXISTS ${name} ON ${tabelle}`);
        await db.run(`DROP FUNCTION IF EXISTS ${name}()`);
        await db.run(`DROP SEQUENCE IF EXISTS ${name}`);
      },
    };
  };
  const konten = [];
  const konto = async name => {
    const id = (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_active, email_verified)
         VALUES ($1, $2, 'x', true, true) RETURNING id`,
        [`${name}_${process.pid}`, `${name}_${process.pid}@example.org`],
      )
    ).id;
    konten.push(id);
    return id;
  };
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [konten]).catch(() => {});
  });

  await t.test('k.transaktion mit Sperren reicht die Option weiter', async () => {
    const k = testContext('inventory');
    const sperren = [{ konto: 1, schluessel: 'x' }];
    let n = 0;
    const r = await k.transaktion(
      async () => {
        if (++n < 2) throw pgError('40P01');
        return 'fertig';
      },
      { ...MIT, sperren },
    );
    assert.deepEqual([r, n], ['fertig', 2]);
    let m = 0;
    await assert.rejects(
      k.transaktion(
        async () => {
          m++;
          throw pgError('40P01');
        },
        { sperren },
      ),
      { code: '40P01' },
    );
    assert.equal(m, 1);
  });

  await t.test('moveSet wiederholt bei Konflikt', async () => {
    const { moveSet } = require('./helpers/sources').areaPage('sets');
    const { holdsSet, quantityOf } = require('./helpers/inventory');
    const von = await konto('wv_von');
    const nach = await konto('wv_nach');
    await holdsSet(db, von, '10179-1', 2);
    // Verschoben wird nur im Haushalt: nach ist Unterkonto von von.
    await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [von, nach]);
    const probe = await onceError('sets', 'INSERT', `NEW.user_id = ${nach}`);
    try {
      const ids = (await db.all('SELECT id FROM set_acquisitions WHERE user_id = $1', [von])).map(z => z.id);
      const r = await moveSet(von, '10179-1', von, nach, ids);
      assert.equal(r.quantity, 2);
      assert.equal(await probe.aufrufe(), 2, 'erster Anlauf scheiterte, zweiter ging durch');
      assert.equal(await quantityOf(db, nach, '10179-1'), 2);
      assert.equal(await quantityOf(db, von, '10179-1'), 0);
    } finally {
      await probe.weg();
    }
  });

  await t.test('setEstimatedPrice wiederholt bei Konflikt', async () => {
    const { setEstimatedPrice } = _req('src/inventory/acquisitions.js');
    const { holdsSet } = require('./helpers/inventory');
    const u = await konto('wv_preis');
    await holdsSet(db, u, '10179-1', 1);
    const id = (await db.get('SELECT id FROM set_acquisitions WHERE user_id = $1', [u])).id;
    const probe = await onceError('set_acquisitions', 'UPDATE', `NEW.user_id = ${u}`);
    try {
      assert.equal(await setEstimatedPrice('set', id, 42), true);
      assert.equal(await probe.aufrufe(), 2, 'erster Anlauf scheiterte, zweiter ging durch');
      const z = await db.get('SELECT purchase_price::float AS p, price_estimated FROM set_acquisitions WHERE id = $1', [
        id,
      ]);
      assert.deepEqual([z.p, z.price_estimated], [42, true]);
    } finally {
      await probe.weg();
    }
  });
});
