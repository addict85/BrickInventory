/**
 * E-Mail-Verifikation gegen eine ECHTE Datenbank.
 *
 * test/email-verify.test.js hält am Quelltext fest, dass die Logik nur noch
 * an einer Stelle steht. Das sagt nichts darüber, ob sie das Richtige TUT.
 * Genau dort lagen die Fehler, die man sonst erst im Betrieb sieht: ein Token,
 * der nach Ablauf noch gilt; einer, der sich zweimal einlösen lässt; ein
 * Feld, das beim Einlösen stehen bleibt.
 *
 * ── Warum die Browser-Route nicht mitgestartet wird ─────────────────────────
 * server.ts exportiert seine App nicht und beginnt beim Einbinden zu lauschen
 * — samt Session-Speicher, Mailversand und Cluster-Logik. Sie hier zu booten
 * hiesse, den halben Betrieb im Test hochzufahren. Stattdessen wird die
 * gemeinsame Funktion direkt geprüft (sie IST die Logik beider Routen), die
 * API-Route echt über Express angesprochen, und test/email-verify.test.js
 * hält fest, dass server.ts genau diese Funktion ruft und ihre beiden
 * Ausgänge auf ?verified=1 bzw. ?verified=invalid abbildet.
 *
 * ── Gegenproben (04.11.2026 gemessen, je einzeln) ───────────────────────────
 * Seit Runde 13 trägt eine Registrierung Adresse und Link in email_neu*.
 *   A  in uebernimmEmailNeu() `AND email_neu_bis > NOW()` gestrichen → rot:
 *      „abgelaufener Token wird abgelehnt …“
 *   B  uebernimmEmailNeu() ohne `registrierung_offen = false` → rot: „gültiger
 *      Token …“ (die Registrierung bliebe offen und gesperrt)
 *   C  uebernimmEmailNeu() ohne erneute Vergabeprüfung UND ohne den Fang von
 *      23505 → rot: „die erste Bestätigung gewinnt …“ (Fehler aus dem Index;
 *      jede der beiden allein hält)
 *
 * Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
 * Ohne DB: skip — ausser REQUIRE_DB=1, dann Fehler.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db   = _req('db/database.js');
const { verifiziereEmailToken, hashToken } = _req('src/konto/auth.js');

async function dbReachable() {
  try { await db.get('SELECT 1 AS ok'); return true; } catch { return false; }
}

async function seed() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  // ── Und die MIGRATIONEN, nicht nur das Schema ───────────────────────────
  //
  // Diese Datei loescht das Schema und baut es neu auf. Ohne die Migrationen
  // bleibt die Datenbank auf dem Stand von db/schema.sql stehen — also VOR
  // allen Migrationen —, und das ist nicht nur fuer sie selbst falsch,
  // sondern fuer jede Datei danach: Sie erbt eine halbe Datenbank.
  //
  // GEMESSEN beim Umzug der Teilemengen (Migration 0038): db/schema.sql legt
  // `parts.quantity DEFAULT 1` an, die Katalogzeilen tragen die echte Zahl.
  // Die naechste Datei, die die Migrationen laufen liess, brach ab — „Bei 8
  // Set-Teilen weicht parts.quantity vom Katalog ab". Der Riegel hatte recht.
  {
    const mc = await db.pool.connect();
    try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }
  }
}

/** Eine offene Registrierung wie POST /register sie anlegt. `minutenGueltig` negativ =
 * abgelaufen. Gibt den ROHEN Token zurück — in der DB steht nur sein SHA-256. */
async function neuerNutzer(name, { minutenGueltig = 60, email = `${name}@example.ch` } = {}) {
  const token = crypto.randomBytes(16).toString('hex');
  const { id } = await db.get(
    `INSERT INTO users (username, password_hash, email_neu, email_neu_token, email_neu_bis, registrierung_offen)
     VALUES ($1, 'x', $2, $3, NOW() + ($4 || ' minutes')::interval, true) RETURNING id`,
    [name, email, hashToken(token), String(minutenGueltig)]);
  return { id, token };
}

const zustand = (id) =>
  db.get('SELECT email, email_verified, registrierung_offen, email_neu, email_neu_token, email_neu_bis FROM users WHERE id=$1', [id]);

test('E-Mail-Verifikation gegen echte Datenbank', async (t) => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    if (process.env.REQUIRE_DB === '1') {
      throw new Error('REQUIRE_DB=1, aber die Test-Datenbank ist nicht erreichbar.');
    }
    t.skip('Test-DB nicht erreichbar — Suite übersprungen');
    return;
  }
  await seed();

  await t.test('gültiger Token: setzt email_verified und räumt die Felder ab', async () => {
    const u = await neuerNutzer('gueltig');
    const e = await verifiziereEmailToken(u.token);
    assert.equal(e.ok, true, 'Ein frischer Token muss eingelöst werden können');
    assert.deepEqual(await zustand(u.id), { email: 'gueltig@example.ch', email_verified: true, registrierung_offen: false,
      email_neu: null, email_neu_token: null, email_neu_bis: null });
  });

  await t.test('abgelaufener Token wird abgelehnt und ändert nichts', async () => {
    const u = await neuerNutzer('abgelaufen', { minutenGueltig: -5 });
    const e = await verifiziereEmailToken(u.token);
    assert.equal(e.ok, false);
    assert.equal(e.grund, 'ungueltig');
    const z = await zustand(u.id);
    assert.deepEqual([z.email, z.email_verified, z.registrierung_offen], [null, false, true], 'Ein abgelaufener Token hat bestätigt');
    assert.notEqual(z.email_neu_token, null, 'Die Felder wurden fälschlich abgeräumt');
  });

  await t.test('unbekannter Token wird abgelehnt', async () => {
    const e = await verifiziereEmailToken('gibtesnicht');
    assert.equal(e.ok, false);
    assert.equal(e.grund, 'ungueltig');
  });

  await t.test('fehlender Token wird von „ungültig" unterschieden', async () => {
    for (const leer of [undefined, null, '', '   ']) {
      const e = await verifiziereEmailToken(leer);
      assert.equal(e.ok, false);
      assert.equal(e.grund, 'fehlt', `${JSON.stringify(leer)} muss als "fehlt" gelten`);
    }
  });

  await t.test('zweites Einlösen desselben Tokens schlägt fehl', async () => {
    const u = await neuerNutzer('zweimal');
    assert.equal((await verifiziereEmailToken(u.token)).ok, true);
    const e2 = await verifiziereEmailToken(u.token);
    assert.equal(e2.ok, false, 'Derselbe Link liess sich ein zweites Mal einlösen');
    assert.equal(e2.grund, 'ungueltig');
  });

  await t.test('die erste Bestätigung gewinnt, die zweite Registrierung bleibt offen', async () => {
    const erste = await neuerNutzer('erste', { email: 'geteilt@example.ch' });
    const zweite = await neuerNutzer('zweite', { email: 'GETEILT@example.ch' });
    assert.equal((await verifiziereEmailToken(erste.token)).ok, true);
    assert.deepEqual(await verifiziereEmailToken(zweite.token), { ok: false, grund: 'vergeben', userId: zweite.id });
    const z = await zustand(zweite.id);
    assert.deepEqual([z.email, z.registrierung_offen, z.email_neu_token], [null, true, null]);
  });

  // ── Die fuenf Faelle ueber die API-Route sind ENTFERNT ───────────────────
  //
  // GET /api/auth/verify gibt es nicht mehr: Sie hatte keinen Aufrufer — der
  // Link aus der Verifikationsmail zeigt auf die Frontend-Seite /verify, die
  // server.ts bedient. Dass sie keinen Aufrufer hat, stand seit Nachtrag 154
  // als Kommentar in der Route selbst.
  //
  // Verloren geht dadurch nichts: Die fuenf Faelle pruefen dieselben Regeln
  // wie die sechs darueber (gueltig, abgelaufen, unbekannt, fehlend, zweimal),
  // nur durch eine HTTP-Huelle hindurch. Was die Huelle zusaetzlich sagte —
  // 400 gegen 410 statt einer Weiterleitung — betraf einen Aufrufer, den es
  // nie gab.
  //
  // Der Weg, den es WIRKLICH gibt, bleibt geprueft: test/email-verify.test.js
  // haelt fest, dass server.ts dieselbe Funktion ruft und ihre beiden
  // Ausgaenge auf ?verified=1 bzw. ?verified=invalid abbildet.

  await db.pool.end().catch(() => {});
});
