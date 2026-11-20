'use strict';
/**
 * Verwalterrechte verlangen einen eingerichteten Code-Generator (403
 * zweiter_faktor_pflicht, src/konto/http/anmeldung.ts). Tests, die als
 * Verwalter arbeiten, richten ihn hier auf dem echten Weg ein.
 *
 * @param {(pfad: string) => any} _req  buildAndRequire() der Testdatei
 * @param {number} uid
 * @returns {Promise<string[]>} die zehn Wiederherstellungscodes, je einer für eine Anmeldung
 */
async function adminWithFactor(_req, uid) {
  const zf = _req('src/factors/secondFactor.js');
  // Wie im Betrieb im Konto selbst: Der Zeilenschutz verbirgt die Zeilen sonst.
  return _req('src/infra/kontoKontext.js').asRequest({ apiUser: { user_id: uid } }, async () => {
    const geheimnis = await zf.beginSetup(uid);
    if (!geheimnis) throw new Error(`Konto ${uid} hat schon einen zweiten Faktor`);
    return zf.confirmSetup(uid, zf.hotp(zf.fromBase32(geheimnis), zf.timeStep()));
  });
}

module.exports = { adminWithFactor };
