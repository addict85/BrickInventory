/**
 * Passwort-vergessen gegen echte Datenbank: E-Mail-Vergleich ohne Beachtung
 * der Gross-/Kleinschreibung.
 *
 * ── Warum es diese Datei gibt ───────────────────────────────────────────────
 * Login, Registrierung und Profil vergleichen E-Mails seit jeher mit
 * LOWER(...) auf beiden Seiten. forgot-password war der EINZIGE Weg mit einem
 * case-sensitiven Vergleich (`WHERE email = $1`). Wer sich als
 * "Marco@Example.CH" registriert hatte und im Formular "marco@example.ch"
 * tippte, bekam die (bewusst neutrale) Erfolgsmeldung — aber nie eine Mail:
 * kein Treffer, kein Token, kein Versand. Von aussen war das nicht von Erfolg
 * zu unterscheiden; der Nutzer ist ohne erkennbaren Grund ausgesperrt.
 *
 * Das ist das wiederkehrende Muster "eine Regel fehlt an einem ZWEITEN Weg" —
 * und wie immer braucht sie einen VERHALTENStest: Eine Quelltext-Prüfung auf
 * LOWER( im richtigen Statement wäre dieselbe Sorte Test, die Lücken auch
 * festschreiben kann. Hier läuft die echte Route gegen die echte Tabelle, und
 * geprüft wird, ob der reset_token GESETZT wurde.
 *
 * Gegenprobe (durchgeführt): LOWER($1) in routes/auth.ts wieder auf $1
 * zurückgedreht → genau der erste Teilschritt hier wird rot.
 *
 * Voraussetzung: Test-DB (Inhalt wird verändert!) via TEST_DATABASE_URL.
 * Ohne DB: skip.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const _req = require('./helpers/sources').buildAndRequire();
// Adresse aus server.ts lesen — siehe einhaengung() in helpers/sources.js.
const AUTH = require('./helpers/sources').einhaengung('auth');
const db = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const bcrypt  = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

test('forgot-password findet die E-Mail unabhängig von der Schreibweise',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  const USERNAME = 'forgotcasetest';
  await db.run(`DELETE FROM users WHERE username = $1`, [USERNAME]);
  // Die ipThrottle des Endpunkts (5/h) zählt in rate_limit_attempts und
  // ÜBERLEBT Prozesse — dieser Test macht vier Aufrufe von derselben Adresse,
  // ein zweiter Lauf innerhalb der Stunde liefe sonst in 429.
  await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'forgot-password|%'`).catch(() => {});
  const hash = await bcrypt.hash('passwort123', 4);
  // Registriert mit gemischter Schreibweise — genau so speichert die
  // Registrierung die Adresse (unverändert, wie eingegeben).
  await db.run(
    `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
     VALUES ($1, 'Forgot.Case@Example.CH', $2, 0, 1, 1)`,
    [USERNAME, hash]
  );

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = {}; next(); });
  app.use(AUTH, _req('routes/auth.js'));
  const srv = app.listen(0);
  const port = srv.address().port;

  const forgot = async (email) => {
    const r = await fetch(`http://localhost:${port}${AUTH}/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.success, true, 'die Antwort ist IMMER success:true (Anti-Enumeration)');
    // Die Wahrheit steht nicht in der Antwort, sondern in der Tabelle.
    const row = await db.get(`SELECT reset_token FROM users WHERE username = $1`, [USERNAME]);
    const gesetzt = !!row.reset_token;
    await db.run(`UPDATE users SET reset_token = NULL, reset_token_expires = NULL WHERE username = $1`, [USERNAME]);
    return gesetzt;
  };

  try {
    assert.equal(await forgot('forgot.case@example.ch'), true,
      'Kleinschreibung muss die gemischt geschriebene Adresse finden');
    assert.equal(await forgot('FORGOT.CASE@EXAMPLE.CH'), true,
      'Grossschreibung muss die gemischt geschriebene Adresse finden');
    assert.equal(await forgot('Forgot.Case@Example.CH'), true,
      'die exakte Schreibweise funktioniert weiterhin');
    assert.equal(await forgot('gibt.es.nicht@example.ch'), false,
      'eine unbekannte Adresse setzt weiterhin KEINEN Token');
  } finally {
    await db.run(`DELETE FROM users WHERE username = $1`, [USERNAME]);
    await new Promise(r => srv.close(r));
    // Pool schliessen, sonst hält er den Prozess am Leben und die DATEI läuft
    // in den 60-s-Timeout des Runners — der Test selbst wäre längst grün
    // (Muster wie in household-db/auth-sessions-db).
    await db.pool.end().catch(() => {});
  }
});
