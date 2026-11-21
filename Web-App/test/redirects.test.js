/**
 * Outgoing redirects: limited, only https, without secrets.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const { buildAndRequire, ohneKommentare } = require('./helpers/sources');
const _req = buildAndRequire();
const { nextRedirect, hostAllowed, REDIRECT_LIMIT, ALLOWED_IMAGE_HOSTS, ALLOWED_DOWNLOAD_HOSTS } = _req(
  'src/infra/foreignAddresses.js',
);

const HEADER = { Authorization: 'key GEHEIM', 'User-Agent': 'test' };

test('a redirect does not take the key along to a foreign host', () => {
  const w = nextRedirect('https://rebrickable.com/a', 'https://angreifer.tld/b', HEADER);
  assert.ok(w, 'Der Sprung selbst ist erlaubt — nur eben ohne Geheimnis');
  assert.equal(w.url, 'https://angreifer.tld/b');
  assert.equal(w.kopfzeilen.Authorization, undefined, 'Der API-Schluessel darf einen Hostwechsel nicht ueberleben');
  assert.equal(
    w.kopfzeilen['User-Agent'],
    'test',
    'Alles andere bleibt — sonst sperrt uns das CDN wegen fehlendem User-Agent aus',
  );
});

test('on the same host the key stays', () => {
  // Otherwise the rule would be unusable: rebrickable.com redirects within its
  // own addresses (slash at the end), and without a key
  // a 401 would come back there.
  const w = nextRedirect('https://rebrickable.com/a', 'https://rebrickable.com/a/', HEADER);
  assert.equal(w.kopfzeilen.Authorization, 'key GEHEIM');
});

test('a downgrade to http is not followed', () => {
  assert.equal(
    nextRedirect('https://rebrickable.com/a', 'http://rebrickable.com/a', HEADER),
    null,
    'Sonst geht derselbe Schluessel im Klartext hinaus',
  );
  // Checked positively for https, not negatively for http: a deny list
  // forgets a scheme at some point.
  for (const boese of ['file:///etc/passwd', 'ftp://x.tld/a', 'data:text/plain,x'])
    assert.equal(nextRedirect('https://rebrickable.com/a', boese, HEADER), null, `${boese} darf nicht befolgt werden`);
});

test('a relative redirect target is resolved', () => {
  // A Location header MAY be a mere path (RFC 9110). Before, that ran
  // into `new URL(location)` and thus into an "Invalid URL" — rightly
  // rejected, but for the wrong reason: a valid redirect did not come
  // an.
  const w = nextRedirect('https://rebrickable.com/sets/123/', '/sets/123-1/', HEADER);
  assert.equal(w.url, 'https://rebrickable.com/sets/123-1/');
  assert.equal(w.kopfzeilen.Authorization, 'key GEHEIM', 'Derselbe Host — der Schluessel bleibt');
});

test('without a Location header there is no target', () => {
  assert.equal(nextRedirect('https://rebrickable.com/a', undefined, HEADER), null);
  assert.equal(nextRedirect('https://rebrickable.com/a', '', HEADER), null);
});

test('with a host list the redirect target counts as well', () => {
  // The file download checks the host on EVERY hop, because it delivers what it
  // fetched (data/instructions/ is retrievable for logged-in users).
  assert.equal(
    nextRedirect('https://cdn.rebrickable.com/a.pdf', 'https://angreifer.tld/a.pdf', HEADER, ALLOWED_DOWNLOAD_HOSTS),
    null,
    'Sonst holt der Server eine beliebige Adresse und gibt sie zurueck',
  );
  assert.ok(
    nextRedirect('https://cdn.rebrickable.com/a.pdf', 'https://www.lego.com/a.pdf', HEADER, ALLOWED_DOWNLOAD_HOSTS),
    'Anleitungen liegen bei lego.com — die muessen weiter ankommen',
  );
});

test('the host check does not fall for an appended name', () => {
  // The same trap as with the bearer token of the app and with the update address:
  // a mere endsWith() without the dot in front.
  assert.ok(hostAllowed('https://cdn.rebrickable.com/x', ALLOWED_IMAGE_HOSTS));
  assert.ok(hostAllowed('https://rebrickable.com/x', ALLOWED_IMAGE_HOSTS));
  for (const boese of [
    'https://evil-rebrickable.com/x',
    'https://rebrickable.com.angreifer.tld/x',
    'https://xlego.com/x',
    'https://lego.com.angreifer.tld/x',
  ])
    assert.ok(!hostAllowed(boese, ALLOWED_DOWNLOAD_HOSTS), `${boese} darf nicht durchgehen`);
  // Unparsable means do NOT fetch — and not: throw.
  assert.equal(hostAllowed('kein-url', ALLOWED_IMAGE_HOSTS), false);
});

/**
 * Port, userinfo and bucket subdomains.
 *
 * Counter-checks (measured 01.11.2026, each on its own):
 *   `u.hostname === h` instead of `u.host === h` → red at „:22"
 *   userinfo check removed → red at „evil.com@"
 *   additionally `u.host.endsWith('.' + h)` (old suffix) → red at „x.bdpinstructions"
 */
test('host check: only default port, no userinfo, bucket exact', () => {
  for (const gut of [
    'https://cdn.rebrickable.com/x',
    'https://cdn.rebrickable.com:443/x',
    'https://www.lego.com/cdn/a.pdf',
    'https://assets.lego.com/a.pdf',
  ])
    assert.ok(hostAllowed(gut, ALLOWED_DOWNLOAD_HOSTS), `${gut} muss erlaubt sein`);
  for (const boese of ['https://cdn.rebrickable.com:22/', 'https://cdn.rebrickable.com:8443/x'])
    assert.ok(!hostAllowed(boese, ALLOWED_IMAGE_HOSTS), `${boese}: fremder Port`);
  for (const boese of ['https://evil.com@cdn.rebrickable.com/', 'https://a:b@cdn.rebrickable.com/'])
    assert.ok(!hostAllowed(boese, ALLOWED_IMAGE_HOSTS), `${boese}: Userinfo`);
  for (const boese of ['https://x.bdpinstructions.s3.amazonaws.com/a.pdf', 'https://x.cdn.rebrickable.com/a.png'])
    assert.ok(!hostAllowed(boese, ALLOWED_DOWNLOAD_HOSTS), `${boese}: Unterdomäne`);
});

/**
 * The instructions of the BrickLink Designer Program.
 */
test('the BDP bucket may be fetched — but only it', () => {
  assert.ok(
    hostAllowed('https://bdpinstructions.s3.amazonaws.com/11010.pdf', ALLOWED_DOWNLOAD_HOSTS),
    'Der Rueckfall in src/catalog/instructions.ts baut genau diese Adresse — sie hier ' +
      'abzulehnen heisst, ihn bauen zu lassen und ins Leere laufen zu lassen',
  );

  // And NOT half the provider
  for (const fremd of [
    'https://amazonaws.com/x.pdf',
    'https://s3.amazonaws.com/x.pdf',
    'https://boeser-eimer.s3.amazonaws.com/x.pdf',
    'https://bdpinstructions.s3.amazonaws.com.angreifer.tld/x.pdf',
  ]) {
    assert.ok(
      !hostAllowed(fremd, ALLOWED_DOWNLOAD_HOSTS),
      `${fremd} darf nicht durchgehen — sonst ist jeder fremde Eimer erlaubt`,
    );
  }

  // And the image list stays untouched: PDFs come from there, no images.
  assert.ok(
    !hostAllowed('https://bdpinstructions.s3.amazonaws.com/11010.pdf', ALLOWED_IMAGE_HOSTS),
    'Der PDF-Eimer hat in der BILDliste nichts zu suchen — der Bild-Proxy ' +
      'liefert an den Browser aus, und das ist eine andere Frage',
  );
});

test('outbound requests only go through src/infra/fetch.ts', () => {
  // Structure, not behavior: the behavior of the helper is checked by
  // test/fetch-helper.test.js against a real TLS server. Counter-check
  // (measured 02.11.2026): globalThis.fetch back in gutscheinGuthaben.ts → red.
  const fremd = [];
  (function lauf(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) {
        if (!['node_modules', 'dist', 'test', 'public', 'scripts', '.git'].includes(n)) lauf(p);
        continue;
      }
      if (!n.endsWith('.ts') || p.endsWith(path.join('src', 'infra', 'fetch.ts'))) continue;
      if (/\bhttps?\.(get|request)\(|\bfetch\(|\bglobalThis\.fetch\b/.test(ohneKommentare(fs.readFileSync(p, 'utf8'))))
        fremd.push(path.relative(ROOT, p));
    }
  })(ROOT);
  assert.deepEqual(fremd, [], 'eigener Abrufweg an Hostliste, Umleitungs- und Grössengrenze vorbei');
  assert.match(
    ohneKommentare(read('src/infra/fetch.ts')),
    /nextRedirect\(u, r\.headers\?\.location, kopf, o\.hosts\)/,
    'der Helfer prüft die Umleitungsziele nicht gegen die Hostliste',
  );
  assert.match(
    ohneKommentare(read('clients/rebrickable.ts')),
    /hosts: ALLOWED_DOWNLOAD_HOSTS/,
    'downloadFile prueft die Umleitungsziele nicht mehr — die Datei wird ausgeliefert',
  );

  // ── And the list stands at only ONE place ──────────────────────────
  const proxy = ohneKommentare(read('src/images/http/imageProxy.ts'));
  assert.doesNotMatch(
    proxy,
    /const ALLOWED_IMAGE_HOSTS = \[/,
    'Die Bild-Allowlist ist zurueck in der Route — sie gehoert nach src/infra/foreignAddresses.ts, ' +
      'weil clients/ sie braucht und ein Client nicht von einer Route abhaengen soll',
  );
  // This is a PATTERN rule: it catches a deleted line. That the
  // path really lives runs in test/wiring-running-db.test.js —
  // both together, not one instead of the other.
  assert.match(
    proxy,
    /hostAllowed\(url, ALLOWED_IMAGE_HOSTS\)/,
    'Der Bild-Proxy prueft nicht mehr ueber die gemeinsame Regel',
  );
  // Since 05.11.2026 the image diagnosis stands in the admin service.
  assert.match(
    ohneKommentare(read('src/management/diagnostics.ts')),
    /hostAllowed\(url, ALLOWED_IMAGE_HOSTS\)/,
    'Die Bild-Diagnose prueft nicht mehr ueber die gemeinsame Regel',
  );
});

test('the limit is the one downloadFile already had', () => {
  // Self-proof: the number comes from the tree, not from the header. It stood
  // as `redirects > 5` in downloadFile before.
  assert.equal(REDIRECT_LIMIT, 5);
});
