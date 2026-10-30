/**
 * Ein Proxy im Docker-Netz, dem TRUST_PROXY nicht glaubt, wird gemeldet — einmal.
 * Ohne die Angabe gelten alle Clients als dieselbe Adresse, und fünf
 * Fehlversuche eines Fremden sperren den Inhaber aus.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  istDockerGateway() gibt immer false → rot: „Proxy über das Gateway …“
 *   B  `gewarnt = true` nach der Warnung entfernt → rot: „… nur einmal“
 * Gegenprobe (am 29.10.2026 gemessen):
 *   C  Hinweis wieder nur ohne TRUST_PROXY (die Prüfung gegen die Einstellung
 *      entfernt) → rot: „Proxy über das Gateway ohne passendes TRUST_PROXY …“
 *      (mit TRUST_PROXY=docker blieb der Hinweis aus)
 * Gegenprobe (am 30.10.2026 gemessen):
 *   D  der Gateway-Hinweis nennt wieder `TRUST_PROXY=${ip}` → rot: „rät, den
 *      Clients hinter dem Gateway zu glauben“
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

test('Proxy über das Gateway wird gemeldet, nur einmal — ohne Rat, dem Gateway zu glauben', () => {
  for (const trust of [undefined, '172.28.73.10']) {
    const m = lauf(trust, [anfrage('::ffff:172.18.0.1', '198.51.100.4'), anfrage('172.18.0.1', '198.51.100.5')]);
    assert.equal(m.length, 1, `TRUST_PROXY=${trust}`);
    assert.match(m[0], /Docker-Gateway 172\.18\.0\.1/);
    assert.doesNotMatch(m[0], /TRUST_PROXY=172\.18\.0\.1/, 'rät, den Clients hinter dem Gateway zu glauben');
  }
});

test('Proxy im Docker-Netz ohne passendes TRUST_PROXY: Hinweis auf genau seine Adresse', () => {
  const m = lauf(undefined, [anfrage('172.28.73.10', '198.51.100.4')]);
  assert.equal(m.length, 1);
  assert.match(m[0], /TRUST_PROXY=172\.28\.73\.10/);
  assert.doesNotMatch(m[0], /TRUST_PROXY=docker/);
});

test('kein Hinweis ohne Proxy-Kopf, von anderen Adressen oder mit passendem TRUST_PROXY', () => {
  assert.deepEqual(lauf(undefined, [anfrage('172.18.0.1')]), []);
  assert.deepEqual(lauf(undefined, [anfrage('127.0.0.1', '198.51.100.4'), anfrage('192.168.1.20', '1.2.3.4')]), []);
  assert.deepEqual(lauf('172.28.73.10', [anfrage('172.28.73.10', '198.51.100.4')]), []);
  assert.deepEqual(lauf('false', [anfrage('172.18.0.1', '198.51.100.4')]), [], 'ausdrücklich ohne Proxy');
});

test('Gateway-Erkennung', () => {
  for (const a of ['172.17.0.1', '::ffff:172.31.0.1', 'fd00:dead:beef::1']) assert.equal(istDockerGateway(a), true, a);
  for (const a of ['172.17.0.2', '10.0.0.1', '192.168.0.1', '127.0.0.1', '::1']) assert.equal(istDockerGateway(a), false, a);
});
