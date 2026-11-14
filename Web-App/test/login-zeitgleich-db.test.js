/**
 * Ein Anmeldeversuch darf nicht verraten, ob es das Konto gibt: Auch ein unbekannter
 * Name rechnet genau einen Hash mit den Kosten eines echten Kontos (DUMMY_HASH).
 * Gezählt statt gestoppt: argon2id kostet kaum mehr als die schwankende Datenbankarbeit.
 *
 * Gegenproben (14.11.2026 gemessen, je einzeln):
 *   A  in pruefeAnmeldedaten() ohne Treffer kein Vergleich gegen DUMMY_HASH → rot:
 *      „unbekannt: genau ein Hash“ (0 statt 1)
 *   B  DUMMY_HASH mit geringeren Kosten (memoryCost 4096) → rot: „unbekannt: dieselben
 *      Kosten wie ein echtes Konto“
 *
 * Voraussetzung: Test-DB (Inhalt wird angefasst!) via TEST_DATABASE_URL.
 * Ohne DB: skip. Ausführen: REQUIRE_DB=1 npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const db = testDaten();
const argon2 = require('@node-rs/argon2');
const { pruefeAnmeldedaten } = _req('src/konto/anmeldepruefung.js');
const { hashePasswort } = _req('src/konto/passwortHash.js');

/** Minimaler Request: pruefeAnmeldedaten braucht davon nur die IP (Zähler). */
const anfrage = (i = 7) => ({ ip: `203.0.113.${i}`, headers: {}, socket: {} });
/** Kosten eines argon2-Hashes: alles vor dem Salz. */
const kosten = (/** @type {string} */ hash) => hash.split('$').slice(0, 4).join('$');

test('unbekannter Anmeldename rechnet denselben Hash wie ein falsches Passwort', async t => {
  if (!(await datenOderSkip(t, _req))) return;

  const name = 'zeit_bekannt';
  const hash = await hashePasswort('richtigesPasswort1');
  await db.run('DELETE FROM users WHERE username = $1', [name]);
  await db.run(
    'INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,false,true,true)',
    [name, hash],
  );

  try {
    /** @type {string[]} */
    let gerechnet = [];
    const echt = argon2.verify;
    t.mock.method(argon2, 'verify', (/** @type {string} */ h, /** @type {any[]} */ ...rest) => {
      gerechnet.push(h);
      return /** @type {any} */ (echt)(h, ...rest);
    });

    // Je ein Versuch mit eigenem Namen und eigener IP: Ein zweiter liefe irgendwann in die Bremse.
    for (const [was, wer, ip] of /** @type {const} */ ([
      ['bekannt', name, 10],
      ['unbekannt', 'zeit_gibtsnicht', 20],
    ])) {
      gerechnet = [];
      const r = await pruefeAnmeldedaten(anfrage(ip), wer, 'falschesPasswort1');
      // Vorbedingung: wirklich abgelehnt, mit 401 — nicht 429 (Sperre) oder 400 (Formfehler).
      assert.equal(r.ok, false, `${was}: hätte abgelehnt werden müssen`);
      assert.equal(r.absage.art, 'nicht_angemeldet', `${was}: erwartet nicht_angemeldet (${r.absage.error})`);
      assert.equal(gerechnet.length, 1, `${was}: genau ein Hash`);
      assert.equal(kosten(gerechnet[0]), kosten(hash), `${was}: dieselben Kosten wie ein echtes Konto`);
    }
  } finally {
    await db.run('DELETE FROM users WHERE username = $1', [name]).catch(() => {});
    // Ohne das bleibt der Pool offen und der Testprozess endet nie.
    await db.pool.end().catch(() => {});
  }
});
