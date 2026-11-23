/**
 * The globally set theme (global_settings.app_theme) must also apply BEFORE
 * login — on the login and startup screen.
 *
 * Counter-checks (measured 08.11.2026, each reverted):
 *   A  theme-boot.js: `sync();` removed → red “without a server value the cache
 *      applies immediately …” (no fetch)
 *   B  theme-boot.js: early `return;` removed in the branch `served` → red
 *      “a server-set value applies …” (fetch despite a server value)
 *   C  konto.js: applyTheme() returns null instead of __bimApplyTheme →
 *      red “applyTheme runs via the boot helper”
 *   D  routes/api/settingsGlobal.ts: forgetTheme() removed in the admin save
 *      → red “the server sets data-theme itself …” (brick instead of noppe)
 *   Deleted „GET /api/settings/theme ist ohne Login erreichbar“: covered by
 *   design-per-account-db.test.js; route put behind requireLogin → red there
 *   „ohne Anmeldung: die Vorgabe“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(PUB, 'styles.css'), 'utf8');
const BOOT = fs.readFileSync(path.join(PUB, 'js', 'theme-boot.js'), 'utf8');

/** theme-boot.js in an empty window: server value in the <html>, cache, response of the server. */
function bootWindow({ server = '', cached = '', response = {} } = {}) {
  const jsdom = require(path.join(ROOT, 'node_modules', 'jsdom'));
  const attr = server ? ` data-theme="${server}"` : '';
  const dom = new jsdom.JSDOM(`<!doctype html><html${attr}><head></head><body></body></html>`, {
    runScripts: 'outside-only',
    url: 'http://localhost/',
  });
  const w = dom.window;
  /** @type {string[]} */
  const fetches = [];
  /** @type {Promise<unknown>} */
  let last = Promise.resolve();
  w.fetch = (/** @type {string} */ url) => {
    fetches.push(String(url));
    last = Promise.resolve({ ok: true, json: async () => response });
    return last;
  };
  if (cached) w.localStorage.setItem('bim_theme', cached);
  w.eval(BOOT);
  const responseDa = async () => {
    await last;
    for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  };
  return { w, fetches, responseDa, theme: () => w.document.documentElement.getAttribute('data-theme') };
}

// „GET /api/v2/settings/theme ist ohne Login erreichbar" stood here as an order in the
// source text; executed, design-per-account-db.test.js checks it („ohne Anmeldung: die Vorgabe").

test('the boot script is before startup and login markup', () => {
  // Structure: only a blocking script in the <head> takes effect before the first paint.
  assert.ok(fs.existsSync(path.join(PUB, 'js', 'theme-boot.js')), 'js/theme-boot.js is missing');
  const prior = html.slice(0, html.indexOf('id="startup-screen"'));
  assert.match(
    prior,
    /<script src="\/js\/theme-boot\.js/,
    'The boot script must load before the login and the app, otherwise the wrong design flashes',
  );
});

test('without a server value the cache applies immediately, then the sync with the server', async () => {
  const b = bootWindow({ cached: 'brick', response: { success: true, theme: 'hochglanz' } });
  assert.equal(b.theme(), 'brick', 'The last known value must apply before any response');
  assert.deepEqual(b.fetches, ['/api/v2/settings/theme'], 'The boot script does not reconcile with the server');
  await b.responseDa();
  assert.equal(b.theme(), 'hochglanz', 'The server value is not applied');
  assert.equal(b.w.localStorage.getItem('bim_theme'), 'hochglanz', 'The server value does not land in the cache');
});

test('a server-set value applies, without sync and without a jump', async () => {
  const b = bootWindow({ server: 'noppe', cached: 'brick', response: { success: true, theme: 'hochglanz' } });
  await b.responseDa();
  assert.equal(b.theme(), 'noppe');
  assert.deepEqual(b.fetches, [], 'If the value is already in the HTML, every request is superfluous');
  assert.equal(b.w.localStorage.getItem('bim_theme'), 'noppe', 'The cache does not follow the server value');
});

test('applyTheme runs via the boot helper (cache stays current)', async t => {
  // After login showApp() sets the theme from the settings; without
  // the boot helper the cache would stay at the old theme.
  const { openUi, SIGNED_IN, waitFor } = require('./helpers/ui');
  const { w } = await openUi(
    {
      '/v2/settings/raw': {
        success: true,
        settings: { ...SIGNED_IN['/v2/settings/raw'].settings, app_theme: 'brick' },
      },
    },
    {
      before: win => {
        win.eval(BOOT);
      },
    },
  );
  t.after(() => w.close());
  await waitFor(() => w.document.documentElement.getAttribute('data-theme') === 'brick');
  assert.equal(
    w.document.documentElement.getAttribute('data-theme'),
    'brick',
    'applyTheme() does not set the design of the settings',
  );
  assert.equal(
    w.localStorage.getItem('bim_theme'),
    'brick',
    'applyTheme() does not update the cache — on the next load the old design flashes up',
  );
});

test('login and startup screen have no hard-coded background', () => {
  for (const id of ['#startup-screen', '#login-screen']) {
    const rule = styles.slice(styles.indexOf(id), styles.indexOf('}', styles.indexOf(id)));
    assert.doesNotMatch(
      rule,
      /background:\s*#/,
      `${id} must not have a fixed background — otherwise no theme gets past it`,
    );
    assert.match(rule, /background:\s*var\(--screen-bg\)/, `${id} must use var(--screen-bg)`);
  }
  assert.match(styles, /--screen-bg:/, '--screen-bg is not defined in :root');
});

test('startup screen no longer sets colors via inline style', () => {
  const start = html.indexOf('id="startup-screen"');
  const block = html.slice(start, html.indexOf('id="login-screen"'));
  // The LEGO brick in the logo is in brand colors and stays hard-coded; everything
  // else must run via the theme variables.
  const inlineColours = [...block.matchAll(/style="[^"]*?(?:background|color):\s*(#[0-9a-fA-F]{6})/g)].map(m => m[1]);
  assert.deepEqual(inlineColours, [], `inline styles override every theme rule: ${inlineColours.join(', ')}`);
});

test('five lists name the same designs', () => {
  // Why this is a check of its own
  const asFile = fs
    .readdirSync(path.join(PUB, 'themes'))
    .filter(f => f.endsWith('.css'))
    .map(f => path.basename(f, '.css'))
    .sort();
  // "classic" has no file of its own: it IS the base theme in styles.css.
  const expected = ['classic', ...asFile].sort();
  assert.ok(asFile.length >= 2, `Only ${asFile.length} design file(s) — does the search still work?`);

  const list = (src, re, where) => {
    const m = src.match(re);
    assert.ok(m, `${where}: the list of designs can no longer be found`);
    return [...m[1].matchAll(/['"]([a-z]+)['"]/g)].map(x => x[1]).sort();
  };
  // The <link> lines in index.html. Not via `list()`: there the
  // file name stands, not the theme name in quotation marks.
  const linked = [...html.matchAll(/<link[^>]+href="\/themes\/([a-z]+)\.css/g)].map(m => m[1]).sort();
  assert.deepEqual(
    linked,
    asFile,
    'index.html does not load exactly the stylesheets that are under public/themes/. ' +
      'If one is missing, only the colours from tokens.css arrive in the browser and not a ' +
      'single structure — the design then looks like the base design with a different ' +
      'accent colour.',
  );

  const boot = list(
    fs.readFileSync(path.join(PUB, 'js', 'theme-boot.js'), 'utf8'),
    /var ALLOWED = \[([^\]]*)\]/,
    'js/theme-boot.js',
  );
  const server = list(
    fs.readFileSync(path.join(__dirname, '..', 'src/contract/globalRules.ts'), 'utf8'),
    /const DESIGNS: readonly string\[\] = \[([^\]]*)\]/,
    'src/contract/globalRules.ts',
  );
  // The shared source from which the app also generates its design tokens.
  const shared = Object.keys(
    JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'shared', 'design-tokens.json'), 'utf8')).designs,
  ).sort();

  assert.deepEqual(boot, expected, 'ALLOWED in the boot script differs from the files');
  assert.deepEqual(server, expected, "The server's whitelist differs from the files");
  assert.deepEqual(shared, expected, 'shared/design-tokens.json differs from the files');
});

test('every theme under public/themes/ covers the screens before login', () => {
  const dir = path.join(PUB, 'themes');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.css'))) {
    const css = fs.readFileSync(path.join(dir, f), 'utf8');
    const name = path.basename(f, '.css');
    assert.match(
      css,
      new RegExp(`\\[data-theme="${name}"\\][^{]*#login-screen`),
      `${f} does not style the login screen — the design would jump after login`,
    );
    assert.match(css, /--screen-bg\s*:/, `${f} does not set --screen-bg`);
  }
});

test('the server sets data-theme itself, and a design change applies immediately', async t => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
  process.env.SESSION_SECRET ??= 'test-secret-lang-genug-fuer-die-pruefung';
  const _req = require('./helpers/sources').buildAndRequire();
  const db = await require('./helpers/db').dataOrSkip(t, _req);
  if (!db) return;
  const { setGlobalSetting } = _req('src/settings/settings.js');
  const { forgetTheme } = _req('src/profile/indexHtml.js');
  const sendStartPage = (...a) =>
    _req('src/profile/http/startPage.js').sendStartPage(require('./helpers/sources').testServices().profile, ...a);
  const name = `theme_admin_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [name]);
  const admin = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, is_admin) VALUES ($1, 'x', true, true) RETURNING id`,
      [name],
    )
  ).id;
  await require('./helpers/admin').adminWithFactor(_req, admin);
  const prior = (await db.get(`SELECT value FROM global_settings WHERE key = 'app_theme'`))?.value ?? null;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [admin]).catch(() => {});
    if (prior === null) await db.run(`DELETE FROM global_settings WHERE key = 'app_theme'`);
    else await setGlobalSetting('app_theme', prior);
    forgetTheme();
    await db.pool.end().catch(() => {});
  });
  await setGlobalSetting('app_theme', 'brick');
  forgetTheme();

  const startPage = async () => {
    let sent = '';
    await sendStartPage({
      type: () => ({
        send: b => {
          sent = b;
        },
      }),
      sendFile: () => {
        sent = 'DATEI';
      },
    });
    return /<html[^>]*\sdata-theme="([^"]+)"/.exec(sent)?.[1];
  };
  assert.equal(await startPage(), 'brick', 'The start page does not carry the design in the <html> tag');

  // Saved via the route: without discarding the cache the old theme would come
  // until expiry (THEME_TTL_MS).
  const { base } = require('./helpers/server').testServer(_req, {
    session: { userId: admin, username: name, isAdmin: true },
    t,
  });
  const r = await fetch(base + '/api/v2/settings/admin/theme', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme: 'noppe' }),
  });
  assert.equal(r.status, 200, await r.text());
  assert.equal(await startPage(), 'noppe', 'After saving the server still serves the old design');
});

test('the chart colors match the condition badges', () => {
  // Why this is recorded
  const tokens = fs.readFileSync(path.join(PUB, 'tokens.css'), 'utf8');
  const brickPart = tokens.slice(tokens.indexOf('[data-theme="brick"]'));
  assert.ok(brickPart, 'tokens.css no longer has a brick design');
  const brick = [brickPart, fs.readFileSync(path.join(PUB, 'themes', 'brick.css'), 'utf8')]
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  const grab = (re, what) => {
    const m = brick.match(re);
    assert.ok(m, `${what} not found`);
    return m[1].toLowerCase();
  };
  assert.equal(
    grab(/--chart-new:\s*(#[0-9a-f]{6})/i, '--chart-new'),
    grab(/\.cond-new\{background:#[0-9a-f]{6};color:(#[0-9a-f]{6})\}/i, '.cond-new'),
    'New line and new badge must have the same colour',
  );
  assert.equal(
    grab(/--chart-used:\s*(#[0-9a-f]{6})/i, '--chart-used'),
    grab(/\.cond-used\{background:#[0-9a-f]{6};color:(#[0-9a-f]{6})\}/i, '.cond-used'),
    'Used line and used badge must have the same colour',
  );

  // The default theme keeps blue/amber — the pair stays distinguishable even with
  // red-green color blindness, because it lies on the other color axis.
  const base = fs.readFileSync(path.join(PUB, 'tokens.css'), 'utf8').split('[data-theme=')[0];
  assert.match(base, /--chart-new:\s*#2563eb;/, 'The default value of the new line is missing');
  assert.match(base, /--chart-used:\s*#d97706;/, 'The default value of the used line is missing');
});

test('only the boot script knows the list of designs', () => {
  // The error this rule prevents
  const DESIGNS = [
    'classic',
    ...fs
      .readdirSync(path.join(PUB, 'themes'))
      .filter(f => f.endsWith('.css'))
      .map(f => path.basename(f, '.css')),
  ];
  assert.ok(DESIGNS.length >= 3, `Only ${DESIGNS.length} designs — does the search still work?`);

  const folder = path.join(PUB, 'js');
  const files = fs.readdirSync(folder).filter(n => n.endsWith('.js') && n !== 'app.bundle.js' && n !== 'theme-boot.js');
  assert.ok(files.length >= 10, `Only ${files.length} scripts — does the search still work?`);

  // Comments away first: the reasoning above names the themes in
  // running text, and the explanation in konto.js likewise. Without this step
  // the rule would report exactly the text that explains it.
  const withoutComments = js =>
    js
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter(z => !/^\s*\/\//.test(z))
      .join('\n');

  const hits = [];
  for (const name of files) {
    const code = withoutComments(fs.readFileSync(path.join(folder, name), 'utf8'));
    const named = new Set(DESIGNS.filter(d => new RegExp(`['"\`]${d}['"\`]`).test(code)));
    if (named.size >= 2) hits.push(`${name}: ${[...named].sort().join(', ')}`);
  }
  assert.deepEqual(
    hits,
    [],
    'These files keep their own list of designs. There is exactly one, ' +
      'in js/theme-boot.js — every other one does not grow with the next design, ' +
      'and the switch then only takes effect after a reload.',
  );
});

/**
 * A theme whose tab bar may wrap makes the tabs narrower
 * UNCONDITIONALLY — not behind a media query.
 *
 * ── Counter-check (carried out, result in the commit) ──────────────────────────
 *   The two lines in themes/brick.css wrapped in @media again → red.
 */
test('whoever lets the tab bar wrap must make it narrower', () => {
  const folder = path.join(PUB, 'themes');
  const files = fs.readdirSync(folder).filter(f => f.endsWith('.css'));
  assert.ok(files.length >= 4, `Only ${files.length} designs — does the search still work?`);

  const error = [];
  let affected = 0;
  for (const name of files) {
    const css = fs.readFileSync(path.join(folder, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    // Only themes that do BOTH: let it wrap and cap the content.
    if (!/nav\s*\{[^}]*flex-wrap\s*:\s*wrap/.test(css)) continue;
    if (!/#app\s*\{[^}]*max-width/.test(css)) continue;
    affected++;

    // Every @media block that sets the tab padding is the error.
    for (const m of css.matchAll(/@media[^{]+\{([\s\S]*?)\n\}/g)) {
      if (/\.ntab\s*\{[^}]*padding/.test(m[1])) {
        error.push(`${name}: ${m[0].slice(0, m[0].indexOf('{')).trim()}`);
      }
    }
  }
  assert.ok(
    affected >= 1,
    'No design lets the tab bar wrap AND caps the content — ' + 'then this rule is vacuously true',
  );
  assert.deepEqual(
    error,
    [],
    'Here the width of the tabs depends on the WINDOW width although they sit in ' +
      'a capped container. On a wide screen the query does not ' +
      'apply — and exactly there the bar wrapped.',
  );
});
