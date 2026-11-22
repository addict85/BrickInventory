/**
 * Capturing a set: the progress dialog of the real bundle (jsdom) reads the event stream of the
 * real server (testServer, test DB). When the stream ends, no step still shows “active”, and every
 * step in the dialog was reached.
 *
 * Counter-checks (22.11.2026, each alone):
 *   A  handleSseEvent: case 'done_meta' without setStep('image', 'done') → red (ps-image stays active)
 *   B  the route no longer sends the step 'image' → red (ps-image never reached)
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testImageWorker, testSources } = require('./helpers/sources');
const _req = buildAndRequire();
testImageWorker(null, { loadSetImage: async () => null, createPreview: async () => true });
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { catalogSet } = require('./helpers/inventory');

test('after the stream no step of the progress dialog hangs on active', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const SN = `9${process.pid % 100000}-1`;
  const name = `asp-${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [name]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified) VALUES ($1,'x',true,true) RETURNING id`,
      [name],
    )
  ).id;
  await catalogSet(db, SN, { name: 'Probe' });
  // Rebrickable and Brickset at the wiring: the catalog has no image yet, so the stream fetches it.
  testSources(t, {
    holeSet: async n => ({ set_num: n, name: 'Probe', year: 2020, theme_id: 1, num_parts: 10, set_img_url: null }),
    getThemeName: async () => 'City',
    brickset: { setDetails: async () => null },
  });
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const { base } = testServer(_req, { sitzung: { userId: uid, username: name }, t });
  const events = [];
  const { openUi, warte } = require('./helpers/ui');
  const { w, d } = await openUi(
    {
      [`/v2/sets/${SN}`]: { success: false, error: 'nicht gefunden', code: 'set_not_found', $status: 404 },
      [`/v2/catalog/sets/${SN}`]: { success: true, set: { set_number: SN, name: 'Probe' } },
    },
    {
      before: win => {
        const fake = win.fetch;
        // Only the capture stream goes to the real server; everything else stays the fixed answers.
        win.fetch = (url, o = {}) =>
          String(url).includes('/v2/sets/add-stream')
            ? fetch(`${base}/api/v2/sets/add-stream`, { method: 'POST', headers: o.headers, body: o.body }).then(r => {
                const [a, b] = r.body.tee();
                readAll(b);
                return new Response(a, { status: r.status, headers: r.headers });
              })
            : fake(url, o);
      },
    },
  );
  async function readAll(stream) {
    const text = await new Response(stream).text();
    for (const l of text.split('\n')) if (l.startsWith('data: ')) events.push(JSON.parse(l.slice(6)).step);
  }
  try {
    d.getElementById('add-num').value = SN;
    d.getElementById('btn-add').click();
    assert.ok(await warte(() => events.includes('done'), 10000), `the stream did not finish: ${events.join(', ')}`);
    await warte(() => false, 50);
    const steps = [...d.querySelectorAll('.prog-step')];
    assert.ok(steps.length >= 2, 'the dialog has no steps');
    const state = steps.map(s => [s.id, ['active', 'done', 'err'].find(c => s.classList.contains(c)) ?? 'untouched']);
    assert.deepEqual(
      state.filter(([, z]) => z !== 'done'),
      [],
      `events ${events.join(', ')}; steps ${JSON.stringify(state)}`,
    );
  } finally {
    w.close();
  }
});
