/**
 * Ein Proxy über das Docker-Gateway ohne TRUST_PROXY wird gemeldet — einmal.
 * Ohne die Angabe gelten alle Clients als dieselbe Adresse, und fünf
 * Fehlversuche eines Fremden sperren den Inhaber aus.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  istDockerGateway() gibt immer false → rot: „Proxy über das Gateway …“
 *   B  `gewarnt = true` nach der Warnung entfernt → rot: „… nur einmal“
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const _req = require('./helpers/sources').buildAndRequire();
const { proxyHinweis, istDockerGateway } = _req('utils/proxyVertrauen.js');

const anfrage = (von, xff) => ({ socket: { remoteAddress: von }, headers: xff ? { 'x-forwarded-for': xff } : {} });
function lauf(trust, anfragen) {
  const meldungen = [];
  const mw = proxyHinweis(trust, t => meldungen.push(t));
  let weiter = 0;
  for (const a of anfragen) mw(a, {}, () => { weiter++; });
  assert.equal(weiter, anfragen.length, 'jede Anfrage geht weiter');
  return meldungen;
}

test('Proxy über das Gateway ohne TRUST_PROXY wird gemeldet, nur einmal', () => {
  const m = lauf(undefined, [anfrage('::ffff:172.18.0.1', '198.51.100.4'), anfrage('172.18.0.1', '198.51.100.5')]);
  assert.equal(m.length, 1);
  assert.match(m[0], /TRUST_PROXY=172\.18\.0\.1/);
});

test('kein Hinweis ohne Proxy-Kopf, von anderen Adressen oder mit TRUST_PROXY', () => {
  assert.deepEqual(lauf(undefined, [anfrage('172.18.0.1')]), []);
  assert.deepEqual(lauf(undefined, [anfrage('172.18.0.5', '198.51.100.4'), anfrage('192.168.1.20', '1.2.3.4')]), []);
  assert.deepEqual(lauf('172.18.0.1', [anfrage('172.18.0.1', '198.51.100.4')]), []);
});

test('Gateway-Erkennung', () => {
  for (const a of ['172.17.0.1', '::ffff:172.31.0.1', 'fd00:dead:beef::1']) assert.equal(istDockerGateway(a), true, a);
  for (const a of ['172.17.0.2', '10.0.0.1', '192.168.0.1', '127.0.0.1', '::1']) assert.equal(istDockerGateway(a), false, a);
});
