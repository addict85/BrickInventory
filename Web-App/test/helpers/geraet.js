/**
 * Der Schrittschutz der App von der Testseite: ein EC-P-256-Schlüssel wie der
 * des Keystores, mit Attestierungskette hinterlegt für einen App-Token (der
 * Server braucht dafür attestation.UMGEBUNG), und die Freigabe einer Aktion
 * auf dem echten Weg (Challenge holen, signieren, einlösen).
 */
const { generateKeyPairSync, sign } = require('node:crypto');
const attestation = require('./attestation');

function geraeteSchluessel() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { privateKey, oeffentlich: publicKey.export({ format: 'der', type: 'spki' }).toString('base64') };
}

/** So signiert die App: SHA256withECDSA, DER, Base64. */
const signiere = (privateKey, text) =>
  sign('sha256', Buffer.from(text, 'utf8'), { key: privateKey, dsaEncoding: 'der' }).toString('base64');

/**
 * Nonce holen, Kette mit ihr als Challenge bauen, hinterlegen. [o] geht an attestation.kette().
 * @param {(weg: string, opt: object) => Promise<{status: number, body: any}>} ruf  ruft /api/v1 + weg
 * @param {string} token
 */
async function hinterlege(ruf, token, o = {}) {
  const n = await ruf('/geraet/schluessel/nonce', { method: 'POST', token, body: {} });
  if (n.status !== 200) return { antwort: n, schluessel: null };
  const k = attestation.kette({ challenge: Buffer.from(n.body.nonce, 'base64url'), ...o });
  const antwort = await ruf('/geraet/schluessel', { method: 'POST', token, body: { kette: k.kette } });
  return { antwort, schluessel: { privateKey: k.privateKey, oeffentlich: k.oeffentlich }, nonce: n.body.nonce };
}

/**
 * @param {(weg: string, opt: object) => Promise<{status: number, body: any}>} ruf  ruft /api/v1 + weg
 * @param {string} token
 * @param {string} aktion
 * @param {{ privateKey: import('node:crypto').KeyObject }} [schluessel]  fehlt er, wird einer erzeugt und hinterlegt
 */
async function geraetFreigeben(ruf, token, aktion, schluessel) {
  let s = schluessel;
  if (!s) {
    const h = await hinterlege(ruf, token);
    const r = h.antwort;
    if (r.status !== 200 || !h.schluessel)
      throw new Error(`Schlüssel nicht hinterlegt: ${r.status} ${JSON.stringify(r.body)}`);
    s = h.schluessel;
  }
  const c = await ruf('/geraet/schritt/challenge', { method: 'POST', token, body: { aktion } });
  if (c.status !== 200) throw new Error(`keine Challenge: ${c.status} ${JSON.stringify(c.body)}`);
  const f = await ruf('/geraet/schritt/freigabe', {
    method: 'POST',
    token,
    body: { challenge: c.body.challenge, signatur: signiere(s.privateKey, c.body.nachricht) },
  });
  if (f.status !== 200) throw new Error(`keine Freigabe: ${f.status} ${JSON.stringify(f.body)}`);
  return s;
}

module.exports = { geraeteSchluessel, signiere, geraetFreigeben, hinterlege };
