/**
 * Every WRITING route of the app (shared/app-schnittstelle.json) against its
 * contract (src/contract/): response and, where the contract names one, the input.
 *
 * Counter-checks (measured on 27.10.):
 *   A  in routes/api/sets.ts PUT /storage/default with `success: null` →
 *      red (31.10.2026): “every step answers with 200” (500 contract_violated,
 *      response success) and “every writing route is checked …”
 *   B  a step removed from STEPS (PUT /api/v2/vouchers/{id}) → red:
 *      “every writing route is checked or omitted with reason"
 *   C  a path the app does not know added to OMITTED → red:
 *      “no dead exception"
 *   D  in src/parts/repository/manualParts.ts again `NULLIF($1, 0)` without ::numeric → red: “every
 *      step answers with 200" (PUT /parts: 500, invalid input syntax for
 *      type integer) and “unit price with decimals"
 *   E  (09.11.2026) in deleteOtherAccesses() without `$2::text IS NULL OR`
 *      (NULL IS DISTINCT FROM NULL is false) → red: “the write responses …”
 *      (zugaenge 0 instead of 1 from a browser session)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
// Links in mails only exist with a fixed address (routes/auth.ts, getBaseUrl).
process.env.APP_BASE_URL = 'http://localhost';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const { catalogSet } = require('./helpers/inventory');
const { importWorker } = require('./helpers/jobs');
const { dataOrSkip } = require('./helpers/db');
const { routerEinhaengungen, testData } = require('./helpers/sources');
const db = testData();
const express = require(path.join(ROOT, 'node_modules', 'express'));
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const PDFDocument = require('pdfkit');
const { contractTo, appSchnittstelle } = require('./helpers/contract');
const { mailAttrappe, enterMailServer } = require('./helpers/mail-fake');
mailAttrappe();

const NAME = `kschreib_${process.pid}`,
  PASS = 'VertragsPasswort1!';
const SET = '99075-1',
  SET2 = '99076-1',
  TEIL = '3001ks',
  FARBE = 5,
  FARBE2 = 1,
  FIGUR = 'ks0001';

/** Routes that must not or cannot run here — with reason. */
const OMITTED = new Map([
  ['POST /api/v2/admin/trigger-csv-sync', 'startet den Katalogabgleich mit Rebrickable im Netz'],
  ['POST /api/v2/admin/reimport-instructions', 'lädt Anleitungen bei LEGO im Netz'],
  ['POST /api/v2/admin/trigger-price-job', 'fragt BrickLink im Netz'],
  ['POST /api/v2/admin/redownload-missing-images', 'lädt Bilder im Netz'],
  ['POST /api/v2/admin/catalog-images', 'reiht Bilder für den Download im Netz ein'],
  ['POST /api/v2/vouchers/{id}/balance', 'fragt das Guthaben bei LEGO im Netz ab'],
  ['POST /api/v2/sets/partslist-pdf', 'liefert eine Datei, kein JSON-Modell'],
  [
    'POST /api/v2/auth/passkey/login/options',
    'braucht APP_BASE_URL mit Domain; die Optionen bleiben JSON (passkeys-db)',
  ],
  ['POST /api/v2/auth/passkey/login', 'braucht eine WebAuthn-Signatur; antwortet wie /auth/login (passkeys-db)'],
  ['POST /api/v2/vouchers/{id}/plaintext', 'verlangt Passwort und zweiten Faktor; Antwort geprüft in gutscheine-db'],
  ['POST /api/v2/vouchers/{id}/pdf-grant', 'verlangt Passwort und zweiten Faktor; Ticket geprüft in gutscheine-db'],
  ['POST /api/v2/vouchers/export/pdf-grant', 'verlangt Passwort und zweiten Faktor; Ticket geprüft in gutscheine-db'],
  ['POST /api/v2/device/key', 'nur mit App-Token, dieser Lauf hat eine Sitzung; geprüft in schrittschutz-db'],
  ['POST /api/v2/device/key/nonce', 'nur mit App-Token in seinen ersten Minuten; geprüft in schrittschutz-db'],
  [
    'POST /api/v2/auth/qr-login/discard',
    'braucht eine bestätigte, nicht abgeholte Kopplung; geprüft in qr-kopplung-db',
  ],
  ['POST /api/v2/device/step/challenge', 'nur mit App-Token und Schlüssel; geprüft in schrittschutz-db'],
  ['POST /api/v2/device/step/approval', 'braucht eine Signatur des Geräteschlüssels; geprüft in schrittschutz-db'],
]);

/** A PDF with the passed lines. */
function pdfWith(zeilen) {
  return new Promise(fertig => {
    const doc = new PDFDocument({ compress: true });
    const stuecke = [];
    doc.on('data', s => stuecke.push(s));
    doc.on('end', () => fertig(Buffer.concat(stuecke)));
    for (const z of zeilen) doc.text(z);
    doc.end();
  });
}

/** A form with a file under `file` — that is how the app sends it. */
function formular(inhalt, typ, name, felder = {}) {
  const f = new FormData();
  f.append('file', new Blob([inhalt], { type: typ }), name);
  for (const [k, v] of Object.entries(felder)) f.append(k, v);
  return f;
}

test("the app's write responses keep their contract", { concurrency: 1, timeout: 180_000 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  importWorker(t, _req);

  // ── Three accounts: main, sub-account, a third for the invitation ──────
  const namen = [NAME, `${NAME}_sub`, `${NAME}_neu`, `${NAME}_reg`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  const hash = await bcrypt.hash(PASS, 4);
  const anlegen = async (n, admin) =>
    (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
     VALUES ($1, $2, $3, $4, true, true) RETURNING id`,
        [n, `${n}@example.org`, hash, admin ? 1 : 0],
      )
    ).id;
  const uid = await anlegen(NAME, true),
    sub = await anlegen(`${NAME}_sub`, false);
  const neu = await anlegen(`${NAME}_neu`, false);
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [uid, sub]);

  const globalBefore = await db
    .all(`SELECT key, value FROM global_settings WHERE key = ANY($1)`, [
      [
        'cache_ttl_hours',
        'default_price_condition',
        'app_theme',
        'rate_limit_rebrickable',
        'rate_limit_bricklink',
        'rate_limit_brickset',
        'registration_enabled',
        'price_job_interval_minutes',
      ],
    ])
    .catch(() => []);
  const mailBack = await enterMailServer(db);
  t.after(async () => {
    await mailBack();
    await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]).catch(() => {});
    for (const tab of ['set_catalog', 'set_parts_catalog', 'set_minifigs_catalog', 'brickset_queue'])
      await db.run(`DELETE FROM ${tab} WHERE set_number = ANY($1)`, [[SET, SET2]]).catch(() => {});
    await db.run('DELETE FROM part_catalog WHERE part_number = $1', [TEIL]).catch(() => {});
    await db.run('DELETE FROM part_color_catalog WHERE part_number = $1', [TEIL]).catch(() => {});
    await db.run('DELETE FROM minifigs_catalog WHERE fig_number = $1', [FIGUR]).catch(() => {});
    for (const { key, value } of globalBefore)
      await db.run('UPDATE global_settings SET value = $2 WHERE key = $1', [key, value]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  // The throttles for registering & co. count per IP across runs.
  await db.run(`DELETE FROM rate_limit_attempts WHERE key ~ '^(register|forgot-password|qr-login|qr-abholen)\\|'`);
  // The currency is already set: a change would trigger the price job including timer.
  // For all three: joining a household requires the same currency, and the
  // server default may have been changed by another test.
  for (const k of [uid, sub, neu])
    await db.run(
      `INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'EUR')
                  ON CONFLICT (user_id, key) DO UPDATE SET value = 'EUR'`,
      [k],
    );

  // ── Catalog so that creating works without network ─────────────────────
  for (const s of [SET, SET2])
    await catalogSet(db, s, { name: 'Schreibprobe', year: 2024, theme: 'Test', pieces: 10, minifigs: 1 });
  await db.run(
    `INSERT INTO part_catalog (part_number, part_name, category_name) VALUES ($1, 'Stein 2x2', 'Steine')
                ON CONFLICT DO NOTHING`,
    [TEIL],
  );
  for (const [f, n] of [
    [FARBE, 'Rot'],
    [FARBE2, 'Blau'],
  ])
    await db.run(
      `INSERT INTO part_color_catalog (part_number, color_id, color_name, color_hex) VALUES ($1, $2, $3, 'C91A09')
                  ON CONFLICT DO NOTHING`,
      [TEIL, f, n],
    );
  await db.run(`INSERT INTO minifigs_catalog (fig_number, fig_name) VALUES ($1, 'Probefigur') ON CONFLICT DO NOTHING`, [
    FIGUR,
  ]);
  await db
    .run(`INSERT INTO brickset_queue (set_number, attempts) VALUES ($1, 1) ON CONFLICT DO NOTHING`, [SET2])
    .catch(() => {});

  // ── Server as in server.ts; the session can be switched ─────────────────
  let als = { id: uid, name: NAME, admin: true };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = {
      userId: als.id,
      username: als.name,
      isAdmin: als.admin,
      regenerate(cb) {
        cb();
      },
      save(cb) {
        cb?.();
      },
      destroy(cb) {
        cb?.();
      },
    };
    req.apiUser = { user_id: als.id, username: als.name, is_admin: als.admin ? 1 : 0 };
    next();
  });
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use('/api/v2', require('./helpers/sources').routerFrom(_req, 'routes/api/index.js'));
  for (const r of routerEinhaengungen())
    app.use(r.mount, require('./helpers/sources').routerFrom(_req, `routes/${r.name}.js`));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const basis = `http://127.0.0.1:${srv.address().port}`;

  const routen = appSchnittstelle().routen.filter(r => r.methode !== 'GET');

  /** Values for the placeholders in the path; steps add new ones. */
  const w = { setNumber: SET, partNumber: TEIL, colorId: String(FARBE), figNumber: FIGUR };
  const erst = async (sql, values) => await db.get(sql, values);

  /** @type {{ m: string, p: string, body?: any, form?: () => Promise<FormData>|FormData, q?: string, kopf?: () => object, als?: object, davor?: () => Promise<void>, danach?: (j: any) => Promise<void>|void }[]} */
  /** @type {any[]} */
  const STEPS = [
    // ── Login and account ─────────────────────────────────────────────────
    {
      m: 'POST',
      p: '/api/v2/auth/login',
      body: { username: NAME, password: PASS, label: 'Vertrag', never_expires: true },
      danach: j => {
        w.appToken = j.token;
      },
    },
    // The exchange takes the token from the header, not the test's session.
    { m: 'POST', p: '/api/v2/auth/rotate-token', kopf: () => ({ Authorization: 'Bearer ' + w.appToken }) },
    {
      m: 'POST',
      p: '/api/v2/auth/qr-login',
      davor: async () => {
        const nonce = 'vertrag' + process.pid + Date.now();
        await db.run(
          `INSERT INTO qr_login_tokens (token, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '5 minutes')`,
          [_req('src/account/deviceToken.js').tokenDigest(nonce), uid],
        );
        w.qr = 'bim:' + nonce;
      },
      body: () => ({ token: w.qr, label: 'Vertrag' }),
      danach: j => {
        w.pickup = j.pickup;
      },
    },
    // Confirmation happens in the browser (qr-kopplung/:id/bestaetigen); here the response to the app counts.
    {
      m: 'POST',
      p: '/api/v2/auth/qr-login/collect',
      davor: async () => {
        await db.run('UPDATE qr_login_tokens SET confirmed_at = NOW() WHERE token = $1', [
          _req('src/account/deviceToken.js').tokenDigest(w.qr.slice(4)),
        ]);
      },
      body: () => ({ pickup: w.pickup }),
    },
    {
      m: 'POST',
      p: '/api/v2/auth/register',
      davor: async () => {
        await db.run(
          `INSERT INTO global_settings (key, value) VALUES ('registration_enabled', '1') ON CONFLICT (key) DO UPDATE SET value = '1'`,
        );
      },
      body: { username: `${NAME}_reg`, email: `${NAME}_reg@example.org`, password: PASS, language: 'de' },
    },
    { m: 'POST', p: '/api/v2/auth/forgot-password', body: { email: `${NAME}@example.org` } },
    {
      m: 'PUT',
      p: '/api/v2/auth/profile',
      body: {
        username: NAME,
        email: `${NAME}@example.org`,
        first_name: 'Vera',
        last_name: 'Trag',
        password_current: PASS,
      },
    },
    {
      m: 'POST',
      p: '/api/v2/auth/second-factor/setup',
      body: { password: PASS },
      danach: j => {
        w.secret = j.secret;
      },
    },
    {
      m: 'POST',
      p: '/api/v2/auth/second-factor/confirm',
      body: () => {
        const zf = _req('src/factors/secondFactor.js');
        return { code: zf.hotp(zf.fromBase32(w.secret), zf.timeStep()) };
      },
      danach: j => {
        w.codes = j.codes;
      },
    },
    {
      m: 'POST',
      p: '/api/v2/auth/second-factor/codes',
      body: () => ({ code: w.codes[0] }),
      danach: j => {
        w.codes = j.codes;
      },
    },
    { m: 'POST', p: '/api/v2/auth/second-factor/disable', body: () => ({ password: PASS, code: w.codes[0] }) },

    // ── Settings ──────────────────────────────────────────────────────────
    { m: 'PUT', p: '/api/v2/settings', body: { currency: 'EUR', price_condition: 'N' } },
    { m: 'POST', p: '/api/v2/settings/user/default-condition', body: { condition: 'N' } },
    { m: 'POST', p: '/api/v2/settings/admin/theme', body: { theme: 'classic' } },
    // Own design (account screen of the app), then back to the default.
    {
      m: 'POST',
      p: '/api/v2/settings/user/theme',
      body: { theme: 'noppe' },
      danach: j => {
        assert.deepEqual([j.theme, j.preset, j.own], ['noppe', 'classic', 'noppe']);
      },
    },
    {
      m: 'POST',
      p: '/api/v2/settings/user/theme',
      body: { theme: '' },
      danach: j => {
        assert.deepEqual([j.theme, j.own], ['classic', null]);
      },
    },
    {
      m: 'DELETE',
      p: '/api/v2/settings/tokens/{tokenId}',
      davor: async () => {
        await _req('src/account/deviceToken.js').createToken(uid, 'Zum Entwerten');
        w.tokenId = (
          await erst(
            `SELECT substring(token, 1, 16) AS t FROM api_tokens WHERE user_id = $1 AND label = 'Zum Entwerten'`,
            [uid],
          )
        ).t;
      },
      body: { password: PASS },
    },
    {
      m: 'POST',
      p: '/api/v2/settings/sessions/end-others',
      body: { password: PASS, accesses: true },
      davor: async () => {
        await _req('src/account/deviceToken.js').createToken(uid, 'Anderes Gerät');
      },
      danach: j => {
        assert.equal(j.accesses, 1);
      },
    },

    // ── Storage locations ─────────────────────────────────────────────────
    {
      m: 'POST',
      p: '/api/v2/storage/locations',
      body: { name: 'Regal Probe' },
      danach: j => {
        w.id = String(j.location.id);
      },
    },
    { m: 'PUT', p: '/api/v2/storage/locations/{id}', body: { name: 'Regal Probe 2' } },
    { m: 'PUT', p: '/api/v2/storage/default', body: () => ({ id: Number(w.id) }) },

    // ── Sets ──────────────────────────────────────────────────────────────
    { m: 'POST', p: '/api/v2/sets', body: { set_number: SET, quantity: 1, purchase_price: 49.9, condition: 'N' } },
    {
      m: 'PUT',
      p: '/api/v2/sets/{setNumber}',
      body: { quantity: 2, purchase_price: 40, condition: 'N' },
      danach: async () => {
        w.acqId = String(
          (
            await erst(`SELECT id FROM set_acquisitions WHERE user_id = $1 AND set_number = $2 ORDER BY id LIMIT 1`, [
              uid,
              SET,
            ])
          ).id,
        );
      },
    },
    { m: 'PUT', p: '/api/v2/sets/{setNumber}/acquisitions/{acqId}', body: { purchase_price: 45 } },
    { m: 'DELETE', p: '/api/v2/sets/{setNumber}/acquisitions/{acqId}' },
    // The only entry is gone and with it the set — create it anew.
    { m: 'POST', p: '/api/v2/sets', body: { set_number: SET, quantity: 1, condition: 'N' } },
    { m: 'PUT', p: '/api/v2/sets/{setNumber}/alert', body: { direction: 'unter', threshold: 30, condition: 'N' } },
    { m: 'DELETE', p: '/api/v2/sets/{setNumber}/alert', q: 'condition=N' },
    { m: 'PUT', p: '/api/v2/sets/{setNumber}/storage', body: { storage: 'Regal Probe 2' } },
    {
      m: 'POST',
      p: '/api/v2/sets/{setNumber}/instructions/upload',
      form: async () =>
        formular(await pdfWith(['Bauanleitung']), 'application/pdf', 'anleitung.pdf', { description: 'Probe' }),
      danach: async () => {
        w.instrId = String(
          (
            await erst(`SELECT id FROM instructions WHERE set_number = $1 AND user_id = $2 ORDER BY id DESC LIMIT 1`, [
              SET,
              uid,
            ])
          ).id,
        );
      },
    },
    { m: 'DELETE', p: '/api/v2/sets/{setNumber}/instructions/{instrId}' },
    { m: 'DELETE', p: '/api/v2/sets/{setNumber}' },

    // ── Parts ─────────────────────────────────────────────────────────────
    {
      m: 'POST',
      p: '/api/v2/parts',
      body: { part_number: TEIL, color_id: FARBE, color_name: 'Rot', quantity: 3, unit_price: 0.2, condition: 'N' },
    },
    {
      m: 'PUT',
      p: '/api/v2/parts/{partNumber}/{colorId}',
      body: { quantity: 4, unit_price: 0.25, condition: 'N' },
      danach: async () => {
        w.partPrice = (
          await erst(
            `SELECT unit_price::float AS p FROM part_acquisitions WHERE user_id = $1 AND part_number = $2
                                    ORDER BY created_at DESC, id DESC LIMIT 1`,
            [uid, TEIL],
          )
        ).p;
        w.id = String(
          (
            await erst(`SELECT id FROM part_acquisitions WHERE user_id = $1 AND part_number = $2 ORDER BY id LIMIT 1`, [
              uid,
              TEIL,
            ])
          ).id,
        );
      },
    },
    { m: 'PUT', p: '/api/v2/parts/{partNumber}/{colorId}/acquisitions/{id}', body: { unit_price: 0.3 } },
    { m: 'DELETE', p: '/api/v2/parts/{partNumber}/{colorId}/acquisitions/{id}' },
    {
      m: 'POST',
      p: '/api/v2/parts',
      body: { part_number: TEIL, color_id: FARBE, color_name: 'Rot', quantity: 2, condition: 'N' },
    },
    { m: 'PUT', p: '/api/v2/parts/{partNumber}/{colorId}/storage', body: { storage: 'Kiste' } },
    { m: 'POST', p: '/api/v2/parts/owned', body: { parts: [{ part_number: TEIL, color_id: FARBE }] } },
    {
      m: 'PUT',
      p: '/api/v2/parts/{partNumber}/{colorId}/color',
      body: { color_id: FARBE2, color_name: 'Blau', color_hex: '0055BF' },
      danach: () => {
        w.colorId = String(FARBE2);
      },
    },
    { m: 'DELETE', p: '/api/v2/parts/{partNumber}/{colorId}' },

    // ── Minifiguren ───────────────────────────────────────────────────────
    { m: 'POST', p: '/api/v2/minifigs', body: { fig_number: FIGUR, quantity: 1, unit_price: 4, condition: 'N' } },
    {
      m: 'PUT',
      p: '/api/v2/minifigs/{figNumber}',
      body: { quantity: 2, unit_price: 4.5, condition: 'N' },
      danach: async () => {
        w.id = String(
          (
            await erst(
              `SELECT id FROM minifig_acquisitions WHERE user_id = $1 AND fig_number = $2 ORDER BY id LIMIT 1`,
              [uid, FIGUR],
            )
          ).id,
        );
      },
    },
    { m: 'PUT', p: '/api/v2/minifigs/{figNumber}/acquisitions/{id}', body: { unit_price: 5 } },
    { m: 'DELETE', p: '/api/v2/minifigs/{figNumber}/acquisitions/{id}' },
    { m: 'POST', p: '/api/v2/minifigs', body: { fig_number: FIGUR, quantity: 1, condition: 'N' } },
    { m: 'PUT', p: '/api/v2/minifigs/{figNumber}/storage', body: { storage: 'Kiste' } },
    { m: 'DELETE', p: '/api/v2/minifigs/{figNumber}' },

    // ── Wishlist ──────────────────────────────────────────────────────────
    { m: 'POST', p: '/api/v2/wanted', body: { set_number: SET2, condition: 'N' } },
    {
      m: 'POST',
      p: '/api/v2/wanted/{setNumber}/{condition}/take-over',
      davor: async () => {
        w.setNumber = SET2;
        w.condition = 'N';
      },
      body: { quantity: 1, purchase_price: 30 },
    },
    // The takeover entered SET2 — the purchase price moves into the sub-account.
    {
      m: 'POST',
      p: '/api/v2/sets/{setNumber}/move',
      body: async () => ({
        to_user_id: sub,
        acquisition_ids: (
          await db.all('SELECT id FROM set_acquisitions WHERE user_id = $1 AND set_number = $2', [uid, SET2])
        ).map(r => r.id),
      }),
    },
    {
      m: 'POST',
      p: '/api/v2/wanted',
      body: { set_number: SET2, condition: 'U' },
      danach: () => {
        w.condition = 'U';
      },
    },
    {
      m: 'PUT',
      p: '/api/v2/wanted/{setNumber}/{condition}/owner',
      body: () => ({ owner_user_id: uid, new_owner: sub }),
    },
    { m: 'DELETE', p: '/api/v2/wanted/{setNumber}/{condition}', q: () => `owner_user_id=${sub}` },

    // ── Remove the storage location (after the sets/parts that used it) ───
    {
      m: 'DELETE',
      p: '/api/v2/storage/locations/{id}',
      davor: async () => {
        await db.run(`UPDATE sets SET storage_id = NULL WHERE user_id = ANY($1)`, [[uid, sub]]);
        w.id = String(
          (await erst(`SELECT id FROM storage_locations WHERE user_id = $1 ORDER BY id LIMIT 1`, [uid])).id,
        );
      },
    },

    // ── Vouchers ──────────────────────────────────────────────────────────
    {
      m: 'POST',
      p: '/api/v2/vouchers',
      body: { number: '5045076374450011111', pin: '1234', amount: 50, currency: 'CHF' },
      danach: j => {
        w.id = String(j.voucher.id);
      },
    },
    {
      m: 'PUT',
      p: '/api/v2/vouchers/{id}',
      body: { number: '5045076374450011111', pin: '4321', amount: 40, currency: 'CHF' },
    },
    { m: 'DELETE', p: '/api/v2/vouchers/{id}', body: { password: PASS } },
    {
      m: 'POST',
      p: '/api/v2/vouchers/pdf',
      form: async () =>
        formular(
          await pdfWith(['Ihre LEGO-Geschenkkarte im Wert von 25 CHF:', '5045076374450012222', 'PIN: 4711']),
          'application/pdf',
          'gutschein.pdf',
        ),
    },

    // ── Household: invite, join as third account, unlink ──────────────────
    {
      m: 'POST',
      p: '/api/v2/settings/household/invite',
      danach: j => {
        w.code = j.code;
      },
    },
    {
      m: 'POST',
      p: '/api/v2/settings/household/redeem',
      als: { id: neu, name: `${NAME}_neu`, admin: false },
      body: () => ({ code: w.code, password: PASS }),
    },
    { m: 'POST', p: '/api/v2/settings/household/unlink', body: () => ({ sub_user_id: neu }) },
    {
      m: 'POST',
      p: '/api/v2/settings/household/former/dismiss',
      davor: async () => {
        await erst(
          `INSERT INTO household_former_links (main_user_id, sub_user_id) VALUES ($1, $2)
                    ON CONFLICT DO NOTHING`,
          [uid, neu],
        );
      },
      body: () => ({ sub_user_id: neu }),
    },

    // ── CSV imports: only the header so that no job goes to the network ───
    {
      m: 'POST',
      p: '/api/v2/sets/import/csv',
      form: () => formular(`set_number,quantity\n${SET},1\n`, 'text/csv', 'sets.csv'),
    },
    { m: 'POST', p: '/api/v2/sets/import/csv/cancel' },
    {
      m: 'POST',
      p: '/api/v2/parts/import/csv',
      form: () => formular('part_number,color_id,quantity\n', 'text/csv', 'teile.csv'),
    },
    {
      m: 'POST',
      p: '/api/v2/minifigs/import/csv',
      form: () => formular('fig_number,quantity\n', 'text/csv', 'figuren.csv'),
    },
    {
      m: 'POST',
      p: '/api/v2/wanted/import/csv',
      form: () => formular('set_number,condition\n', 'text/csv', 'merkliste.csv'),
    },
    {
      m: 'POST',
      p: '/api/v2/alerts/import/csv',
      form: () => formular('set_number,condition,richtung,schwelle\n', 'text/csv', 'alarme.csv'),
    },

    // ── Administration ────────────────────────────────────────────────────
    {
      m: 'POST',
      p: '/api/v2/admin/job-schedule',
      davor: async () => {
        w.minutes =
          Number(
            (await erst(`SELECT value FROM global_settings WHERE key = 'price_job_interval_minutes'`, []))?.value,
          ) || 60;
      },
      body: () => ({ name: 'priceJob', minutes: w.minutes }),
    },
    { m: 'POST', p: '/api/v2/admin/cache-ttl', body: { ttl: '24' } },
    { m: 'POST', p: '/api/v2/admin/cache-clear', body: {} },
    { m: 'POST', p: '/api/v2/admin/default-condition', body: { condition: 'N' } },
    {
      m: 'PUT',
      p: '/api/v2/admin/api-limits',
      davor: async () => {
        const g = await db.all(`SELECT key, value FROM global_settings WHERE key LIKE 'rate_limit_%'`).catch(() => []);
        w.limits = Object.fromEntries(g.map(r => [r.key.replace('rate_limit_', ''), Number(r.value) || 1000]));
      },
      body: () => ({
        rebrickable: w.limits.rebrickable ?? 1000,
        bricklink: w.limits.bricklink ?? 1000,
        brickset: w.limits.brickset ?? 1000,
      }),
    },
    {
      m: 'POST',
      p: '/api/v2/admin/brickset-queue/{setNumber}/retry',
      davor: async () => {
        w.setNumber = SET2;
      },
    },
    { m: 'DELETE', p: '/api/v2/admin/brickset-queue/{setNumber}' },

    // ── Background jobs (job table) ───────────────────────────────────────
    {
      m: 'POST',
      p: '/api/v2/admin/job-queue/{id}/cancel',
      davor: async () => {
        w.id = String(
          await {
            ..._req('src/jobQueue/service.js'),
            ...require('./helpers/sources').testArea('jobQueue').jobs,
          }.placeJobOne('instructions', { set_number: SET }, { schluessel: `vertrag:${process.pid}:${Date.now()}` }),
        );
      },
    },
    { m: 'POST', p: '/api/v2/admin/job-queue/{id}/retry' },
    {
      m: 'POST',
      p: '/api/v2/admin/job-queue/kind/{kind}/now',
      davor: async () => {
        w.kind = 'instructions';
      },
    },
    { m: 'DELETE', p: '/api/v2/admin/job-queue/kind/{kind}' },

    // ── Finally: change password (discards all tokens), log out ───────────
    { m: 'POST', p: '/api/v2/auth/change-password', body: { current: PASS, newPassword: PASS + 'x' } },
    { m: 'POST', p: '/api/v2/auth/logout' },
  ];

  const deviations = [],
    status = [],
    gelaufen = new Set();
  const duration = [];
  for (const s of STEPS) {
    const schluessel = `${s.m} ${s.p}`;
    const start = Date.now();
    if (s.davor) await s.davor();
    if (s.als) als = s.als;
    const path = s.p.replace(/\{(\w+)\}/g, (_, n) => encodeURIComponent(w[n] ?? `<${n}>`));
    const q = typeof s.q === 'function' ? s.q() : s.q;
    const body = typeof s.body === 'function' ? await s.body() : s.body;
    // A time limit per step: a hanging step thus becomes a red test, not a hanging one.
    const init = { method: s.m, signal: AbortSignal.timeout(15_000) };
    if (s.form) init.body = await s.form();
    else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { 'Content-Type': 'application/json' };
    }
    if (s.kopf) init.headers = { ...(init.headers || {}), ...s.kopf() };
    let response;
    try {
      response = await fetch(basis + path + (q ? '?' + q : ''), init);
    } catch (e) {
      status.push(`${schluessel}: ${e.name}`);
      als = { id: uid, name: NAME, admin: true };
      continue;
    }
    als = { id: uid, name: NAME, admin: true };
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      status.push(`${schluessel}: ${response.status} kein JSON`);
      continue;
    }
    if (response.status !== 200) {
      status.push(`${schluessel}: ${response.status} ${text.slice(0, 160)}`);
      continue;
    }
    gelaufen.add(schluessel);
    const vertrag = contractTo(_req, s.m, s.p);
    if (!vertrag?.response) deviations.push(`${schluessel}: kein Vertrag`);
    else {
      const r = vertrag.response.safeParse(json);
      if (!r.success) deviations.push(...r.error.issues.map(i => `${schluessel} $.${i.path.join('.')}: ${i.message}`));
    }
    if (s.danach) await s.danach(json);
    duration.push([Date.now() - start, schluessel]);
  }
  if (process.env.VERTRAG_DAUER) console.error(duration.sort((a, b) => b[0] - a[0]).slice(0, 5));

  await t.test('every step answers with 200', () => assert.deepEqual(status, []));
  await t.test('matches the contract', () => assert.deepEqual(deviations, []));
  await t.test('every writing route is checked or omitted with a reason', () => {
    const open = routen.map(r => `${r.methode} ${r.path}`).filter(k => !gelaufen.has(k) && !OMITTED.has(k));
    assert.deepEqual(open, []);
  });
  await t.test('a unit price with decimal places is kept when changing', () => assert.equal(w.partPrice, 0.25));
  await t.test('no dead exception', () => {
    const bekannt = new Set(routen.map(r => `${r.methode} ${r.path}`));
    assert.deepEqual(
      [...OMITTED.keys()].filter(k => !bekannt.has(k)),
      [],
    );
  });
  t.diagnostic(`geprüft: ${gelaufen.size} von ${routen.length}`);
});
