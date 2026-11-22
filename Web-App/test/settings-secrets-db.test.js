/**
 * NO read route of the settings hands out a secret in plain text.
 *
 * Counter-check (carried out): readSettings() in `/raw` replaced by the old, raw
 * query → both substeps for /raw turn red (non-admin sees
 * the value, admin sees it unmasked).
 *
 * Also: mail server, account and sender are only seen by the admin.
 * Counter-check (measured on 28.10.2026): ONLY_ADMIN row removed in
 * globaleFuerAnsicht() → red: “… gets smtp_host”.
 * Counter-check (measured on 29.10.2026): geheimnisMaske() again appends the last
 * four characters → red: “… the mask of bricklink_consumer_secret reveals 4711”.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const express = require(path.join(ROOT, 'node_modules', 'express'));

/** Secrets that must stand in plain text in no response. */
const GEHEIM = {
  bricklink_consumer_secret: 'GEHEIM-bl-cs-4711',
  bricklink_token_secret: 'GEHEIM-bl-ts-4712',
  brickset_api_key: 'GEHEIM-bs-key-4713',
  rebrickable_api_key: 'GEHEIM-rb-key-4714',
  smtp_pass: 'GEHEIM-smtp-4715',
};

/** No secrets, but only for the admin. */
const MANAGEMENT = {
  smtp_host: 'mail.verwaltung.example',
  smtp_user: 'postfach@verwaltung.example',
  smtp_from: 'absender@verwaltung.example',
};

/**
 * Read routes that deliver global_settings — SEARCHED, not enumerated.
 */
const EXEMPT = new Map([
  [
    '/',
    'Die Sicht der App: nur die Felder aus APP_FIELDS (Währung, Zustand, ' + 'Cache-Dauer), keine globalen Schlüssel.',
  ],
  ['/default-condition', 'Gibt genau einen Wert heraus (den globalen Standard-Zustand).'],
  ['/user/default-condition', 'Gibt genau einen Wert heraus (den Zustand des Kontos).'],
  ['/household', 'Konten des Haushalts und offene Einladungen, keine Einstellungen.'],
  [
    '/export',
    'Die Konfigurations-Sicherung lässt Geheimnisse ganz weg statt sie ' +
      'zu maskieren; für Nicht-Verwalter enthält sie gar keine globalen ' +
      'Werte (test/settings-check-db.test.js).',
  ],
  [
    '/export/data',
    'ZIP mit Sets/Teilen/Minifiguren als CSV — enthält gar keine ' + 'Einstellungen und liefert kein JSON.',
  ],
  ['/tls', 'Gibt den öffentlichen Fingerabdruck der CA heraus, keine Einstellungen.'],
  [
    '/theme',
    'Gibt genau einen Wert heraus (den Designnamen) und ist bewusst ' +
      'ohne Login erreichbar, damit der Login-Bildschirm passt.',
  ],
  ['/tokens', 'Listet App-Token, keine Einstellungen. Die Token selbst stehen ' + 'nur als Hash in der Datenbank.'],
  [
    '/setup',
    'Stand des Einrichtungs-Assistenten: je Quelle nur ja/nein, ' +
      'keine Werte, und nur für Verwalter. Dass kein Schlüssel ' +
      'herauskommt, prüft test/setup-db.test.js.',
  ],
]);

function leserouten() {
  const source = ['settings.ts', 'settingsGlobal.ts']
    .map(f => require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'routes/api', f), 'utf8'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const found = [...source.matchAll(/router\.endpoint\(\s*'GET \/api\/v2\/settings([^']*)'/g)].map(m => m[1] || '/');
  // Self-proof: if the pattern did not apply, the list would be empty and the test
  // green without having looked at a single route.
  assert.ok(found.length >= 4, `Nur ${found.length} GET-Routen in routes/api/settings.ts gefunden — Muster veraltet?`);
  const veraltet = [...EXEMPT.keys()].filter(p => !found.includes(p));
  assert.deepEqual(veraltet, [], 'Diese Ausnahmen beschreiben keine Route mehr — streichen: ' + veraltet.join(', '));
  return found.filter(p => !EXEMPT.has(p)).map(p => '/api/v2/settings' + (p === '/' ? '' : p));
}

/** All strings of a response — no matter how deeply wrapped. */
function allValues(x, out = []) {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) for (const v of x) allValues(v, out);
  else if (x && typeof x === 'object') for (const v of Object.values(x)) allValues(v, out);
  return out;
}

test('settings never hand out secrets in plain text', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { migrieren: false }))) return;

  const NUTZER = `sec-user-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;

  const vorher = {};
  for (const [k, v] of Object.entries({ ...GEHEIM, ...MANAGEMENT })) {
    vorher[k] = (await db.get(`SELECT value FROM global_settings WHERE key=$1`, [k]))?.value ?? null;
    await db.run(
      `INSERT INTO global_settings (key,value) VALUES ($1,$2)
                  ON CONFLICT (key) DO UPDATE SET value=$2`,
      [k, v],
    );
  }
  // Like the start: plain text in the table is encrypted before the first request.
  await _req('src/settings/settings.js').reencryptLegacyGlobalValues();

  const appFor = isAdmin => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { userId: uid, isAdmin };
      next();
    });
    app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
    app.use('/api/v2', require('./helpers/sources').routerFrom(_req, 'routes/api/settings.js'));
    return app;
  };
  const srvUser = appFor(false).listen(0);
  const srvAdmin = appFor(true).listen(0);
  const baseUser = `http://localhost:${srvUser.address().port}`;
  const baseAdmin = `http://localhost:${srvAdmin.address().port}`;

  const hol = async (base, path) => {
    const r = await fetch(base + path);
    assert.equal(r.status, 200, `${path} -> ${r.status}`);
    return allValues(await r.json());
  };

  try {
    for (const path of leserouten()) {
      // 1. An account WITHOUT admin rights must not see the keys at all.
      const asUser = await hol(baseUser, path);
      for (const [k, v] of Object.entries(GEHEIM)) {
        assert.ok(!asUser.includes(v), `${path}: ein Konto ohne Adminrechte bekommt ${k} im Klartext`);
      }

      for (const [k, v] of Object.entries(MANAGEMENT)) {
        assert.ok(!asUser.includes(v), `${path}: ein Konto ohne Adminrechte bekommt ${k}`);
      }

      // 2. Even an admin only gets the mask — otherwise the values end up in the
      //    browser storage, where every XSS gap takes them along.
      const alsAdmin = await hol(baseAdmin, path);
      for (const [k, v] of Object.entries(GEHEIM)) {
        assert.ok(!alsAdmin.includes(v), `${path}: auch ein Admin darf ${k} nur maskiert bekommen`);
      }
      // Opposite direction: the mask must arrive at all, otherwise the
      // form cannot tell „set" from „not set" — a test
      // that only checks the absence would also be green with an empty response.
      assert.ok(
        alsAdmin.some(s => s.includes('\u2022'.repeat(12))),
        `${path}: der Admin muss die maskierte Fassung sehen`,
      );
      // Not even the end of the value: it shortens the guessing.
      for (const [k, v] of Object.entries(GEHEIM))
        assert.ok(!alsAdmin.some(s => s.includes(v.slice(-4))), `${path}: die Maske von ${k} verrät „${v.slice(-4)}"`);
      for (const [k, v] of Object.entries(MANAGEMENT)) {
        assert.ok(alsAdmin.includes(v), `${path}: der Verwalter braucht ${k} für sein Formular`);
      }
    }
  } finally {
    for (const [k, v] of Object.entries(vorher)) {
      if (v === null) await db.run(`DELETE FROM global_settings WHERE key=$1`, [k]).catch(() => {});
      else await db.run(`UPDATE global_settings SET value=$2 WHERE key=$1`, [k, v]).catch(() => {});
    }
    await db.run(`DELETE FROM user_settings WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]).catch(() => {});
    await new Promise(r => srvUser.close(r));
    await new Promise(r => srvAdmin.close(r));
    await db.pool.end().catch(() => {});
  }
});
