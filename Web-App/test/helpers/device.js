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
const signIt = (privateKey, text) =>
  sign('sha256', Buffer.from(text, 'utf8'), { key: privateKey, dsaEncoding: 'der' }).toString('base64');

/**
 * Fetch nonce, build a chain with it as challenge, store it. [o] goes to attestation.kette().
 * @param {(route: string, opt: object) => Promise<{status: number, body: any}>} callFn  calls /api/v1 + weg
 * @param {string} token
 */
async function deposit(callFn, token, o = {}) {
  const n = await callFn('/device/key/nonce', { method: 'POST', token, body: {} });
  if (n.status !== 200) return { response: n, key: null };
  const k = attestation.chain({ challenge: Buffer.from(n.body.nonce, 'base64url'), ...o });
  const response = await callFn('/device/key', { method: 'POST', token, body: { chain: k.chain } });
  return { response, key: { privateKey: k.privateKey, public_key: k.public_key }, nonce: n.body.nonce };
}

/**
 * @param {(route: string, opt: object) => Promise<{status: number, body: any}>} callFn  calls /api/v1 + weg
 * @param {string} token
 * @param {string} action
 * @param {{ privateKey: import('node:crypto').KeyObject }} [key]  if missing, one is created and stored
 */
async function releaseDevice(callFn, token, action, key) {
  let s = key;
  if (!s) {
    const h = await deposit(callFn, token);
    const r = h.response;
    if (r.status !== 200 || !h.key) throw new Error(`Key not stored: ${r.status} ${JSON.stringify(r.body)}`);
    s = h.key;
  }
  const c = await callFn('/device/step/challenge', { method: 'POST', token, body: { action } });
  if (c.status !== 200) throw new Error(`no challenge: ${c.status} ${JSON.stringify(c.body)}`);
  const f = await callFn('/device/step/approval', {
    method: 'POST',
    token,
    body: { challenge: c.body.challenge, signature: signIt(s.privateKey, c.body.message) },
  });
  if (f.status !== 200) throw new Error(`no approval: ${f.status} ${JSON.stringify(f.body)}`);
  return s;
}

module.exports = { deviceKeys, signIt, releaseDevice, deposit };
