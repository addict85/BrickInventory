/**
 * Daily limit for Rebrickable API calls.
 *
 * Counter-check: REBRICKABLE_DEFAULT_DAILY in src/externalSources/apiQuota.ts set to 4000 → red “default daily limit is 25000 — in ONE place”.
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

test('the daily quota counts for the installation, not per worker', () => {
  // Where this test comes from
  const rl = fs.readFileSync(path.join(ROOT, 'src/externalSources/rateLimiter.ts'), 'utf8');
  assert.match(rl, /async function consumeRebrickableDaily/, 'Consumption must go through the shared counter');
  assert.match(
    rl,
    /checkAndCountQuota\((?:\s*(?:kx?|sk|t)(?:: \w+)?(?:,\s*|(?=\s*\))))?'rebrickable'\)/,
    'Derselbe Mechanismus wie bei BrickLink und Brickset — kein dritter Weg',
  );
  assert.doesNotMatch(rl, /new DailyLimiter\(/, 'Keine prozesslokale Instanz mehr für ein Tagesbudget');

  // All call sites go via the shared path.
  for (const datei of [
    'clients/rebrickable.ts',
    'src/catalog/partsImport.ts',
    'src/sets/barcode.ts',
    'src/catalog/partsEnrichment.ts',
    'src/catalog/csvSync.ts',
  ]) {
    const src = fs.readFileSync(path.join(ROOT, datei), 'utf8');
    assert.doesNotMatch(src, /rebrickableDailyLimiter/, `${datei}: still counts past the shared counter`);
  }

  // And the reloading at startup is gone — the limit is read on every
  // call instead of being copied into a process memory.
  // Comments out: the note at the old place still names the name
  // (it explains why nothing stands there any more) — without hiding it …
  const server = require('./helpers/sources')
    .serverAll()
    .replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(server, /loadDailyLimitsFromDb\(\)/, 'An in-memory limit no longer needs to be loaded');
});

test('a changed limit applies immediately in ALL workers', () => {
  // Before: PUT /api/v2/admin/api-limits called setMax() — that only applied in the
  // worker that handled the request. The others kept running with the old value
  // until a restart, and at startup
  // loadDailyLimitsFromDb() had to copy the value into every process.
  const admin = fs.readFileSync(path.join(ROOT, 'routes/api/admin.ts'), 'utf8').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(admin, /setMax\(/, 'setMax() erreicht nur den eigenen Prozess');
  // Comments out before the span is measured: the explanatory block in
  // limitTheSource is longer than any reasonable character window, and a
  // test that fails on a growing comment checks the wrong thing.
  const fc = fs.readFileSync(path.join(ROOT, 'src/externalSources/apiQuota.ts'), 'utf8').replace(/\/\/[^\n]*/g, '');
  const fn = fc.slice(fc.indexOf('async function limitTheSource'), fc.indexOf('const limitJeAccount'));
  assert.match(
    fn,
    /await k\.settings\.globalValue\(`api_limit_\$\{apiName\}`(?:, '')?\)/,
    'The limit must be read on every call, not come from process memory',
  );
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

test('the input field shows the same default', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const field = html.slice(html.indexOf('id="lim-rb"') - 400, html.indexOf('id="lim-rb"') + 200);
  assert.match(field, new RegExp(`value="${EXPECTED}"`), 'value of the field #lim-rb does not match the default');
  assert.match(field, new RegExp(`"n":"${EXPECTED}"`), 'The hint "(Standard: …)" does not match the default');
});

// ── Point 3: counters in the database ───────────────────────────────────────

test('the login counters are no longer in process memory', () => {
  // src/throttle writes the counters (owner of rate_limit_attempts), the login calls k.throttle.
  const src = fs.readFileSync(path.join(ROOT, 'src/throttle/repository.ts'), 'utf8');
  assert.match(src, /rate_limit_attempts/, 'With N cluster workers 5 failed attempts otherwise become N×5');
  assert.match(
    src,
    /ON CONFLICT \(key\) DO UPDATE/,
    'Incrementing must happen atomically in one statement, otherwise parallel attempts read the same state',
  );
  assert.match(
    src,
    /CASE WHEN rate_limit_attempts\.first_at < NOW\(\)/,
    'An expired window must restart in the same statement',
  );
});

test('on DB outage the fallback kicks in', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/throttle/counter.ts'), 'utf8');
  for (const fn of ['counterState', 'countAttempt', 'forgetCounter']) {
    const body = src.slice(src.indexOf(`async function ${fn}(`), src.indexOf(`async function ${fn}(`) + 900);
    // The fallback reports itself (inMemory); the name of the error variable does not count.
    assert.match(
      body,
      /catch \(\w+\) \{\s*inMemory\(/,
      `${fn}: ohne Rückfall wäre der Login bei DB-Problemen komplett blockiert`,
    );
  }
  assert.match(src, /entries: new Map/, 'in-memory fallback is missing');
});

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
