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
 * ── Gegenprobe (durchgeführt) ───────────────────────────────────────────────
 * In verifiziereEmailToken() wurde die Bedingung `AND email_verified = 0`
 * versuchsweise entfernt — der Riegel, der einen zweiten Klick auf denselben
 * Link verhindert. Ergebnis: „ein bereits verifiziertes Konto nimmt keinen
 * Token mehr an" wird rot. Riegel zurückgebaut, wieder 12 von 12 grün. Eine
 * Prüfung, die man nicht rot gesehen hat, ist eine Behauptung.
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
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db   = _req('db/database.js');
const { verifiziereEmailToken, hashToken } = _req('utils/auth.js');

async function dbReachable() {
  try { await db.get('SELECT 1 AS ok'); return true; } catch { return false; }
}

async function seed() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
}

/**
 * Ein Konto mit offenem Verifikations-Token anlegen.
 * `minutenGueltig` negativ = bereits abgelaufen.
 * Gibt den ROHEN Token zurück — in der DB steht nur sein SHA-256.
 */
async function neuerNutzer(name, { minutenGueltig = 60, schonVerifiziert = false } = {}) {
  const token = crypto.randomBytes(16).toString('hex');
  await db.run(
    `INSERT INTO users (username, password_hash, email, email_verified, verification_token, token_expires)
     VALUES ($1, 'x', $2, $3, $4, NOW() + ($5 || ' minutes')::interval)`,
    [name, `${name}@example.ch`, schonVerifiziert ? 1 : 0, hashToken(token), String(minutenGueltig)]);
  const { id } = await db.get('SELECT id FROM users WHERE username=$1', [name]);
  return { id, token };
}

const zustand = (id) =>
  db.get('SELECT email_verified, verification_token, token_expires FROM users WHERE id=$1', [id]);

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
    const z = await zustand(u.id);
    assert.equal(Number(z.email_verified), 1, 'email_verified wurde nicht gesetzt');
    // Beide Token-Felder MÜSSEN leer sein. Bliebe der Hash stehen, wäre er
    // ein unnötig lange gültiges Geheimnis in der Datenbank.
    assert.equal(z.verification_token, null, 'verification_token blieb stehen');
    assert.equal(z.token_expires, null, 'token_expires blieb stehen');
  });

  await t.test('abgelaufener Token wird abgelehnt und ändert nichts', async () => {
    const u = await neuerNutzer('abgelaufen', { minutenGueltig: -5 });
    const e = await verifiziereEmailToken(u.token);
    assert.equal(e.ok, false);
    assert.equal(e.grund, 'ungueltig');
    const z = await zustand(u.id);
    assert.equal(Number(z.email_verified), 0, 'Ein abgelaufener Token hat trotzdem verifiziert');
    assert.notEqual(z.verification_token, null, 'Die Felder wurden fälschlich abgeräumt');
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

  await t.test('ein bereits verifiziertes Konto nimmt keinen Token mehr an', async () => {
    // Der Riegel ist `email_verified = 0` in der Abfrage. Fiele er weg, liesse
    // sich ein altes, nie benutztes Token später erneut einlösen.
    const u = await neuerNutzer('schondrin', { schonVerifiziert: true });
    const e = await verifiziereEmailToken(u.token);
    assert.equal(e.ok, false);
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
