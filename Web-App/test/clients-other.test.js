/**
 * The small clients against a local HTTPS stub: UPCitemdb, the LEGO balance query, the image
 * CDNs, Rebrickable's catalog files, Google's revocation list, and asFetchError.
 *
 * Counter-checks (measured 22.11.2026, each alone):
 *   A  in loadCatalogCsv() the status check removed → red: “a catalog file: unpacked, …” (404 written)
 *   B  in revocationListFetch() `redirects: 0` removed → red: “the revocation list …” (redirect followed)
 *   C  in legoFetch() the cookies no longer passed on → red: “the balance query posts …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const _req = require('./helpers/sources').buildAndRequire();
const { httpsStub, reply, clientsAccess } = require('./helpers/https-stub');
const { productTitle } = _req('clients/upcitemdb.js');
const { createRebrickable } = _req('clients/rebrickable.js');
const { legoFetch } = _req('clients/legoBalance.js');
const { fetchImage, openImage, IMAGE_HEADERS } = _req('clients/imageCdn.js');
const { loadCatalogCsv } = _req('clients/rebrickableCsv.js');
const { revocationListFetch } = _req('clients/googleAttestation.js');
const { asFetchError } = _req('clients/fetchError.js');

test('UPCitemdb: the first title, otherwise null', async t => {
  const slow = [429, { detail: 'Expected available in 0 seconds.' }];
  const answers = [
    [200, { items: [{ title: 'LEGO Icons 10294 Titanic' }] }],
    [200, { items: [] }],
    slow,
    slow,
    slow,
    [200, '{'],
  ];
  const stub = await httpsStub(t, (_c, res) =>
    reply(res, .../** @type {[number, any, Record<string, string>?]} */ (answers.shift() ?? [500, ''])),
  );
  const get = createRebrickable(clientsAccess()).httpsGetRobust;
  assert.equal(await productTitle(get, '5702016914313'), 'LEGO Icons 10294 Titanic');
  assert.equal(stub.calls[0].host, 'api.upcitemdb.com');
  assert.equal(stub.calls[0].path, '/prod/trial/lookup?upc=5702016914313');
  assert.equal(await productTitle(get, '1'), null);
  assert.equal(await productTitle(get, '1'), null, '429');
  assert.equal(await productTitle(get, '1'), null, 'kaputtes JSON');
});

test('the balance query posts to www.lego.com and returns cookies', async t => {
  const stub = await httpsStub(t, (c, res) =>
    c.method === 'POST'
      ? reply(res, 200, { balance: 25 }, { 'set-cookie': 'sitzung=abc; Path=/' })
      : reply(res, 503, 'weg'),
  );
  const r = await legoFetch('https://www.lego.com/api/balance', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"card":"x"}',
  });
  assert.deepEqual([r.ok, r.status, await r.json()], [true, 200, { balance: 25 }]);
  assert.deepEqual(r.headers.getSetCookie?.(), ['sitzung=abc; Path=/']);
  assert.equal(stub.calls[0].body, '{"card":"x"}');
  const g = await legoFetch('https://www.lego.com/de-ch/');
  assert.deepEqual([g.ok, g.status, await g.text()], [false, 503, 'weg']);
  await assert.rejects(legoFetch('https://lego.example.org/'), /Adresse nicht erlaubt/);
});

test('images from the CDNs: whole, as a stream, with the browser headers', async t => {
  const image = Buffer.alloc(300, 7);
  const stub = await httpsStub(t, (c, res) =>
    c.path === '/gross.jpg'
      ? reply(res, 200, Buffer.alloc(5000))
      : reply(res, 200, image, { 'content-type': 'image/jpeg' }),
  );
  const r = await fetchImage('https://cdn.rebrickable.com/media/sets/10294-1.jpg', { maxBytes: 1000 });
  assert.deepEqual([r.status, r.body], [200, image]);
  assert.equal(stub.calls[0].headers.referer, IMAGE_HEADERS.Referer);
  const s = await openImage('https://images.brickset.com/sets/10294-1.jpg', { maxBytes: 1000, pool: true });
  const parts = [];
  for await (const d of s.stream()) parts.push(d);
  assert.deepEqual(Buffer.concat(parts), image);
  await assert.rejects(fetchImage('https://cdn.rebrickable.com/gross.jpg', { maxBytes: 1000 }), /über 1000 Byte/);
  await assert.rejects(fetchImage('https://bilder.example.org/x.jpg', { maxBytes: 1000 }), /nicht erlaubt/);
});

test('a catalog file: unpacked, progress counted; errors leave nothing usable', async t => {
  const csv = 'id,name\n1,Black\n2,White\n';
  const gz = zlib.gzipSync(csv);
  const stub = await httpsStub(t, (c, res) =>
    c.path === '/media/downloads/colors.csv.gz'
      ? reply(res, 200, gz, { 'content-length': String(gz.length) })
      : c.path === '/media/downloads/themes.csv.gz'
        ? reply(res, 200, 'kein gzip')
        : reply(res, 404, ''),
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-csv-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const progress = [];
  await loadCatalogCsv('colors.csv.gz', path.join(dir, 'colors.csv'), {
    atProgress: (n, ges) => progress.push([n, ges]),
  });
  assert.equal(fs.readFileSync(path.join(dir, 'colors.csv'), 'utf8'), csv);
  assert.deepEqual(progress.at(-1), [gz.length, gz.length]);
  assert.equal(stub.calls[0].host, 'cdn.rebrickable.com');
  await assert.rejects(loadCatalogCsv('sets.csv.gz', path.join(dir, 'sets.csv')), /HTTP 404 für sets\.csv\.gz/);
  await assert.rejects(loadCatalogCsv('themes.csv.gz', path.join(dir, 'themes.csv')), /incorrect header check/);
  await assert.rejects(loadCatalogCsv('../etc/passwd', path.join(dir, 'x')), /Unbekannte Katalogdatei/);
  assert.equal(stub.calls.length, 3);
});

test('the revocation list: only from Google, no redirect', async t => {
  const answers = [
    [200, '{"entries":{}}'],
    [302, '', { location: 'https://android.googleapis.com/anders' }],
  ];
  await httpsStub(t, (_c, res) =>
    reply(res, .../** @type {[number, any, Record<string, string>?]} */ (answers.shift())),
  );
  assert.equal((await revocationListFetch()).toString(), '{"entries":{}}');
  await assert.rejects(revocationListFetch(), /Widerrufsliste: HTTP 302/);
});

test('asFetchError keeps the extra fields of a non-Error', () => {
  const e = new Error('echt');
  assert.equal(asFetchError(e), e);
  const f = asFetchError({ message: 'kein Error', isQuota: 1, isTransient: 1, isCloudflare: 1, detail: { a: 1 } });
  assert.deepEqual(
    [f.message, f.isQuota, f.isTransient, f.isCloudflare, f.detail],
    ['kein Error', true, true, true, { a: 1 }],
  );
  assert.equal(asFetchError('nur Text').message, 'nur Text');
  assert.equal(asFetchError(null).message, 'Unbekannter Abruffehler');
});
