/**
 * The Rebrickable client (clients/rebrickable.ts) against a local HTTPS stub with fixtures:
 * set, theme, paged part lists, minifigs, colors, part images, the BrickLink mapping, the
 * instruction scrape and downloads — and the error paths: 429 with wait time, 403, 404, 5xx,
 * broken JSON, a foreign `next`, a dropped connection and a timeout.
 *
 * Counter-checks (measured 22.11.2026, each alone):
 *   A  in httpsGetRobust() the 429 branch removed → red: “429: waits as told, throttles …”
 *   B  in fetchSetParts() `hostAllowed(…)` replaced by `true` → red: “a foreign `next` …”
 *   C  in rbGet() `if (status === 404) return null` removed → red: “unknown set: null …”
 *   D  in blPartToRb() the cross-check of path 1 removed → red: “BrickLink → Rebrickable …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mock } = require('node:test');

const _req = require('./helpers/sources').buildAndRequire();
const { httpsStub, reply, fixture, clientsAccess } = require('./helpers/https-stub');
const rb = _req('clients/rebrickable.js');
const { RbSet } = _req('clients/responses.js');

const API = '/api/v3/lego';
/** Answers by path (without query); unknown paths 404. */
const byPath = routes => (c, res) => {
  const p = c.path.split('?')[0];
  const a = routes[p];
  if (typeof a === 'function') return a(c, res);
  if (a) return reply(res, .../** @type {[number, any, Record<string, string>?]} */ (a));
  reply(res, 404, { detail: 'Not found.' });
};

test('set and theme; the theme is remembered per client', async t => {
  const stub = await httpsStub(
    t,
    byPath({
      [`${API}/sets/10294-1/`]: [200, fixture('rebrickable-set.json')],
      [`${API}/themes/721/`]: [200, fixture('rebrickable-theme.json')],
    }),
  );
  const k = rb.createRebrickable(clientsAccess());
  const set = await k.holeSet('10294-1');
  assert.deepEqual([set.name, set.num_parts], ['Titanic', 9090]);
  assert.equal(await k.getThemeName(set.theme_id), 'Icons');
  assert.equal(await k.getThemeName(721), 'Icons');
  assert.equal(await k.getThemeName(0), null);
  assert.equal(stub.calls.filter(c => c.path.startsWith(`${API}/themes/`)).length, 1);
  assert.equal(stub.calls[0].headers.authorization, 'key rb-key');
  assert.match(stub.calls[0].path, /page_size=500/);
});

test('unknown set: null; another status is an error with the start of the body', async t => {
  await httpsStub(t, byPath({ [`${API}/sets/1-1/`]: [500, 'Internal Server Error'] }));
  const k = rb.createRebrickable(clientsAccess());
  assert.equal(await k.holeSet('404-1'), null);
  await assert.rejects(k.holeSet('1-1'), /Rebrickable 500: Internal Server Error/);
});

test('without key or quota a set lookup is locked; the access check uses the same path', async t => {
  const stub = await httpsStub(t, byPath({ [`${API}/themes/`]: [200, { count: 1, next: null, results: [] }] }));
  await assert.rejects(
    rb.createRebrickable(clientsAccess({ keys: { rebrickable_api_key: '' } })).holeSet('10294-1'),
    (/** @type {any} */ err) => err instanceof rb.RebrickableLocked && err.reason === 'no_key',
  );
  await assert.rejects(
    rb.createRebrickable(clientsAccess({ allowed: false })).holeSet('10294-1'),
    (/** @type {any} */ err) =>
      err instanceof rb.RebrickableLocked && err.reason === 'quota' && /100\/Tag/.test(err.message),
  );
  assert.equal(stub.calls.length, 0);
  await rb.createRebrickable(clientsAccess()).checkRebrickableAccess();
  assert.match(stub.calls[0].path, /^\/api\/v3\/lego\/themes\/\?page_size=1$/);
});

test('rebrickableJson: every failure is null', async t => {
  await httpsStub(
    t,
    byPath({
      [`${API}/sets/10294-1/`]: [200, fixture('rebrickable-set.json')],
      [`${API}/sets/kaputt-1/`]: [200, '{"set_num": '],
      [`${API}/sets/falsch-1/`]: [200, { name: 'ohne Nummer' }],
    }),
  );
  const k = rb.createRebrickable(clientsAccess());
  assert.equal((await k.rebrickableJson('/lego/sets/10294-1/', RbSet)).name, 'Titanic');
  assert.equal(await k.rebrickableJson('/lego/sets/kaputt-1/', RbSet), null);
  assert.equal(await k.rebrickableJson('/lego/sets/falsch-1/', RbSet), null);
  assert.equal(await k.rebrickableJson('/lego/sets/fehlt-1/', RbSet), null);
  assert.equal(
    await rb.createRebrickable(clientsAccess({ keys: { rebrickable_api_key: '' } })).rebrickableJson('/x/', RbSet),
    null,
  );
  assert.equal(await rb.createRebrickable(clientsAccess({ allowed: false })).rebrickableJson('/x/', RbSet), null);
});

test('429: waits as told, throttles the foreground and tries again', async t => {
  let n = 0;
  await httpsStub(
    t,
    byPath({
      [`${API}/sets/10294-1/`]: (_c, res) =>
        n++ < 1
          ? reply(res, 429, { detail: 'Request was throttled. Expected available in 0 seconds.' })
          : reply(res, 200, fixture('rebrickable-set.json')),
      [`${API}/sets/immer-1/`]: [429, 'kein json'],
    }),
  );
  const z = clientsAccess();
  const k = rb.createRebrickable(z);
  assert.equal((await k.holeSet('10294-1')).name, 'Titanic');
  assert.deepEqual(z.seen.throttled, [500]);
  // Three times 429 (fallback wait 5 s, set clock instead of waiting): the status stays.
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  const lauf = k.httpsGetRobust('https://rebrickable.com/api/v3/lego/sets/immer-1/', { Authorization: 'key x' });
  while (z.seen.throttled.length < 4) {
    await new Promise(r => setImmediate(r));
    mock.timers.tick(5000);
  }
  assert.deepEqual(await lauf, { status: 429, body: '', buffer: Buffer.alloc(0) });
  assert.deepEqual(z.seen.throttled.slice(1), [5000, 5000, 5000]);
  assert.equal(rb.parseThrottleWait('{"detail": "Expected available in 3 seconds."}'), 3500);
});

test('the part list page by page; 403 means refused', async t => {
  await httpsStub(
    t,
    byPath({
      [`${API}/sets/10294-1/parts/`]: (c, res) =>
        reply(res, 200, fixture(c.path.includes('page=2') ? 'rebrickable-parts-2.json' : 'rebrickable-parts-1.json')),
      [`${API}/sets/geheim-1/parts/`]: [403, 'Forbidden'],
      [`${API}/sets/kaputt-1/parts/`]: [200, 'kein json'],
      [`${API}/sets/fehler-1/parts/`]: [502, 'Bad Gateway'],
    }),
  );
  const k = rb.createRebrickable(clientsAccess());
  const { parts, refused } = await k.fetchSetParts('10294-1');
  assert.deepEqual(
    parts.map(p => [p.part.part_num, p.color.id, p.quantity, p.is_spare]),
    [
      ['3001', 0, 4, false],
      ['3002', 0, 2, false],
      ['3003', 15, 1, true],
    ],
  );
  assert.equal(refused, false);
  assert.deepEqual(await k.fetchSetParts('geheim-1'), { parts: [], refused: true });
  assert.deepEqual(await k.fetchSetParts('kaputt-1'), { parts: [], refused: false });
  assert.deepEqual(await k.fetchSetParts('fehler-1'), { parts: [], refused: false });
  assert.deepEqual(await k.fetchSetParts('fehlt-1'), { parts: [], refused: false });
  assert.deepEqual(await rb.createRebrickable(clientsAccess({ allowed: false })).fetchSetParts('10294-1'), {
    parts: [],
    refused: false,
  });
  await assert.rejects(
    rb.createRebrickable(clientsAccess({ keys: { rebrickable_api_key: '' } })).fetchSetParts('10294-1'),
    /nicht konfiguriert/,
  );
});

test('a foreign `next` does not get the key', async t => {
  const page = JSON.parse(fixture('rebrickable-parts-1.json'));
  page.next = 'https://example.org/stiehlt-den-schluessel/?page=2';
  const stub = await httpsStub(t, byPath({ [`${API}/sets/10294-1/parts/`]: [200, page] }));
  // fetch.ts would refuse the host as well; the client must not even try, and says why.
  const gemeldet = [];
  t.mock.method(console, 'error', (...a) => gemeldet.push(a.join(' ')));
  const { parts } = await rb.createRebrickable(clientsAccess()).fetchSetParts('10294-1');
  assert.equal(parts.length, 2);
  assert.ok(
    gemeldet.some(z => /next zeigt auf einen fremden Host, 10294-1 bleibt unvollständig/.test(z)),
    gemeldet.join('\n'),
  );
  assert.deepEqual(
    stub.calls.map(c => c.host),
    ['rebrickable.com'],
  );
});

test('minifigs of a set, a minifig, its parts', async t => {
  await httpsStub(
    t,
    byPath({
      [`${API}/sets/10294-1/minifigs/`]: [200, fixture('rebrickable-minifigs.json')],
      [`${API}/sets/kaputt-1/minifigs/`]: [200, '{'],
      [`${API}/minifigs/fig-000001/`]: [200, fixture('rebrickable-minifig.json')],
      [`${API}/minifigs/fig-000001/parts/`]: [200, fixture('rebrickable-parts-2.json')],
    }),
  );
  const k = rb.createRebrickable(clientsAccess());
  assert.deepEqual(await k.getSetMinifigs('10294'), [
    {
      fig_number: 'fig-000001',
      fig_name: 'Kapitän',
      quantity: 2,
      image_url: 'https://cdn.rebrickable.com/media/sets/fig-000001.jpg',
    },
  ]);
  assert.deepEqual(await k.getSetMinifigs('kaputt-1'), []);
  assert.deepEqual(await k.getSetMinifigs('fehlt-1'), []);
  assert.deepEqual(await k.getMinifigInfo('fig-000001'), {
    fig_number: 'fig-000001',
    fig_name: 'Kapitän',
    image_url: 'https://cdn.rebrickable.com/media/sets/fig-000001.jpg',
  });
  assert.equal(await k.getMinifigInfo('fig-999999'), null);
  assert.deepEqual(await k.fetchMinifigParts('fig-000001'), [
    { part_num: '3003', color_id: 15, quantity: 1, bl_part_num: '3003' },
  ]);
  assert.equal(await k.fetchMinifigParts('fig-999999'), null);
  const ohne = rb.createRebrickable(clientsAccess({ keys: { rebrickable_api_key: '' } }));
  assert.deepEqual([await ohne.getSetMinifigs('10294-1'), await ohne.fetchMinifigParts('fig-1')], [[], null]);
  assert.equal(await rb.createRebrickable(clientsAccess({ allowed: false })).fetchMinifigParts('fig-1'), null);
});

test('colors once per client; a part with its image in the chosen color', async t => {
  const stub = await httpsStub(
    t,
    byPath({
      [`${API}/colors/`]: [200, fixture('rebrickable-colors.json')],
      [`${API}/parts/`]: (c, res) =>
        c.path.includes('part_nums=3001')
          ? reply(res, 200, fixture('rebrickable-part-search.json'))
          : reply(res, 200, { count: 0, next: null, results: [] }),
      [`${API}/parts/3001/colors/15/`]: [200, fixture('rebrickable-part-color.json')],
      [`${API}/parts/3001/colors/4/`]: [200, '{'],
    }),
  );
  const k = rb.createRebrickable(clientsAccess());
  const farben = await k.getBrickColors();
  assert.deepEqual(farben[1], { id: 15, name: 'White', hex: 'FFFFFF' });
  assert.equal(await k.getBrickColors(), farben);
  assert.equal(stub.calls.filter(c => c.path.startsWith(`${API}/colors/`)).length, 1);
  assert.deepEqual(await k.lookupPart('3001', 15), {
    part_name: 'Brick 2 x 4',
    category_name: '11',
    image_url: 'https://cdn.rebrickable.com/media/parts/3001-15.png',
  });
  // Broken color answer: the part image stays.
  assert.equal((await k.lookupPart('3001', 4)).image_url, 'https://cdn.rebrickable.com/media/parts/3001.png');
  assert.equal((await k.lookupPart('3001', null)).image_url, 'https://cdn.rebrickable.com/media/parts/3001.png');
  assert.equal(await k.lookupPart('9999', 15), null);
  const ohne = rb.createRebrickable(clientsAccess({ keys: { rebrickable_api_key: '' } }));
  assert.deepEqual([await ohne.getBrickColors(), await ohne.lookupPart('3001')], [[], null]);
});

test('BrickLink → Rebrickable: only a proven number', async t => {
  await httpsStub(
    t,
    byPath({
      [`${API}/parts/973/`]: [200, fixture('rebrickable-part-973.json')],
      [`${API}/parts/970/`]: [200, { part_num: '970', external_ids: { BrickLink: ['anders'] } }],
      [`${API}/parts/`]: (c, res) =>
        c.path.includes('bricklink_id=970')
          ? reply(res, 200, fixture('rebrickable-part-filter.json'))
          : c.path.includes('bricklink_id=leer')
            ? reply(res, 404, { detail: 'Not found.' })
            : reply(res, 200, { count: 50000, next: null, results: [] }),
    }),
  );
  const k = rb.createRebrickable(clientsAccess());
  assert.equal(await k.blPartToRb('973'), '973c00');
  assert.equal(await k.blPartToRb('970'), '970c00');
  assert.equal(await k.blPartToRb('leer'), null);
  assert.equal(k.blFilterIneffective(), false);
  // More than a thousand hits: the filter was ignored, and the client stops asking it.
  assert.equal(await k.blPartToRb('3001'), null);
  assert.equal(k.blFilterIneffective(), true);
  assert.equal(await k.blPartToRb('970'), null);
  assert.equal(rb.firstBlNumber({ BrickLink: ['973', '973a'] }), '973');
  assert.equal(rb.firstBlNumber(null), null);
});

test('the instruction scrape takes only PDF links of LEGO and Rebrickable, each once', async t => {
  const stub = await httpsStub(
    t,
    byPath({
      '/sets/10294-1/': [200, fixture('rebrickable-set-page.html'), { 'content-type': 'text/html' }],
    }),
  );
  const k = rb.createRebrickable(clientsAccess());
  assert.deepEqual(await k.scrapeInstructions('10294'), [
    {
      url: 'https://www.lego.com/cdn/product-assets/product.bi.core.pdf/6420974.pdf',
      description: 'Anleitung 10294-1',
    },
    { url: 'https://cdn.rebrickable.com/media/instructions/10294-1-b2.pdf', description: 'Anleitung 10294-1' },
  ]);
  assert.deepEqual(await k.scrapeInstructions('fehlt-1'), []);
  assert.equal(stub.calls[0].headers.authorization, undefined, 'the web page gets no key');
});

test('a dropped connection is retried, the third drop is thrown', async t => {
  let n = 0;
  const stub = await httpsStub(t, (_c, res) => (n++ < 1 ? res.socket?.destroy() : reply(res, 200, '{"ok":1}')));
  const k = rb.createRebrickable(clientsAccess());
  const r = await k.httpsGetRobust('https://rebrickable.com/api/v3/x/', {}, 5000);
  assert.deepEqual([r.status, r.body], [200, '{"ok":1}']);
  assert.equal(stub.calls.length, 2);
  n = -10;
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  const lauf = k.httpsGetRobust('https://rebrickable.com/api/v3/x/', {}, 5000);
  const erwartet = assert.rejects(lauf, (/** @type {any} */ err) => err.isTransient === true);
  while (stub.calls.length < 5) {
    await new Promise(r => setImmediate(r));
    mock.timers.tick(1500);
  }
  await erwartet;
});

test('a hanging Rebrickable ends at the deadline: null for rebrickableJson', async t => {
  const stub = await httpsStub(t, () => {});
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  const lauf = rb.createRebrickable(clientsAccess()).rebrickableJson('/lego/sets/10294-1/', RbSet);
  let fertig = false;
  void lauf.then(() => {
    fertig = true;
  });
  // Three attempts of 8 s, between them 1.5 s; the clock only moves once a request is out.
  await stub.nextCall();
  while (!fertig) {
    mock.timers.tick(8000);
    await new Promise(r => setImmediate(r));
    mock.timers.tick(1500);
    await new Promise(r => setImmediate(r));
  }
  assert.equal(await lauf, null);
  assert.ok(stub.calls.length >= 1 && stub.calls.length <= 3, `${stub.calls.length} requests`);
});

test('rebrickableRaw: no retry, a network error is status 0', async t => {
  let n = 0;
  await httpsStub(t, (_c, res) => (n++ === 0 ? reply(res, 429, 'langsam') : res.socket?.destroy()));
  assert.deepEqual(await rb.rebrickableRaw('https://rebrickable.com/api/v3/lego/sets/', 'k'), {
    status: 429,
    body: 'langsam',
  });
  assert.deepEqual(await rb.rebrickableRaw('https://rebrickable.com/api/v3/lego/sets/', 'k'), { status: 0, body: '' });
  assert.deepEqual(await rb.rebrickableRaw('https://example.org/', 'k'), { status: 0, body: '' });
});

test('downloads: only allowed hosts, only complete files with the right start', async t => {
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(200, 0x41)]);
  await httpsStub(
    t,
    byPath({
      '/media/instructions/ok.pdf': [200, pdf],
      '/media/instructions/klein.pdf': [200, Buffer.from('%PDF-')],
      '/media/instructions/falsch.pdf': [200, Buffer.alloc(200, 0x42)],
      '/media/instructions/fehlt.pdf': [404, ''],
      '/media/instructions/gross.pdf': [200, Buffer.alloc(5000, 0x41)],
    }),
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-download-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ziel = n => path.join(dir, 'unter', n);
  const PDF = Buffer.from('%PDF-');
  const cdn = n => `https://cdn.rebrickable.com/media/instructions/${n}`;
  assert.equal(await rb.downloadFile(cdn('ok.pdf'), ziel('ok.pdf'), undefined, PDF), true);
  assert.deepEqual(fs.readFileSync(ziel('ok.pdf')), pdf);
  assert.equal(await rb.downloadFile(cdn('ok.pdf'), ziel('ok.pdf')), true, 'already there');
  for (const [n, max] of /** @type {[string, number | undefined][]} */ ([
    ['klein.pdf', undefined],
    ['falsch.pdf', undefined],
    ['fehlt.pdf', undefined],
    ['gross.pdf', 1000],
  ])) {
    assert.equal(await rb.downloadFile(cdn(n), ziel(n), max, PDF), false, n);
    assert.equal(fs.existsSync(ziel(n)), false, `${n} stays behind`);
  }
  assert.equal(await rb.downloadFile('https://example.org/x.pdf', ziel('fremd.pdf')), false);
});
