/**
 * The app runs under `style-src 'self'` without a single CSP violation, and
 * the styles from data-style still arrive. Measured in Chrome on the real
 * server: log in, open every tab, meanwhile record every `securitypolicyviolation`
 * and every message „nicht freigegeben“ from js/styles.js.
 *
 * Without Chrome (CHROME_BIN, google-chrome, chromium) it is skipped.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  in index.html a data-style again as style= → red: „keine
 *      CSP-Verstösse“ (style-src-attr)
 *   B  the wrapper around innerHTML removed in js/styles.js → red: „jedes
 *      data-style ist angewendet“
 *   C  an empty allowlist in the build → red: „nur freigegebene Werte“
 * Counter-check (measured on 29.10.2026):
 *   D  form-action, base-uri and object-src removed from the CSP in server.ts
 *      → red: „form-action, base-uri und object-src greifen“
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATABASE_URL = URL_DB;
const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { holdsSet } = require('./helpers/inventory');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const NAME = `stile_${process.pid}`,
  PASS = 'stile-Passwort-1';

const { chrome, warte } = require('./helpers/app-browser');
const { portOf } = require('./helpers/server');

const freePort = () =>
  new Promise(r => {
    const s = net.createServer().listen(0, () => {
      const p = portOf(s);
      s.close(() => r(p));
    });
  });

/** A process that is surely gone again at the end of the test. */
function starte(t, bin, args, opt) {
  const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opt });
  let log = '';
  p.stdout.on('data', d => {
    log += d;
  });
  p.stderr.on('data', d => {
    log += d;
  });
  t.after(async () => {
    p.kill('SIGTERM');
    for (let i = 0; i < 40 && p.exitCode === null && p.signalCode === null; i++) await warte(100);
    if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL');
  });
  return { p, log: () => log };
}

/** Smallest CDP client: one tab, commands with a response, events as a list. */
async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, f) => {
    ws.onopen = r;
    ws.onerror = f;
  });
  let n = 0;
  const open = new Map();
  const eventList = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && open.has(d.id)) {
      const { r, f } = open.get(d.id);
      open.delete(d.id);
      d.error ? f(new Error(d.error.message)) : r(d.result);
    } else if (d.method) eventList.push(d);
  };
  const sendIt = (method, params = {}, sessionId) =>
    new Promise((r, f) => {
      const id = ++n;
      open.set(id, { r, f });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  const { targetId } = await sendIt('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await sendIt('Target.attachToTarget', { targetId, flatten: true });
  const tab = (m, p) => sendIt(m, p, sessionId);
  const auswerten = async expression => {
    const r = await tab('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  return { tab, auswerten, eventList, schliessen: () => ws.close() };
}

test('styles under style-src without unsafe-inline', { concurrency: 1, timeout: 180_000 }, async t => {
  const bin = chrome();
  if (!bin) {
    t.skip('no Chrome found');
    return;
  }
  if (!(await dataOrSkip(t, _req))) return;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified, is_admin)
    VALUES ($1, $2, $3, true, true, true) RETURNING id`,
      [NAME, `${NAME}@example.org`, await bcrypt.hash(PASS, 4)],
    )
  ).id;
  await holdsSet(db, uid, '10300-1', 1, { preis: 199 });
  const [wiederherstellung] = await require('./helpers/admin').adminWithFactor(_req, uid);
  // With today's stamps the start does not download the Rebrickable catalog.
  for (const k of ['rb_csv_last_sync', 'rb_part_categories_last_sync', 'rb_catalog_extras_last_sync'])
    await db.run(
      `INSERT INTO run_state (key, value) VALUES ($1, to_char(NOW(), 'YYYY-MM-DD'))
                  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [k],
    );
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const port = await freePort();
  const server = starte(t, process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: URL_DB,
      SESSION_SECRET: 'stile-test-geheimnis-lang-genug-1234',
      PORT: String(port),
      TRUST_PROXY: 'false',
    },
  });
  for (let i = 0; i < 240 && !/localhost:\d+|Startup complete/.test(server.log()); i++) await warte(250);
  for (let i = 0; i < 40 && (await fetch(`http://127.0.0.1:${port}/api/v2/`).catch(() => null)) === null; i++)
    await warte(250);
  const csp = (await fetch(`http://127.0.0.1:${port}/`)).headers.get('content-security-policy') || '';
  // Inline only the one block of the start skeleton, via its hash — no 'unsafe-inline'.
  assert.match(csp, /style-src 'self'( 'sha256-[A-Za-z0-9+/]+=*')?(;|$)/, `Die CSP erlaubt Inline-Stile: ${csp}`);

  const profileData = fs.mkdtempSync(path.join(os.tmpdir(), 'stile-'));
  // Chrome still writes into the profile when exiting; an error here would skip the
  // remaining cleanup steps and leave Chrome running.
  t.after(() => {
    try {
      fs.rmSync(profileData, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      /* the system cleans up tmp */
    }
  });
  const browser = starte(
    t,
    bin,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--remote-debugging-port=0',
      `--user-data-dir=${profileData}`,
      '--window-size=1280,900',
      'about:blank',
    ],
    {},
  );
  let wsUrl = null;
  for (let i = 0; i < 100 && !wsUrl; i++) {
    wsUrl = /DevTools listening on (ws:\/\/\S+)/.exec(browser.log())?.[1];
    await warte(100);
  }
  assert.ok(wsUrl, 'Chrome meldet keinen DevTools-Zugang');
  const b = await cdp(wsUrl);
  t.after(() => b.schliessen());

  await b.tab('Runtime.enable');
  await b.tab('Page.enable');
  await b.tab('Page.addScriptToEvaluateOnNewDocument', {
    source: `
    window.__verstoesse = [];
    document.addEventListener('securitypolicyviolation', e =>
      window.__verstoesse.push(e.violatedDirective + ' ' + (e.sample || '') + ' @' + e.sourceFile + ':' + e.lineNumber));`,
  });
  await b.tab('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  const bis = async (ausdruck, was) => {
    for (let i = 0; i < 100; i++) {
      if (await b.auswerten(ausdruck).catch(() => false)) return;
      await warte(100);
    }
    const condition = await b
      .auswerten(`JSON.stringify({ v: window.__verstoesse,
      lerr: document.getElementById('lerr')?.textContent, text: document.body.innerText.slice(0, 300) })`)
      .catch(e => e.message);
    assert.fail(`Zeitüberschreitung: ${was} — ${condition}`);
  };
  // Only click once the bundle has wired up the button — under load the
  // form already stands there before the script at the end of the page has run.
  await bis(`typeof document.getElementById('btn-login')?.onclick === 'function'`, 'Anmeldemaske');
  await b.auswerten(`document.getElementById('lu').value = ${JSON.stringify(NAME)};
    document.getElementById('lp').value = ${JSON.stringify(PASS)};
    document.getElementById('lc').value = ${JSON.stringify(wiederherstellung)};
    document.getElementById('btn-login').click(); true`);
  await bis(`/${NAME} \\(Administrator\\)/.test(document.body.innerText)`, 'angemeldet als Verwalter');
  const reiter = await b.auswerten(`[...document.querySelectorAll('.ntab[data-tab]')].map(x => x.dataset.tab)`);
  assert.ok(reiter.length >= 8, `nur ${reiter.length} Reiter`);
  for (const r of reiter) {
    await b.auswerten(`document.querySelector('.ntab[data-tab="${r}"]').click(); true`);
    await warte(700);
  }
  // The set view builds the most markup at runtime.
  await b.auswerten(`document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
  await bis(`!!document.querySelector('[data-click="openModal"]')`, 'Set-Karte');
  await b.auswerten(`document.querySelector('[data-click="openModal"]').click(); true`);
  await bis(`document.getElementById('m-tit').textContent.length > 0`, 'Set-Ansicht offen');
  await warte(800);
  const s = await b.auswerten(`({
    violations: window.__verstoesse,
    uebrig: [...document.querySelectorAll('[data-style]')].map(e => e.getAttribute('data-style')).slice(0, 5),
    styleSet: document.querySelectorAll('[style]').length,
  })`);
  const warnings = b.eventList
    .filter(e => e.method === 'Runtime.consoleAPICalled')
    .map(e => e.params.args.map(a => a.value ?? '').join(' '))
    .filter(x => x.includes('[stile]'));

  await t.test('no CSP violations', () => assert.deepEqual(s.violations, []));
  await t.test('every data-style is applied', () => {
    assert.deepEqual(s.uebrig, []);
    assert.ok(s.styleSet > 50, `nur ${s.styleSet} Elemente mit Stil`);
  });
  await t.test('only approved values', () => assert.deepEqual(warnings, []));

  // Last, because a form going outside without form-action would leave the page.
  await t.test('form-action, base-uri and object-src take effect', async () => {
    assert.match(csp, /form-action 'self'/);
    // A form of the app (submit via Enter) and a download stay without a violation.
    await b.auswerten(`document.querySelector('form[data-submit="btn-gen-qr"]')?.requestSubmit(); true`);
    await b.auswerten(`document.getElementById('btn-cfg-export')?.click(); true`);
    await warte(800);
    assert.deepEqual(await b.auswerten('window.__verstoesse'), [], 'Formular oder Download der App verletzt die CSP');
    const verletzt = await b.auswerten(`new Promise(fertig => {
      const gesehen = new Set();
      document.addEventListener('securitypolicyviolation', e => gesehen.add(e.effectiveDirective));
      const basis = document.createElement('base'); basis.href = 'https://fremd.invalid/';
      document.head.appendChild(basis);
      // Trusted Types lassen als Skript-Adresse nur eigene Pfade zu; object-src 'none' sperrt auch sie.
      const obj = document.createElement('object'); obj.data = '/locales/de.js';
      document.body.appendChild(obj);
      const f = document.createElement('form'); f.action = 'https://fremd.invalid/'; f.method = 'post';
      document.body.appendChild(f); f.submit();
      setTimeout(() => fertig([...gesehen].sort()), 1500);
    })`);
    assert.deepEqual(verletzt, ['base-uri', 'form-action', 'object-src']);
  });
});
