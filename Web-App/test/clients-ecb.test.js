/**
 * The ECB client (clients/ecb.ts) against a local HTTPS stub (helpers/https-stub.js) with
 * fixtures from test/fixtures/clients/: daily XML, history ZIP (deflate and stored), and the
 * error paths — 5xx, redirect, foreign address, timeout, broken XML and ZIP.
 *
 * Counter-checks (measured 22.11.2026, each alone):
 *   A  in ecbFetch() the status check removed → red: “a 5xx is an error, not a rate”
 *   B  `redirects: 0` removed → red: “a redirect is not followed”
 *   C  readHistory() without the `w !== 'EUR'` condition → red: “the history as ZIP …” (EUR row)
 *   D  firstZipFile() without the method-0 branch → red: “… stored ZIP”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');

const _req = require('./helpers/sources').buildAndRequire();
const { httpsStub, reply, fixture } = require('./helpers/https-stub');
const ecb = _req('clients/ecb.js');

test('the daily rates come as XML from the ECB host', async t => {
  const stub = await httpsStub(t, (_c, res) => reply(res, 200, fixture('ecb-daily.xml')));
  const kurse = ecb.readDailyRates((await ecb.ecbFetch(ecb.ECB_DAILY_RATES)).toString('utf8'));
  assert.deepEqual(kurse, [
    { tag: '2026-11-20', currency: 'USD', per_eur: 1.0832 },
    { tag: '2026-11-20', currency: 'CHF', per_eur: 0.9415 },
    { tag: '2026-11-20', currency: 'GBP', per_eur: 0.835 },
  ]);
  assert.deepEqual(
    stub.calls.map(c => [c.host, c.path]),
    [['www.ecb.europa.eu', '/stats/eurofxref/eurofxref-daily.xml']],
  );
});

test('the history as ZIP, packed and stored', async t => {
  const zip = { '/stats/eurofxref/eurofxref-hist.zip': 'ecb-hist.zip', '/stored.zip': 'ecb-hist-stored.zip' };
  await httpsStub(t, (c, res) => reply(res, 200, fixture(zip[c.path], true)));
  const erwartet = [
    { tag: '2026-11-20', currency: 'USD', per_eur: 1.0832 },
    { tag: '2026-11-20', currency: 'JPY', per_eur: 162.1 },
    { tag: '2026-11-20', currency: 'CHF', per_eur: 0.9415 },
    { tag: '2026-11-19', currency: 'USD', per_eur: 1.0811 },
    { tag: '2026-11-19', currency: 'CHF', per_eur: 0.9402 },
  ];
  for (const url of [ecb.ECB_HISTORY, 'https://www.ecb.europa.eu/stored.zip']) {
    const csv = ecb.firstZipFile(await ecb.ecbFetch(url)).toString('utf8');
    assert.deepEqual(ecb.readHistory(csv), erwartet, url);
  }
});

test('a 5xx is an error, not a rate', async t => {
  await httpsStub(t, (_c, res) => reply(res, 503, 'Service Unavailable'));
  await assert.rejects(ecb.ecbFetch(ecb.ECB_DAILY_RATES), /EZB 503/);
});

test('a redirect is not followed', async t => {
  const stub = await httpsStub(t, (_c, res) =>
    reply(res, 302, '', { location: 'https://www.ecb.europa.eu/anderswo.xml' }),
  );
  await assert.rejects(ecb.ecbFetch(ecb.ECB_DAILY_RATES), /EZB 302/);
  assert.equal(stub.calls.length, 1);
});

test('only HTTPS to the ECB host; nothing else is asked', async t => {
  const stub = await httpsStub(t, (_c, res) => reply(res, 200, 'nie'));
  await assert.rejects(ecb.ecbFetch('http://www.ecb.europa.eu/x.xml'), /nur von https/);
  await assert.rejects(ecb.ecbFetch('https://kurse.example.org/x.xml'), /nur von https/);
  assert.equal(stub.calls.length, 0);
});

test('a hanging ECB ends at the deadline', async t => {
  const stub = await httpsStub(t, () => {});
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  const lauf = ecb.ecbFetch(ecb.ECB_DAILY_RATES);
  await stub.nextCall();
  mock.timers.tick(60_000);
  await assert.rejects(lauf, /Zeitlimit 60000 ms/);
});

test('broken XML gives no rates, a broken ZIP an error', () => {
  assert.deepEqual(ecb.readDailyRates('<Cube time="2026-11-20"><Cube currency="USD" rate="1.08"'), []);
  assert.deepEqual(ecb.readDailyRates('kein xml'), []);
  assert.throws(() => ecb.firstZipFile(Buffer.from('kein zip')), /kein ZIP-Archiv/);
  const zip = Buffer.from(fixture('ecb-hist.zip', true));
  const ende = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const verzeichnis = zip.readUInt32LE(ende + 16);
  const withoutDir = Buffer.from(zip);
  withoutDir.writeUInt32LE(0, verzeichnis);
  assert.throws(() => ecb.firstZipFile(withoutDir), /zentrales Verzeichnis fehlt/);
  const foreignMethod = Buffer.from(zip);
  foreignMethod.writeUInt16LE(12, verzeichnis + 10);
  assert.throws(() => ecb.firstZipFile(foreignMethod), /Kompression 12 unbekannt/);
  const withoutHead = Buffer.from(zip);
  withoutHead.writeUInt32LE(0, zip.readUInt32LE(verzeichnis + 42));
  assert.throws(() => ecb.firstZipFile(withoutHead), /lokaler Kopf fehlt/);
});
