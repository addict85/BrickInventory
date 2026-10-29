/**
 * Die echte App im echten Chrome: Server aus dist/, ein Verwalterkonto mit
 * Bestand, Chrome über das DevTools-Protokoll. Für Tests, die Layout messen
 * (Schriftgrösse, Tippziele, Sichtbarkeit) — das kann jsdom nicht.
 *
 * Ohne Chrome oder Test-DB liefert `starteApp` null; der Aufrufer überspringt.
 */
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const warte = (ms) => new Promise(r => setTimeout(r, ms));

function chrome() {
  const kandidaten = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'];
  return kandidaten.find(k => k && fs.existsSync(k)) ?? null;
}

const freierPort = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

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

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, f) => { ws.onopen = r; ws.onerror = f; });
  let n = 0; const offen = new Map(); const ereignisse = []; const hoerer = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && offen.has(d.id)) { const { r, f } = offen.get(d.id); offen.delete(d.id); d.error ? f(new Error(d.error.message)) : r(d.result); }
    else if (d.method) { ereignisse.push(d); for (const h of hoerer) h(d); }
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
  return { tab, auswerten, ereignisse, hoerer, sessionId, schliessen: () => ws.close() };
}

/**
 * @param t        Testkontext (für t.after)
 * @param opt.name Kontoname
 * @param opt.bestand async (db, uid) => {} legt Testdaten an
 * @param opt.telefon true: 390 × 844, mobile
 * @param opt.abfangen [{ muster, enthaelt, antwort }]: Anfragen, deren URL auf
 *        das CDP-Muster passt und `enthaelt` enthält, bekommen `antwort` als JSON
 */
async function starteApp(t, opt = {}) {
  const bin = chrome();
  if (!bin) return { grund: 'kein Chrome gefunden' };
  const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
  process.env.DATABASE_URL = URL_DB;
  const _req = require('./sources').buildAndRequire();
  const db = _req('db/database.js');
  const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    return { grund: 'Test-DB nicht erreichbar' };
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  const NAME = opt.name || `app_${process.pid}`, PASS = 'app-Passwort-1';
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, email, password_hash, is_active, email_verified, is_admin)
    VALUES ($1, $2, $3, 1, 1, 1) RETURNING id`, [NAME, `${NAME}@example.org`, await bcrypt.hash(PASS, 4)])).id;
  await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'language', $2)`, [uid, opt.sprache || 'de']);
  if (opt.bestand) await opt.bestand(db, uid);
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
    env: { ...process.env, DATABASE_URL: URL_DB, SESSION_SECRET: 'app-test-geheimnis-lang-genug-1234',
           PORT: String(port), WEB_WORKERS: '1', TRUST_PROXY: 'false' },
  });
  for (let i = 0; i < 240 && !/is PRIMARY|Startup complete/.test(server.log()); i++) await warte(250);
  for (let i = 0; i < 40 && (await fetch(`http://127.0.0.1:${port}/api/v1/`).catch(() => null)) === null; i++) await warte(250);

  const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'app-browser-'));
  t.after(() => fs.rmSync(profil, { recursive: true, force: true }));
  const browser = starte(t, bin, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
    `--user-data-dir=${profil}`, '--window-size=1280,900', 'about:blank'], {});
  let wsUrl = null;
  for (let i = 0; i < 100 && !wsUrl; i++) { wsUrl = /DevTools listening on (ws:\/\/\S+)/.exec(browser.log())?.[1]; await warte(100); }
  if (!wsUrl) throw new Error('Chrome meldet keinen DevTools-Zugang');
  const b = await cdp(wsUrl);
  t.after(() => b.schliessen());
  await b.tab('Runtime.enable');
  await b.tab('Page.enable');
  if (opt.abfangen?.length) {
    await b.tab('Fetch.enable', { patterns: opt.abfangen.map(a => ({ urlPattern: a.muster, requestStage: 'Request' })) });
    b.hoerer.push((d) => {
      if (d.method !== 'Fetch.requestPaused') return;
      const a = opt.abfangen.find(x => d.params.request.url.includes(x.enthaelt));
      if (!a) { b.tab('Fetch.continueRequest', { requestId: d.params.requestId }).catch(() => {}); return; }
      b.tab('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify(a.antwort)).toString('base64') }).catch(() => {});
    });
  }
  if (opt.telefon)
    await b.tab('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await b.tab('Emulation.setLocaleOverride', { locale: opt.locale || 'de-DE' });
  // Gemessen wird der Endzustand, nicht ein Übergang.
  await b.tab('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

  const bis = async (ausdruck, was, versuche = 100) => {
    for (let i = 0; i < versuche; i++) { if (await b.auswerten(ausdruck).catch(() => false)) return; await warte(100); }
    const zustand = await b.auswerten(`document.body.innerText.slice(0, 300)`).catch(e => e.message);
    throw new Error(`Zeitüberschreitung: ${was} — ${zustand}`);
  };
  await b.tab('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await bis(`typeof document.getElementById('btn-login')?.onclick === 'function'`, 'Anmeldemaske');
  await b.auswerten(`document.getElementById('lu').value = ${JSON.stringify(NAME)};
    document.getElementById('lp').value = ${JSON.stringify(PASS)};
    document.getElementById('btn-login').click(); true`);
  await bis(`document.getElementById('app')?.style.display === 'block' || getComputedStyle(document.getElementById('app')).display !== 'none'`, 'angemeldet');
  await bis(`document.body.innerText.includes(${JSON.stringify(NAME)})`, 'Kontoname sichtbar');
  return { b, bis, warte, port, uid, db };
}

module.exports = { starteApp, warte };
