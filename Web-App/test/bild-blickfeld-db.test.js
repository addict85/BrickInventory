/**
 * Anleitungen gibt es nur zu Sets im eigenen Blickfeld (Haushalt
 * eingeschlossen); eine fremde antwortet wie eine fehlende (404). Set- und
 * Teilebilder sind Katalog und gehen an jedes angemeldete Konto (Entscheidung
 * zu Migration 0105). Gefragt wird der echte Server mit echten Dateien unter data/.
 *
 * Gegenproben (01.11.2026 gemessen, A und E am 10.11.2026 neu):
 *   A  bildFreigegeben() prüft sets/ wieder gegen das Blickfeld
 *      (`imBlickfeld(uid, stamm, 'nummern')`) → rot: „Set-Bilder gehen an jedes
 *      angemeldete Konto“ (404 statt 200)
 *   B  anleitungFreigegeben() in routes/datenDateien.ts entfernt → rot:
 *      „Anleitungen nur zu eigenen Sets“ (200 statt 404)
 *   C  bildFreigegeben() lässt nur sets/ durch (Teile wie Sets geprüft) → rot:
 *      „Teilebilder sind Katalog“ (404)
 *   D  blickfeldIds() durch [uid] ersetzt → rot: „Anleitungen nur zu eigenen Sets“
 *   E  in setInfoFuerKonto() (src/sets/inhalt.ts) image_local für Sets ausserhalb
 *      des Blickfelds wieder auf null → rot: „die API nennt das lokale Bild jedes Sets“
 *   F  beiHaushaltsaenderung() in bildBlickfeld.ts nicht aufgerufen (60 s
 *      Treffer-Frist bleibt) → rot: „nach dem Lösen der Verknüpfung …“ (200 statt 404)
 *   G  (08.11.2026) liefereBild ohne die 401-Zeile bzw. mit `public` statt
 *      `private` → rot: „ohne Anmeldung kein Bild …“
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
const { katalogSet } = require('./helpers/bestand');
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');
const { warte } = require('./helpers/zeit');
const freierPort = () =>
  new Promise(r => {
    const s = net.createServer().listen(0, () => {
      const p = s.address().port;
      s.close(() => r(p));
    });
  });

const P = process.pid;
const SN = { unter: `BBU${P}-1`, fremd: `BBF${P}-1`, gemerkt: `BBW${P}-1`, keins: `BBX${P}-1` };
const TEIL = `BBT${P}_0.png`;
const DATEN = path.join(ROOT, 'data');
const DATEIEN = [
  ['images/sets', `${SN.unter}.jpg`],
  ['images/sets', `${SN.unter}_thumb.jpg`],
  ['images/sets', `${SN.fremd}.jpg`],
  ['images/sets', `${SN.gemerkt}.jpg`],
  ['images/parts', TEIL],
  ['instructions', `${SN.unter}_1.pdf`],
  ['instructions', `${SN.fremd}_1.pdf`],
  ['instructions', `${SN.gemerkt}_bdp.pdf`],
].map(([o, n]) => path.join(DATEN, o, n));

test('Bilder und Anleitungen im Blickfeld', { concurrency: 1, timeout: 180_000 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;

  const namen = ['bb_haupt', 'bb_unter', 'bb_fremd'].map(n => `${n}_${P}`);
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  const ids = [];
  for (const n of namen)
    ids.push(
      (
        await db.get(
          `INSERT INTO users (username, password_hash, is_active, email_verified)
    VALUES ($1, 'x', true, true) RETURNING id`,
          [n],
        )
      ).id,
    );
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [ids[0], ids[1]]);
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2), ($3, $4)', [
    ids[1],
    SN.unter,
    ids[2],
    SN.fremd,
  ]);
  await db.run('INSERT INTO wanted (user_id, set_number) VALUES ($1, $2)', [ids[0], SN.gemerkt]);
  for (const sn of [SN.unter, SN.fremd]) await katalogSet(db, sn, { name: sn, image_local: `/images/sets/${sn}.jpg` });
  for (const f of DATEIEN) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, `Inhalt ${path.basename(f)}`);
  }
  const auth = _req('src/konto/geraeteToken.js');
  const token = {};
  for (const [k, id] of [
    ['haupt', ids[0]],
    ['unter', ids[1]],
    ['fremd', ids[2]],
  ])
    token[k] = await auth.createToken(id, 'Prüfung', true);
  t.after(async () => {
    for (const f of DATEIEN) fs.rmSync(f, { force: true });
    await db.run('DELETE FROM rb_sets WHERE set_num = ANY($1)', [[SN.unter, SN.fremd]]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const port = await freierPort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DATABASE_URL: URL_DB,
      SESSION_SECRET: 'blickfeld-test-geheimnis-lang-genug-1234',
      PORT: String(port),
      TRUST_PROXY: 'false',
    },
  });
  let log = '';
  srv.stdout.on('data', d => {
    log += d;
  });
  srv.stderr.on('data', d => {
    log += d;
  });
  t.after(async () => {
    srv.kill('SIGTERM');
    for (let i = 0; i < 40 && srv.exitCode === null && srv.signalCode === null; i++) await warte(100);
    if (srv.exitCode === null && srv.signalCode === null) srv.kill('SIGKILL');
  });
  for (let i = 0; i < 240 && !/localhost:\d+|Startup complete/.test(log); i++) await warte(250);
  for (let i = 0; i < 40 && (await fetch(`http://127.0.0.1:${port}/api/v1/health`).catch(() => null)) === null; i++)
    await warte(250);

  const hole = async (wer, weg) => {
    const r = await fetch(`http://127.0.0.1:${port}${weg}`, {
      redirect: 'manual',
      headers: { Authorization: `Bearer ${token[wer]}` },
    });
    return { status: r.status, text: await r.text() };
  };
  const bild = (sn, zusatz = '') => `/images/sets/${sn}${zusatz}.jpg`;

  await t.test('ohne Anmeldung kein Bild und keine Anleitung, und Bilder nur privat zwischengespeichert', async () => {
    for (const weg of [bild(SN.unter), `/images/parts/${TEIL}`, `/data/instructions/${SN.unter}_1.pdf`]) {
      const r = await fetch(`http://127.0.0.1:${port}${weg}`, { redirect: 'manual' });
      const text = await r.text();
      assert.ok([401, 403].includes(r.status), `${weg} ohne Anmeldung: ${r.status}`);
      assert.doesNotMatch(text, /^Inhalt /, `${weg} lieferte die Datei ohne Anmeldung aus`);
    }
    const r = await fetch(`http://127.0.0.1:${port}${bild(SN.unter)}`, {
      headers: { Authorization: `Bearer ${token.unter}` },
    });
    await r.text();
    assert.match(
      String(r.headers.get('cache-control')),
      /^private\b/,
      'Bilder hinter Anmeldung dürfen nicht public zwischengespeichert werden',
    );
  });

  await t.test('das eigene Set-Bild samt Vorschau', async () => {
    assert.equal((await hole('unter', bild(SN.unter))).status, 200);
    assert.equal((await hole('unter', bild(SN.unter, '_thumb'))).text, `Inhalt ${SN.unter}_thumb.jpg`);
    assert.equal((await hole('fremd', bild(SN.fremd))).status, 200);
  });

  await t.test('Set-Bilder gehen an jedes angemeldete Konto', async () => {
    for (const [wer, sn] of [
      ['haupt', SN.unter],
      ['haupt', SN.gemerkt],
      ['unter', SN.gemerkt],
      ['haupt', SN.fremd],
    ]) {
      const r = await hole(wer, bild(sn));
      assert.deepEqual(r, { status: 200, text: `Inhalt ${sn}.jpg` }, `${wer} → ${sn}`);
    }
    assert.equal((await hole('fremd', bild(SN.unter, '_thumb'))).status, 200);
    assert.equal((await hole('haupt', bild(SN.keins))).status, 404, 'eine fehlende Datei bleibt 404');
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
    assert.equal(
      (await hole('haupt', `/data/instructions/${SN.gemerkt}_bdp.pdf`)).status,
      404,
      'gemerkt ist nicht besessen',
    );
  });

  await t.test('die API nennt das lokale Bild jedes Sets', async () => {
    const info = async sn => JSON.parse((await hole('haupt', `/api/v1/sets/info/${sn}`)).text);
    assert.equal((await info(SN.unter)).image_local, `/images/sets/${SN.unter}.jpg`);
    assert.equal((await info(SN.fremd)).image_local, `/images/sets/${SN.fremd}.jpg`);
  });

  await t.test('nach dem Lösen der Verknüpfung sieht das Hauptkonto die Anleitung sofort nicht mehr', async () => {
    assert.equal(
      (await hole('haupt', `/data/instructions/${SN.unter}_1.pdf`)).status,
      200,
      'vorher: im Zwischenspeicher als Treffer',
    );
    const r = await fetch(`http://127.0.0.1:${port}/api/v1/settings/household/unlink`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.unter}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ main_user_id: ids[0] }),
    });
    assert.equal(r.status, 200, await r.text());
    assert.equal((await hole('haupt', `/data/instructions/${SN.unter}_1.pdf`)).status, 404);
    assert.equal((await hole('haupt', bild(SN.unter))).status, 200, 'das Set-Bild bleibt Katalog');
  });
});
