'use strict';
/**
 * Administrator rights require a set-up code generator (403
 * zweiter_faktor_pflicht, src/account/http/login.ts). Tests that work as
 * administrators set it up here the real way.
 *
 * @param {(pfad: string) => any} _req  buildAndRequire() of the test file
 * @param {number} uid
 * @returns {Promise<string[]>} the ten recovery codes, one per login
 */
async function adminWithFactor(_req, uid) {
  const zf = _req('src/factors/secondFactor.js');
  // As in production in the account itself: row security would otherwise hide the rows.
  return _req('src/infra/accountContext.js').asRequest({ apiUser: { user_id: uid } }, async () => {
    const geheimnis = await zf.beginSetup(uid);
    if (!geheimnis) throw new Error(`Konto ${uid} hat schon einen zweiten Faktor`);
    return zf.confirmSetup(uid, zf.hotp(zf.fromBase32(geheimnis), zf.timeStep()));
  });
}

module.exports = { adminWithFactor };
