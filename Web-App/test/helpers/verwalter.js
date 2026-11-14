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
async function verwalterMitFaktor(_req, uid) {
  const zf = _req('src/konto/zweiterFaktor.js');
  // Wie im Betrieb im Konto selbst: Der Zeilenschutz verbirgt die Zeilen sonst.
  return _req('src/infra/kontoKontext.js').alsAnfrage({ apiUser: { user_id: uid } }, async () => {
    const geheimnis = await zf.beginneEinrichtung(uid);
    if (!geheimnis) throw new Error(`Konto ${uid} hat schon einen zweiten Faktor`);
    return zf.bestaetigeEinrichtung(uid, zf.hotp(zf.ausBase32(geheimnis), zf.zeitschritt()));
  });
}

module.exports = { verwalterMitFaktor };
