/**
 * Auth parity test (without DB).
 *
 * Counter-checks of the cases deleted on 08.11.2026 that are now executed:
 * QR login without password material and one-time → anmeldung-regeln-db A/B;
 * displayed QR validity → there B and qr-klartext-hinweis C; profile checks
 * the username → anmeldung-regeln-db C; login without a stored token →
 * there D, a silent `.catch(() => {})` when invalidating the accesses is forbidden by
 * ratschen.test.js (“silent catches …”).
 * Switched to behavior on 11.11.2026: administrator sets a foreign password and
 * every password path ends the accesses → auth-sessions-db; equal bcrypt cost
 * on all paths → passwort-regel-db; sliding period and count of the cleanup →
 * token-gleitfrist-db. Counter-check: `loadConfig` accepts TOKEN_IDLE_DAYS=0 → red
 * “the sliding period cannot be switched off”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// Build to dist/ instead of in place — see helpers/sources.js.
const _req = require('./helpers/sources').buildAndRequire();
const { assertLoginAllowed } = _req('src/account/loginCheck.js');
const { ARGON2_COST } = _req('src/account/passwordHash.js');
const { USERNAME_RE } = _req('src/account/nameRules.js');
const { escapeLike } = _req('src/account/deviceToken.js');
const { ohneKommentare } = require('./helpers/sources');

/**
 * SEARCH every login handler instead of enumerating two.
 */
function loginHandler() {
  const dateien = dir =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? dateien(p) : e.name.endsWith('.ts') ? [p] : [];
    });
  const alle = [...dateien(path.join(ROOT, 'routes')), path.join(ROOT, 'server.ts')];
  const treffer = [];
  for (const datei of alle) {
    const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    for (const m of src.matchAll(
      /(?:router|app)\.(?:(?:post|put)\(\s*'|endpoint\(\s*'(?:POST|PUT) )([^']*login[^']*)'/g,
    )) {
      // The body extends to the next route definition. Comments are
      // already gone — otherwise an explanatory text mentioning “password" would count.
      const rel = src.slice(m.index + 1).search(/\n\s*(?:router|app)\.[a-z]+\(/);
      const koerper = rel < 0 ? src.slice(m.index) : src.slice(m.index, m.index + 1 + rel);
      treffer.push({ datei: path.relative(ROOT, datei), path: m[1], koerper });
    }
  }
  return treffer;
}

test('an active, confirmed account may log in', () => {
  assert.equal(assertLoginAllowed({ is_active: 1, email_verified: 1, email: 'a@b.c' }), null);
  assert.equal(assertLoginAllowed({ is_active: true, email_verified: true, email: 'a@b.c' }), null);
  // An account entirely without e-mail (old installation, admin/admin) stays allowed
  assert.equal(assertLoginAllowed({ is_active: 1, email_verified: 0, email: null }), null);
});

test('a deactivated account is rejected — whether 0 or false', () => {
  for (const v of [0, false]) {
    const r = assertLoginAllowed({ is_active: v, email_verified: 1, email: 'a@b.c' });
    assert.equal(r?.kind, 'forbidden', `is_active=${v} muss verboten ergeben`);
  }
});

test('an open registration is rejected, admins excepted', () => {
  const r = assertLoginAllowed({
    is_active: 1,
    email_verified: 0,
    email: null,
    is_admin: 0,
    registration_pending: true,
  });
  assert.equal(r?.kind, 'forbidden');
  assert.equal(r?.unverified, true);
  assert.equal(
    assertLoginAllowed({ is_active: 1, email_verified: 0, email: null, is_admin: 1, registration_pending: true }),
    null,
  );
  assert.equal(
    assertLoginAllowed({ is_active: 1, email_verified: 0, email: null, is_admin: 0, registration_pending: false }),
    null,
    'ein vom Verwalter angelegtes Konto ohne Adresse',
  );
});

test('every login with password goes through the same check', () => {
  const found = loginHandler();
  // Self-proof: if the pattern finds nothing, the error list would be empty and the
  // test green without having checked anything.
  assert.ok(found.length >= 2, `Nur ${found.length} Anmelde-Routen gefunden — Muster veraltet?`);
  const withPassword = found.filter(h => /password/.test(h.koerper));
  assert.equal(
    withPassword.length,
    1,
    `${withPassword.length} passwortbasierte Anmeldungen: ` +
      withPassword.map(h => `${h.datei} ${h.path}`).join(', ') +
      ' — es soll genau eine geben.',
  );

  const outlier = withPassword
    .filter(h => !/\b(checkCredentials|login)\(/.test(h.koerper))
    .map(h => `${h.datei}  ${h.path}`);
  assert.deepEqual(
    outlier,
    [],
    'Diese Anmeldungen prüfen die Zugangsdaten selbst statt über ' +
      'checkCredentials() aus src/account/loginCheck.ts:\n  ' +
      outlier.join('\n  ') +
      '\nEine zweite Fassung ist schon zweimal auseinandergelaufen: erst fehlten ' +
      'die Konto-Vorbedingungen, dann der Vergleich gegen den Dummy-Hash ' +
      '(415 ms Unterschied, siehe test/login-time-equal-db.test.js).',
  );
});

test('the brute-force counter is only served in one place', () => {
  // Whoever increments the counter themselves has also built the password check
  // themselves — the call is thus the most reliable fingerprint of a
  // second login version, regardless of what its route is called.
  const zaehler = /\b(loginAllowed|loginFailed|loginSucceeded)\s*\(/;
  const erlaubt = new Set(['src/account/loginCheck.ts', 'src/account/loginLimiter.ts']);

  const collect = dir =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? collect(p) : e.name.endsWith('.ts') ? [p] : [];
    });
  const alle = [
    ...collect(path.join(ROOT, 'routes')),
    ...collect(path.join(ROOT, 'src')),
    path.join(ROOT, 'server.ts'),
  ];
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
      ' — die Anmeldung gehört ganz in checkCredentials() (src/account/loginCheck.ts).',
  );

  // Counter-check of the rule: the allowed place must really serve it too.
  const central = require('./helpers/sources').serviceSource('src/account/loginCheck.ts');
  for (const name of ['loginAllowed', 'loginFailed', 'loginSucceeded'])
    assert.match(central, new RegExp(`\\b${name}\\((?:k, )?ip`), `src/account/loginCheck.ts ruft ${name} nicht auf`);
});

test('the username rule', () => {
  assert.ok(USERNAME_RE.test('marco_1'));
  assert.ok(!USERNAME_RE.test('ma'));
  assert.ok(!USERNAME_RE.test('a b'));
  assert.ok(!USERNAME_RE.test('a@b.c'), 'E-Mail-Adresse darf kein Benutzername sein');

  // That PUT /profile applies it (also upper/lower case) is checked by login-rules-db.test.js.
});

test('escapeLike defuses wildcards when deleting tokens', () => {
  assert.equal(escapeLike('%'), '\\%');
  assert.equal(escapeLike('a_b'), 'a\\_b');
  assert.equal(escapeLike('abc123'), 'abc123');
});

test('the sliding deadline cannot be switched off', () => {
  // “Never” no longer exists since migration 0080: without expiry only per device,
  // over HTTPS and with rotation (token-scope-rotation-db). That the period comes from
  // the configuration and the cleanup counts is shown by token-gleitfrist-db.
  const { loadConfig } = _req('src/infra/config.js');
  assert.throws(() => loadConfig({ TOKEN_IDLE_DAYS: '0' }), /TOKEN_IDLE_DAYS/);
  assert.equal(loadConfig({ TOKEN_IDLE_DAYS: '23' }).tokenIdleDays, 23);
  assert.ok(ARGON2_COST.memoryCost >= 19_456 && ARGON2_COST.timeCost >= 2);
});
