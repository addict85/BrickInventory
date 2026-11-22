/**
 * The Brickset client (clients/brickset.ts) against a local HTTPS stub with fixtures: hits,
 * quota (daily limit, 429, Cloudflare 1015), 5xx, broken JSON, connection drop and timeout,
 * and what each of them does with the resubmission queue.
 *
 * Counter-checks (measured 22.11.2026, each alone):
 *   A  in getInstructions() the 429 line before the status branch removed → red: “Cloudflare 1015
 *      is passed on …” (before 22.11.2026 a 429 there meant fallback and the set left the queue)
 *   B  in getInstructions() `status >= 500` → `status >= 600` → red: “a 5xx queues soon …”
 *   C  in httpsGet() MAX_ATTEMPTS = 1 → red: “a dropped connection is tried twice …”
 *   D  in parseResponse() the quota message no longer recognised → red: “the daily limit in the body …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');

const _req = require('./helpers/sources').buildAndRequire();
const { httpsStub, reply, fixture, clientsAccess } = require('./helpers/https-stub');
const { createBrickset } = _req('clients/brickset.js');

/** One answer per call, in order; the last one repeats. */
const nacheinander =
  (...antworten) =>
  (_c, res) => {
    const a = antworten.length > 1 ? antworten.shift() : antworten[0];
    if (a === 'abbruch') res.socket?.destroy();
    else if (a !== 'haengt') reply(res, ...a);
  };

test('setDetails: a hit with image, the set leaves the queue', async t => {
  const stub = await httpsStub(t, nacheinander([200, fixture('brickset-set.json')]));
  const z = clientsAccess();
  const r = await createBrickset(z).setDetails('10294');
  assert.deepEqual(r, {
    name: 'Titanic',
    year: 2021,
    theme: 'Icons',
    pieces: 9090,
    minifigs: null,
    image_url: 'https://images.brickset.com/sets/images/10294-1.jpg',
  });
  assert.deepEqual(z.seen.forgotten, ['10294-1']);
  const url = new URL(`https://brickset.com${stub.calls[0].path}`);
  assert.equal(stub.calls[0].host, 'brickset.com');
  assert.equal(url.pathname, '/api/v3.asmx/getSets');
  assert.equal(url.searchParams.get('apiKey'), 'bs-key');
  assert.deepEqual(JSON.parse(url.searchParams.get('params') ?? ''), { setNumber: '10294-1', pageSize: 1 });
});

test('setDetails without key or without quota asks nothing', async t => {
  const stub = await httpsStub(t, nacheinander([200, fixture('brickset-set.json')]));
  assert.equal(await createBrickset(clientsAccess({ keys: { brickset_api_key: '' } })).setDetails('10294-1'), null);
  const z = clientsAccess({ allowed: false });
  assert.equal(await createBrickset(z).setDetails('10294-1'), null);
  assert.equal(stub.calls.length, 0);
  assert.match(z.seen.reserved[0]?.error ?? '', /Tageslimit erreicht \(7\/100 Aufrufe\)/);
});

test('the daily limit in the body and a 429 queue the set for tomorrow', async t => {
  await httpsStub(t, nacheinander([200, fixture('brickset-quota.json')], [429, 'Too Many Requests']));
  const z = clientsAccess();
  const bs = createBrickset(z);
  assert.equal(await bs.setDetails('10294-1'), null);
  assert.equal(await bs.setDetails('10295-1'), null);
  assert.deepEqual(
    z.seen.reserved.map(r => [r.setNumber, r.soon]),
    [
      ['10294-1', false],
      ['10295-1', false],
    ],
  );
  assert.match(z.seen.reserved[0].error, /Daily API key usage limit exceeded/);
});

test('Cloudflare 1015 is passed on to the instruction queue; a plain 429 queues', async t => {
  await httpsStub(t, nacheinander([429, 'error code: 1015'], [429, 'Too Many Requests'], [429, 'error code: 1015']));
  const z = clientsAccess();
  await assert.rejects(createBrickset(z).getInstructions('10294-1'), err => err.isCloudflare === true);
  assert.deepEqual(await createBrickset(z).getInstructions('10294-1'), { instructions: [], usesFallback: false });
  assert.match(z.seen.reserved[0]?.error ?? '', /Quota exceeded: Daily API key usage limit exceeded/);
  // In setDetails the block is no quota: the set leaves the queue, the fallback applies.
  assert.equal(await createBrickset(z).setDetails('10294-1'), null);
  assert.deepEqual(z.seen.forgotten, ['10294-1']);
});

test('getInstructions: hits, none, and a 5xx queues soon instead of the fallback', async t => {
  await httpsStub(
    t,
    nacheinander(
      [200, fixture('brickset-instructions.json')],
      [200, { status: 'success', matches: 0, instructions: [] }],
      [503, '<h1>Service Unavailable</h1>'],
      [404, 'nicht da'],
    ),
  );
  const z = clientsAccess();
  const bs = createBrickset(z);
  assert.deepEqual(await bs.getInstructions('10294-1'), {
    instructions: [
      { url: 'https://www.lego.com/biassets/bi/6420974.pdf', description: 'BOOK 1/3' },
      { url: 'https://www.lego.com/biassets/bi/6420975.pdf', description: 'BOOK 2/3' },
    ],
    usesFallback: false,
  });
  assert.deepEqual(await bs.getInstructions('10294-1'), { instructions: [], usesFallback: true });
  assert.deepEqual(await bs.getInstructions('10294-1'), { instructions: [], usesFallback: false });
  assert.deepEqual(z.seen.reserved.at(-1), {
    setNumber: '10294-1',
    error: 'HTTP 503: <h1>Service Unavailable</h1>',
    soon: true,
  });
  assert.deepEqual(await bs.getInstructions('10294-1'), { instructions: [], usesFallback: true });
  assert.deepEqual(z.seen.forgotten, ['10294-1']);
});

test('getInstructions: quota queues; a full queue means fallback', async t => {
  await httpsStub(t, nacheinander([200, fixture('brickset-quota.json')]));
  assert.deepEqual(await createBrickset(clientsAccess()).getInstructions('10294-1'), {
    instructions: [],
    usesFallback: false,
  });
  assert.deepEqual(await createBrickset(clientsAccess({ queued: false })).getInstructions('10294-1'), {
    instructions: [],
    usesFallback: true,
  });
  assert.deepEqual(await createBrickset(clientsAccess({ allowed: false })).getInstructions('10294-1'), {
    instructions: [],
    usesFallback: false,
  });
  assert.deepEqual(await createBrickset(clientsAccess({ keys: { brickset_api_key: '' } })).getInstructions('1-1'), {
    instructions: [],
    usesFallback: true,
  });
});

test('broken JSON and an API error take the set out of the queue', async t => {
  await httpsStub(t, nacheinander([200, '{"status": "succ'], [200, fixture('brickset-error.json')]));
  const z = clientsAccess();
  const bs = createBrickset(z);
  assert.equal(await bs.setDetails('10294-1'), null);
  assert.deepEqual(await bs.getInstructions('10294-1'), { instructions: [], usesFallback: true });
  assert.deepEqual(z.seen.forgotten, ['10294-1', '10294-1']);
  assert.deepEqual(z.seen.reserved, []);
});

test('a dropped connection is tried twice, then queued soon', async t => {
  const stub = await httpsStub(t, nacheinander('abbruch'));
  const z = clientsAccess();
  assert.equal(await createBrickset(z).setDetails('10294-1'), null);
  assert.equal(stub.calls.length, 2);
  assert.deepEqual(
    z.seen.reserved.map(r => [r.setNumber, r.soon]),
    [['10294-1', true]],
  );
});

test('a hanging Brickset ends at the deadline and stays queued', async t => {
  const stub = await httpsStub(t, nacheinander('haengt'));
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  const z = clientsAccess();
  const lauf = createBrickset(z).getInstructions('10294-1');
  let fertig = false;
  void lauf.then(() => {
    fertig = true;
  });
  // Two attempts of 30 s, between them the light retry of 1.5 s.
  await stub.nextCall();
  while (!fertig) {
    mock.timers.tick(30_000);
    await new Promise(r => setImmediate(r));
    mock.timers.tick(1500);
    await new Promise(r => setImmediate(r));
  }
  assert.deepEqual(await lauf, { instructions: [], usesFallback: false });
  assert.match(z.seen.reserved[0]?.error ?? '', /Zeitlimit 30000 ms/);
});

test('search by EAN and barcode', async t => {
  await httpsStub(
    t,
    nacheinander(
      [200, fixture('brickset-set.json')],
      [200, fixture('brickset-empty.json')],
      [200, fixture('brickset-quota.json')],
      [502, 'Bad Gateway'],
      [200, 'kaputt'],
    ),
  );
  const bs = createBrickset(clientsAccess());
  assert.deepEqual(await bs.getSetByEan('5702016914313'), {
    set_number: '10294-1',
    name: 'Titanic',
    year: 2021,
    theme: 'Icons',
    pieces: 9090,
    image_url: 'https://images.brickset.com/sets/images/10294-1.jpg',
  });
  for (let i = 0; i < 4; i++) assert.equal(await bs.getSetByBarcode('123'), null);
  assert.equal(await createBrickset(clientsAccess({ keys: { brickset_api_key: '' } })).getSetByEan('1'), null);
});

test('checking the key', async t => {
  await httpsStub(t, nacheinander([200, fixture('brickset-key-ok.json')], [500, 'x'], [200, 'kein json']));
  const bs = createBrickset(clientsAccess());
  await bs.checkBricksetAccess();
  await assert.rejects(bs.checkBricksetAccess(), /Brickset HTTP 500/);
  await assert.rejects(bs.checkBricksetAccess(), /Brickset: invalid JSON response: kein json/);
  await assert.rejects(
    createBrickset(clientsAccess({ keys: { brickset_api_key: '' } })).checkBricksetAccess(),
    /nicht konfiguriert/,
  );
  const z = clientsAccess();
  await createBrickset(z).fromRetryQueue('10294-1');
  assert.deepEqual(z.seen.forgotten, ['10294-1']);
});
