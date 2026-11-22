/**
 * Key switch: secrets written under key A, then started with
 * DATA_KEY=B and DATA_KEY_ALT=A (keySwitch as at startup).
 * Afterwards B alone reads everything, A alone nothing anymore; the search value of the
 * voucher number matches B. Recovery codes from before the switch
 * apply as long as A is available as DATA_KEY_ALT.
 *
 * Counter-checks (measured 05.11.2026, each alone):
 *   A  in umschluesseln() the branch for v2 with the previous key
 *      removed → red: “B alone reads everything” (API key, factor, PIN)
 *   B  in reencryptAllVouchers() the search value not renewed → red: “the
 *      search value of the number …”
 *   C  rekeyBuffer() always returns undefined → red: “B alone reads
 *      everything” (voucher PDF)
 *   D  in pruefeCode() the fallback to searchValueAlt removed → red: “a
 *      recovery code from before the switch …”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const { environment } = require('./helpers/sources');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WURZEL = fs.mkdtempSync(path.join(os.tmpdir(), 'schluesselwechsel-'));
fs.writeFileSync(path.join(WURZEL, 'package.json'), '{}');
environment({ APP_ROOT: WURZEL });
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const A = crypto.randomBytes(32).toString('base64'),
  B = crypto.randomBytes(32).toString('base64');
environment({ DATA_KEY: A });

const _req = require('./helpers/sources').buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const G = _req('src/infra/secret.js');
const zf = _req('src/factors/secondFactor.js');
const gut = {
  ..._req('src/vouchers/repository/vouchers.js'),
  ...require('./helpers/sources').testArea('vouchers').vouchers,
};
const dateien = _req('src/vouchers/voucherFiles.js');
const { keySwitch } = _req('startup/database.js');

/** Switch keys, like a restart with a different environment. */
function schluessel(current, previous) {
  environment({ DATA_KEY: current });
  if (previous) environment({ DATA_KEY_ALT: previous });
  else environment({ DATA_KEY_ALT: undefined });
  G._forgetKey();
}

test('rotate the data key', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const NAME = `wechsel_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
    VALUES ($1, 'x', true, true) RETURNING id`,
      [NAME],
    )
  ).id;
  t.after(async () => {
    schluessel(A, null);
    await db.run(`DELETE FROM global_settings WHERE key = 'rebrickable_api_key'`).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
    fs.rmSync(WURZEL, { recursive: true, force: true });
  });

  // ── write under A ────────────────────────────────────────────────────────
  schluessel(A, null);
  const apiContext = G.context('global_settings.value', 'rebrickable_api_key');
  await db.run(
    `INSERT INTO global_settings (key, value) VALUES ('rebrickable_api_key', $1)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [G.encrypt('api-geheim-123', apiContext)],
  );
  const secret = await zf.beginSetup(uid);
  const codes = await zf.confirmSetup(uid, zf.hotp(zf.fromBase32(secret), zf.timeStep()));
  const g = await gut.createVoucher(uid, { number: '6299-1234-5678', pin: '4711', amount: 25, currency: 'CHF' });
  const pdf = path.join(dateien.VOUCHER_DIR, String(uid), `${g.id}.pdf`);
  await dateien.writeVoucherPdf(pdf, Buffer.from('%PDF-1.4 Gutschein'));

  /** What the current key can read. */
  const readEverything = async () => {
    const api = (await db.get(`SELECT value FROM global_settings WHERE key = 'rebrickable_api_key'`)).value;
    const faktor = (await db.get('SELECT secret FROM second_factor WHERE user_id = $1', [uid])).secret;
    const v = await db.get('SELECT number, pin, number_search FROM vouchers WHERE id = $1', [g.id]);
    const datei = G.decryptBuffer(fs.readFileSync(pdf), G.context('gutschein-pdf', `${uid}/${g.id}.pdf`));
    return {
      api: G.decrypt(api, apiContext),
      faktor: G.decrypt(faktor, zf.secondFactorContext(uid)),
      number: G.decrypt(v.number, gut.numberContext(uid, g.id)),
      pin: G.decrypt(v.pin, gut.pinContext(uid, g.id)),
      pdf: datei?.toString() ?? null,
      searchFits: v.number_search === gut.numberSearch(uid, '6299-1234-5678'),
    };
  };
  const KLAR = {
    api: 'api-geheim-123',
    faktor: secret,
    number: '6299-1234-5678',
    pin: '4711',
    pdf: '%PDF-1.4 Gutschein',
    searchFits: true,
  };
  assert.deepEqual(await readEverything(), KLAR, 'Precondition: A reads everything');

  // ── start with B and the previous A ──────────────────────────────────────
  schluessel(B, A);
  await t.test('a recovery code from before the rotation applies as long as A is available', async () => {
    assert.equal(await zf.checkCode(uid, codes[0]), 'wiederherstellung');
  });
  const warn = console.warn;
  console.warn = () => {};
  let geschrieben;
  try {
    geschrieben = await keySwitch(require('./helpers/sources').testServices());
  } finally {
    console.warn = warn;
  }

  await t.test('B alone reads everything, the search value of the number matches B', async () => {
    schluessel(B, null);
    assert.deepEqual(await readEverything(), KLAR);
    assert.ok(geschrieben >= 4, `only ${geschrieben} values rewritten`);
  });

  await t.test('A alone reads nothing any more', async () => {
    schluessel(A, null);
    const warn2 = console.warn;
    console.warn = () => {};
    try {
      assert.deepEqual(await readEverything(), {
        api: null,
        faktor: null,
        number: null,
        pin: null,
        pdf: null,
        searchFits: false,
      });
    } finally {
      console.warn = warn2;
    }
  });
});
