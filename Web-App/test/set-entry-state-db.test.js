/**
 * When topping up a set, price and noted condition must match TOGETHER.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { holdsSet } = require('./helpers/inventory');
const db = testData();
const { setUserSetting } = _req('src/settings/userSetting.js');
const { setErfassen } = require('./helpers/sources').areaPage('sets');

test("topping up without a condition follows the user's default", { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { migrieren: false }))) return;

  const name = `zst_${process.pid}`;
  const SET = `90${String(process.pid).slice(-4)}-1`;
  const u = await db.get(
    `INSERT INTO users (username, password_hash) VALUES ($1,'x')
       ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`,
    [name],
  );
  const uid = u.id;

  try {
    // The user collects used.
    await setUserSetting(uid, 'user_default_condition', 'U');

    // ISOLATE the top-up path
    await holdsSet(db, uid, SET, 1, { zustand: 'N' });

    // Acquisition WITHOUT a condition. Pass the price along so that no network call
    // is needed; this is not about the price.
    await setErfassen({ requester: uid, setNumber: SET, menge: 1, kaufpreis: 20, ifPresent: 'aufstocken' });

    const zeilen = await db.all(
      `SELECT id, quantity, condition FROM set_acquisitions
        WHERE user_id=$1 AND set_number=$2 ORDER BY id`,
      [uid, SET],
    );
    assert.equal(
      zeilen.length,
      2,
      `${zeilen.length} Erfassung(en): ${JSON.stringify(zeilen)}. Erwartet sind ` +
        'ZWEI — die Vorbedingung mit "N" und die des Aufstock-Wegs mit dem ' +
        'Standard "U". Eine einzige hiesse, dass die beiden Zustände wieder ' +
        'verschmolzen werden.',
    );
    assert.equal(zeilen[0].condition, 'N', 'Vorbedingung: die Zeile des Helfers');

    const neue = zeilen[1];
    assert.equal(
      neue.condition,
      'U',
      `Die Erfassung des Aufstock-Wegs steht als "${neue.condition}" in der ` +
        'Datenbank, obwohl der Standard des Nutzers "U" ist und der Preis genau ' +
        'dafür geholt wurde. Preis und Vermerk müssen denselben Zustand meinen — ' +
        'sonst zählt der Eintrag in der Finanzansicht in der falschen Gruppe.',
    );
  } finally {
    await db.run(`DELETE FROM set_acquisitions WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM user_settings WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
