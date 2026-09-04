/**
 * Ein Anmeldeversuch darf nicht verraten, ob es das Konto gibt.
 *
 * ── Der gemessene Befund ────────────────────────────────────────────────────
 * Die Anmeldeprüfung stand zweimal im Baum: einmal für die Sitzung der Webapp
 * (routes/auth.ts) und einmal für den Token der Android-App
 * (routes/api_v1/auth.ts). Nur die erste verglich auch bei UNBEKANNTEM Namen
 * gegen einen festen Dummy-Hash; die zweite sprang bei `!user` sofort heraus.
 *
 * Nachgemessen über HTTP, je fünf Versuche mit jeweils verschiedenen Namen
 * (mit demselben Namen greift nach fünf Fehlversuchen die Sperre, und dann
 * misst man 429er statt Anmeldungen):
 *
 *     /api/v1/auth/login   bekannt 418.5 ms · unbekannt   4.0 ms · Δ  414.6 ms
 *     /api/auth/login      bekannt 419.3 ms · unbekannt 436.8 ms · Δ  -17.5 ms
 *
 * 415 ms sind von aussen sauber messbar. Wer eine Namensliste durchprobiert,
 * weiss danach, welche Konten existieren — ohne ein einziges Passwort zu
 * erraten. Seither läuft beides über pruefeAnmeldedaten() in utils/auth.ts.
 *
 * ── Warum hier gemessen und nicht gelesen wird ──────────────────────────────
 * Der Unterschied war im Quelltext unauffällig: An der v1-Route stand sogar
 * „Parität zum Webapp-Login" — und der fehlende Vergleich war genau KEINE.
 * Ein Textvergleich hätte das nie gefunden; die Uhr findet es sofort.
 *
 * Die Schranke ist bewusst grob (halbe Zeit statt „gleich"): Gemessen wird auf
 * einer geteilten Maschine, und der Fehlerfall ist nicht ein bisschen
 * schneller, sondern hundertmal — 4 ms gegen 400 ms. Eine engere Schranke
 * würde nur flattern, ohne mehr zu finden.
 *
 * Voraussetzung: Test-DB (Inhalt wird angefasst!) via TEST_DATABASE_URL.
 * Ohne DB: skip. Ausführen: REQUIRE_DB=1 npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { pruefeAnmeldedaten, BCRYPT_ROUNDS } = _req('utils/auth.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

/** Minimaler Request: pruefeAnmeldedaten braucht davon nur die IP (Zähler). */
const anfrage = () => ({ ip: '203.0.113.7', headers: {}, socket: {} });

async function dauer(fn) {
  const t0 = process.hrtime.bigint();
  const wert = await fn();
  return { ms: Number(process.hrtime.bigint() - t0) / 1e6, wert };
}

test('unbekannter Anmeldename kostet dieselbe Zeit wie ein falsches Passwort',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  // Die Kosten müssen denen echter Passwörter entsprechen — mit weniger Runden
  // wäre der BEKANNTE Fall der schnellere und der Vergleich stünde auf dem
  // Kopf. Deshalb BCRYPT_ROUNDS, derselbe Wert, mit dem der Dummy-Hash entsteht.
  const name = 'zeit_bekannt';
  await db.run('DELETE FROM users WHERE username = $1', [name]);
  await db.run(
    'INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,0,1,1)',
    [name, await bcrypt.hash('richtigesPasswort1', BCRYPT_ROUNDS)]);

  try {
    // Je ein Versuch pro Name: Der Brute-Force-Zähler läuft über IP UND Name,
    // ein zweiter Versuch mit demselben Namen käme irgendwann als 429 zurück
    // und würde die Messung ersetzen statt sie zu wiederholen.
    const bekannt   = await dauer(() => pruefeAnmeldedaten(anfrage(), name, 'falschesPasswort1'));
    const unbekannt = await dauer(() => pruefeAnmeldedaten(anfrage(), 'zeit_gibtsnicht', 'falschesPasswort1'));

    // Vorbedingung: Beide müssen wirklich abgelehnt worden sein — und zwar mit
    // 401, nicht mit 429 (Sperre) oder 400 (Formfehler). Sonst misst der Test
    // etwas anderes als gedacht und wäre trotzdem grün.
    for (const [was, r] of [['bekannt', bekannt], ['unbekannt', unbekannt]]) {
      assert.equal(r.wert.ok, false, `${was}: hätte abgelehnt werden müssen`);
      assert.equal(r.wert.absage.status, 401,
        `${was}: erwartet 401, bekommen ${r.wert.absage.status} (${r.wert.absage.error})`);
    }
    // Und die Messung selbst muss überhaupt etwas gekostet haben — ohne das
    // wäre „0 ms ≥ 0 ms" grün, ganz ohne Passwortprüfung.
    assert.ok(bekannt.ms > 20,
      `Der bekannte Fall dauerte nur ${bekannt.ms.toFixed(1)} ms — hier wurde kein bcrypt gerechnet`);

    assert.ok(unbekannt.ms >= bekannt.ms * 0.5,
      `Ein unbekannter Name ist messbar schneller: bekannt ${bekannt.ms.toFixed(1)} ms, ` +
      `unbekannt ${unbekannt.ms.toFixed(1)} ms. Damit lässt sich von aussen abfragen, ` +
      `welche Konten es gibt. Der Vergleich muss auch ohne Treffer gegen den ` +
      `Dummy-Hash laufen (siehe pruefeAnmeldedaten in utils/auth.ts).`);
  } finally {
    await db.run('DELETE FROM users WHERE username = $1', [name]).catch(() => {});
    // Ohne das bleibt der Pool offen und der Testprozess endet nie — der Lauf
    // wirkt dann wie ein Hänger, obwohl der Test längst durch ist.
    await db.pool.end().catch(() => {});
  }
});
