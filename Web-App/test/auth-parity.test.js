/**
 * Auth-Paritätstest (ohne DB).
 *
 * Gegenproben der am 08.11.2026 gestrichenen Fälle, die jetzt ausgeführt werden:
 * QR-Login ohne Passwort-Material und einmalig → anmeldung-regeln-db A/B;
 * angezeigte QR-Gültigkeit → dort B und qr-klartext-hinweis C; Profil prüft
 * den Benutzernamen → anmeldung-regeln-db C; Login ohne gespeicherten Token →
 * dort D, ein stilles `.catch(() => {})` beim Entwerten der Zugänge verbietet
 * ratschen.test.js („stille Faenge …“).
 * Am 11.11.2026 auf Verhalten umgestellt: Verwalter setzt fremdes Passwort und
 * jeder Passwortweg beendet die Zugänge → auth-sessions-db; gleiche bcrypt-Kosten
 * auf allen Wegen → passwort-regel-db; Gleitfrist und Zählung des Aufräumens →
 * token-gleitfrist-db. Gegenprobe: `ladeKonfig` nimmt TOKEN_IDLE_DAYS=0 an → rot
 * „die Gleitfrist lässt sich nicht abschalten“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// Nach dist/ bauen statt in-place — siehe helpers/sources.js.
const _req = require('./helpers/sources').buildAndRequire();
const { assertLoginAllowed, BCRYPT_ROUNDS } = _req('src/konto/anmeldepruefung.js');
const { USERNAME_RE } = _req('src/konto/namensRegeln.js');
const { escapeLike } = _req('src/konto/geraeteToken.js');
const { ohneKommentare } = require('./helpers/sources');

/**
 * Jeden Anmelde-Handler SUCHEN statt zwei aufzuzählen.
 */
function anmeldeHandler() {
  const dateien = dir =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? dateien(p) : e.name.endsWith('.ts') ? [p] : [];
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
    assert.equal(r?.art, 'verboten', `is_active=${v} muss verboten ergeben`);
  }
});

test('eine offene Registrierung wird abgelehnt, Admins ausgenommen', () => {
  const r = assertLoginAllowed({
    is_active: 1,
    email_verified: 0,
    email: null,
    is_admin: 0,
    registrierung_offen: true,
  });
  assert.equal(r?.art, 'verboten');
  assert.equal(r?.unverified, true);
  assert.equal(
    assertLoginAllowed({ is_active: 1, email_verified: 0, email: null, is_admin: 1, registrierung_offen: true }),
    null,
  );
  assert.equal(
    assertLoginAllowed({ is_active: 1, email_verified: 0, email: null, is_admin: 0, registrierung_offen: false }),
    null,
    'ein vom Verwalter angelegtes Konto ohne Adresse',
  );
});

test('jede Anmeldung mit Passwort läuft über dieselbe Prüfung', () => {
  const gefunden = anmeldeHandler();
  // Selbstbeweis: Findet das Muster nichts, wäre die Fehlerliste leer und der
  // Test grün, ohne etwas geprüft zu haben.
  assert.ok(gefunden.length >= 2, `Nur ${gefunden.length} Anmelde-Routen gefunden — Muster veraltet?`);
  const mitPasswort = gefunden.filter(h => /password/.test(h.koerper));
  assert.equal(
    mitPasswort.length,
    1,
    `${mitPasswort.length} passwortbasierte Anmeldungen: ` +
      mitPasswort.map(h => `${h.datei} ${h.pfad}`).join(', ') +
      ' — es soll genau eine geben.',
  );

  const abweichler = mitPasswort
    .filter(h => !/\b(pruefeAnmeldedaten|anmelden)\(/.test(h.koerper))
    .map(h => `${h.datei}  ${h.pfad}`);
  assert.deepEqual(
    abweichler,
    [],
    'Diese Anmeldungen prüfen die Zugangsdaten selbst statt über ' +
      'pruefeAnmeldedaten() aus src/konto/anmeldepruefung.ts:\n  ' +
      abweichler.join('\n  ') +
      '\nEine zweite Fassung ist schon zweimal auseinandergelaufen: erst fehlten ' +
      'die Konto-Vorbedingungen, dann der Vergleich gegen den Dummy-Hash ' +
      '(415 ms Unterschied, siehe test/login-zeitgleich-db.test.js).',
  );
});

test('der Brute-Force-Zähler wird nur an einer Stelle bedient', () => {
  // Wer den Zähler selbst hochzählt, hat auch die Passwortprüfung selbst
  // gebaut — der Aufruf ist damit der zuverlässigste Fingerabdruck einer
  // zweiten Anmeldefassung, unabhängig davon, wie ihre Route heisst.
  const zaehler = /\b(checkLoginAllowed|recordLoginFailure|recordLoginSuccess)\s*\(/;
  const erlaubt = new Set(['src/konto/anmeldepruefung.ts', 'src/konto/loginLimiter.ts']);

  const sammle = dir =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? sammle(p) : e.name.endsWith('.ts') ? [p] : [];
    });
  const alle = [...sammle(path.join(ROOT, 'routes')), ...sammle(path.join(ROOT, 'src')), path.join(ROOT, 'server.ts')];
  assert.ok(alle.length >= 30, `Nur ${alle.length} Dateien durchsucht — Pfade veraltet?`);

  const fremd = alle
    .map(d => path.relative(ROOT, d))
    .filter(rel => !erlaubt.has(rel))
    .filter(rel => zaehler.test(ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'))));
  assert.deepEqual(
    fremd,
    [],
    'Diese Dateien bedienen den Anmelde-Zähler selbst: ' +
      fremd.join(', ') +
      ' — die Anmeldung gehört ganz in pruefeAnmeldedaten() (src/konto/anmeldepruefung.ts).',
  );

  // Gegenprobe zur Regel: Die erlaubte Stelle muss ihn auch wirklich bedienen.
  const zentral = require('./helpers/sources').dienstQuelle('src/konto/anmeldepruefung.ts');
  for (const name of ['checkLoginAllowed', 'recordLoginFailure', 'recordLoginSuccess'])
    assert.match(zentral, new RegExp(`\\b${name}\\(ip`), `src/konto/anmeldepruefung.ts ruft ${name} nicht auf`);
});

test('die Benutzernamen-Regel', () => {
  assert.ok(USERNAME_RE.test('marco_1'));
  assert.ok(!USERNAME_RE.test('ma'));
  assert.ok(!USERNAME_RE.test('a b'));
  assert.ok(!USERNAME_RE.test('a@b.c'), 'E-Mail-Adresse darf kein Benutzername sein');

  // Dass PUT /profile sie anwendet (auch gross/klein), prüft anmeldung-regeln-db.test.js.
});

test('escapeLike entschärft Platzhalter beim Token-Löschen', () => {
  assert.equal(escapeLike('%'), '\\%');
  assert.equal(escapeLike('a_b'), 'a\\_b');
  assert.equal(escapeLike('abc123'), 'abc123');
});

test('die Gleitfrist lässt sich nicht abschalten', () => {
  // „Nie“ gibt es seit Migration 0080 nicht mehr: Ohne Ablauf nur je Gerät,
  // über HTTPS und mit Rotation (token-scope-rotation-db). Dass die Frist aus
  // der Konfiguration kommt und das Aufräumen zählt, zeigt token-gleitfrist-db.
  const { ladeKonfig } = _req('src/infra/konfig.js');
  assert.throws(() => ladeKonfig({ TOKEN_IDLE_DAYS: '0' }), /TOKEN_IDLE_DAYS/);
  assert.equal(ladeKonfig({ TOKEN_IDLE_DAYS: '23' }).tokenLeerlaufTage, 23);
  assert.ok(BCRYPT_ROUNDS >= 12);
});
