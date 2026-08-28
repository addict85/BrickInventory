/**
 * Prozessübergreifende Job-Sperren gegen eine ECHTE Datenbank.
 *
 * ── Warum das kein Quelltext-Test ist ───────────────────────────────────────
 * Eine Sperre lässt sich am Quelltext nur als Vorhandensein eines Aufrufs
 * prüfen — genau die Art Test, die in hardened-126 an der Gegenprobe
 * gescheitert ist (`if (false)` um den Aufruf und alles blieb grün). Hier wird
 * deshalb VERHALTEN geprüft: Der Test hält die Sperre selbst auf einer eigenen
 * Verbindung und schaut nach, ob der Job dann wirklich nichts tut.
 *
 * Der Nachweis in hardened-128 brauchte dafür noch einen zweiten Node-Prozess.
 * Das geht einfacher: Ein Advisory-Lock hängt an der SESSION, nicht am Prozess
 * — eine zweite Verbindung aus demselben Test wirkt für den Job wie ein
 * zweiter Worker.
 *
 * Zu jeder Sperre gehört eine Gegenprobe (ohne Sperre passiert sehr wohl
 * etwas), sonst würde der Test auch dann grün bleiben, wenn der Job gar nichts
 * mehr täte.
 *
 * Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL,
 * Default postgres://tester:test@localhost/cattest. Ohne DB: skip.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db   = _req('db/database.js');

async function dbReachable() {
  try { await db.get('SELECT 1 AS ok'); return true; } catch { return false; }
}

/** Sperre auf einer eigenen Verbindung halten — spielt den zweiten Worker. */
async function haltenAls(fremder, ns) {
  const client = await db.pool.connect();
  const { rows } = await client.query('SELECT pg_try_advisory_lock($1, 0) AS ok', [ns]);
  assert.equal(rows[0].ok, true, `${fremder}: Sperre ${ns} war schon belegt`);
  return async () => {
    await client.query('SELECT pg_advisory_unlock($1, 0)', [ns]).catch(() => {});
    client.release();
  };
}

const QUEUE_LOCK = 56;
const REDL_LOCK  = 57;

test('Job-Sperren wirken über Prozessgrenzen', async (t) => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    if (process.env.REQUIRE_DB === '1') {
      throw new Error('REQUIRE_DB=1, aber die Test-Datenbank ist nicht erreichbar.');
    }
    t.skip('Test-DB nicht erreichbar — Suite übersprungen');
    return;
  }

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();

  const queue = _req('jobs/instructionQueue.js');

  /**
   * Einen Eintrag vorbereiten, dessen Bearbeitung OHNE Netzaufruf auskommt:
   * Liegt die Anleitung schon in shared_instructions, hakt processNext() die
   * Zeile nur ab. Damit prüft der Test die Sperre und nicht Brickset.
   */
  async function eintragVorbereiten(sn) {
    await db.run('DELETE FROM instruction_queue');
    await db.run('DELETE FROM shared_instructions');
    await db.run(`INSERT INTO instruction_queue (set_number, status) VALUES ($1,'pending')`, [sn]);
    await db.run(
      `INSERT INTO shared_instructions (set_number, url, description) VALUES ($1,$2,'x')`,
      [sn, `https://example.invalid/${sn}.pdf`]);
  }
  const status = async (sn) =>
    (await db.get('SELECT status FROM instruction_queue WHERE set_number=$1', [sn]))?.status;

  await t.test('Gegenprobe: ohne fremde Sperre wird der Eintrag abgearbeitet', async () => {
    await eintragVorbereiten('10280-1');
    await queue.processNext();
    assert.equal(await status('10280-1'), 'done',
      'processNext() hat den Eintrag nicht abgehakt — der Rest dieser Suite prüft dann nichts');
  });

  await t.test('hält ein anderer Worker die Sperre, rührt processNext() nichts an', async () => {
    await eintragVorbereiten('10277-1');
    const freigeben = await haltenAls('zweiter Worker', QUEUE_LOCK);
    try {
      await queue.processNext();
      assert.equal(await status('10277-1'), 'pending',
        'zwei Worker haben denselben Eintrag gezogen — die Anleitung würde doppelt geholt');
    } finally { await freigeben(); }
  });

  await t.test('die Cloudflare-Pause gilt prozessübergreifend, nicht nur im blockierten Worker', async () => {
    await eintragVorbereiten('10290-1');
    await db.run(
      `INSERT INTO global_settings (key, value) VALUES ('instr_queue_block', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [JSON.stringify({ until: Date.now() + 10 * 60 * 1000, retries: 1 })]);
    try {
      await queue.processNext();
      assert.equal(await status('10290-1'), 'pending',
        'Backoff missachtet — ein zweiter Worker läuft in die nächste Cloudflare-Sperre');
    } finally {
      await db.run(`DELETE FROM global_settings WHERE key='instr_queue_block'`);
    }
  });

  await t.test('requestRun() setzt nur das Flag, arbeitet aber nichts ab', async () => {
    await eintragVorbereiten('10283-1');
    await db.run(`DELETE FROM global_settings WHERE key='instr_queue_trigger'`);
    await queue.requestRun();
    const flag = await db.get(`SELECT value FROM global_settings WHERE key='instr_queue_trigger'`);
    assert.ok(flag?.value, 'kein Trigger gesetzt — der Primary erfährt nie von der Arbeit');
    assert.equal(await status('10283-1'), 'pending',
      'requestRun() hat selbst abgearbeitet — dann läuft die Queue wieder im Request-Worker');
  });

  await t.test('der Bilder-Nachlauf startet nicht zweimal', async () => {
    const enrich = _req('jobs/partsCatalogEnrich.js');
    // Gegenprobe: ohne fremde Sperre läuft er durch (leerer Katalog → 0 fehlende).
    const frei = await enrich.redownloadMissingImages();
    assert.equal(frei.alreadyRunning, undefined,
      'Lauf wurde ohne fremde Sperre abgewiesen');

    const freigeben = await haltenAls('zweiter Worker', REDL_LOCK);
    try {
      const gesperrt = await enrich.redownloadMissingImages();
      assert.equal(gesperrt.alreadyRunning, true,
        'zweiter Lauf gestartet — dieselben Bilder würden doppelt vom CDN geladen');
    } finally { await freigeben(); }
  });

  await db.pool.end().catch(() => {});
});
