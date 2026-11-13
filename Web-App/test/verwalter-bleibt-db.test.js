/**
 * Es bleibt immer ein aktiver Verwalter, auch wenn zwei Verwalter sich
 * gleichzeitig entziehen, deaktivieren oder löschen. Vorher schützte nur das
 * eigene Konto: Beide sahen den jeweils anderen noch als Verwalter.
 *
 * Gegenproben (am 07.11.2026 gemessen, je einzeln):
 *   A  die Sperre (pg_advisory_xact_lock) in unterVerwalterSperre() entfernt →
 *      rot: „gleichzeitiger Entzug der Rolle“, „gleichzeitiges Deaktivieren“,
 *      „gleichzeitiges Löschen“, „Entzug gegen Deaktivieren“ (beide Aufrufe gelangen durch)
 *   B  die Bedingung ANDERER_VERWALTER aus dem UPDATE in setzeVerwalter()
 *      entfernt → rot: „der letzte Verwalter behält die Rolle“ und der
 *      gleichzeitige Entzug
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const db = testDaten();
const K = { ..._req('src/konto/konten.js'), ..._req('src/konto/prozess.js').kontoBereich().konten };

const RUNDEN = 12;

test('Verwalter: Gleichzeitig bleibt immer einer aktiv', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;
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
  const aktiveVerwalter = async () =>
    (await db.get('SELECT count(*)::int AS n FROM users WHERE is_admin AND is_active AND username = ANY($1)', [NAMEN]))
      .n;
  const zuruecksetzen = async () => {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]);
    return [await neu(NAMEN[0]), await neu(NAMEN[1])];
  };
  /** In jeder Runde frische Konten; genau einer der beiden Aufrufe darf durchkommen. */
  const gleichzeitig = async aufruf => {
    for (let i = 0; i < RUNDEN; i++) {
      const [x, y] = await zuruecksetzen();
      const r = await Promise.all([aufruf(x, y), aufruf(y, x)]);
      const abgelehnt = r.filter(e => e === K.LETZTER_VERWALTER).length;
      assert.equal(abgelehnt, 1, `Runde ${i}: ${JSON.stringify(r)}`);
      assert.equal(await aktiveVerwalter(), 1, `Runde ${i}: kein aktiver Verwalter mehr`);
    }
  };

  await t.test('der letzte Verwalter behält die Rolle und das Konto aktiv', async () => {
    const [x, y] = await zuruecksetzen();
    assert.deepEqual(await K.setzeVerwalterRolle(y, false), { geaendert: true });
    assert.equal(await K.setzeVerwalterRolle(x, false), K.LETZTER_VERWALTER);
    assert.equal(await K.setzeAktiv(x, false), K.LETZTER_VERWALTER);
    assert.equal(await K.loescheKonto(x, y), K.LETZTER_VERWALTER);
    assert.equal(await aktiveVerwalter(), 1);
    // Ein anderer Verwalter darf wieder gehen, die Rolle von Nicht-Verwaltern ist frei.
    assert.deepEqual(await K.setzeVerwalterRolle(y, true), { geaendert: true });
    assert.deepEqual(await K.setzeAktiv(y, false), { geaendert: true });
    assert.equal(await K.setzeVerwalterRolle(999999999, false), null);
  });

  await t.test('gleichzeitiger Entzug der Rolle', async () => {
    await gleichzeitig(ziel => K.setzeVerwalterRolle(ziel, false).then(r => (r?.geaendert === true ? 'ok' : r)));
  });

  await t.test('gleichzeitiges Deaktivieren', async () => {
    await gleichzeitig(ziel => K.setzeAktiv(ziel, false).then(r => (r?.geaendert === true ? 'ok' : r)));
  });

  await t.test('gleichzeitiges Löschen', async () => {
    await gleichzeitig((ziel, ich) => K.loescheKonto(ziel, ich).then(r => (r === true ? 'ok' : r)));
  });

  await t.test('Entzug gegen Deaktivieren, gleichzeitig', async () => {
    for (let i = 0; i < RUNDEN; i++) {
      const [x, y] = await zuruecksetzen();
      const r = await Promise.all([K.setzeVerwalterRolle(x, false), K.setzeAktiv(y, false)]);
      assert.equal(r.filter(e => e === K.LETZTER_VERWALTER).length, 1, `Runde ${i}: ${JSON.stringify(r)}`);
      assert.equal(await aktiveVerwalter(), 1, `Runde ${i}`);
    }
  });
});
