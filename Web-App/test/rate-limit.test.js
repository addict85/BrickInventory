/**
 * Daily limit for Rebrickable API calls.
 *
 * Counter-check: REBRICKABLE_DEFAULT_DAILY in src/externalSources/apiQuota.ts set to 4000 → red “default daily limit is 25000 — in ONE place”.
 * Counter-check (22.11.2026): value="4000" on #lim-rb in index.html → red “the input field shows the same default”.
 * Shared counters and limits across workers: rate-limit-shared-db.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// Build into dist/ instead of in place — see helpers/sources.js.
const _req = require('./helpers/sources').buildAndRequire();
const { ohneKommentare } = require('./helpers/sources');
const { REBRICKABLE_DEFAULT_DAILY } = _req('src/externalSources/rateLimiter.js');

const EXPECTED = 25000;

test('default daily limit is 25000 — in ONE place', () => {
  assert.equal(REBRICKABLE_DEFAULT_DAILY, EXPECTED);
  // limitTheSource() had its own copy of the fallback value (4000). As long as
  // Rebrickable had its own counter, it never saw this table — since
  // both run via checkAndCountQuota, it would have been a silent cut
  // to one sixth. Two constants with the same meaning drift …
  const fc = fs.readFileSync(path.join(ROOT, 'src/externalSources/apiQuota.ts'), 'utf8');
  assert.match(
    fc,
    /rebrickable: REBRICKABLE_DEFAULT_DAILY/,
    'The fallback value must be the shared constant, not a separate number next to it',
  );
  assert.doesNotMatch(fc, /rebrickable: \d+/, 'No second number for the same limit');
});

test('no more hard-coded limit numbers in messages and labels', () => {
  // Location since an earlier round: clients/rebrickable.ts. The file contains not a
  // single route and was never mounted as a router — it only lay in routes/
  // out of habit. The statement of this check is unchanged.
  const rb = fs.readFileSync(path.join(ROOT, 'clients/rebrickable.ts'), 'utf8');
  const messages = [...rb.matchAll(/Tageslimit[^`'"]*\((\d+)\/Tag\)/g)].map(m => m[1]);
  assert.deepEqual(
    messages,
    [],
    `Fest eingetragene Limits in Fehlermeldungen: ${messages.join(', ')} — stattdessen status.max verwenden`,
  );

  const i18n = require('./helpers/sources').i18nAll();
  for (const key of ['monitor.api.rebrickable', 'monitor.api.bricklink', 'monitor.api.brickset']) {
    const vals = [
      ...i18n.matchAll(new RegExp(`'${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}':\\s*'([^']*)'`, 'g')),
    ].map(m => m[1]);
    assert.ok(vals.length > 0, `${key} is missing in i18n.js`);
    for (const v of vals) {
      assert.doesNotMatch(
        v,
        /\d+\s*\/\s*(Tag|day)/,
        `${key} = "${v}" — the number is already in the value above and becomes wrong here on every change`,
      );
    }
  }
});

test('the input field shows the same default', async () => {
  // Before the server's limits arrive, the field and its hint show the default the server applies.
  const { openUi } = require('./helpers/ui');
  const { w, d } = await openUi();
  try {
    assert.equal(d.getElementById('lim-rb').value, String(REBRICKABLE_DEFAULT_DAILY));
    const label = d.querySelector('label[for="lim-rb"]').textContent;
    assert.ok(label.includes(String(REBRICKABLE_DEFAULT_DAILY)), label);
  } finally {
    w.close();
  }
});

// ── Point 3: counters in the database ───────────────────────────────────────

test('the call sites wait for the result', () => {
  // loginAllowed is asynchronous since the switch — a forgotten
  // await delivers a promise that is always truthy and locks EVERY login.
  const dateien = dir =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? dateien(p) : e.name.endsWith('.ts') ? [p] : [];
    });
  const alle = [
    ...dateien(path.join(ROOT, 'routes')),
    ...dateien(path.join(ROOT, 'src')),
    path.join(ROOT, 'server.ts'),
  ];

  const withoutAwait = [];
  let found = 0;
  for (const datei of alle) {
    const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    for (const m of src.matchAll(/\b(loginAllowed|loginFailed|loginSucceeded)\s*\(/g)) {
      // Look at the line itself — an `await` in front suffices. Import and
      // definition are not calls and do not count.
      const rowsStart = src.lastIndexOf('\n', m.index) + 1;
      const row = src.slice(rowsStart, src.indexOf('\n', m.index));
      if (/^\s*(import|export)\b/.test(row) || /\bfunction\s+\w+\s*\(/.test(row)) continue;
      found++;
      if (!new RegExp(`await\\s+${m[1]}\\s*\\(`).test(row))
        withoutAwait.push(`${path.relative(ROOT, datei)}: ${row.trim()}`);
    }
  }
  // Self-proof: if the pattern finds nothing, the list would be empty and the test
  // green without having checked anything.
  assert.ok(found >= 3, `only ${found} calls of the login counter found — pattern outdated?`);
  assert.deepEqual(
    withoutAwait,
    [],
    'These calls do not await the login counter:\n  ' +
      withoutAwait.join('\n  ') +
      '\nA promise is always truthy — without await loginAllowed blocks EVERY login.',
  );
});

test('jobs with an external quota have a cross-process lock', () => {
  // Where this test comes from
  const job = (
    fs.readFileSync(path.join(ROOT, 'src/finances/priceRun.ts'), 'utf8') +
    fs.readFileSync(path.join(ROOT, 'db/txLock.ts'), 'utf8')
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  assert.match(job, /pg_try_advisory_lock/, 'Without a cross-process lock state.running only protects its own worker');
  // Own connection, not transaction-bound: the run takes minutes.
  assert.match(job, /(?:db|access)\.pool\.connect\(\)/, 'The lock must be held for the whole run — own connection');
  assert.doesNotMatch(
    job,
    /pg_try_advisory_xact_lock/,
    'Keeping a transaction open for minutes would be the wrong way',
  );
  // Release in finally — otherwise a crashed run blocks all following ones.
  const fn = job.slice(job.indexOf('async function runPriceRefresh'), job.indexOf('async function rememberStatus'));
  assert.match(
    fn,
    /finally\s*\{[\s\S]{0,300}releaseLock\(\)/,
    'Ohne Freigabe im finally sperrt ein Absturz den Job bis zum Neustart',
  );

  // The manual kick only brings the scheduled job forward (src/jobQueue/schedule.ts);
  // if it already runs, pullPlanBefore reports false instead of a second run.

  // And the callers must await the result.
  //
  // The manual kick lies only under /api/v2/admin/trigger-price-job, the
  // web app calls the same address: with two paths one can lose the `await`
  // without it standing out.
  const route = fs.readFileSync(path.join(ROOT, 'routes/api/admin.ts'), 'utf8');
  assert.match(
    route,
    /await d\.management\.runPriceJobNow\(\)/,
    'routes/api/admin.ts: without await the route reports a promise as „gestartet“',
  );

  // The namespace comes from the shared list.
  assert.match(job, /LOCKS\.PRICE_JOB/, 'The namespace belongs in src/infra/lockNamespaces.ts, not typed in');
});
