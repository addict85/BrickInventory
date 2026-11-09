/**
 * Auth-Paritätstest (ohne DB).
 * Ausführlich: docs/begruendungen/test/auth-parity.test.js.md#kopf
 *
 * Gegenproben der am 08.11.2026 gestrichenen Fälle, die jetzt ausgeführt werden:
 * QR-Login ohne Passwort-Material und einmalig → anmeldung-regeln-db A/B;
 * angezeigte QR-Gültigkeit → dort B und qr-klartext-hinweis C; Profil prüft
 * den Benutzernamen → anmeldung-regeln-db C; Login ohne gespeicherten Token →
 * dort D, ein stilles `.catch(() => {})` beim Entwerten der Zugänge verbietet
 * ratschen.test.js („stille Faenge …“).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// Nach dist/ bauen statt in-place — siehe helpers/sources.js.
const _req = require('./helpers/sources').buildAndRequire();
const { assertLoginAllowed, USERNAME_RE, BCRYPT_ROUNDS, escapeLike } =
  _req('src/konto/auth.js');
const { ohneKommentare, abschnitt } = require('./helpers/sources');

/**
 * Jeden Anmelde-Handler SUCHEN statt zwei aufzuzählen.
 * Ausführlich: docs/begruendungen/test/auth-parity.test.js.md#anmeldehandler
 */
function anmeldeHandler() {
  const dateien = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? dateien(p) : (e.name.endsWith('.ts') ? [p] : []);
  });
  const alle = [...dateien(path.join(ROOT, 'routes')), path.join(ROOT, 'server.ts')];
  const treffer = [];
  for (const datei of alle) {
    const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    for (const m of src.matchAll(/(?:router|app)\.(post|put)\(\s*'([^']*login[^']*)'/g)) {
      // Der Rumpf reicht bis zur nächsten Routendefinition. Kommentare sind
      // schon weg — sonst zählte ein Erklärtext, der „password" erwähnt, mit.
      const rel = src.slice(m.index + 1).search(/\n(?:router|app)\.[a-z]+\(/);
      const koerper = rel < 0 ? src.slice(m.index) : src.slice(m.index, m.index + 1 + rel);
      treffer.push({ datei: path.relative(ROOT, datei), pfad: m[2], koerper });
    }
  }
  return treffer;
}

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

test('eine offene Registrierung wird abgelehnt, Admins ausgenommen', () => {
  const r = assertLoginAllowed({ is_active: 1, email_verified: 0, email: null, is_admin: 0, registrierung_offen: true });
  assert.equal(r?.status, 403);
  assert.equal(r?.unverified, true);
  assert.equal(assertLoginAllowed({ is_active: 1, email_verified: 0, email: null, is_admin: 1, registrierung_offen: true }), null);
  assert.equal(assertLoginAllowed({ is_active: 1, email_verified: 0, email: null, is_admin: 0, registrierung_offen: false }), null,
    'ein vom Verwalter angelegtes Konto ohne Adresse');
});

test('jede Anmeldung mit Passwort läuft über dieselbe Prüfung', () => {
  const gefunden = anmeldeHandler();
  // Selbstbeweis: Findet das Muster nichts, wäre die Fehlerliste leer und der
  // Test grün, ohne etwas geprüft zu haben.
  // Ausführlich: docs/begruendungen/test/auth-parity.test.js.md#stelle
  assert.ok(gefunden.length >= 2,
    `Nur ${gefunden.length} Anmelde-Routen gefunden — Muster veraltet?`);
  const mitPasswort = gefunden.filter(h => /password/.test(h.koerper));
  assert.equal(mitPasswort.length, 1,
    `${mitPasswort.length} passwortbasierte Anmeldungen: ` +
    mitPasswort.map(h => `${h.datei} ${h.pfad}`).join(', ') +
    ' — es soll genau eine geben.');

  const abweichler = mitPasswort
    .filter(h => !/\b(pruefeAnmeldedaten|anmelden)\(/.test(h.koerper))
    .map(h => `${h.datei}  ${h.pfad}`);
  assert.deepEqual(abweichler, [],
    'Diese Anmeldungen prüfen die Zugangsdaten selbst statt über ' +
    'pruefeAnmeldedaten() aus src/konto/auth.ts:\n  ' + abweichler.join('\n  ') +
    '\nEine zweite Fassung ist schon zweimal auseinandergelaufen: erst fehlten ' +
    'die Konto-Vorbedingungen, dann der Vergleich gegen den Dummy-Hash ' +
    '(415 ms Unterschied, siehe test/login-zeitgleich-db.test.js).');
});

test('der Brute-Force-Zähler wird nur an einer Stelle bedient', () => {
  // Wer den Zähler selbst hochzählt, hat auch die Passwortprüfung selbst
  // gebaut — der Aufruf ist damit der zuverlässigste Fingerabdruck einer
  // zweiten Anmeldefassung, unabhängig davon, wie ihre Route heisst.
  const zaehler = /\b(checkLoginAllowed|recordLoginFailure|recordLoginSuccess)\s*\(/;
  const erlaubt = new Set(['src/konto/auth.ts', 'src/konto/loginLimiter.ts']);

  const sammle = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? sammle(p) : (e.name.endsWith('.ts') ? [p] : []);
  });
  const alle = [...sammle(path.join(ROOT, 'routes')), ...sammle(path.join(ROOT, 'src')),
                path.join(ROOT, 'server.ts')];
  assert.ok(alle.length >= 30, `Nur ${alle.length} Dateien durchsucht — Pfade veraltet?`);

  const fremd = alle
    .map(d => path.relative(ROOT, d))
    .filter(rel => !erlaubt.has(rel))
    .filter(rel => zaehler.test(ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'))));
  assert.deepEqual(fremd, [],
    'Diese Dateien bedienen den Anmelde-Zähler selbst: ' + fremd.join(', ') +
    ' — die Anmeldung gehört ganz in pruefeAnmeldedaten() (src/konto/auth.ts).');

  // Gegenprobe zur Regel: Die erlaubte Stelle muss ihn auch wirklich bedienen.
  const zentral = require('./helpers/sources').dienstQuelle('src/konto/auth.ts');
  for (const name of ['checkLoginAllowed', 'recordLoginFailure', 'recordLoginSuccess'])
    assert.match(zentral, new RegExp(`\\b${name}\\(ip`), `src/konto/auth.ts ruft ${name} nicht auf`);
});

test('die Benutzernamen-Regel', () => {
  assert.ok(USERNAME_RE.test('marco_1'));
  assert.ok(!USERNAME_RE.test('ma'));
  assert.ok(!USERNAME_RE.test('a b'));
  assert.ok(!USERNAME_RE.test('a@b.c'), 'E-Mail-Adresse darf kein Benutzername sein');

  // Dass PUT /profile sie anwendet (auch gross/klein), prüft anmeldung-regeln-db.test.js.
});

test('bcrypt-Kostenfaktor ist überall derselbe', () => {
  assert.ok(BCRYPT_ROUNDS >= 12);
  const auth = [require('./helpers/sources').anmeldeQuelle(), fs.readFileSync(path.join(ROOT, 'src/konto/konten.ts'), 'utf8')].join('\n');
  const literals = [...auth.matchAll(/(?:bcrypt\.hash|hashePasswort)\([^,]+,\s*([^)]+)\)/g)].map(m => m[1].trim());
  assert.deepEqual([...new Set(literals)], ['BCRYPT_ROUNDS'],
    `bcrypt.hash wird mit unterschiedlichen Kosten aufgerufen: ${literals.join(', ')}`);
});

test('escapeLike entschärft Platzhalter beim Token-Löschen', () => {
  assert.equal(escapeLike('%'), '\\%');
  assert.equal(escapeLike('a_b'), 'a\\_b');
  assert.equal(escapeLike('abc123'), 'abc123');
});

test('Admins können das Passwort anderer Nutzer setzen', () => {
  // Der Dialog in den Einstellungen rief PUT /auth/users/:id/password schon
  // immer auf — die Route gab es nicht, das Speichern endete in
  // „API-Endpunkt nicht gefunden".
  const auth = require('./helpers/sources').anmeldeQuelle();
  assert.match(auth, /router\.put\('\/users\/:id\/password', requireAdmin/,
    'Route fehlt oder ist nicht auf Administratoren beschränkt');

  const fn = auth.slice(auth.indexOf("router.put('/users/:id/password'"),
                        auth.indexOf("router.delete('/users/:id'"));

  // Das eigene Konto ist ausgenommen: Hier wird KEIN altes Passwort verlangt,
  // also könnte eine übernommene Sitzung den Besitzer sonst aussperren.
  // Ausführlich: docs/begruendungen/test/auth-parity.test.js.md#stelle-2
  assert.match(fn, /targetId === nutzerId\(req\)/,
    'Für das eigene Konto muss /change-password gelten');
  // Die AUSSAGE bleibt, der Beleg wechselt: Die Mindestlaenge stand hier als
  // handgetippte Bedingung, an vier von sechs passwortsetzenden Routen und in
  // zwei Schreibweisen. Genau daran fehlte sie an den anderen zwei. Sie liegt
  // jetzt in passwortZuKurz() (src/konto/auth.ts); test/passwortlaenge.test.js
  // haelt fest, dass ALLE sechs Stellen sie benutzen.
  assert.match(fn, /passwortMangel\(password, /, 'Passwortregel fehlt');
  // Hashen und das Beenden aller Zugänge übernimmt der Kontodienst (Test darüber).
  assert.match(fn, /if \(!await K\.setzeFremdesPasswort\(targetId, password\)\) return sendeFehler\(req, res, 404/,
    'Ein unbekannter Nutzer muss 404 ergeben, nicht stillen Erfolg');
});

test('ein Passwortwechsel beendet auch die offenen Sitzungen', () => {
  // Woher dieser Test kommt
  // Ausführlich: docs/begruendungen/test/auth-parity.test.js.md#auth-2
  const auth  = require('./helpers/sources').anmeldeQuelle();
  const utils = require('./helpers/sources').dienstQuelle('src/konto/auth.ts');

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
    assert.match(block, /K\.(setzeFremdesPasswort|aendereEigenesPasswort|setzePasswortZurueck)\(|A\.eigenesPasswortAendern\(/,
      `${name}: Passwort nicht über den Kontodienst gesetzt — die Zugänge bleiben gültig`);
  }
  assert.match(abschnitt(ohneKommentare(fs.readFileSync(path.join(ROOT, 'src/konto/anmeldungAblauf.ts'), 'utf8')),
    'function eigenesPasswortAendern(', '\n}'), /K\.aendereEigenesPasswort\(/, 'der Ablauf setzt das Passwort nicht über den Kontodienst');
  // Der Kontodienst beendet in jedem dieser Wege Tokens UND Sitzungen.
  const konten = ohneKommentare(fs.readFileSync(path.join(ROOT, 'src/konto/konten.ts'), 'utf8'));
  assert.match(konten, /async function zugaengeBeenden[^}]*revokeAllTokens\(uid\);[^}]*revokeAllSessions\(uid\);/);
  for (const f of ['setzeFremdesPasswort', 'aendereEigenesPasswort', 'setzePasswortZurueck'])
    assert.match(abschnitt(konten, `function ${f}(`, '\n}'), /await zugaengeBeenden\(uid\)/, `${f} beendet die Zugänge nicht`);
});

test('ungenutzte App-Tokens verfallen, aktive nicht', () => {
  // Woher diese Regel kommt
  // Ausführlich: docs/begruendungen/test/auth-parity.test.js.md#utils
  const utils = require('./helpers/sources').dienstQuelle('src/konto/auth.ts');

  assert.match(utils, /const TOKEN_IDLE_DAYS/, 'Die Frist gehört an eine benannte Stelle');
  // TOKEN_IDLE_DAYS liest die zentrale Konfiguration (src/infra/konfig.ts).
  assert.match(utils, /konfig\(\)\.tokenLeerlaufTage/,
    'Die Frist muss ohne Codeänderung anpassbar sein');
  assert.match(utils, /expires_at IS NULL/,
    'Die Regel gilt NUR für Tokens ohne Ablaufdatum — die anderen deckt die erste Abfrage ab');
  assert.match(utils, /COALESCE\(last_used, created_at\)/,
    'Ohne COALESCE wären Zeilen ohne last_used für immer ausgenommen — ausgerechnet die ältesten');
  // „Nie“ gibt es seit Migration 0080 nicht mehr: Ohne Ablauf nur je Gerät,
  // über HTTPS und mit Rotation (token-scope-rotation-db).
  const { ladeKonfig } = require('./helpers/sources').buildAndRequire()('src/infra/konfig.js');
  assert.throws(() => ladeKonfig({ TOKEN_IDLE_DAYS: '0' }), /TOKEN_IDLE_DAYS/,
    'TOKEN_IDLE_DAYS=0 darf die Frist nicht mehr abschalten');

  // db.run() liefert { changes, lastID } — nicht rowCount. Vorher stand hier
  // r?.rowCount, die Zahl war deshalb immer 0 und die Meldung des Aufräumjobs
  // ist nie erschienen. Aufgeräumt wurde trotzdem; man sah es nur nicht.
  const fn = utils.slice(utils.indexOf('async function purgeExpiredTokens'),
                         utils.indexOf('export {'));
  assert.doesNotMatch(fn, /rowCount/, 'db.run() liefert changes, nicht rowCount');
  assert.match(fn, /\.changes \|\| 0/, 'Die Zählung muss changes lesen');
});
