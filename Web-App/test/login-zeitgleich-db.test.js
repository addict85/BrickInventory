/**
 * Ein Anmeldeversuch darf nicht verraten, ob es das Konto gibt.
 * Ausführlich: docs/begruendungen/test/login-zeitgleich-db.test.js.md#kopf
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
const { dbOderSkip } = require('./helpers/db');
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

  if (!await dbOderSkip(t, _req)) return;

  // Die Kosten müssen denen echter Passwörter entsprechen — mit weniger Runden
  // wäre der BEKANNTE Fall der schnellere und der Vergleich stünde auf dem
  // Kopf. Deshalb BCRYPT_ROUNDS, derselbe Wert, mit dem der Dummy-Hash entsteht.
  // Drei Paare, abwechselnd gemessen, je mit eigenem Namen und eigener IP: …
  // Ausführlich: docs/begruendungen/test/login-zeitgleich-db.test.js.md#namen
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
        assert.equal(r.wert.absage.art, 'nicht_angemeldet',
          `${was}: erwartet nicht_angemeldet, bekommen ${r.wert.absage.art} (${r.wert.absage.error})`);
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
