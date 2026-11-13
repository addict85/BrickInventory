/**
 * Die Hostlisten prüfen Namen; src/infra/zielAdresse.ts prüft die Adresse, auf
 * die ein Name auflöst. Das DNS ist hier eine Attrappe: `ziel.attrappe.test`
 * und die erlaubten Hosts lösen auf, was der Teiltest vorgibt.
 *
 * Gegenproben (11.11.2026 gemessen, je einzeln):
 *   A  in abruf.ts ohne `lookup: oeffentlicherLookup` → rot: „ein erlaubter
 *      Host, der intern auflöst …“ (grund 'netz' statt 'adresse')
 *   B  in clients/bildCdn.ts den Pool ohne `lookup` → rot: „auch der Pool …“
 *   C  `*.lego.com` wieder in ERLAUBTE_DOWNLOAD_HOSTS → rot: „von LEGO nur …“
 *   D  in pruefenderLookup() ohne den Filter (alle Adressen weiter) → rot:
 *      „gemischte Antworten …“
 * Eingebettete IPv4 (12.11.2026 gemessen, je einzeln):
 *   E  normalisiert() gibt die Adresse unverändert zurück → rot: „NAT64 …
 *      zählt wie die IPv4-Adresse darin“ (64:ff9b::7f00:1 galt als öffentlich)
 *      und „… Container-Netz auch über NAT64“
 *   F  '2002::/16' aus INTERN gestrichen → rot: „6to4 und Teredo …“
 *   G  in normalisiert() die IPv4-kompatiblen (::/96) nicht erkannt → rot:
 *      „IPv4-kompatible Adressen …“ (::127.0.0.1 galt als öffentlich und
 *      erreichte den Mailserver im Container)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const dns = require('node:dns');

const _req = require('./helpers/sources').buildAndRequire();
const Z = _req('src/infra/zielAdresse.js');
const { holeHttps, AbrufFehler } = _req('src/infra/abruf.js');
const { oeffneBild } = _req('clients/bildCdn.js');
const { hostErlaubt, ERLAUBTE_DOWNLOAD_HOSTS } = _req('src/infra/fremdeAdressen.js');

/** @param {Record<string, string[]>} antworten  Host → Adressen */
function mitDns(t, antworten) {
  const echt = dns.lookup;
  const gefragt = [];
  /** @type {any} */ (dns).lookup = (host, opt, rueckruf) => {
    const liste = antworten[host];
    if (!liste) return echt(host, opt, rueckruf);
    gefragt.push(host);
    const a = liste.map(address => ({ address, family: address.includes(':') ? 6 : 4 }));
    setImmediate(() => (opt?.all ? rueckruf(null, a) : rueckruf(null, a[0].address, a[0].family)));
  };
  t.after(() => {
    dns.lookup = echt;
  });
  return gefragt;
}

async function grund(versprechen) {
  try {
    await versprechen;
  } catch (e) {
    assert.ok(e instanceof AbrufFehler, `kein AbrufFehler: ${e}`);
    return e.grund;
  }
  return 'kein Fehler';
}

test('öffentlich heisst: nicht privat, Loopback, Link-Local, ULA oder CGNAT', () => {
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
    assert.equal(Z.oeffentlicheAdresse(ip), false, ip);
  for (const ip of ['104.20.1.1', '1.1.1.1', '2606:4700::1111']) assert.equal(Z.oeffentlicheAdresse(ip), true, ip);
});

test('der Mailserver darf im eigenen Netz stehen, nur nicht in dem des Containers', () => {
  const schnittstellen = {
    lo: [{ address: '127.0.0.1', cidr: '127.0.0.1/8', family: 'IPv4', internal: true }],
    eth0: [{ address: '172.28.73.5', cidr: '172.28.73.5/24', family: 'IPv4', internal: false }],
  };
  const imContainer = ip => Z.mailserverAdresse(ip, { imContainer: true, schnittstellen });
  assert.deepEqual(['192.168.1.10', '10.0.0.25', '172.28.73.20', '127.0.0.1', '169.254.169.254'].map(imContainer), [
    true,
    true,
    false,
    false,
    false,
  ]);
  const ohneContainer = ip => Z.mailserverAdresse(ip, { imContainer: false, schnittstellen });
  assert.deepEqual(
    ['127.0.0.1', '172.28.73.20', '169.254.169.254', 'fe80::1'].map(ohneContainer),
    [true, true, false, false],
    'ohne Container ist Loopback ein lokaler Mailserver',
  );
});

test('gemischte Antworten: nur die erlaubten Adressen gehen weiter', async t => {
  mitDns(t, { 'ziel.attrappe.test': ['10.0.0.7', '104.20.1.1', '127.0.0.1'] });
  const alle = await new Promise((fertig, scheitern) =>
    Z.oeffentlicherLookup('ziel.attrappe.test', { all: true }, (e, a) => (e ? scheitern(e) : fertig(a))),
  );
  assert.deepEqual(alle, [{ address: '104.20.1.1', family: 4 }]);
  assert.equal(await Z.loeseAuf('ziel.attrappe.test', Z.oeffentlicheAdresse), '104.20.1.1');
});

test('ein erlaubter Host, der intern auflöst, wird nicht verbunden', async t => {
  const gefragt = mitDns(t, {
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

test('auch der Pool des Bild-Proxys prüft die Adresse', async t => {
  const gefragt = mitDns(t, { 'cdn.rebrickable.com': ['192.168.0.10'] });
  assert.equal(
    await grund(oeffneBild('https://cdn.rebrickable.com/media/x.jpg', { maxBytes: 1000, pool: true })),
    'adresse',
  );
  assert.deepEqual(gefragt, ['cdn.rebrickable.com']);
});

test('von LEGO nur die Hosts der Anleitungen', () => {
  for (const gut of ['https://lego.com/a.pdf', 'https://www.lego.com/cdn/a.pdf', 'https://assets.lego.com/a.pdf'])
    assert.ok(hostErlaubt(gut, ERLAUBTE_DOWNLOAD_HOSTS), gut);
  for (const fremd of ['https://irgendwas.lego.com/a.pdf', 'https://x.www.lego.com/a.pdf'])
    assert.ok(!hostErlaubt(fremd, ERLAUBTE_DOWNLOAD_HOSTS), fremd);
});

test('NAT64 und IPv4-gemappte Adressen: es zählt die IPv4-Adresse darin', () => {
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
    assert.equal(Z.oeffentlicheAdresse(ip), false, `NAT64 zählt wie die IPv4-Adresse darin: ${ip}`);
  // Hinter DNS64 bekommt ein reiner IPv4-Dienst eine NAT64-Adresse; die bleibt erreichbar.
  assert.equal(Z.oeffentlicheAdresse('64:ff9b::808:808'), true);
});

test('6to4 und Teredo sind nie öffentlich', () => {
  for (const ip of ['2002:a00:1::1', '2002:7f00:1::', '2001:0:4136:e378::1'])
    assert.equal(Z.oeffentlicheAdresse(ip), false, `6to4 und Teredo: ${ip}`);
});

test('der Mailserver erreicht das Container-Netz auch über NAT64 nicht', () => {
  const schnittstellen = {
    eth0: [{ address: '172.28.73.5', cidr: '172.28.73.5/24', family: 'IPv4', internal: false }],
  };
  const pruefe = ip => Z.mailserverAdresse(ip, { imContainer: true, schnittstellen });
  assert.equal(pruefe('64:ff9b::172.28.73.20'), false, 'Container-Netz auch über NAT64');
  assert.equal(pruefe('::ffff:172.28.73.20'), false);
  assert.equal(pruefe('64:ff9b::7f00:1'), false, 'Loopback über NAT64');
  assert.equal(pruefe('64:ff9b::c0a8:10a'), true, 'ein Mailserver im eigenen LAN bleibt erlaubt');
});

test('IPv4-kompatible Adressen (::a.b.c.d) zählen wie die IPv4-Adresse darin', () => {
  assert.equal(Z.normalisiert('::127.0.0.1'), '127.0.0.1');
  assert.equal(Z.normalisiert('::a9fe:a9fe'), '169.254.169.254');
  for (const ip of ['::', '::1']) assert.equal(Z.normalisiert(ip), ip, `${ip} bleibt IPv6`);
  for (const ip of ['::127.0.0.1', '::7f00:1', '::10.0.0.1', '::a9fe:a9fe', '64:ff9b::7f00:1'])
    assert.equal(Z.oeffentlicheAdresse(ip), false, ip);
  const schnittstellen = {
    eth0: [{ address: '172.28.73.5', cidr: '172.28.73.5/24', family: 'IPv4', internal: false }],
  };
  const pruefe = ip => Z.mailserverAdresse(ip, { imContainer: true, schnittstellen });
  assert.equal(pruefe('::127.0.0.1'), false, 'Loopback über ::/96');
  assert.equal(pruefe('::172.28.73.20'), false, 'Container-Netz über ::/96');
  assert.equal(Z.mailserverAdresse('::1', { imContainer: false, schnittstellen }), true, '::1 ohne Container');
});
