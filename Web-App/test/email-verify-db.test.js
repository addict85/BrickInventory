/**
 * E-Mail-Verifikation gegen eine ECHTE Datenbank.
 *
 * ── Gegenproben (04.11.2026 gemessen, je einzeln) ───────────────────────────
 * Seit Runde 13 trägt eine Registrierung Adresse und Link in new_email*.
 *   A  in adoptEmailNew() `AND new_email_until > NOW()` gestrichen → rot:
 *      „abgelaufener Token wird abgelehnt …“
 *   B  adoptEmailNew() ohne `registration_pending = false` → rot: „gültiger
 *      Token …“ (die Registrierung bliebe offen und gesperrt)
 *   C  adoptEmailNew() ohne erneute Vergabeprüfung UND ohne den Fang von
 *      23505 → rot: „die erste Bestätigung gewinnt …“ (Fehler aus dem Index;
 *      jede der beiden allein hält)
 *
 * Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
 * Ohne DB: skip — ausser REQUIRE_DB=1, dann Fehler.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = testData();
const { verifyEmailToken } = _req('src/konto/anmeldepruefung.js');
const INVALID = { code: 'bestaetigungslink_ungueltig' };
const { tokenDigest } = _req('src/konto/geraeteToken.js');

async function dbReachable() {
  try {
    await db.get('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

async function seed() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  // Und die MIGRATIONEN, nicht nur das Schema
  {
    const mc = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(mc);
    } finally {
      mc.release();
    }
  }
}

/** Eine offene Registrierung wie POST /register sie anlegt. `minutesValid` negativ =
 * abgelaufen. Gibt den ROHEN Token zurück — in der DB steht nur sein SHA-256. */
async function newUser(name, { minutesValid = 60, email = `${name}@example.ch` } = {}) {
  const token = crypto.randomBytes(16).toString('hex');
  const { id } = await db.get(
    `INSERT INTO users (username, password_hash, new_email, new_email_token, new_email_until, registration_pending)
     VALUES ($1, 'x', $2, $3, NOW() + ($4 || ' minutes')::interval, true) RETURNING id`,
    [name, email, tokenDigest(token), String(minutesValid)],
  );
  return { id, token };
}

const zustand = id =>
  db.get(
    'SELECT email, email_verified, registration_pending, new_email, new_email_token, new_email_until FROM users WHERE id=$1',
    [id],
  );

test('E-Mail-Verifikation gegen echte Datenbank', async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    keineDb(t);
    return;
  }
  await seed();

  await t.test('gültiger Token: setzt email_verified und räumt die Felder ab', async () => {
    const u = await newUser('gueltig');
    assert.deepEqual(
      await verifyEmailToken(u.token),
      { userId: u.id },
      'Ein frischer Token muss eingelöst werden können',
    );
    assert.deepEqual(await zustand(u.id), {
      email: 'gueltig@example.ch',
      email_verified: true,
      registration_pending: false,
      new_email: null,
      new_email_token: null,
      new_email_until: null,
    });
  });

  await t.test('abgelaufener Token wird abgelehnt und ändert nichts', async () => {
    const u = await newUser('abgelaufen', { minutesValid: -5 });
    await assert.rejects(verifyEmailToken(u.token), INVALID);
    const z = await zustand(u.id);
    assert.deepEqual(
      [z.email, z.email_verified, z.registration_pending],
      [null, false, true],
      'Ein abgelaufener Token hat bestätigt',
    );
    assert.notEqual(z.new_email_token, null, 'Die Felder wurden fälschlich abgeräumt');
  });

  await t.test('unbekannter Token wird abgelehnt', async () => {
    await assert.rejects(verifyEmailToken('gibtesnicht'), INVALID);
  });

  await t.test('fehlender Token wird abgelehnt', async () => {
    for (const leer of [undefined, null, '', '   '])
      await assert.rejects(verifyEmailToken(leer), INVALID, `${JSON.stringify(leer)} wurde angenommen`);
  });

  await t.test('zweites Einlösen desselben Tokens schlägt fehl', async () => {
    const u = await newUser('zweimal');
    await verifyEmailToken(u.token);
    await assert.rejects(verifyEmailToken(u.token), INVALID, 'Derselbe Link liess sich ein zweites Mal einlösen');
  });

  await t.test('die erste Bestätigung gewinnt, die zweite Registrierung bleibt offen', async () => {
    const erste = await newUser('erste', { email: 'geteilt@example.ch' });
    const zweite = await newUser('zweite', { email: 'GETEILT@example.ch' });
    await verifyEmailToken(erste.token);
    await assert.rejects(verifyEmailToken(zweite.token), { code: 'email_vergeben' });
    const z = await zustand(zweite.id);
    assert.deepEqual([z.email, z.registration_pending, z.new_email_token], [null, true, null]);
  });

  // Die fuenf Faelle ueber die API-Route sind ENTFERNT

  await db.pool.end().catch(() => {});
});
