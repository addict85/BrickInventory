/**
 * Ein Proxy im Docker-Netz, dem TRUST_PROXY nicht glaubt, wird gemeldet — einmal.
 * Ohne die Angabe gelten alle Clients als dieselbe Adresse, und fünf
 * Fehlversuche eines Fremden sperren den Inhaber aus.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  isDockerGateway() gibt immer false → rot: „Proxy über das Gateway …“
 *   B  `warned = true` nach der Warnung entfernt → rot: „… nur einmal“
 * Gegenprobe (am 29.10.2026 gemessen):
 *   C  Hinweis wieder nur ohne TRUST_PROXY (die Prüfung gegen die Einstellung
 *      entfernt) → rot: „Proxy über das Gateway ohne passendes TRUST_PROXY …“
 *      (mit TRUST_PROXY=docker blieb der Hinweis aus)
 * Gegenprobe (am 30.10.2026 gemessen):
 *   D  der Gateway-Hinweis nennt wieder `TRUST_PROXY=${ip}` → rot: „rät, den
 *      Clients hinter dem Gateway zu glauben“
 * Ein Proxy vor dem vertrauten Proxy (13.11.2026 gemessen, je einzeln):
 *   E  in onlyClientAddress() den Abbruch bei einer zweiten Adresse
 *      gestrichen → rot: „zwei Client-Adressen: kein Hinweis“
 *   F  die Zeitbedingung (`uhr() - seit < EINE_ADDRESS.ms`) gestrichen → rot:
 *      „nach zehn Minuten noch kein Hinweis“
 *   G  den Aufruf von eineAddress() in proxyHinweis() gestrichen → rot:
 *      „eine einzige Client-Adresse über eine Stunde wird gemeldet“
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const _req = require('./helpers/sources').buildAndRequire();
const { isDockerGateway } = _req('src/infra/proxyTrust.js');
const { proxyHinweis, EINE_ADDRESS } = _req('src/http/proxyHint.js');

const anfrage = (von, xff) => ({ socket: { remoteAddress: von }, headers: xff ? { 'x-forwarded-for': xff } : {} });
function lauf(trust, anfragen) {
  const meldungen = [];
  const mw = proxyHinweis(trust, t => meldungen.push(t));
  let weiter = 0;
  for (const a of anfragen)
    mw(a, {}, () => {
      weiter++;
    });
  assert.equal(weiter, anfragen.length, 'jede Anfrage geht weiter');
  return meldungen;
}

test('proxy via the gateway is reported, only once — without advice to trust the gateway', () => {
  for (const trust of [undefined, '172.28.73.10']) {
    const m = lauf(trust, [anfrage('::ffff:172.18.0.1', '198.51.100.4'), anfrage('172.18.0.1', '198.51.100.5')]);
    assert.equal(m.length, 1, `TRUST_PROXY=${trust}`);
    assert.match(m[0], /Docker-Gateway 172\.18\.0\.1/);
    assert.doesNotMatch(m[0], /TRUST_PROXY=172\.18\.0\.1/, 'rät, den Clients hinter dem Gateway zu glauben');
  }
});

test('proxy in the Docker network without matching TRUST_PROXY: hint at exactly its address', () => {
  const m = lauf(undefined, [anfrage('172.28.73.10', '198.51.100.4')]);
  assert.equal(m.length, 1);
  assert.match(m[0], /TRUST_PROXY=172\.28\.73\.10/);
  assert.doesNotMatch(m[0], /TRUST_PROXY=docker/);
});

test('no hint without a proxy header, from other addresses or with matching TRUST_PROXY', () => {
  assert.deepEqual(lauf(undefined, [anfrage('172.18.0.1')]), []);
  assert.deepEqual(lauf(undefined, [anfrage('127.0.0.1', '198.51.100.4'), anfrage('192.168.1.20', '1.2.3.4')]), []);
  assert.deepEqual(lauf('172.28.73.10', [anfrage('172.28.73.10', '198.51.100.4')]), []);
  assert.deepEqual(lauf('false', [anfrage('172.18.0.1', '198.51.100.4')]), [], 'ausdrücklich ohne Proxy');
});

test('gateway detection', () => {
  for (const a of ['172.17.0.1', '::ffff:172.31.0.1', 'fd00:dead:beef::1']) assert.equal(isDockerGateway(a), true, a);
  for (const a of ['172.17.0.2', '10.0.0.1', '192.168.0.1', '127.0.0.1', '::1'])
    assert.equal(isDockerGateway(a), false, a);
});

/** Anfragen über den vertrauten Proxy; `ip` ist, was Express aus X-Forwarded-For liest. */
function viaProxy(trust, ips, { minuten }) {
  const meldungen = [];
  let jetzt = 0;
  const mw = proxyHinweis(
    trust,
    t => meldungen.push(t),
    () => jetzt,
  );
  ips.forEach((ip, i) => {
    jetzt = Math.round((i / Math.max(ips.length - 1, 1)) * minuten * 60_000);
    mw({ ip, socket: { remoteAddress: '172.28.73.10' }, headers: { 'x-forwarded-for': ip } }, {}, () => {});
  });
  return meldungen;
}
const viele = (ip, n = EINE_ADDRESS.anfragen + 10) => Array(n).fill(ip);

test('a single client address over an hour is reported — once, with VORGELAGERTER_PROXY', () => {
  const m = viaProxy('172.28.73.10', viele('::ffff:172.28.73.20', 2 * EINE_ADDRESS.anfragen), { minuten: 61 });
  assert.equal(m.length, 1, 'eine einzige Client-Adresse über eine Stunde wird gemeldet');
  assert.match(m[0], /Client-Adresse 172\.28\.73\.20\b/);
  assert.match(m[0], /VORGELAGERTER_PROXY/);
});

test('two client addresses, too short or without TRUST_PROXY: no hint', () => {
  const gemischt = viele('192.168.1.20');
  gemischt[10] = '192.168.1.21';
  assert.deepEqual(viaProxy('172.28.73.10', gemischt, { minuten: 120 }), [], 'zwei Client-Adressen: kein Hinweis');
  assert.deepEqual(
    viaProxy('172.28.73.10', viele('192.168.1.20'), { minuten: 10 }),
    [],
    'nach zehn Minuten noch kein Hinweis',
  );
  assert.deepEqual(
    viaProxy('172.28.73.10', viele('192.168.1.20', EINE_ADDRESS.anfragen - 1), { minuten: 120 }),
    [],
    'zu wenige Anfragen',
  );
  // Ohne TRUST_PROXY meldet sich nur der Hinweis auf den nicht vertrauten Proxy (oben).
  assert.deepEqual(
    viaProxy(undefined, viele('192.168.1.20'), { minuten: 120 }).filter(t => /VORGELAGERTER_PROXY/.test(t)),
    [],
    'ohne TRUST_PROXY',
  );
  // Ohne ausgewertetes X-Forwarded-For ist req.ip der Proxy selbst.
  assert.deepEqual(viaProxy('172.28.73.10', viele('172.28.73.10'), { minuten: 120 }), [], 'ohne Auswertung');
});
