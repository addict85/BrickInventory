/**
 * Auch der Import (CSV, Wanted-XML) erfasst über setErfassen(): ohne Netz, Set,
 * Erfassung, Lagerort und Nacharbeit in einer Transaktion. Getippt heisst ein Set
 * im Blickfeld „exists“; ein Import stockt beim Besitzer auf und legt es im eigenen
 * Konto an, wenn nur ein anderes im Haushalt es hat (die Datei ist sein Bestand).
 *
 * Gegenproben (14.11.2026 gemessen):
 *   A  im Aufstock-Zweig die Nacharbeit nach der Transaktion eingestellt (wie das
 *      frühere addSet, Fehler mit versuche() verschluckt) → rot: „scheitert die
 *      Nacharbeit, ist nichts gebucht“
 *   B  im Aufstock-Zweig vor dem Buchen `await t.katalog.getSetInfo(sn)` → rot:
 *      „ein Import stockt beim Besitzer auf, ohne Netz“
 *   C  den Aufstock-Zweig nie betreten (immer „melden“) → rot: „ein Import stockt
 *      beim Besitzer auf …“ (exists statt updated)
 *   D  im Aufstock-Zweig wieder der Vorgabe-Lagerort gesetzt → rot: „ein Import
 *      ohne Ort lässt den Lagerort stehen“
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testQuellen, testBildwerk, alsKonto } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');

test('Set erfassen: ein Weg für Eingabe und Import', { concurrency: 1 }, async t => {
  const db = await datenOderSkip(t, _req);
  if (!db) return;
  const netz = [];
  testQuellen(t, {
    holeSet: async sn => {
      netz.push(sn);
      return null;
    },
    getSetInfo: async sn => {
      netz.push(sn);
      return null;
    },
  });
  testBildwerk(t, { setBildLaden: async () => null });
  const sets = require('./helpers/sources').bereichsSeite('sets');
  const P = process.pid % 100000;
  const HAUPT = `einweg-h-${P}`,
    KIND = `einweg-k-${P}`;
  const SN = `${60000 + (P % 9000)}-1`,
    FREMD = `${50000 + (P % 9000)}-1`;
  const FUNKTION = `einweg_sperre_${P}`;
  const weg = async () => {
    await db.exec(`DROP TRIGGER IF EXISTS ${FUNKTION} ON auftraege; DROP FUNCTION IF EXISTS ${FUNKTION}();`);
    for (const sn of [SN, FREMD]) {
      await db.run("DELETE FROM auftraege WHERE art = 'nacharbeit' AND nutzlast->>'set_number' = $1", [sn]);
      await db.run('DELETE FROM rb_sets WHERE set_num = $1', [sn]);
    }
    await db.run('DELETE FROM users WHERE username = ANY($1)', [[HAUPT, KIND]]);
  };
  await weg();
  t.after(async () => {
    await weg();
    await db.pool.end().catch(() => {});
  });
  const neu = async n =>
    (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [n])).id;
  const h = await neu(HAUPT),
    k = await neu(KIND);
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [h, k]);
  const menge = async (uid, sn) =>
    (
      await db.get(
        'SELECT COALESCE(SUM(quantity), 0)::int AS n FROM set_acquisitions WHERE user_id = $1 AND set_number = $2',
        [uid, sn],
      )
    ).n;
  const erfasse = (uid, e) => alsKonto(uid, () => sets.setErfassen({ anfragender: uid, ...e }));

  await t.test('kein Netz beim Import, Nacharbeit in derselben Transaktion', async () => {
    const r = await erfasse(h, {
      setNumber: SN,
      menge: 1,
      lagerort: 'Kiste 1',
      wennVorhanden: 'aufstocken',
      nacharbeit: 'csv',
    });
    assert.equal(r.action, 'added');
    const auftrag = await db.get(
      "SELECT nutzlast->>'art' AS art FROM auftraege WHERE art = 'nacharbeit' AND nutzlast->>'set_number' = $1",
      [SN],
    );
    assert.equal(auftrag?.art, 'csv');
    assert.deepEqual(netz, []);
  });

  await t.test('ein Import stockt beim Besitzer auf, ohne Netz', async () => {
    // Eine Vorgabe des Kontos: Sie darf das schon einsortierte Set nicht verschieben (unten).
    const vorgabe = await db.get(`INSERT INTO storage_locations (user_id, name) VALUES ($1, 'Vorgabe') RETURNING id`, [
      h,
    ]);
    await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'default_storage_id', $2)`, [
      h,
      String(vorgabe.id),
    ]);
    const r = await erfasse(h, { setNumber: SN, menge: 2, wennVorhanden: 'aufstocken' });
    assert.equal(r.action, 'updated');
    assert.equal(await menge(h, SN), 3);
    assert.deepEqual(netz, [], 'kein Netz beim Import');
  });

  await t.test('ein Import ohne Ort lässt den Lagerort stehen', async () => {
    const ort = await db.get(
      'SELECT l.name FROM sets s JOIN storage_locations l ON l.id = s.storage_id WHERE s.user_id = $1 AND s.set_number = $2',
      [h, SN],
    );
    assert.equal(ort?.name, 'Kiste 1');
  });

  await t.test('getippt heisst ein Set im Blickfeld „exists“', async () => {
    const r = await erfasse(h, { setNumber: SN, menge: 1 });
    assert.equal(r.action, 'exists');
    assert.equal(await menge(h, SN), 3);
  });

  await t.test('hat nur das andere Konto das Set, legt der Import es im eigenen an', async () => {
    assert.equal((await erfasse(k, { setNumber: FREMD, menge: 1 })).action, 'added');
    assert.equal((await erfasse(h, { setNumber: FREMD, menge: 1 })).action, 'exists', 'getippt: im Blickfeld');
    assert.equal((await erfasse(h, { setNumber: FREMD, menge: 1, wennVorhanden: 'aufstocken' })).action, 'added');
    assert.equal(await menge(h, FREMD), 1);
    assert.equal(await menge(k, FREMD), 1);
  });

  await t.test('scheitert die Nacharbeit, ist nichts gebucht', async () => {
    await db.exec(`
      CREATE FUNCTION ${FUNKTION}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.art = 'nacharbeit' AND NEW.nutzlast->>'set_number' = '${SN}' THEN RAISE EXCEPTION 'Auftrag abgelehnt'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER ${FUNKTION} BEFORE INSERT ON auftraege FOR EACH ROW EXECUTE FUNCTION ${FUNKTION}();`);
    await db.run("DELETE FROM auftraege WHERE art = 'nacharbeit' AND nutzlast->>'set_number' = $1", [SN]);
    await assert.rejects(erfasse(h, { setNumber: SN, menge: 1, wennVorhanden: 'aufstocken' }), /Auftrag abgelehnt/);
    assert.equal(await menge(h, SN), 3);
  });
});
