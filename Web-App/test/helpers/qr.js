/**
 * Der ganze QR-Weg wie App und Browser ihn gehen: Die App meldet sich mit dem
 * Code, der Browser bestätigt mit dem Code, den die App zeigt, die App holt
 * ihren Token ab. Liefert die erste Antwort, die nicht 200 ist, sonst die Abholung.
 *
 * @typedef {{ status: number, body: any } & Record<string, any>} Antwort
 * @param {(pfad: string, body: object, kopf: Record<string, string>) => Promise<Antwort>} post
 *        POST unter /api/v1/auth
 * @param {{ token: string, kopplung: number }} qr  die Antwort von /qr-token
 * @param {Record<string, string>} [sitzung]  Köpfe der Browser-Sitzung (etwa das Cookie)
 * @returns {Promise<Antwort>}
 */
async function qrKoppeln(post, qr, sitzung = {}) {
  const meldung = await post('/qr-login', { token: qr.token }, {});
  if (meldung.status !== 200) return meldung;
  const ja = await post(`/qr-kopplung/${qr.kopplung}/bestaetigen`, { code: meldung.body.code }, sitzung);
  if (ja.status !== 200) return ja;
  return post('/qr-login/abholen', { abholung: meldung.body.abholung }, {});
}

module.exports = { qrKoppeln };
