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
 *   D  routes/api_v1/settingsGlobal.ts: forgetTheme() removed in the admin save
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
function bootWindow({ server = '', gecacht = '', antwort = {} } = {}) {
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
  let letzte = Promise.resolve();
  w.fetch = (/** @type {string} */ url) => {
    fetches.push(String(url));
    letzte = Promise.resolve({ ok: true, json: async () => antwort });
    return letzte;
  };
  if (gecacht) w.localStorage.setItem('bim_theme', gecacht);
  w.eval(BOOT);
  const responseDa = async () => {
    await letzte;
    for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  };
  return { w, fetches, responseDa, thema: () => w.document.documentElement.getAttribute('data-theme') };
}

// „GET /api/v1/settings/theme ist ohne Login erreichbar" stood here as an order in the
// source text; executed, design-per-account-db.test.js checks it („ohne Anmeldung: die Vorgabe").

test('the boot script is before startup and login markup', () => {
  // Structure: only a blocking script in the <head> takes effect before the first paint.
  assert.ok(fs.existsSync(path.join(PUB, 'js', 'theme-boot.js')), 'js/theme-boot.js fehlt');
  const vorher = html.slice(0, html.indexOf('id="startup-screen"'));
  assert.match(
    vorher,
    /<script src="\/js\/theme-boot\.js/,
    'Das Boot-Skript muss vor Anmeldung und App geladen werden, sonst blitzt das falsche Design auf',
  );
});

test('without a server value the cache applies immediately, then the sync with the server', async () => {
  const b = bootWindow({ gecacht: 'brick', antwort: { success: true, theme: 'hochglanz' } });
  assert.equal(b.thema(), 'brick', 'Der zuletzt bekannte Wert muss vor jeder Antwort gelten');
  assert.deepEqual(b.fetches, ['/api/v1/settings/theme'], 'Das Boot-Skript gleicht nicht gegen den Server ab');
  await b.responseDa();
  assert.equal(b.thema(), 'hochglanz', 'Der Serverwert wird nicht angewendet');
  assert.equal(b.w.localStorage.getItem('bim_theme'), 'hochglanz', 'Der Serverwert landet nicht im Cache');
});

test('a server-set value applies, without sync and without a jump', async () => {
  const b = bootWindow({ server: 'noppe', gecacht: 'brick', antwort: { success: true, theme: 'hochglanz' } });
  await b.responseDa();
  assert.equal(b.thema(), 'noppe');
  assert.deepEqual(b.fetches, [], 'Steht der Wert schon im HTML, ist jede Anfrage überflüssig');
  assert.equal(b.w.localStorage.getItem('bim_theme'), 'noppe', 'Der Cache folgt dem Serverwert nicht');
});

test('applyTheme runs via the boot helper (cache stays current)', async t => {
  // After login showApp() sets the theme from the settings; without
  // the boot helper the cache would stay at the old theme.
  const { openUi, ANMELDUNG, warte } = require('./helpers/ui');
  const { w } = await openUi(
    {
      '/v1/settings/raw': {
        success: true,
        settings: { ...ANMELDUNG['/v1/settings/raw'].settings, app_theme: 'brick' },
      },
    },
    {
      before: fenster => {
        fenster.eval(BOOT);
      },
    },
  );
  t.after(() => w.close());
  await warte(() => w.document.documentElement.getAttribute('data-theme') === 'brick');
  assert.equal(
    w.document.documentElement.getAttribute('data-theme'),
    'brick',
    'applyTheme() setzt das Design der Einstellungen nicht',
  );
  assert.equal(
    w.localStorage.getItem('bim_theme'),
    'brick',
    'applyTheme() führt den Cache nicht nach — beim nächsten Laden blitzt das alte Design auf',
  );
});

test('login and startup screen have no hard-coded background', () => {
  for (const id of ['#startup-screen', '#login-screen']) {
    const rule = styles.slice(styles.indexOf(id), styles.indexOf('}', styles.indexOf(id)));
    assert.doesNotMatch(
      rule,
      /background:\s*#/,
      `${id} darf keinen festen Hintergrund haben — sonst kommt kein Theme daran vorbei`,
    );
    assert.match(rule, /background:\s*var\(--screen-bg\)/, `${id} muss var(--screen-bg) verwenden`);
  }
  assert.match(styles, /--screen-bg:/, '--screen-bg ist in :root nicht definiert');
});

test('startup screen no longer sets colors via inline style', () => {
  const start = html.indexOf('id="startup-screen"');
  const block = html.slice(start, html.indexOf('id="login-screen"'));
  // The LEGO brick in the logo is in brand colors and stays hard-coded; everything
  // else must run via the theme variables.
  const inlineColours = [...block.matchAll(/style="[^"]*?(?:background|color):\s*(#[0-9a-fA-F]{6})/g)].map(m => m[1]);
  assert.deepEqual(inlineColours, [], `Inline-Styles überstimmen jede Theme-Regel: ${inlineColours.join(', ')}`);
});

test('five lists name the same designs', () => {
  // Why this is a check of its own
  const asFile = fs
    .readdirSync(path.join(PUB, 'themes'))
    .filter(f => f.endsWith('.css'))
    .map(f => path.basename(f, '.css'))
    .sort();
  // "classic" has no file of its own: it IS the base theme in styles.css.
  const erwartet = ['classic', ...asFile].sort();
  assert.ok(asFile.length >= 2, `Nur ${asFile.length} Design-Datei(en) — greift die Suche noch?`);

  const liste = (src, re, wo) => {
    const m = src.match(re);
    assert.ok(m, `${wo}: die Liste der Designs ist nicht mehr zu finden`);
    return [...m[1].matchAll(/['"]([a-z]+)['"]/g)].map(x => x[1]).sort();
  };
  // The <link> lines in index.html. Not via `list()`: there the
  // file name stands, not the theme name in quotation marks.
  const linked = [...html.matchAll(/<link[^>]+href="\/themes\/([a-z]+)\.css/g)].map(m => m[1]).sort();
  assert.deepEqual(
    linked,
    asFile,
    'index.html laedt nicht genau die Stylesheets, die unter public/themes/ liegen. ' +
      'Fehlt eines, kommen im Browser nur die Farben aus tokens.css an und keine ' +
      'einzige Struktur — das Design sieht dann aus wie das Grunddesign mit anderer ' +
      'Akzentfarbe.',
  );

  const boot = liste(
    fs.readFileSync(path.join(PUB, 'js', 'theme-boot.js'), 'utf8'),
    /var ALLOWED = \[([^\]]*)\]/,
    'js/theme-boot.js',
  );
  const server = liste(
    fs.readFileSync(path.join(__dirname, '..', 'src/contract/globalRules.ts'), 'utf8'),
    /const DESIGNS: readonly string\[\] = \[([^\]]*)\]/,
    'src/contract/globalRules.ts',
  );
  // The shared source from which the app also generates its design tokens.
  const geteilt = Object.keys(
    JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'shared', 'design-tokens.json'), 'utf8')).designs,
  ).sort();

  assert.deepEqual(boot, erwartet, 'ALLOWED im Boot-Skript weicht von den Dateien ab');
  assert.deepEqual(server, erwartet, 'Die Whitelist des Servers weicht von den Dateien ab');
  assert.deepEqual(geteilt, erwartet, 'shared/design-tokens.json weicht von den Dateien ab');
});

test('every theme under public/themes/ covers the screens before login', () => {
  const dir = path.join(PUB, 'themes');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.css'))) {
    const css = fs.readFileSync(path.join(dir, f), 'utf8');
    const name = path.basename(f, '.css');
    assert.match(
      css,
      new RegExp(`\\[data-theme="${name}"\\][^{]*#login-screen`),
      `${f} stylt den Login-Screen nicht — das Design würde nach dem Login umspringen`,
    );
    assert.match(css, /--screen-bg\s*:/, `${f} setzt --screen-bg nicht`);
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
  const vorher = (await db.get(`SELECT value FROM global_settings WHERE key = 'app_theme'`))?.value ?? null;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [admin]).catch(() => {});
    if (vorher === null) await db.run(`DELETE FROM global_settings WHERE key = 'app_theme'`);
    else await setGlobalSetting('app_theme', vorher);
    forgetTheme();
    await db.pool.end().catch(() => {});
  });
  await setGlobalSetting('app_theme', 'brick');
  forgetTheme();

  const startseite = async () => {
    let gesendet = '';
    await sendStartPage({
      type: () => ({
        send: b => {
          gesendet = b;
        },
      }),
      sendFile: () => {
        gesendet = 'DATEI';
      },
    });
    return /<html[^>]*\sdata-theme="([^"]+)"/.exec(gesendet)?.[1];
  };
  assert.equal(await startseite(), 'brick', 'Die Startseite trägt das Design nicht im <html>-Tag');

  // Saved via the route: without discarding the cache the old theme would come
  // until expiry (THEME_TTL_MS).
  const { base } = require('./helpers/server').testServer(_req, {
    sitzung: { userId: admin, username: name, isAdmin: true },
    t,
  });
  const r = await fetch(base + '/api/v1/settings/admin/theme', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme: 'noppe' }),
  });
  assert.equal(r.status, 200, await r.text());
  assert.equal(await startseite(), 'noppe', 'Nach dem Speichern liefert der Server noch das alte Design aus');
});

test('the chart colors match the condition badges', () => {
  // Why this is recorded
  const tokens = fs.readFileSync(path.join(PUB, 'tokens.css'), 'utf8');
  const steinTeil = tokens.slice(tokens.indexOf('[data-theme="brick"]'));
  assert.ok(steinTeil, 'tokens.css fuehrt kein Stein-Design mehr');
  const brick = [steinTeil, fs.readFileSync(path.join(PUB, 'themes', 'brick.css'), 'utf8')]
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  const grab = (re, what) => {
    const m = brick.match(re);
    assert.ok(m, `${what} nicht gefunden`);
    return m[1].toLowerCase();
  };
  assert.equal(
    grab(/--chart-new:\s*(#[0-9a-f]{6})/i, '--chart-new'),
    grab(/\.cond-new\{background:#[0-9a-f]{6};color:(#[0-9a-f]{6})\}/i, '.cond-new'),
    'Neu-Linie und Neu-Plakette müssen dieselbe Farbe haben',
  );
  assert.equal(
    grab(/--chart-used:\s*(#[0-9a-f]{6})/i, '--chart-used'),
    grab(/\.cond-used\{background:#[0-9a-f]{6};color:(#[0-9a-f]{6})\}/i, '.cond-used'),
    'Gebraucht-Linie und Gebraucht-Plakette müssen dieselbe Farbe haben',
  );

  // The default theme keeps blue/amber — the pair stays distinguishable even with
  // red-green color blindness, because it lies on the other color axis.
  const base = fs.readFileSync(path.join(PUB, 'tokens.css'), 'utf8').split('[data-theme=')[0];
  assert.match(base, /--chart-new:\s*#2563eb;/, 'Der Vorgabewert der Neu-Linie fehlt');
  assert.match(base, /--chart-used:\s*#d97706;/, 'Der Vorgabewert der Gebraucht-Linie fehlt');
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
  assert.ok(DESIGNS.length >= 3, `Nur ${DESIGNS.length} Designs — greift die Suche noch?`);

  const ordner = path.join(PUB, 'js');
  const dateien = fs
    .readdirSync(ordner)
    .filter(n => n.endsWith('.js') && n !== 'app.bundle.js' && n !== 'theme-boot.js');
  assert.ok(dateien.length >= 10, `Nur ${dateien.length} Skripte — greift die Suche noch?`);

  // Comments away first: the reasoning above names the themes in
  // running text, and the explanation in konto.js likewise. Without this step
  // the rule would report exactly the text that explains it.
  const ohneKommentare = js =>
    js
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter(z => !/^\s*\/\//.test(z))
      .join('\n');

  const treffer = [];
  for (const name of dateien) {
    const code = ohneKommentare(fs.readFileSync(path.join(ordner, name), 'utf8'));
    const genannt = new Set(DESIGNS.filter(d => new RegExp(`['"\`]${d}['"\`]`).test(code)));
    if (genannt.size >= 2) treffer.push(`${name}: ${[...genannt].sort().join(', ')}`);
  }
  assert.deepEqual(
    treffer,
    [],
    'Diese Dateien fuehren eine eigene Liste der Designs. Es gibt genau eine, ' +
      'in js/theme-boot.js — jede weitere waechst beim naechsten Design nicht ' +
      'mit, und der Wechsel wirkt dann erst nach einem Neuladen.',
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
  const ordner = path.join(PUB, 'themes');
  const dateien = fs.readdirSync(ordner).filter(f => f.endsWith('.css'));
  assert.ok(dateien.length >= 4, `Nur ${dateien.length} Designs — greift die Suche noch?`);

  const fehler = [];
  let betroffen = 0;
  for (const name of dateien) {
    const css = fs.readFileSync(path.join(ordner, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    // Only themes that do BOTH: let it wrap and cap the content.
    if (!/nav\s*\{[^}]*flex-wrap\s*:\s*wrap/.test(css)) continue;
    if (!/#app\s*\{[^}]*max-width/.test(css)) continue;
    betroffen++;

    // Every @media block that sets the tab padding is the error.
    for (const m of css.matchAll(/@media[^{]+\{([\s\S]*?)\n\}/g)) {
      if (/\.ntab\s*\{[^}]*padding/.test(m[1])) {
        fehler.push(`${name}: ${m[0].slice(0, m[0].indexOf('{')).trim()}`);
      }
    }
  }
  assert.ok(
    betroffen >= 1,
    'Kein Design lässt die Reiterleiste umbrechen UND deckelt den Inhalt — ' + 'dann ist diese Regel leer wahr',
  );
  assert.deepEqual(
    fehler,
    [],
    'Hier hängt die Breite der Reiter an der FENSTERbreite, obwohl sie in ' +
      'einem gedeckelten Behälter stehen. Auf einem breiten Bildschirm greift ' +
      'die Abfrage nicht — und genau dort brach die Leiste um.',
  );
});
