/**
 * Die App läuft unter `style-src 'self'` ohne einen einzigen CSP-Verstoss, und
 * die Stile aus data-stil kommen trotzdem an. Gemessen in Chrome am echten
 * Server: anmelden, jeden Reiter öffnen, dabei jede `securitypolicyviolation`
 * und jede Meldung „nicht freigegeben“ aus js/00-stile.js mitschreiben.
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  in index.html ein data-stil wieder als style= → rot: „keine
 *      CSP-Verstösse“ (style-src-attr)
 *   B  in js/00-stile.js die Hülle um innerHTML entfernt → rot: „jedes
 *      data-stil ist angewendet“
 *   C  im Build eine leere Freigabeliste → rot: „nur freigegebene Werte“
 * Gegenprobe (am 29.10.2026 gemessen):
 *   D  form-action, base-uri und object-src aus der CSP in server.ts entfernt
 *      → rot: „form-action, base-uri und object-src greifen“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
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
const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { haeltSet } = require('./helpers/bestand');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const NAME = `stile_${process.pid}`, PASS = 'stile-Passwort-1';
const warte = (ms) => new Promise(r => setTimeout(r, ms));

function chrome() {
  const kandidaten = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'];
  return kandidaten.find(k => k && fs.existsSync(k)) ?? null;
}

const freierPort = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

/** Ein Prozess, der beim Testende sicher wieder weg ist. */
function starte(t, bin, args, opt) {
  const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opt });
  let log = '';
  p.stdout.on('data', d => { log += d; });
  p.stderr.on('data', d => { log += d; });
  t.after(async () => {
    p.kill('SIGTERM');
    for (let i = 0; i < 40 && p.exitCode === null && p.signalCode === null; i++) await warte(100);
    if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL');
  });
  return { p, log: () => log };
}

/** Kleinster CDP-Client: ein Tab, Befehle mit Antwort, Ereignisse als Liste. */
async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, f) => { ws.onopen = r; ws.onerror = f; });
  let n = 0; const offen = new Map(); const ereignisse = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && offen.has(d.id)) { const { r, f } = offen.get(d.id); offen.delete(d.id); d.error ? f(new Error(d.error.message)) : r(d.result); }
    else if (d.method) ereignisse.push(d);
  };
  const senden = (method, params = {}, sessionId) => new Promise((r, f) => {
    const id = ++n; offen.set(id, { r, f }); ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const { targetId } = await senden('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await senden('Target.attachToTarget', { targetId, flatten: true });
  const tab = (m, p) => senden(m, p, sessionId);
  const auswerten = async (expression) => {
    const r = await tab('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  return { tab, auswerten, ereignisse, schliessen: () => ws.close() };
}

test('Stile unter style-src ohne unsafe-inline', { concurrency: 1, timeout: 180_000 }, async (t) => {
  const bin = chrome();
  if (!bin) { t.skip('kein Chrome gefunden'); return; }
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, email, password_hash, is_active, email_verified, is_admin)
    VALUES ($1, $2, $3, 1, 1, 1) RETURNING id`, [NAME, `${NAME}@example.org`, await bcrypt.hash(PASS, 4)])).id;
  await haeltSet(db, uid, '10300-1', 1, { preis: 199 });
  // Mit heutigen Stempeln lädt der Start den Rebrickable-Katalog nicht herunter.
  for (const k of ['rb_csv_last_sync', 'rb_part_categories_last_sync', 'rb_catalog_extras_last_sync'])
    await db.run(`INSERT INTO laufzustand (schluessel, wert) VALUES ($1, to_char(NOW(), 'YYYY-MM-DD'))
                  ON CONFLICT (schluessel) DO UPDATE SET wert = EXCLUDED.wert`, [k]);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const port = await freierPort();
  const server = starte(t, process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: URL_DB, SESSION_SECRET: 'stile-test-geheimnis-lang-genug-1234',
           PORT: String(port), TRUST_PROXY: 'false' },
  });
  for (let i = 0; i < 240 && !/localhost:\d+|Startup complete/.test(server.log()); i++) await warte(250);
  for (let i = 0; i < 40 && (await fetch(`http://127.0.0.1:${port}/api/v1/`).catch(() => null)) === null; i++) await warte(250);
  const csp = (await fetch(`http://127.0.0.1:${port}/`)).headers.get('content-security-policy') || '';
  assert.match(csp, /style-src 'self'(;|$)/, `Die CSP erlaubt Inline-Stile: ${csp}`);

  const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'stile-'));
  t.after(() => fs.rmSync(profil, { recursive: true, force: true }));
  const browser = starte(t, bin, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
    `--user-data-dir=${profil}`, '--window-size=1280,900', 'about:blank'], {});
  let wsUrl = null;
  for (let i = 0; i < 100 && !wsUrl; i++) { wsUrl = /DevTools listening on (ws:\/\/\S+)/.exec(browser.log())?.[1]; await warte(100); }
  assert.ok(wsUrl, 'Chrome meldet keinen DevTools-Zugang');
  const b = await cdp(wsUrl);
  t.after(() => b.schliessen());

  await b.tab('Runtime.enable');
  await b.tab('Page.enable');
  await b.tab('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__verstoesse = [];
    document.addEventListener('securitypolicyviolation', e =>
      window.__verstoesse.push(e.violatedDirective + ' ' + (e.sample || '') + ' @' + e.sourceFile + ':' + e.lineNumber));` });
  await b.tab('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  const bis = async (ausdruck, was) => {
    for (let i = 0; i < 100; i++) { if (await b.auswerten(ausdruck).catch(() => false)) return; await warte(100); }
    const zustand = await b.auswerten(`JSON.stringify({ v: window.__verstoesse,
      lerr: document.getElementById('lerr')?.textContent, text: document.body.innerText.slice(0, 300) })`).catch(e => e.message);
    assert.fail(`Zeitüberschreitung: ${was} — ${zustand}`);
  };
  // Erst klicken, wenn das Bündel den Knopf verdrahtet hat — unter Last steht
  // die Maske schon da, bevor das Skript am Ende der Seite gelaufen ist.
  await bis(`typeof document.getElementById('btn-login')?.onclick === 'function'`, 'Anmeldemaske');
  await b.auswerten(`document.getElementById('lu').value = ${JSON.stringify(NAME)};
    document.getElementById('lp').value = ${JSON.stringify(PASS)};
    document.getElementById('btn-login').click(); true`);
  await bis(`document.body.innerText.includes(${JSON.stringify(NAME + ' (Admin)')})`, 'angemeldet als Verwalter');
  const reiter = await b.auswerten(`[...document.querySelectorAll('.ntab[data-tab]')].map(x => x.dataset.tab)`);
  assert.ok(reiter.length >= 8, `nur ${reiter.length} Reiter`);
  for (const r of reiter) {
    await b.auswerten(`document.querySelector('.ntab[data-tab="${r}"]').click(); true`);
    await warte(700);
  }
  // Die Set-Ansicht baut am meisten Markup zur Laufzeit.
  await b.auswerten(`document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
  await bis(`!!document.querySelector('[data-click="openModal"]')`, 'Set-Karte');
  await b.auswerten(`document.querySelector('[data-click="openModal"]').click(); true`);
  await bis(`document.getElementById('m-tit').textContent.length > 0`, 'Set-Ansicht offen');
  await warte(800);
  const s = await b.auswerten(`({
    verstoesse: window.__verstoesse,
    uebrig: [...document.querySelectorAll('[data-stil]')].map(e => e.getAttribute('data-stil')).slice(0, 5),
    stilGesetzt: document.querySelectorAll('[style]').length,
  })`);
  const warnungen = b.ereignisse.filter(e => e.method === 'Runtime.consoleAPICalled')
    .map(e => e.params.args.map(a => a.value ?? '').join(' ')).filter(x => x.includes('[stile]'));

  await t.test('keine CSP-Verstösse', () => assert.deepEqual(s.verstoesse, []));
  await t.test('jedes data-stil ist angewendet', () => {
    assert.deepEqual(s.uebrig, []);
    assert.ok(s.stilGesetzt > 50, `nur ${s.stilGesetzt} Elemente mit Stil`);
  });
  await t.test('nur freigegebene Werte', () => assert.deepEqual(warnungen, []));

  // Zuletzt, weil ein Formular nach draussen ohne form-action die Seite verliesse.
  await t.test('form-action, base-uri und object-src greifen', async () => {
    assert.match(csp, /form-action 'self'/);
    // Ein Formular der App (Absenden per Enter) und ein Download bleiben ohne Verstoss.
    await b.auswerten(`document.querySelector('form[data-submit="btn-gen-qr"]')?.requestSubmit(); true`);
    await b.auswerten(`document.getElementById('btn-cfg-export')?.click(); true`);
    await warte(800);
    assert.deepEqual(await b.auswerten('window.__verstoesse'), [], 'Formular oder Download der App verletzt die CSP');
    const verletzt = await b.auswerten(`new Promise(fertig => {
      const gesehen = new Set();
      document.addEventListener('securitypolicyviolation', e => gesehen.add(e.effectiveDirective));
      const basis = document.createElement('base'); basis.href = 'https://fremd.invalid/';
      document.head.appendChild(basis);
      const obj = document.createElement('object'); obj.data = '/favicon.svg';
      document.body.appendChild(obj);
      const f = document.createElement('form'); f.action = 'https://fremd.invalid/'; f.method = 'post';
      document.body.appendChild(f); f.submit();
      setTimeout(() => fertig([...gesehen].sort()), 1500);
    })`);
    assert.deepEqual(verletzt, ['base-uri', 'form-action', 'object-src']);
  });
});
