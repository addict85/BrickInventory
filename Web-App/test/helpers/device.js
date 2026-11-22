/**
 * The app's step-up protection from the test side: an EC P-256 key like the
 * keystore's, stored with an attestation chain for an app token (the
 * server needs attestation.UMGEBUNG for that), and the approval of an action
 * the real way (fetch challenge, sign, redeem).
 */
const { generateKeyPairSync, sign } = require('node:crypto');
const attestation = require('./attestation');

function deviceKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { privateKey, public_key: publicKey.export({ format: 'der', type: 'spki' }).toString('base64') };
}

/** This is how the app signs: SHA256withECDSA, DER, Base64. */
const signiere = (privateKey, text) =>
  sign('sha256', Buffer.from(text, 'utf8'), { key: privateKey, dsaEncoding: 'der' }).toString('base64');

/**
 * Fetch nonce, build a chain with it as challenge, store it. [o] goes to attestation.kette().
 * @param {(weg: string, opt: object) => Promise<{status: number, body: any}>} ruf  calls /api/v1 + weg
 * @param {string} token
 */
async function deposit(ruf, token, o = {}) {
  const n = await ruf('/device/key/nonce', { method: 'POST', token, body: {} });
  if (n.status !== 200) return { response: n, schluessel: null };
  const k = attestation.chain({ challenge: Buffer.from(n.body.nonce, 'base64url'), ...o });
  const response = await ruf('/device/key', { method: 'POST', token, body: { chain: k.chain } });
  return { response, schluessel: { privateKey: k.privateKey, public_key: k.public_key }, nonce: n.body.nonce };
}

/**
 * @param {(weg: string, opt: object) => Promise<{status: number, body: any}>} ruf  calls /api/v1 + weg
 * @param {string} token
 * @param {string} action
 * @param {{ privateKey: import('node:crypto').KeyObject }} [schluessel]  if missing, one is created and stored
 */
async function releaseDevice(ruf, token, action, schluessel) {
  let s = schluessel;
  if (!s) {
    const h = await deposit(ruf, token);
    const r = h.response;
    if (r.status !== 200 || !h.schluessel)
      throw new Error(`Schlüssel nicht hinterlegt: ${r.status} ${JSON.stringify(r.body)}`);
    s = h.schluessel;
  }
  const c = await ruf('/device/step/challenge', { method: 'POST', token, body: { action } });
  if (c.status !== 200) throw new Error(`keine Challenge: ${c.status} ${JSON.stringify(c.body)}`);
  const f = await ruf('/device/step/approval', {
    method: 'POST',
    token,
    body: { challenge: c.body.challenge, signature: signiere(s.privateKey, c.body.message) },
  });
  if (f.status !== 200) throw new Error(`keine Freigabe: ${f.status} ${JSON.stringify(f.body)}`);
  return s;
}

module.exports = { deviceKeys, signiere, releaseDevice, deposit };
