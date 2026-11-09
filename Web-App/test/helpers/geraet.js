/**
 * Der Schrittschutz der App von der Testseite: ein EC-P-256-Schlüssel wie der
 * des Keystores, hinterlegt für einen App-Token, und die Freigabe einer Aktion
 * auf dem echten Weg (Challenge holen, signieren, einlösen).
 */
const { generateKeyPairSync, sign } = require('node:crypto');

function geraeteSchluessel() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { privateKey, oeffentlich: publicKey.export({ format: 'der', type: 'spki' }).toString('base64') };
}

/** So signiert die App: SHA256withECDSA, DER, Base64. */
const signiere = (privateKey, text) =>
  sign('sha256', Buffer.from(text, 'utf8'), { key: privateKey, dsaEncoding: 'der' }).toString('base64');

/**
 * @param {(weg: string, opt: object) => Promise<{status: number, body: any}>} ruf  ruft /api/v1 + weg
 * @param {string} token
 * @param {string} aktion
 * @param {ReturnType<typeof geraeteSchluessel>} [schluessel]  fehlt er, wird einer erzeugt und hinterlegt
 */
async function geraetFreigeben(ruf, token, aktion, schluessel) {
  const s = schluessel ?? geraeteSchluessel();
  if (!schluessel) {
    const r = await ruf('/geraet/schluessel', { method: 'POST', token, body: { oeffentlich: s.oeffentlich } });
    if (r.status !== 200) throw new Error(`Schlüssel nicht hinterlegt: ${r.status} ${JSON.stringify(r.body)}`);
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

module.exports = { geraeteSchluessel, signiere, geraetFreigeben };
