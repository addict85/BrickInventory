/**
 * Two assurances that the switch to Express 5 would have silently cost.
 *
 * ── Counter-checks (performed, result in the commit) ────────────────────────
 *   a) pattern turned back to '/*splat' → step 1 red, names the 404
 *   b) the assurance removed from server.ts → step 2 red
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { serverAll, ohneKommentare } = require('./helpers/sources');
const { portOf } = require('./helpers/server');

test('1. the start page is reachable even without a path', async () => {
  const src = serverAll();

  // Find the catch-all by its TASK, not by its pattern: it is
  // the app.get registration that delivers startPageHtml(). If the
  // search hung on the pattern, it would have to be maintained on every rename —
  // and then at some point it checks the spelling instead of the matter. …
  const kandidaten = [];
  for (const m of src.matchAll(/^\s*app\.get\('([^']+)'/gm)) {
    if (/startPageHtml|sendStartPage/.test(src.slice(m.index, m.index + 800))) kandidaten.push(m[1]);
  }
  assert.ok(kandidaten.length, 'No route renders index.html anymore — search outdated?');
  const muster = kandidaten.find(k => k.includes('*'));
  assert.ok(
    muster,
    `None of the rendering routes (${kandidaten.join(', ')}) catches everything anymore. ` +
      'Then there is no SPA catch-all anymore.',
  );

  // The same pattern on an empty Express: what the real route delivers
  // does not matter here — the only question is WHETHER it matches.
  const app = express();
  app.get(muster, (_req, res) => res.status(200).send('ok'));
  const srv = app.listen(0);
  await new Promise(r => srv.once('listening', r));
  const basis = `http://localhost:${portOf(srv)}`;
  try {
    const wurzel = await fetch(`${basis}/`);
    assert.equal(
      wurzel.status,
      200,
      `The pattern ${muster} does not match the bare root (${wurzel.status}). ` +
        'Then every call of the page without a path — bookmarks, ' +
        'home screen, first visit — runs into nothing.',
    );
    // And the paths below still; otherwise one could calm the rule with
    // a pattern that ONLY matches the root.
    for (const path of ['/start', '/tief/drin', '/reset-password']) {
      assert.equal((await fetch(basis + path)).status, 200, `The pattern ${muster} no longer matches ${path}`);
    }
  } finally {
    await new Promise(r => srv.close(r));
  }
});

test('2. req.body is always an object, even without a matching parser', async () => {
  // First the NEED: does the assumption still hold at all? If Express
  // one day falls back to `{}` by itself again, this rule should not
  // silently demand an assurance nobody needs anymore — then it shows
  // up here.
  const blank = express();
  blank.use(express.json());
  blank.use(express.urlencoded({ extended: true }));
  blank.post('/a', (req, res) => res.json({ fehlt: req.body === undefined }));
  const s1 = blank.listen(0);
  await new Promise(r => s1.once('listening', r));
  let withoutAssertion;
  try {
    withoutAssertion = (await (await fetch(`http://localhost:${portOf(s1)}/a`, { method: 'POST' })).json()).fehlt;
  } finally {
    await new Promise(r => s1.close(r));
  }
  assert.equal(
    withoutAssertion,
    true,
    'Express delivers an object again without the assertion — then the line ' +
      'in server.ts has become superfluous and may go (together with this rule).',
  );

  // And now the assurance itself. It is read without comments: the
  // explanation block above names `req.body` plenty, a mere indexOf
  // would thus be satisfied forever.
  // Since 04.11.2026 in readBody: the bodies are only read after login.
  const code = ohneKommentare(fs.readFileSync(path.join(__dirname, '..', 'routes', 'api', 'middleware.ts'), 'utf8'));
  assert.match(
    code,
    /req\.body === undefined.*req\.body = \{\}/,
    'readBody lacks the assertion that req.body is an object. ' +
      'Without it fourteen handlers answer with 500 instead of their own 400 ' +
      'as soon as a client forgets the Content-Type.',
  );

  // It must stand AFTER the parsers — before them it would achieve nothing, because the
  // parser overwrites afterwards.
  const nachParser = code.indexOf('req.body === undefined');
  const atJson = code.indexOf('express.json(');
  assert.ok(atJson >= 0 && nachParser > atJson, 'The assertion comes before the parsers — there it has no effect.');
});

/**
 * The start page goes through the renderer — not past it.
 *
 * Counter-check: `index: false` removed → this case red (read without comments).
 */
test('3. the start page goes through the renderer', () => {
  // WITHOUT COMMENTS, and that is not decoration: the explanatory comment above the
  // option names `index: false` itself. The first version read the source text
  // including comments — MEASURED, the counter-check therefore stayed green although
  // the option was removed. A check that reads its own rationale
  // confirms itself.
  const src = ohneKommentare(serverAll());
  const auf = src.indexOf('express.static(PUBLIC_DIR');
  assert.ok(auf > 0, 'The static delivery can no longer be found.');
  const block = src.slice(auf, src.indexOf('}));', auf));
  assert.match(
    block,
    /index:\s*false/,
    'express.static serves index.html for `/` by itself again. Then ' +
      'the start page bypasses the renderer: no server-side data-theme ' +
      '(visible design jump on the first call) and no file stamp on ' +
      'the assets (the browser keeps its old copies).',
  );
});
