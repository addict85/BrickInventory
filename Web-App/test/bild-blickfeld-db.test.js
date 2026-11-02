/**
 * Set-Bilder und Anleitungen gibt es nur zu Sets im eigenen Blickfeld
 * (Haushalt eingeschlossen); ein fremdes antwortet wie ein fehlendes (404).
 * Teilebilder sind Katalog und bleiben für jedes Konto offen. Gefragt wird der
 * echte Server mit echten Dateien unter data/.
 *
 * Gegenproben (01.11.2026 gemessen):
 *   A  die Prüfung bildFreigegeben() in server.ts entfernt → rot: „ein fremdes
 *      Set-Bild antwortet …“ (200 statt 404) und „das Hauptkonto sieht …“
 *   B  anleitungFreigegeben() in routes/datenDateien.ts entfernt → rot:
 *      „Anleitungen nur zu eigenen Sets“ (200 statt 404)
 *   C  bildFreigegeben() lässt nur sets/ durch (Teile wie Sets geprüft) → rot:
 *      „Teilebilder sind Katalog“ (404)
 *   D  scopeIds() durch [uid] ersetzt → rot: „das Hauptkonto sieht …“,
 *      „Anleitungen nur zu eigenen Sets“ und „die API nennt …“
 *   E  in GET /sets/info den Abgleich mit setBildSichtbar() entfernt → rot:
 *      „die API nennt fremde lokale Bilder nicht“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATABASE_URL = URL_DB;
const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const warte = (ms) => new Promise(r => setTimeout(r, ms));
const freierPort = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

const P = process.pid;
const SN = { unter: `BBU${P}-1`, fremd: `BBF${P}-1`, gemerkt: `BBW${P}-1`, keins: `BBX${P}-1` };
const TEIL = `BBT${P}_0.png`;
const DATEN = path.join(ROOT, 'data');
const DATEIEN = [
  ['images/sets', `${SN.unter}.jpg`], ['images/sets', `${SN.unter}_thumb.jpg`],
  ['images/sets', `${SN.fremd}.jpg`], ['images/sets', `${SN.gemerkt}.jpg`], ['images/parts', TEIL],
  ['instructions', `${SN.unter}_1.pdf`], ['instructions', `${SN.fremd}_1.pdf`], ['instructions', `${SN.gemerkt}_bdp.pdf`],
].map(([o, n]) => path.join(DATEN, o, n));

test('Bilder und Anleitungen im Blickfeld', { concurrency: 1, timeout: 180_000 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }

  const namen = ['bb_haupt', 'bb_unter', 'bb_fremd'].map(n => `${n}_${P}`);
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  const ids = [];
  for (const n of namen) ids.push((await db.get(`INSERT INTO users (username, password_hash, is_active, email_verified)
    VALUES ($1, 'x', true, true) RETURNING id`, [n])).id);
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [ids[0], ids[1]]);
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2), ($3, $4)', [ids[1], SN.unter, ids[2], SN.fremd]);
  await db.run('INSERT INTO wanted (user_id, set_number) VALUES ($1, $2)', [ids[0], SN.gemerkt]);
  for (const sn of [SN.unter, SN.fremd])
    await db.run('INSERT INTO set_catalog (set_number, name, image_local) VALUES ($1, $1, $2) ON CONFLICT DO NOTHING',
      [sn, `/images/sets/${sn}.jpg`]);
  for (const f of DATEIEN) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, `Inhalt ${path.basename(f)}`); }
  const auth = _req('src/konto/auth.js');
  const token = {};
  for (const [k, id] of [['haupt', ids[0]], ['unter', ids[1]], ['fremd', ids[2]]]) token[k] = await auth.createToken(id, 'Prüfung', true);
  t.after(async () => {
    for (const f of DATEIEN) fs.rmSync(f, { force: true });
    await db.run('DELETE FROM set_catalog WHERE set_number = ANY($1)', [[SN.unter, SN.fremd]]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const port = await freierPort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: URL_DB, SESSION_SECRET: 'blickfeld-test-geheimnis-lang-genug-1234',
           PORT: String(port), TRUST_PROXY: 'false' },
  });
  let log = '';
  srv.stdout.on('data', d => { log += d; });
  srv.stderr.on('data', d => { log += d; });
  t.after(async () => {
    srv.kill('SIGTERM');
    for (let i = 0; i < 40 && srv.exitCode === null && srv.signalCode === null; i++) await warte(100);
    if (srv.exitCode === null && srv.signalCode === null) srv.kill('SIGKILL');
  });
  for (let i = 0; i < 240 && !/localhost:\d+|Startup complete/.test(log); i++) await warte(250);
  for (let i = 0; i < 40 && (await fetch(`http://127.0.0.1:${port}/api/v1/health`).catch(() => null)) === null; i++) await warte(250);

  const hole = async (wer, weg) => {
    const r = await fetch(`http://127.0.0.1:${port}${weg}`, { redirect: 'manual', headers: { Authorization: `Bearer ${token[wer]}` } });
    return { status: r.status, text: await r.text() };
  };
  const bild = (sn, zusatz = '') => `/images/sets/${sn}${zusatz}.jpg`;

  await t.test('das eigene Set-Bild samt Vorschau', async () => {
    assert.equal((await hole('unter', bild(SN.unter))).status, 200);
    assert.equal((await hole('unter', bild(SN.unter, '_thumb'))).text, `Inhalt ${SN.unter}_thumb.jpg`);
    assert.equal((await hole('fremd', bild(SN.fremd))).status, 200);
  });

  await t.test('das Hauptkonto sieht das Bild des Unterkontos, nicht umgekehrt', async () => {
    assert.equal((await hole('haupt', bild(SN.unter))).status, 200);
    assert.equal((await hole('haupt', bild(SN.gemerkt))).status, 200, 'die eigene Merkliste gehört zum Blickfeld');
    assert.equal((await hole('unter', bild(SN.gemerkt))).status, 404);
  });

  await t.test('ein fremdes Set-Bild antwortet wie ein fehlendes', async () => {
    const fremd = await hole('haupt', bild(SN.fremd));
    const keins = await hole('haupt', bild(SN.keins));
    assert.equal(fremd.status, 404, log.slice(-500));
    assert.deepEqual(fremd, keins);
    assert.equal((await hole('fremd', bild(SN.unter, '_thumb'))).status, 404);
  });

  await t.test('Teilebilder sind Katalog', async () => {
    assert.equal((await hole('fremd', `/images/parts/${TEIL}`)).status, 200);
  });

  await t.test('Anleitungen nur zu eigenen Sets', async () => {
    assert.equal((await hole('haupt', `/data/instructions/${SN.unter}_1.pdf`)).status, 200);
    assert.equal((await hole('fremd', `/data/instructions/${SN.fremd}_1.pdf`)).status, 200);
    const fremd = await hole('haupt', `/data/instructions/${SN.fremd}_1.pdf`);
    assert.equal(fremd.status, 404);
    assert.deepEqual(fremd, await hole('haupt', `/data/instructions/${SN.keins}_1.pdf`));
    assert.equal((await hole('haupt', `/data/instructions/${SN.gemerkt}_bdp.pdf`)).status, 404, 'gemerkt ist nicht besessen');
  });

  await t.test('die API nennt fremde lokale Bilder nicht', async () => {
    const info = async (sn) => JSON.parse((await hole('haupt', `/api/v1/sets/info/${sn}`)).text);
    assert.equal((await info(SN.unter)).image_local, `/images/sets/${SN.unter}.jpg`);
    assert.equal((await info(SN.fremd)).image_local, null);
  });
});
