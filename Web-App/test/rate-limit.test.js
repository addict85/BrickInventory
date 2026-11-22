/**
 * Daily limit for Rebrickable API calls.
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
    'Der Rückfallwert muss die gemeinsame Konstante sein, nicht eine eigene Zahl danebenstehen',
  );
  assert.doesNotMatch(fc, /rebrickable: \d+/, 'Keine zweite Zahl für dasselbe Limit');
});

test('the daily quota counts for the installation, not per worker', () => {
  // Where this test comes from
  const rl = fs.readFileSync(path.join(ROOT, 'src/externalSources/rateLimiter.ts'), 'utf8');
  assert.match(rl, /async function consumeRebrickableDaily/, 'Der Verbrauch muss über den gemeinsamen Zähler laufen');
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
    assert.doesNotMatch(src, /rebrickableDailyLimiter/, `${datei}: zählt noch am gemeinsamen Zähler vorbei`);
  }

  // And the reloading at startup is gone — the limit is read on every
  // call instead of being copied into a process memory.
  // Comments out: the note at the old place still names the name
  // (it explains why nothing stands there any more) — without hiding it …
  const server = require('./helpers/sources')
    .serverAll()
    .replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(server, /loadDailyLimitsFromDb\(\)/, 'Ein In-Memory-Limit muss nicht mehr geladen werden');
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
    'Die Grenze muss bei jedem Aufruf gelesen werden, nicht aus dem Prozessspeicher kommen',
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
    assert.ok(vals.length > 0, `${key} fehlt in i18n.js`);
    for (const v of vals) {
      assert.doesNotMatch(
        v,
        /\d+\s*\/\s*(Tag|day)/,
        `${key} = "${v}" — die Zahl steht schon im Wert darüber und wird hier bei jeder Änderung falsch`,
      );
    }
  }
});

test('the input field shows the same default', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const field = html.slice(html.indexOf('id="lim-rb"') - 400, html.indexOf('id="lim-rb"') + 200);
  assert.match(field, new RegExp(`value="${EXPECTED}"`), 'value des Felds #lim-rb passt nicht zum Standard');
  assert.match(field, new RegExp(`"n":"${EXPECTED}"`), 'Der Hinweis "(Standard: …)" passt nicht zum Standard');
});

// ── Point 3: counters in the database ───────────────────────────────────────

test('the login counters are no longer in process memory', () => {
  // src/throttle writes the counters (owner of rate_limit_attempts), the login calls k.throttle.
  const src = fs.readFileSync(path.join(ROOT, 'src/throttle/repository.ts'), 'utf8');
  assert.match(src, /rate_limit_attempts/, 'Bei N Cluster-Workern werden aus 5 Fehlversuchen sonst N×5');
  assert.match(
    src,
    /ON CONFLICT \(key\) DO UPDATE/,
    'Hochzählen muss atomar in einem Statement passieren, sonst lesen parallele Versuche denselben Stand',
  );
  assert.match(
    src,
    /CASE WHEN rate_limit_attempts\.first_at < NOW\(\)/,
    'Ein abgelaufenes Fenster muss im selben Statement neu starten',
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
  assert.match(src, /entries: new Map/, 'In-Memory-Rückfall fehlt');
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
  assert.ok(found >= 3, `nur ${found} Aufrufe des Anmelde-Zählers gefunden — Muster veraltet?`);
  assert.deepEqual(
    withoutAwait,
    [],
    'Diese Aufrufe warten nicht auf den Anmelde-Zähler:\n  ' +
      withoutAwait.join('\n  ') +
      '\nEin Promise ist immer truthy — ohne await sperrt loginAllowed JEDEN Login.',
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

  assert.match(
    job,
    /pg_try_advisory_lock/,
    'Ohne prozessübergreifende Sperre schützt state.running nur den eigenen Worker',
  );
  // Own connection, not transaction-bound: the run takes minutes.
  assert.match(
    job,
    /(?:db|access)\.pool\.connect\(\)/,
    'Die Sperre muss über die ganze Laufzeit gehalten werden — eigene Verbindung',
  );
  assert.doesNotMatch(
    job,
    /pg_try_advisory_xact_lock/,
    'Eine Transaktion minutenlang offen zu halten wäre der falsche Weg',
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
    'routes/api/admin.ts: ohne await meldet die Route ein Promise als „gestartet"',
  );

  // The namespace comes from the shared list.
  assert.match(job, /LOCKS\.PRICE_JOB/, 'Der Namensraum gehört aus src/infra/lockNamespaces.ts, nicht eingetippt');
});
