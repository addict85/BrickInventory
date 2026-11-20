/**
 * Es bleibt immer ein aktiver Verwalter, auch wenn zwei Verwalter sich
 * gleichzeitig entziehen, deaktivieren oder löschen. Vorher schützte nur das
 * eigene Konto: Beide sahen den jeweils anderen noch als Verwalter.
 *
 * Gegenproben (am 07.11.2026 gemessen, je einzeln):
 *   A  die Sperre (pg_advisory_xact_lock) in belowAdminLock() entfernt →
 *      rot: „gleichzeitiger Entzug der Rolle“, „gleichzeitiges Deaktivieren“,
 *      „gleichzeitiges Löschen“, „Entzug gegen Deaktivieren“ (beide Aufrufe gelangen durch)
 *   B  die Bedingung ANDERER_VERWALTER aus dem UPDATE in setAdmin()
 *      entfernt → rot: „der letzte Verwalter behält die Rolle“ und der
 *      gleichzeitige Entzug
 *   C  (13.11.2026) in belowAdminLock() die Prüfung inTransaction() gestrichen
 *      → rot: „der letzte Verwalter behält …“ (deleteAccount ohne Transaktion lief durch)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const K = { ..._req('src/account/accounts.js'), ...require('./helpers/sources').testArea('account').konten };
/** Die Absage wirft der Dienst; hier wird sie zum Wert, damit gleichzeitige Aufrufe zählbar bleiben. */
const LAST = 'letzter_verwalter';
const alsWert = p => p.catch(e => (e?.code === LAST ? LAST : Promise.reject(e)));
/** Wie kontoEntfernen(), ohne Protokoll: Dessen Eintrag zum gleichzeitig gelöschten Verwalter stiesse an den Fremdschlüssel. */
/** Im Systemrahmen wie dort: Konten löscht nur die Systemrolle (0117). */
const remove = (ziel, durch) =>
  _req('src/infra/accountContext.js').inSystemContext('test', () =>
    require('./helpers/sources')
      .testContext('account')
      .transaktion(t => t.konten.deleteAccount(ziel, durch)),
  );

const ROUNDS = 12;

test('admins: at the same time one always stays active', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const P = process.pid,
    NAMEN = ['a', 'b'].map(n => `vb_${n}_${P}`);
  await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]);
  // Nur diese zwei Verwalter zählen; die übrigen Konten der Test-DB werden für die Dauer ausgeblendet.
  const fremde = (await db.all('SELECT id FROM users WHERE is_admin AND is_active')).map(z => z.id);
  await db.run('UPDATE users SET is_active = false WHERE id = ANY($1)', [fremde]);
  const neu = async name =>
    (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, 'x', true, true, true) RETURNING id`,
        [name, `${name}@example.org`],
      )
    ).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]).catch(() => {});
    await db.run('UPDATE users SET is_active = true WHERE id = ANY($1)', [fremde]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const activeAdmin = async () =>
    (await db.get('SELECT count(*)::int AS n FROM users WHERE is_admin AND is_active AND username = ANY($1)', [NAMEN]))
      .n;
  const zuruecksetzen = async () => {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]);
    return [await neu(NAMEN[0]), await neu(NAMEN[1])];
  };
  /** In jeder Runde frische Konten; genau einer der beiden Aufrufe darf durchkommen. */
  const gleichzeitig = async call => {
    for (let i = 0; i < ROUNDS; i++) {
      const [x, y] = await zuruecksetzen();
      const r = await Promise.all([call(x, y), call(y, x)]);
      const abgelehnt = r.filter(e => e === LAST).length;
      assert.equal(abgelehnt, 1, `Runde ${i}: ${JSON.stringify(r)}`);
      assert.equal(await activeAdmin(), 1, `Runde ${i}: kein aktiver Verwalter mehr`);
    }
  };

  await t.test('the last admin keeps the role and the account active', async () => {
    const [x, y] = await zuruecksetzen();
    assert.deepEqual(await K.setzeVerwalterRolle(y, false), { geaendert: true });
    assert.equal(await alsWert(K.setzeVerwalterRolle(x, false)), LAST);
    assert.equal(await alsWert(K.setzeAktiv(x, false)), LAST);
    assert.equal(await remove(x, y), LAST);
    await assert.rejects(
      K.deleteAccount(x, y),
      /nur in einer Transaktion/,
      'ohne Transaktion schützte die Sperre nichts',
    );
    assert.equal(await activeAdmin(), 1);
    // Ein anderer Verwalter darf wieder gehen, die Rolle von Nicht-Verwaltern ist frei.
    assert.deepEqual(await K.setzeVerwalterRolle(y, true), { geaendert: true });
    assert.deepEqual(await K.setzeAktiv(y, false), { geaendert: true });
    await assert.rejects(K.setzeVerwalterRolle(999999999, false), { code: 'benutzer_nicht_gefunden' });
  });

  await t.test('concurrent revocation of the role', async () => {
    await gleichzeitig(ziel =>
      alsWert(K.setzeVerwalterRolle(ziel, false)).then(r => (r?.geaendert === true ? 'ok' : r)),
    );
  });

  await t.test('concurrent deactivation', async () => {
    await gleichzeitig(ziel => alsWert(K.setzeAktiv(ziel, false)).then(r => (r?.geaendert === true ? 'ok' : r)));
  });

  await t.test('concurrent deletion', async () => {
    await gleichzeitig((ziel, ich) => remove(ziel, ich).then(r => (r === true ? 'ok' : r)));
  });

  await t.test('revocation against deactivation, concurrently', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const [x, y] = await zuruecksetzen();
      const r = await Promise.all([alsWert(K.setzeVerwalterRolle(x, false)), alsWert(K.setzeAktiv(y, false))]);
      assert.equal(r.filter(e => e === LAST).length, 1, `Runde ${i}: ${JSON.stringify(r)}`);
      assert.equal(await activeAdmin(), 1, `Runde ${i}`);
    }
  });
});
