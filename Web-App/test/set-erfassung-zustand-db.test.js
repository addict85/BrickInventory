/**
 * Beim Aufstocken eines Sets müssen Preis und vermerkter Zustand ZUSAMMEN passen.
 * Ausführlich: docs/begruendungen/test/set-erfassung-zustand-db.test.js.md#kopf
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// Der Nachzug nach dem Erfassen (src/sets/nachErfassung.ts) wird abgefangen.
// Ausführlich: docs/begruendungen/test/set-erfassung-zustand-db.test.js.md#module
const Module = require('node:module');
const _echtesRequire = Module.prototype.require;
Module.prototype.require = function (name) {
  const m = _echtesRequire.apply(this, arguments);
  if (typeof name === 'string' && /sets[/\\]nachErfassung(\.js)?$/.test(name))
    return new Proxy(m, { get: (t, k) =>
      (k === 'zieheNach' || k === 'zieheNachNeuanlage') ? () => {} : t[k] });
  return m;
};

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { haeltSet } = require('./helpers/bestand');
const db = _req('db/database.js');
const { setUserSetting } = _req('src/konto/nutzerEinstellung.js');
const { addSet } = _req('src/sets/setService.js');

test('aufstocken ohne Zustandsangabe folgt dem Standard des Nutzers', { concurrency: 1 }, async (t) => {
  if (!await dbOderSkip(t, _req, { migrieren: false })) return;

  const name = `zst_${process.pid}`;
  const SET = `90${String(process.pid).slice(-4)}-1`;
  const u = await db.get(
    `INSERT INTO users (username, password_hash) VALUES ($1,'x')
       ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`, [name]);
  const uid = u.id;

  try {
    // Der Nutzer sammelt gebraucht.
    await setUserSetting(uid, 'user_default_condition', 'U');

    // Den Aufstock-Weg ISOLIEREN
    // Ausführlich: docs/begruendungen/test/set-erfassung-zustand-db.test.js.md#stelle
    await haeltSet(db, uid, SET, 1, { zustand: 'N' });

    // Erfassung OHNE Zustandsangabe. Preis mitgeben, damit kein Netzaufruf
    // nötig ist; um den Preis geht es hier nicht.
    await addSet(SET, 1, uid, null, 20, null);

    const zeilen = await db.all(
      `SELECT id, quantity, condition FROM set_acquisitions
        WHERE user_id=$1 AND set_number=$2 ORDER BY id`, [uid, SET]);
    assert.equal(zeilen.length, 2,
      `${zeilen.length} Erfassung(en): ${JSON.stringify(zeilen)}. Erwartet sind ` +
      'ZWEI — die Vorbedingung mit "N" und die des Aufstock-Wegs mit dem ' +
      'Standard "U". Eine einzige hiesse, dass die beiden Zustände wieder ' +
      'verschmolzen werden.');
    assert.equal(zeilen[0].condition, 'N', 'Vorbedingung: die Zeile des Helfers');

    const neue = zeilen[1];
    assert.equal(neue.condition, 'U',
      `Die Erfassung des Aufstock-Wegs steht als "${neue.condition}" in der ` +
      'Datenbank, obwohl der Standard des Nutzers "U" ist und der Preis genau ' +
      'dafür geholt wurde. Preis und Vermerk müssen denselben Zustand meinen — ' +
      'sonst zählt der Eintrag in der Finanzansicht in der falschen Gruppe.');
  } finally {
    await db.run(`DELETE FROM set_acquisitions WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM user_settings WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
