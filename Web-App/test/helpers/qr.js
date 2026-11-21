/**
 * The whole QR path as app and browser walk it: the app reports with the
 * code, the browser confirms with the code the app shows, the app collects
 * its token. Returns the first response that is not 200, otherwise the collection.
 *
 * @typedef {{ status: number, body: any } & Record<string, any>} Antwort
 * @param {(pfad: string, body: object, kopf: Record<string, string>) => Promise<Antwort>} post
 *        POST under /api/v1/auth
 * @param {{ token: string, kopplung: number }} qr  the response of /qr-token
 * @param {Record<string, string>} [sitzung]  headers of the browser session (say the cookie)
 * @returns {Promise<Antwort>}
 */
async function pairQr(post, qr, sitzung = {}) {
  const meldung = await post('/qr-login', { token: qr.token }, {});
  if (meldung.status !== 200) return meldung;
  const ja = await post(`/qr-kopplung/${qr.kopplung}/bestaetigen`, { code: meldung.body.code }, sitzung);
  if (ja.status !== 200) return ja;
  return post('/qr-login/abholen', { abholung: meldung.body.abholung }, {});
}

module.exports = { pairQr };
