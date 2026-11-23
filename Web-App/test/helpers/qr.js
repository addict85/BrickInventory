/**
 * The whole QR path as app and browser walk it: the app reports with the
 * code, the browser confirms with the code the app shows, the app collects
 * its token. Returns the first response that is not 200, otherwise the collection.
 *
 * @typedef {{ status: number, body: any } & Record<string, any>} Reply
 * @param {(path: string, body: object, head: Record<string, string>) => Promise<Reply>} post
 *        POST under /api/v2/auth
 * @param {{ token: string, pairing: number }} qr  the response of /qr-token
 * @param {Record<string, string>} [session]  headers of the browser session (say the cookie)
 * @returns {Promise<Reply>}
 */
async function pairQr(post, qr, session = {}) {
  const message = await post('/qr-login', { token: qr.token }, {});
  if (message.status !== 200) return message;
  const yes = await post(`/qr-pairing/${qr.pairing}/confirm`, { code: message.body.code }, session);
  if (yes.status !== 200) return yes;
  return post('/qr-login/collect', { pickup: message.body.pickup }, {});
}

module.exports = { pairQr };
