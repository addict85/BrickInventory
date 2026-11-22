/**
 * The real app in real Chrome: server from dist/, an administrator account with
 * stock, Chrome via the DevTools protocol. For tests that measure layout
 * (font size, tap targets, visibility) — jsdom cannot do that.
 *
 * Without Chrome or test DB `startApp` returns null; the caller skips.
 */
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { portOf } = require('./server');

const ROOT = path.join(__dirname, '..', '..');
const warte = ms => new Promise(r => setTimeout(r, ms));

/**
 * Path to Chrome or null (the test skips). With REQUIRE_BROWSER=1 a missing
 * browser throws, like REQUIRE_DB=1 for the database: in CI a
 * green run without browser tests would otherwise be no proof.
 * Counter-check (04.11.2026): CHROME_BIN empty, REQUIRE_BROWSER=1 → telefon-browser
 * and anmeldefelder-leer-browser red; without the variable skipped.
 */
function chrome() {
  const kandidaten = [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  ];
  const bin = kandidaten.find(k => k && fs.existsSync(k)) ?? null;
  if (!bin && process.env.REQUIRE_BROWSER === '1')
    throw new Error(
      `REQUIRE_BROWSER=1, aber kein Chrome gefunden (CHROME_BIN=${process.env.CHROME_BIN || 'empty-state'})`,
    );
  return bin;
}

const freePort = () =>
  new Promise(r => {
    const s = net.createServer().listen(0, () => {
      const p = portOf(s);
      s.close(() => r(p));
    });
  });

/**
 * With `detached` the program gets its own process group, and the end
 * hits the whole group: Chrome's child processes otherwise inherit the output pipes
 * and keep the test process open after a SIGKILL.
 */
function starte(t, bin, args, opt = {}) {
  const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opt });
  let log = '';
  p.stdout.on('data', d => {
    log += d;
  });
  p.stderr.on('data', d => {
    log += d;
  });
  const ende = signal => {
    try {
      if (opt.detached) process.kill(-p.pid, signal);
      else p.kill(signal);
    } catch {
      /* already gone */
    }
  };
  t.after(async () => {
    ende('SIGTERM');
    for (let i = 0; i < 40 && p.exitCode === null && p.signalCode === null; i++) await warte(100);
    ende('SIGKILL');
  });
  return { p, log: () => log };
}

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, f) => {
    ws.onopen = r;
    ws.onerror = f;
  });
  let n = 0;
  const offen = new Map();
  const ereignisse = [];
  const listener = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && offen.has(d.id)) {
      const { r, f } = offen.get(d.id);
      offen.delete(d.id);
      d.error ? f(new Error(d.error.message)) : r(d.result);
    } else if (d.method) {
      ereignisse.push(d);
      for (const h of listener) h(d);
    }
  };
  const senden = (method, params = {}, sessionId) =>
    new Promise((r, f) => {
      const id = ++n;
      offen.set(id, { r, f });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  const { targetId } = await senden('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await senden('Target.attachToTarget', { targetId, flatten: true });
  const tab = (m, p) => senden(m, p, sessionId);
  const auswerten = async expression => {
    const r = await tab('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  return { tab, auswerten, ereignisse, listener, sessionId, schliessen: () => ws.close() };
}

/**
 * @param t        test context (for t.after)
 * @param {object} [opt] options:
 * @param [opt.name] account name
 * @param [opt.bestand] async (db, uid) => {} creates test data
 * @param [opt.telefon] true: 390 × 844, mobile
 * @param [opt.movement] true: prefers-reduced-motion no-preference (otherwise reduce)
 * @param [opt.sprache] language of the account (default de)
 * @param [opt.locale] locale of the browser (default de-DE)
 * @param [opt.allDesigns] true: load all design stylesheets. The page only loads the active one; whoever sets data-theme
 *        themselves would otherwise see the others without styling.
 * @param [opt.intercept] [{ muster, contains, antwort?, delay? }]: requests
 *        whose URL matches the CDP pattern and contains `contains` get
 *        `antwort` as JSON (without `antwort` the real one), `delay` ms later
 */
async function startApp(t, opt = {}) {
  const bin = chrome();
  if (!bin) return { grund: 'kein Chrome gefunden' };
  const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
  process.env.DATABASE_URL = URL_DB;
  const _req = require('./sources').buildAndRequire();
  const db = require('./sources').testData();
  const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
  try {
    await db.initSchema();
  } catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    return { grund: 'Test-DB nicht erreichbar' };
  }
  const c = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(c);
  } finally {
    c.release();
  }
  const NAME = opt.name || `app_${process.pid}`,
    PASS = 'app-Passwort-1';
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified, is_admin)
    VALUES ($1, $2, $3, true, true, true) RETURNING id`,
      [NAME, `${NAME}@example.org`, await bcrypt.hash(PASS, 4)],
    )
  ).id;
  await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'language', $2)`, [
    uid,
    opt.sprache || 'de',
  ]);
  // Without this value the setup wizard would open above an empty collection and
  // every test would have to wait for it first; whoever checks it deletes the value in `bestand`.
  await db.run(`INSERT INTO global_settings (key, value) VALUES ('einrichtung_erledigt', '1')
                ON CONFLICT (key) DO UPDATE SET value = '1'`);
  if (opt.bestand) await opt.bestand(db, uid);
  // Administrators without a code generator would only get as far as setting it up; login
  // happens with a recovery code in the code field.
  const verwalter = (await db.get('SELECT is_admin FROM users WHERE id = $1', [uid])).is_admin;
  const [wiederherstellung = '', ...furtherCodes] = verwalter
    ? await require('./admin').adminWithFactor(_req, uid)
    : [];
  for (const k of ['rb_csv_last_sync', 'rb_part_categories_last_sync', 'rb_catalog_extras_last_sync'])
    await db.run(
      `INSERT INTO run_state (key, value) VALUES ($1, to_char(NOW(), 'YYYY-MM-DD'))
                  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [k],
    );
  t.after(async () => {
    await db
      .run(`DELETE FROM users WHERE id = $1 OR username LIKE $2`, [uid, `${NAME.replace(/_/g, '\\_')}\\_%`])
      .catch(() => {});
    await db.pool.end().catch(() => {});
  });

  // The port is only free until a parallel test takes it: then the server reports EADDRINUSE and stays without
  // a port, the test would see the other's server. So once more with a new port.
  let port = 0,
    server;
  for (let versuch = 0; versuch < 4; versuch++) {
    port = await freePort();
    server = starte(t, process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
      cwd: ROOT,
      env: {
        ...process.env,
        DATABASE_URL: URL_DB,
        SESSION_SECRET: 'app-test-geheimnis-lang-genug-1234',
        PORT: String(port),
        TRUST_PROXY: 'false',
      },
    });
    for (let i = 0; i < 240 && !/localhost:\d+|Startup complete|EADDRINUSE/.test(server.log()); i++) await warte(250);
    if (!/EADDRINUSE/.test(server.log())) break;
    server.p.kill('SIGKILL');
  }
  for (let i = 0; i < 40 && (await fetch(`http://127.0.0.1:${port}/api/v1/`).catch(() => null)) === null; i++)
    await warte(250);

  // Chrome creates a Unix socket under TMPDIR (at most 107 characters); with a long
  // TMPDIR it would abort with “Socket path too long”, so profile and TMPDIR then go under /tmp.
  const basis = os.tmpdir().length > 60 && fs.existsSync('/tmp') ? '/tmp' : os.tmpdir();
  const profil = fs.mkdtempSync(path.join(basis, 'app-browser-'));
  const browser = starte(
    t,
    bin,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--remote-debugging-port=0',
      `--user-data-dir=${profil}`,
      '--window-size=1280,900',
      'about:blank',
    ],
    { detached: true, env: { ...process.env, TMPDIR: basis } },
  );
  // Only delete after Chrome's end: t.after runs in registration order, and
  // a hook that throws skips the following ones — Chrome would then keep running.
  t.after(() => {
    try {
      fs.rmSync(profil, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      /* the system cleans up tmp */
    }
  });
  // Up to 30 s because the start can take longer on the CI runner. If Chrome ends
  // before, the helper aborts right away and shows Chrome's own output.
  let wsUrl = null;
  for (let i = 0; i < 300 && !wsUrl && browser.p.exitCode === null && browser.p.signalCode === null; i++) {
    wsUrl = /DevTools listening on (ws:\/\/\S+)/.exec(browser.log())?.[1];
    if (!wsUrl) await warte(100);
  }
  // The cause stands in Chrome's first FATAL line; it belongs at the start of the message.
  const ursache = /^.*(?:FATAL|Socket path too long).*$/m.exec(browser.log())?.[0]?.trim();
  if (!wsUrl)
    throw new Error(
      `Chrome meldet keinen DevTools-Zugang (Ende: ${browser.p.exitCode ?? browser.p.signalCode ?? 'läuft'})` +
        `${ursache ? ` — ${ursache}` : ''}:\n` +
        browser.log().slice(-1500),
    );
  const b = await cdp(wsUrl);
  t.after(() => b.schliessen());
  await b.tab('Runtime.enable');
  await b.tab('Page.enable');
  // Every 401 from the start: if the UI later throws back to the login,
  // the test thereby names the request that ended the session.
  const abgewiesen = [];
  await b.tab('Network.enable');
  // Running fetch/XHR requests for ruhig(); images do not count, they depend on the CDN.
  const laufend = new Set();
  b.listener.push(d => {
    if (d.method === 'Network.responseReceived' && d.params.response.status === 401)
      abgewiesen.push(d.params.response.url.replace(/^https?:\/\/[^/]+/, ''));
    if (d.method === 'Network.requestWillBeSent' && ['Fetch', 'XHR'].includes(d.params.type))
      laufend.add(d.params.requestId);
    if (d.method === 'Network.loadingFinished' || d.method === 'Network.loadingFailed')
      laufend.delete(d.params.requestId);
  });
  if (opt.intercept?.length) {
    await b.tab('Fetch.enable', {
      patterns: opt.intercept.map(a => ({ urlPattern: a.muster, requestStage: 'Request' })),
    });
    b.listener.push(d => {
      if (d.method !== 'Fetch.requestPaused') return;
      const a = opt.intercept.find(x => d.params.request.url.includes(x.contains));
      if (!a) {
        b.tab('Fetch.continueRequest', { requestId: d.params.requestId }).catch(() => {});
        return;
      }
      // Without a response only delay: the real response, but later.
      if (!a.antwort) {
        setTimeout(
          () => b.tab('Fetch.continueRequest', { requestId: d.params.requestId }).catch(() => {}),
          a.delay || 0,
        );
        return;
      }
      setTimeout(
        () =>
          b
            .tab('Fetch.fulfillRequest', {
              requestId: d.params.requestId,
              responseCode: 200,
              responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
              body: Buffer.from(JSON.stringify(a.antwort)).toString('base64'),
            })
            .catch(() => {}),
        a.delay || 0,
      );
    });
  }
  if (opt.telefon)
    await b.tab('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await b.tab('Emulation.setLocaleOverride', { locale: opt.locale || 'de-DE' });
  // What is measured is the final state, not a transition.
  await b.tab('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: opt.movement ? 'no-preference' : 'reduce' }],
  });

  const bis = async (ausdruck, was, versuche = 100) => {
    for (let i = 0; i < versuche; i++) {
      if (await b.auswerten(ausdruck).catch(() => false)) return;
      await warte(100);
    }
    const zustand = await b.auswerten(`document.body.innerText.slice(0, 300)`).catch(e => e.message);
    const s401 = abgewiesen.length ? `\n401 auf: ${abgewiesen.join(', ')}` : '';
    // Exceptions of the page (say Trusted Types): without them a CI run only shows the timeout.
    const exceptions = b.ereignisse
      .filter(e => e.method === 'Runtime.exceptionThrown')
      .slice(-5)
      .map(e => e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text);
    const sFrom = exceptions.length ? `\nAusnahmen der Seite:\n${exceptions.join('\n')}` : '';
    throw new Error(`Zeitüberschreitung: ${was} — ${zustand}${s401}${sFrom}\nServer:\n${server.log().slice(-3000)}`);
  };
  await b.tab('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await bis(`typeof document.getElementById('btn-login')?.onclick === 'function'`, 'Anmeldemaske');
  await b.auswerten(`document.getElementById('lu').value = ${JSON.stringify(NAME)};
    document.getElementById('lp').value = ${JSON.stringify(PASS)};
    document.getElementById('lc').value = ${JSON.stringify(wiederherstellung)};
    document.getElementById('btn-login').click(); true`);
  // 30 s as at Chrome start: login computes bcrypt with 12 rounds and
  // writes the session; on a busy runner that took over 10 s.
  await bis(
    `document.getElementById('app')?.style.display === 'block' || getComputedStyle(document.getElementById('app')).display !== 'none'`,
    'loggedIn',
    300,
  );
  // On the phone the name only stands in the menu; that is why the account badge itself is checked.
  await bis(
    `(document.getElementById('ubadge')?.textContent || '').includes(${JSON.stringify(NAME)})`,
    'Kontoname im Kontoschild',
  );
  // The start is only decided once the collection has loaded; before that
  // its build could overtake a tab switch of the test.
  await bis(
    `(() => {
    if (document.querySelector('.ntab[data-tab="settings"]')?.classList.contains('active')) return true;
    const g = document.getElementById('gallery');
    return !!g && g.children.length > 0 && !g.querySelector('.skeleton-grid'); })()`,
    'Start abgeschlossen',
  );
  if (opt.allDesigns)
    await b.auswerten(`(() => { const v = document.getElementById('theme-styles');
      return Promise.all([...v.content.querySelectorAll('link')].map(l => new Promise(r => {
        l.onload = l.onerror = r; v.before(document.adoptNode(l)); }))).then(() => true); })()`);
  /** Until no request runs anymore (twice in a row) and two frames are drawn. */
  const ruhig = async (ms = 10_000) => {
    const ende = Date.now() + ms;
    for (let still = 0; still < 2 && Date.now() < ende; await warte(50)) still = laufend.size ? 0 : still + 1;
    await b.auswerten('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
  };
  return { b, bis, warte, ruhig, port, uid, db, abgewiesen, furtherCodes };
}

module.exports = { startApp, warte, chrome };
