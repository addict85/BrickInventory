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
 * erraten. Seither läuft beides über pruefeAnmeldedaten() in src/konto/auth.ts.
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
 * Gegenprobe (01.11.2026 gemessen, Median aus drei Paaren): in
 * pruefeAnmeldedaten() ohne Treffer kein Vergleich gegen DUMMY_HASH → rot
 * (bekannt 344,7 ms, unbekannt 11,5 ms).
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
const { pruefeAnmeldedaten, BCRYPT_ROUNDS } = _req('src/konto/auth.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

/** Minimaler Request: pruefeAnmeldedaten braucht davon nur die IP (Zähler). */
const anfrage = (i = 7) => ({ ip: `203.0.113.${i}`, headers: {}, socket: {} });
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

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
  // Drei Paare, abwechselnd gemessen, je mit eigenem Namen und eigener IP:
  // Eine Einzelmessung schwankte unter Last (Volllauf parallel) um mehr als
  // das Doppelte; der Median dreier Paare nicht, der Fehlerfall (4 ms gegen
  // 400 ms) bleibt trotzdem eindeutig.
  const namen = [0, 1, 2].map(i => `zeit_bekannt_${i}`);
  const hash = await bcrypt.hash('richtigesPasswort1', BCRYPT_ROUNDS);
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  for (const name of namen)
    await db.run(
      'INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,false,true,true)',
      [name, hash]);

  try {
    // Je ein Versuch pro Name: Der Brute-Force-Zähler läuft über IP UND Name,
    // ein zweiter Versuch mit demselben Namen käme irgendwann als 429 zurück
    // und würde die Messung ersetzen statt sie zu wiederholen.
    const messungen = { bekannt: [], unbekannt: [] };
    for (let i = 0; i < namen.length; i++) {
      const paar = [
        ['bekannt', () => pruefeAnmeldedaten(anfrage(10 + i), namen[i], 'falschesPasswort1')],
        ['unbekannt', () => pruefeAnmeldedaten(anfrage(20 + i), `zeit_gibtsnicht_${i}`, 'falschesPasswort1')],
      ];
      if (i % 2) paar.reverse();
      for (const [was, fn] of paar) {
        const r = await dauer(fn);
        // Vorbedingung: wirklich abgelehnt, mit 401 — nicht 429 (Sperre) oder
        // 400 (Formfehler). Sonst misst der Test etwas anderes als gedacht.
        assert.equal(r.wert.ok, false, `${was}: hätte abgelehnt werden müssen`);
        assert.equal(r.wert.absage.status, 401,
          `${was}: erwartet 401, bekommen ${r.wert.absage.status} (${r.wert.absage.error})`);
        messungen[was].push(r.ms);
      }
    }
    const bekannt = { ms: median(messungen.bekannt) };
    const unbekannt = { ms: median(messungen.unbekannt) };
    // Und die Messung selbst muss überhaupt etwas gekostet haben — ohne das
    // wäre „0 ms ≥ 0 ms" grün, ganz ohne Passwortprüfung.
    assert.ok(bekannt.ms > 20,
      `Der bekannte Fall dauerte nur ${bekannt.ms.toFixed(1)} ms — hier wurde kein bcrypt gerechnet`);

    assert.ok(unbekannt.ms >= bekannt.ms * 0.5,
      `Ein unbekannter Name ist messbar schneller: bekannt ${bekannt.ms.toFixed(1)} ms, ` +
      `unbekannt ${unbekannt.ms.toFixed(1)} ms. Damit lässt sich von aussen abfragen, ` +
      `welche Konten es gibt. Der Vergleich muss auch ohne Treffer gegen den ` +
      `Dummy-Hash laufen (siehe pruefeAnmeldedaten in src/konto/auth.ts).`);
  } finally {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]).catch(() => {});
    // Ohne das bleibt der Pool offen und der Testprozess endet nie — der Lauf
    // wirkt dann wie ein Hänger, obwohl der Test längst durch ist.
    await db.pool.end().catch(() => {});
  }
});
