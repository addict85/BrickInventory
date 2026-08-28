/**
 * Auth-Paritätstest (ohne DB).
 *
 * api-parity.test.js vergleicht, ob /api und /api/v1 dieselben DATEN liefern.
 * Die Vorbedingungen des Logins waren davon nicht abgedeckt — und genau dort
 * lag eine echte Lücke: /api/v1/auth/login hat weder is_active noch
 * email_verified geprüft. Ein deaktiviertes Konto konnte sich über die
 * Android-API anmelden und bekam dort einen Token OHNE Ablaufdatum.
 *
 * Der Test hat zwei Teile:
 *   1. assertLoginAllowed() selbst (Verhalten, inkl. der 0/1-vs-boolean-Fälle,
 *      die Postgres je nach Spaltentyp liefert).
 *   2. Ein statischer Check, dass BEIDE Login-Handler die Funktion aufrufen —
 *      damit die Regel nicht wieder auseinanderläuft.
 *
 * Ausführen: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
// Nach dist/ bauen statt in-place — siehe helpers/sources.js.
const _req = require('./helpers/sources').buildAndRequire();
const { assertLoginAllowed, USERNAME_RE, BCRYPT_ROUNDS, escapeLike } =
  _req('utils/auth.js');

test('aktives, bestätigtes Konto darf sich anmelden', () => {
  assert.equal(assertLoginAllowed({ is_active: 1, email_verified: 1, email: 'a@b.c' }), null);
  assert.equal(assertLoginAllowed({ is_active: true, email_verified: true, email: 'a@b.c' }), null);
  // Konto ganz ohne E-Mail (Alt-Installation, admin/admin) bleibt erlaubt
  assert.equal(assertLoginAllowed({ is_active: 1, email_verified: 0, email: null }), null);
});

test('deaktiviertes Konto wird abgelehnt — egal ob 0 oder false', () => {
  for (const v of [0, false]) {
    const r = assertLoginAllowed({ is_active: v, email_verified: 1, email: 'a@b.c' });
    assert.equal(r?.status, 403, `is_active=${v} muss 403 ergeben`);
  }
});

test('unbestätigte E-Mail wird abgelehnt, Admins ausgenommen', () => {
  const r = assertLoginAllowed({ is_active: 1, email_verified: 0, email: 'a@b.c', is_admin: 0 });
  assert.equal(r?.status, 403);
  assert.equal(r?.unverified, true);
  assert.equal(assertLoginAllowed({ is_active: 1, email_verified: 0, email: 'a@b.c', is_admin: 1 }), null);
});

test('beide Login-Handler nutzen dieselbe Vorbedingungsprüfung', () => {
  const web = fs.readFileSync(path.join(ROOT, 'routes', 'auth.ts'), 'utf8');
  const api = fs.readFileSync(path.join(ROOT, 'routes', 'api_v1', 'auth.ts'), 'utf8');
  assert.match(web, /assertLoginAllowed\(user\)/, 'routes/auth.ts prüft die Vorbedingungen nicht mehr');
  assert.match(api, /assertLoginAllowed\(user\)/, 'routes/api_v1/auth.ts prüft die Vorbedingungen nicht');
  // Die alte, doppelt gepflegte Inline-Variante darf nicht zurückkommen
  assert.doesNotMatch(web, /if \(user\.is_active === 0\)/);
});

test('Benutzernamen-Regel gilt für Login, Register UND Profil-Update', () => {
  assert.ok(USERNAME_RE.test('marco_1'));
  assert.ok(!USERNAME_RE.test('ma'));
  assert.ok(!USERNAME_RE.test('a b'));
  assert.ok(!USERNAME_RE.test('a@b.c'), 'E-Mail-Adresse darf kein Benutzername sein');

  const auth = fs.readFileSync(path.join(ROOT, 'routes', 'auth.ts'), 'utf8');
  const profile = auth.slice(auth.indexOf("router.put('/profile'"), auth.indexOf("router.get('/users'"));
  assert.match(profile, /USERNAME_RE\.test/, 'PUT /profile validiert den Benutzernamen nicht');
  assert.match(profile, /LOWER\(username\) = LOWER\(\$1\)/,
    'PUT /profile muss case-insensitiv auf Eindeutigkeit prüfen — der Login vergleicht mit LOWER()');
});

test('bcrypt-Kostenfaktor ist überall derselbe', () => {
  assert.ok(BCRYPT_ROUNDS >= 12);
  const auth = fs.readFileSync(path.join(ROOT, 'routes', 'auth.ts'), 'utf8');
  const literals = [...auth.matchAll(/bcrypt\.hash\([^,]+,\s*([^)]+)\)/g)].map(m => m[1].trim());
  assert.deepEqual([...new Set(literals)], ['BCRYPT_ROUNDS'],
    `bcrypt.hash wird mit unterschiedlichen Kosten aufgerufen: ${literals.join(', ')}`);
});

test('escapeLike entschärft Platzhalter beim Token-Löschen', () => {
  assert.equal(escapeLike('%'), '\\%');
  assert.equal(escapeLike('a_b'), 'a\\_b');
  assert.equal(escapeLike('abc123'), 'abc123');
});

test('QR-Login transportiert kein Passwort-Material mehr', () => {
  const auth = fs.readFileSync(path.join(ROOT, 'routes', 'auth.ts'), 'utf8');
  // Nur den QR-Abschnitt betrachten: dahinter kommen /register und
  // /reset-password, die legitim mit password_hash arbeiten.
  const from = auth.indexOf("router.get('/qr-token'");
  const to   = auth.indexOf("router.get('/registration-status'");
  assert.ok(from > 0 && to > from, 'QR-Abschnitt nicht gefunden');
  const qr = auth.slice(from, to);
  assert.doesNotMatch(qr, /password_hash/,
    'Der QR-Code darf den bcrypt-Hash nicht enthalten — er ist offline knackbar');
  assert.match(qr, /qr_login_tokens/, 'QR-Login muss über eine serverseitige Nonce laufen');
  assert.match(qr, /used_at IS NULL/, 'Die Nonce muss einmalig einlösbar sein');
  assert.doesNotMatch(qr, /createHmac/, 'HMAC mit dem SESSION_SECRET wird nicht mehr gebraucht');
});

test('die angezeigte QR-Gültigkeit stimmt mit dem Server überein', () => {
  // Der Text nannte 30 Minuten, und der Countdown zählte von 1800 Sekunden
  // herunter — der Token läuft seit der Sicherheitshärtung aber nach 5 Minuten
  // ab. Der Zähler lief also 25 Minuten weiter, obwohl der Code längst
  // ungültig war.
  const auth = fs.readFileSync(path.join(ROOT, 'routes', 'auth.ts'), 'utf8');
  const m = /const QR_TTL_MS = (\d+) \* 60 \* 1000;/.exec(auth);
  assert.ok(m, 'QR_TTL_MS nicht gefunden');
  const minutes = parseInt(m[1]);

  // Der Client darf die Dauer nicht fest verdrahten
  const settings = fs.readFileSync(path.join(ROOT, 'public', 'js', '05-settings.js'), 'utf8');
  assert.match(settings, /let secs = parseInt\(d\.expires_in\)/,
    'Die Dauer muss vom Server kommen');
  assert.doesNotMatch(settings, /let secs = 1800/, 'Fest verdrahtete 30 Minuten');
  assert.match(auth, /expires_in: QR_TTL_MS \/ 1000/, 'Der Server muss die Dauer mitliefern');

  // Und der Hinweistext muss dieselbe Zahl nennen — in beiden Sprachen und im
  // Markup, das vor dem Laden der Übersetzungen sichtbar ist.
  const i18n = require('./helpers/sources').i18nAll();
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  for (const [name, src] of [['i18n.js', i18n], ['index.html', html]]) {
    for (const hit of src.match(/[^']*settings\.qr\.hint[^\n]*/g) || []) {
      assert.doesNotMatch(hit, /30 (Minuten|minutes)/, `${name}: nennt noch 30 Minuten`);
    }
  }
  assert.ok(i18n.includes(`${minutes} Minuten gültig`), `DE-Text nennt nicht ${minutes} Minuten`);
  assert.ok(i18n.includes(`valid for ${minutes} minutes`), `EN-Text nennt nicht ${minutes} Minuten`);
});

test('Admins können das Passwort anderer Nutzer setzen', () => {
  // Der Dialog in den Einstellungen rief PUT /auth/users/:id/password schon
  // immer auf — die Route gab es nicht, das Speichern endete in
  // „API-Endpunkt nicht gefunden".
  const auth = fs.readFileSync(path.join(ROOT, 'routes', 'auth.ts'), 'utf8');
  assert.match(auth, /router\.put\('\/users\/:id\/password', requireAdmin/,
    'Route fehlt oder ist nicht auf Administratoren beschränkt');

  const fn = auth.slice(auth.indexOf("router.put('/users/:id/password'"),
                        auth.indexOf("router.delete('/users/:id'"));

  // Das eigene Konto ist ausgenommen: Hier wird KEIN altes Passwort verlangt,
  // also könnte eine übernommene Sitzung den Besitzer sonst aussperren.
  assert.match(fn, /targetId === Number\(req\.session\.userId\)/,
    'Für das eigene Konto muss /change-password gelten');
  assert.match(fn, /String\(password\)\.length < 8/, 'Mindestlänge fehlt');
  assert.match(fn, /bcrypt\.hash\(String\(password\), BCRYPT_ROUNDS\)/,
    'Das Passwort muss mit denselben Parametern gehasht werden wie überall');
  assert.match(fn, /if \(!r\.changes\) return res\.status\(404\)/,
    'Ein unbekannter Nutzer muss 404 ergeben, nicht stillen Erfolg');

  // Offene Zugänge schliessen.
  //
  // Hier stand die Erwartung, die Session-Tabelle werde vor dem Löschen mit
  // to_regclass geprüft — „der Store legt sie zur Laufzeit an". Die Annahme
  // war falsch: Der Store läuft auf user_sessions (server.ts, tableName), und
  // db/database.ts legt die Tabelle im Schema an. Der Test auf `session` war
  // immer NULL, das DELETE lief nie, und dieser Test hat die Lücke
  // festgeschrieben statt sie zu finden. Beide Schritte laufen jetzt über die
  // Helfer in utils/auth.ts.
  assert.match(fn, /revokeAllSessions\(targetId\)/,
    'Offene Sitzungen des Kontos müssen enden');
  assert.match(fn, /revokeAllTokens\(targetId\)/,
    'Token des Kontos müssen ebenfalls verfallen');
});

test('Sicherheitsschritte am Konto scheitern nicht mehr stillschweigend', () => {
  // ── Woher dieser Test kommt ─────────────────────────────────────────────
  // Drei Stellen im Anmeldeweg trugen .catch(() => {}):
  //
  //   • Der Web-Token beim Login. Scheiterte das INSERT, galt die Anmeldung
  //     trotzdem als erfolgreich, und der Client legte einen Token in den
  //     sessionStorage, den die Datenbank nie gesehen hatte — der SSE-Kanal
  //     (?token=…, EventSource kann keine Header setzen) lief dann in ein 401.
  //     Jetzt wird der Token bei einem Fehler WEGGELASSEN; ohne ihn fällt der
  //     Client auf die Cookie-Session zurück, die ohnehin funktioniert.
  //   • Das Verwerfen von Sessions und Tokens nach einem Passwortwechsel.
  //     Verschluckt hiess: neues Passwort gesetzt, alte Zugänge gelten weiter.
  //   • revokeAllTokens() — dieselbe Regel an der zentralen Stelle.
  const auth  = fs.readFileSync(path.join(ROOT, 'routes', 'auth.ts'), 'utf8');
  const utils = fs.readFileSync(path.join(ROOT, 'utils', 'auth.ts'), 'utf8');

  const login = auth.slice(auth.indexOf('webapp-session'), auth.indexOf('mustChangePassword'));
  assert.doesNotMatch(login, /\.catch\(\(\)\s*=>\s*\{\}\)/,
    'Ein Token, den die Datenbank nicht kennt, darf nicht ausgeliefert werden');
  assert.match(auth, /webToken \? \{ webToken \} : \{\}/,
    'Ohne gespeicherten Token gehört das Feld nicht in die Antwort');

  // Die Löschungen selbst stehen inzwischen nur noch in utils/auth.ts
  // (revokeAllTokens / revokeAllSessions) — routes/auth.ts ruft sie auf.
  for (const [quelle, name, stelle] of [
    [utils, 'utils/auth.ts', "DELETE FROM api_tokens WHERE user_id = $1"],
    [utils, 'utils/auth.ts', "DELETE FROM user_sessions WHERE sess::jsonb->>'userId' = $1"],
  ]) {
    const i = quelle.indexOf(stelle);
    assert.ok(i > 0, `${name}: ${stelle} nicht gefunden`);
    const aufruf = quelle.slice(i, quelle.indexOf(';', i) + 1);
    assert.doesNotMatch(aufruf, /\.catch\(\(\)\s*=>\s*\{\}\)/,
      `${name}: alte Zugänge dürfen einen Passwortwechsel nicht überleben`);
  }
});

test('ein Passwortwechsel beendet auch die offenen Sitzungen', () => {
  // ── Woher dieser Test kommt ─────────────────────────────────────────────
  // Der Admin-Reset suchte die Sitzungen in einer Tabelle `session` und
  // übersprang den Schritt, wenn es sie nicht gibt. Es gibt sie NIE: Der
  // Store läuft auf `user_sessions` (server.ts, tableName). to_regclass
  // lieferte immer NULL, das DELETE lief nie — ein Administrator konnte das
  // Passwort eines übernommenen Kontos zurücksetzen, und die Sitzung des
  // Angreifers blieb angemeldet. Gegen echten Store nachgestellt: vorher
  // blieb die Sitzung gültig, jetzt ist sie weg.
  //
  // Drei Wege ändern ein Passwort — Admin-Reset, Reset per E-Mail-Token und
  // die eigene Änderung. Alle drei müssen Tokens UND Sitzungen schliessen.
  const auth  = fs.readFileSync(path.join(ROOT, 'routes', 'auth.ts'), 'utf8');
  const utils = fs.readFileSync(path.join(ROOT, 'utils', 'auth.ts'), 'utf8');

  assert.doesNotMatch(auth, /to_regclass\('public\.session'\)/,
    'Die Tabelle heisst user_sessions — der Test darauf war immer NULL');
  assert.doesNotMatch(auth, /DELETE FROM session\b/,
    'DELETE FROM session trifft keine existierende Tabelle');

  // Sitzungen werden an EINER Stelle gelöscht, mit dem robusten Ausdruck.
  assert.match(utils, /async function revokeAllSessions/);
  assert.match(utils, /DELETE FROM user_sessions WHERE sess::jsonb->>'userId'/,
    "->> liefert den blanken Wert; ::text brächte bei einem String die Anführungszeichen mit");
  assert.equal((auth.match(/DELETE FROM user_sessions/g) || []).length, 0,
    'Sitzungen löscht nur noch revokeAllSessions()');

  // Alle drei Passwortwege rufen beide Helfer.
  const wege = [
    ["users/:id/password", auth.indexOf("router.put('/users/:id/password'")],
    ["reset-password",     auth.indexOf("router.post('/reset-password'")],
    ["change-password",    auth.indexOf("router.post('/change-password'")],
  ];
  for (const [name, start] of wege) {
    assert.ok(start > 0, `${name}: Route nicht gefunden`);
    const ende = auth.indexOf('router.', start + 10);
    const block = auth.slice(start, ende === -1 ? auth.length : ende);
    assert.match(block, /revokeAllTokens\(/, `${name}: Tokens bleiben gültig`);
    assert.match(block, /revokeAllSessions\(/, `${name}: Sitzungen bleiben gültig`);
  }
});

test('ungenutzte App-Tokens verfallen, aktive nicht', () => {
  // ── Woher diese Regel kommt ─────────────────────────────────────────────
  // Tokens der Android-App und des QR-Logins werden bewusst ohne Ablaufdatum
  // angelegt (expires_at NULL) — wer die App öffnet, soll nicht ständig sein
  // Passwort eintippen. Der Preis war: Ein Token auf einem verlorenen oder
  // verkauften Telefon gilt unbegrenzt, und ausser einem Passwortwechsel gibt
  // es keinen Weg, ihn loszuwerden.
  //
  // Das Mass ist „ungenutzt", nicht „alt": Ein Telefon, das täglich
  // synchronisiert, wird nie ausgesperrt, egal wie lange es das Konto schon
  // hat. Nur was ohnehin niemand mehr benutzt, verfällt.
  const utils = fs.readFileSync(path.join(ROOT, 'utils', 'auth.ts'), 'utf8');

  assert.match(utils, /const TOKEN_IDLE_DAYS/, 'Die Frist gehört an eine benannte Stelle');
  assert.match(utils, /process\.env\.TOKEN_IDLE_DAYS/,
    'Die Frist muss ohne Codeänderung anpassbar sein');
  assert.match(utils, /expires_at IS NULL/,
    'Die Regel gilt NUR für Tokens ohne Ablaufdatum — die anderen deckt die erste Abfrage ab');
  assert.match(utils, /COALESCE\(last_used, created_at\)/,
    'Ohne COALESCE wären Zeilen ohne last_used für immer ausgenommen — ausgerechnet die ältesten');
  assert.match(utils, /if \(TOKEN_IDLE_DAYS > 0\)/,
    '0 muss die Regel abschalten können');

  // db.run() liefert { changes, lastID } — nicht rowCount. Vorher stand hier
  // r?.rowCount, die Zahl war deshalb immer 0 und die Meldung des Aufräumjobs
  // ist nie erschienen. Aufgeräumt wurde trotzdem; man sah es nur nicht.
  const fn = utils.slice(utils.indexOf('async function purgeExpiredTokens'),
                         utils.indexOf('export {'));
  assert.doesNotMatch(fn, /rowCount/, 'db.run() liefert changes, nicht rowCount');
  assert.match(fn, /\?\.changes \|\| 0/, 'Die Zählung muss changes lesen');
});
