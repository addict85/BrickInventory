/**
 * Die Hostlisten prüfen Namen; src/infra/targetAddress.ts prüft die Adresse, auf
 * die ein Name auflöst. Das DNS ist hier eine Attrappe: `ziel.fake.test`
 * und die erlaubten Hosts lösen auf, was der Teiltest vorgibt.
 *
 * Gegenproben (11.11.2026 gemessen, je einzeln):
 *   A  in abruf.ts ohne `lookup: publicLookup` → rot: „ein erlaubter
 *      Host, der intern auflöst …“ (grund 'netz' statt 'adresse')
 *   B  in clients/imageCdn.ts den Pool ohne `lookup` → rot: „auch der Pool …“
 *   C  `*.lego.com` wieder in ALLOWED_DOWNLOAD_HOSTS → rot: „von LEGO nur …“
 *   D  in checkingLookup() ohne den Filter (alle Adressen weiter) → rot:
 *      „gemischte Antworten …“
 * Eingebettete IPv4 (12.11.2026 gemessen, je einzeln):
 *   E  normalisiert() gibt die Adresse unverändert zurück → rot: „NAT64 …
 *      zählt wie die IPv4-Adresse darin“ (64:ff9b::7f00:1 galt als öffentlich)
 *      und „… Container-Netz auch über NAT64“
 *   F  '2002::/16' aus INTERN gestrichen → rot: „6to4 und Teredo …“
 *   G  in normalisiert() die IPv4-kompatiblen (::/96) nicht erkannt → rot:
 *      „IPv4-kompatible Adressen …“ (::127.0.0.1 galt als öffentlich und
 *      erreichte den Mailserver im Container)
 *   H  (15.11.2026) die Dokumentationsnetze, 192.88.99.0/24 und fec0::/10 aus INTERN
 *      gestrichen → rot: „Dokumentations-, 6to4-Relais- und Site-Local-Netze …“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const dns = require('node:dns');

const _req = require('./helpers/sources').buildAndRequire();
const Z = _req('src/infra/targetAddress.js');
const { holeHttps, AbrufFehler } = _req('src/infra/fetch.js');
const { oeffneBild } = _req('clients/imageCdn.js');
const { hostAllowed, ALLOWED_DOWNLOAD_HOSTS } = _req('src/infra/foreignAddresses.js');

/** @param {Record<string, string[]>} antworten  Host → Adressen */
function withDns(t, antworten) {
  const echt = dns.lookup;
  const gefragt = [];
  /** @type {any} */ (dns).lookup = (host, opt, callback) => {
    const liste = antworten[host];
    if (!liste) return echt(host, opt, callback);
    gefragt.push(host);
    const a = liste.map(address => ({ address, family: address.includes(':') ? 6 : 4 }));
    setImmediate(() => (opt?.all ? callback(null, a) : callback(null, a[0].address, a[0].family)));
  };
  t.after(() => {
    dns.lookup = echt;
  });
  return gefragt;
}

async function grund(promise) {
  try {
    await promise;
  } catch (e) {
    assert.ok(e instanceof AbrufFehler, `kein AbrufFehler: ${e}`);
    return e.grund;
  }
  return 'kein Fehler';
}

test('public means: not private, loopback, link-local, ULA or CGNAT', () => {
  for (const ip of [
    '10.1.2.3',
    '172.20.0.5',
    '192.168.1.1',
    '127.0.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    'kein-ip',
  ])
    assert.equal(Z.publicAddress(ip), false, ip);
  for (const ip of ['104.20.1.1', '1.1.1.1', '2606:4700::1111']) assert.equal(Z.publicAddress(ip), true, ip);
});

test('documentation, 6to4 relay and site-local networks are not a public target', () => {
  for (const ip of [
    '192.0.2.10',
    '198.51.100.7',
    '203.0.113.200',
    '192.88.99.1',
    'fec0::1',
    'feff::1',
    '2001:db8::5',
    '::ffff:203.0.113.5',
  ])
    assert.equal(Z.publicAddress(ip), false, ip);
  // Die Nachbarn bleiben öffentlich: Die Netze sind nicht zu weit gefasst.
  for (const ip of ['192.0.3.1', '198.51.101.1', '203.0.114.1', '192.88.100.1', 'fe00::1'])
    assert.equal(Z.publicAddress(ip), true, ip);
});

test('the mail server may be in the own network, just not in that of the container', () => {
  const interfaces = {
    lo: [{ address: '127.0.0.1', cidr: '127.0.0.1/8', family: 'IPv4', internal: true }],
    eth0: [{ address: '172.28.73.5', cidr: '172.28.73.5/24', family: 'IPv4', internal: false }],
  };
  const imContainer = ip => Z.mailServerAddress(ip, { imContainer: true, interfaces });
  assert.deepEqual(['192.168.1.10', '10.0.0.25', '172.28.73.20', '127.0.0.1', '169.254.169.254'].map(imContainer), [
    true,
    true,
    false,
    false,
    false,
  ]);
  const withoutContainer = ip => Z.mailServerAddress(ip, { imContainer: false, interfaces });
  assert.deepEqual(
    ['127.0.0.1', '172.28.73.20', '169.254.169.254', 'fe80::1'].map(withoutContainer),
    [true, true, false, false],
    'ohne Container ist Loopback ein lokaler Mailserver',
  );
});

test('mixed responses: only the allowed addresses go on', async t => {
  withDns(t, { 'ziel.fake.test': ['10.0.0.7', '104.20.1.1', '127.0.0.1'] });
  const alle = await new Promise((fertig, scheitern) =>
    Z.publicLookup('ziel.fake.test', { all: true }, (e, a) => (e ? scheitern(e) : fertig(a))),
  );
  assert.deepEqual(alle, [{ address: '104.20.1.1', family: 4 }]);
  assert.equal(await Z.resolveOn('ziel.fake.test', Z.publicAddress), '104.20.1.1');
});

test('an allowed host that resolves internally is not connected', async t => {
  const gefragt = withDns(t, {
    'rebrickable.com': ['127.0.0.1'],
    'cdn.rebrickable.com': ['10.0.0.9', '169.254.169.254'],
  });
  const o = { hosts: ['rebrickable.com', 'cdn.rebrickable.com'], maxBytes: 1000, zeitlimitMs: 3000 };
  assert.equal(await grund(holeHttps('https://rebrickable.com/api/v3/x', o)), 'adresse');
  assert.equal(
    await grund(holeHttps('https://cdn.rebrickable.com/a.png', { ...o, methode: 'POST', rumpf: '{}' })),
    'adresse',
  );
  assert.deepEqual(gefragt, ['rebrickable.com', 'cdn.rebrickable.com']);
});

test('the image proxy pool also checks the address', async t => {
  const gefragt = withDns(t, { 'cdn.rebrickable.com': ['192.168.0.10'] });
  assert.equal(
    await grund(oeffneBild('https://cdn.rebrickable.com/media/x.jpg', { maxBytes: 1000, pool: true })),
    'adresse',
  );
  assert.deepEqual(gefragt, ['cdn.rebrickable.com']);
});

test('from LEGO only the hosts of the instructions', () => {
  for (const gut of ['https://lego.com/a.pdf', 'https://www.lego.com/cdn/a.pdf', 'https://assets.lego.com/a.pdf'])
    assert.ok(hostAllowed(gut, ALLOWED_DOWNLOAD_HOSTS), gut);
  for (const fremd of ['https://irgendwas.lego.com/a.pdf', 'https://x.www.lego.com/a.pdf'])
    assert.ok(!hostAllowed(fremd, ALLOWED_DOWNLOAD_HOSTS), fremd);
});

test('NAT64 and IPv4-mapped addresses: the IPv4 address inside counts', () => {
  for (const [ip, v4] of [
    ['::ffff:127.0.0.1', '127.0.0.1'],
    ['::FFFF:7f00:1', '127.0.0.1'],
    ['64:ff9b::7f00:1', '127.0.0.1'],
    ['64:ff9b::10.0.0.1', '10.0.0.1'],
    ['64:ff9b::a9fe:a9fe', '169.254.169.254'],
    ['64:ff9b::808:808', '8.8.8.8'],
  ])
    assert.equal(Z.normalisiert(ip), v4, ip);
  for (const ip of ['2606:4700::1111', 'fe80::1%eth0', '64:ff9b:1::1', '1.2.3.4']) assert.equal(Z.normalisiert(ip), ip);
  for (const ip of ['64:ff9b::7f00:1', '64:ff9b::10.0.0.1', '64:ff9b::a9fe:a9fe', '::ffff:192.168.1.1'])
    assert.equal(Z.publicAddress(ip), false, `NAT64 zählt wie die IPv4-Adresse darin: ${ip}`);
  // Hinter DNS64 bekommt ein reiner IPv4-Dienst eine NAT64-Adresse; die bleibt erreichbar.
  assert.equal(Z.publicAddress('64:ff9b::808:808'), true);
});

test('6to4 and Teredo are never public', () => {
  for (const ip of ['2002:a00:1::1', '2002:7f00:1::', '2001:0:4136:e378::1'])
    assert.equal(Z.publicAddress(ip), false, `6to4 und Teredo: ${ip}`);
});

test('the mail server does not reach the container network via NAT64 either', () => {
  const interfaces = {
    eth0: [{ address: '172.28.73.5', cidr: '172.28.73.5/24', family: 'IPv4', internal: false }],
  };
  const pruefe = ip => Z.mailServerAddress(ip, { imContainer: true, interfaces });
  assert.equal(pruefe('64:ff9b::172.28.73.20'), false, 'Container-Netz auch über NAT64');
  assert.equal(pruefe('::ffff:172.28.73.20'), false);
  assert.equal(pruefe('64:ff9b::7f00:1'), false, 'Loopback über NAT64');
  assert.equal(pruefe('64:ff9b::c0a8:10a'), true, 'ein Mailserver im eigenen LAN bleibt erlaubt');
});

test('IPv4-compatible addresses (::a.b.c.d) count like the IPv4 address inside', () => {
  assert.equal(Z.normalisiert('::127.0.0.1'), '127.0.0.1');
  assert.equal(Z.normalisiert('::a9fe:a9fe'), '169.254.169.254');
  for (const ip of ['::', '::1']) assert.equal(Z.normalisiert(ip), ip, `${ip} bleibt IPv6`);
  for (const ip of ['::127.0.0.1', '::7f00:1', '::10.0.0.1', '::a9fe:a9fe', '64:ff9b::7f00:1'])
    assert.equal(Z.publicAddress(ip), false, ip);
  const interfaces = {
    eth0: [{ address: '172.28.73.5', cidr: '172.28.73.5/24', family: 'IPv4', internal: false }],
  };
  const pruefe = ip => Z.mailServerAddress(ip, { imContainer: true, interfaces });
  assert.equal(pruefe('::127.0.0.1'), false, 'Loopback über ::/96');
  assert.equal(pruefe('::172.28.73.20'), false, 'Container-Netz über ::/96');
  assert.equal(Z.mailServerAddress('::1', { imContainer: false, interfaces }), true, '::1 ohne Container');
});
