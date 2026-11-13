/**
 * Ein Konto entfernen: Protokoll, Zeile und Sitzungen in einer Transaktion,
 * Dateien danach mit Ausgleich (Auftrag „konto_dateien“), wenn sie sich nicht
 * löschen lassen. Ein Ablauf für Verwalter und eigenes Konto (src/konto/kontoEntfernen.ts).
 *
 * Gegenproben (09.11.2026 gemessen, je einzeln):
 *   A  in kontoEntfernen() Sitzungsversion und Sitzungen erst nach der Transaktion
 *      gelöscht → rot: „scheitert ein Schritt, bleibt alles, wie es war“ (Konto weg)
 *   B  protokolliere() nach der Transaktion → rot: dieselbe Prüfung (Eintrag ohne Löschung)
 *   C  in kontoDateienEntfernen() den Fang entfernt → rot: „liegen die Dateien
 *      fest, übernimmt ein Auftrag“ (die Löschung meldet einen Fehler)
 *
 * Die Sitzungslöschung scheitert an einem Trigger in der Datenbank (wie ein echter
 * Fehler dort), nicht an einem umgebogenen Modul. A am 13.11.2026 so wiederholt: rot.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');

test('Konto entfernen', { concurrency: 1 }, async t => {
  const db = await datenOderSkip(t, _req);
  if (!db) return;
  const { kontoEntfernen, kontoDateienEntfernen } = _req('src/konto/kontoEntfernen.js');
  const P = process.pid;
  const VERW = `entf-verw-${P}`,
    ZIEL = `entf-ziel-${P}`;
  const weg = async () => {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [[VERW, ZIEL]]);
    await db.run("DELETE FROM auftraege WHERE art = 'konto_dateien'");
  };
  await weg();
  const verw = (
    await db.get(
      "INSERT INTO users (username, password_hash, is_admin, is_active) VALUES ($1, 'x', true, true) RETURNING id",
      [VERW],
    )
  ).id;
  const neu = async () =>
    (await db.get("INSERT INTO users (username, password_hash, is_active) VALUES ($1, 'x', true) RETURNING id", [ZIEL]))
      .id;
  const sitzung = uid =>
    db.run(`INSERT INTO user_sessions (sid, sess, expire) VALUES ($1, $2, NOW() + interval '1 hour')`, [
      `entf-${uid}`,
      JSON.stringify({ userId: uid, cookie: {} }),
    ]);
  const stand = async uid => ({
    konto: !!(await db.get('SELECT 1 FROM users WHERE id = $1', [uid])),
    sitzungen: (
      await db.get("SELECT COUNT(*)::int AS n FROM user_sessions WHERE sess::jsonb->>'userId' = $1", [String(uid)])
    ).n,
    protokoll: (
      await db.get(
        "SELECT COUNT(*)::int AS n FROM verwaltungsprotokoll WHERE ziel_id = $1 AND aktion = 'konto_geloescht'",
        [uid],
      )
    ).n,
  });
  t.after(async () => {
    await weg().catch(() => {});
    await db.run("DELETE FROM user_sessions WHERE sid LIKE 'entf-%'").catch(() => {});
    await db.pool.end().catch(() => {});
  });

  await t.test('scheitert ein Schritt, bleibt alles, wie es war', async () => {
    const ziel = await neu();
    await sitzung(ziel);
    await db.exec(`CREATE FUNCTION entf_sperre() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Sitzungen nicht löschbar'; END $$;
      CREATE TRIGGER entf_sperre BEFORE DELETE ON user_sessions
        FOR EACH ROW WHEN (OLD.sid = 'entf-${ziel}') EXECUTE FUNCTION entf_sperre()`);
    try {
      await assert.rejects(kontoEntfernen(ziel, verw), /Sitzungen nicht löschbar/);
    } finally {
      await db.exec('DROP TRIGGER entf_sperre ON user_sessions; DROP FUNCTION entf_sperre()');
    }
    assert.deepEqual(await stand(ziel), { konto: true, sitzungen: 1, protokoll: 0 });
    await db.run('DELETE FROM users WHERE id = $1', [ziel]);
    await db.run('DELETE FROM user_sessions WHERE sid = $1', [`entf-${ziel}`]);
  });

  await t.test('gelingt es, sind Konto und Sitzungen weg und protokolliert', async () => {
    const ziel = await neu();
    await sitzung(ziel);
    assert.equal(await kontoEntfernen(ziel, verw), 'entfernt');
    assert.deepEqual(await stand(ziel), { konto: false, sitzungen: 0, protokoll: 1 });
    assert.equal(await kontoEntfernen(ziel, verw), 'nicht_gefunden');
    assert.equal(await kontoEntfernen(verw, verw), 'nicht_gefunden', 'das eigene Konto nicht über den Verwalterweg');
  });

  await t.test('liegen die Dateien fest, übernimmt ein Auftrag', async () => {
    const echt = fs.promises.rm;
    fs.promises.rm = async () => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    };
    let r;
    try {
      r = await kontoDateienEntfernen(987654);
    } finally {
      fs.promises.rm = echt;
    }
    assert.equal(r, 'eingereiht');
    const a = await db.get(
      "SELECT nutzlast, schluessel FROM auftraege WHERE art = 'konto_dateien' AND schluessel = $1",
      ['konto_dateien:987654'],
    );
    assert.ok(a, 'kein Auftrag zum Wiederholen');
    assert.equal(a.nutzlast.user_id, 987654);
    assert.equal(await kontoDateienEntfernen(987654), 'entfernt', 'ohne Störung geht es gleich');
  });
});
