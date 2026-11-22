'use strict';
/**
 * Administrator rights require a set-up code generator (403
 * second_factor_mandatory, src/account/http/login.ts). Tests that work as
 * administrators set it up here the real way.
 *
 * @param {(path: string) => any} _req  buildAndRequire() of the test file
 * @param {number} uid
 * @returns {Promise<string[]>} the ten recovery codes, one per login
 */
async function adminWithFactor(_req, uid) {
  const zf = _req('src/factors/secondFactor.js');
  // As in production in the account itself: row security would otherwise hide the rows.
  return _req('src/infra/accountContext.js').asRequest({ apiUser: { user_id: uid } }, async () => {
    const secret = await zf.beginSetup(uid);
    if (!secret) throw new Error(`Account ${uid} already has a second factor`);
    return zf.confirmSetup(uid, zf.hotp(zf.fromBase32(secret), zf.timeStep()));
  });
}

/**
 * Password and second factor of another account only apply after the deadline
 * (src/account/adminActions.ts). Tests that need the effect now move the deadline
 * into the past and run the cleanup run, as the hourly job would.
 *
 * @param {(path: string) => any} _req
 * @param {{ run: (sql: string, values?: unknown[]) => Promise<unknown> }} db
 * @param {number} ziel
 * @returns {Promise<number>} how many announcements took effect
 */
async function takeoverNow(_req, db, ziel) {
  await db.run(`UPDATE admin_takeovers SET effective_at = NOW() - INTERVAL '1 minute' WHERE target_id = $1`, [ziel]);
  return _req('src/account/adminActions.js').runDueTakeoversFrom();
}

module.exports = { adminWithFactor, takeoverNow };
