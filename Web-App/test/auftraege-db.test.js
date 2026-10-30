/**
 * Die Auftragstabelle (Migration 0066, utils/auftraege.ts, jobs/auftragsWorker.ts):
 * Ein Auftrag überlebt das Ende seines Prozesses, ein Fehler wird wiederholt
 * und endet nach dem letzten Versuch als 'fehler', und zwei Worker führen
 * nie denselben Auftrag aus.
 *
 * Gegenproben (am 29.10.2026 gemessen):
 *   A  in belegeAuftrag nur `status = 'offen'` statt `IN ('offen', 'laeuft')`
 *      → rot: „ein verwaister Auftrag wird nach seiner Frist erledigt“
 *   B  in fehlgeschlagen immer 'fehler' statt 'offen' → rot: „ein Fehler wird
 *      wiederholt“
 *   C  `FOR UPDATE SKIP LOCKED` aus belegeAuftrag entfernt → rot: „zwei Worker,
 *      jeder Auftrag genau einmal“ (Aufträge doppelt ausgeführt)
 *   D  der PDF-Auftrag ohne Bearbeiter (BEARBEITER.pdf entfernt) → rot: „ein
 *      PDF-Auftrag entsteht im Worker“ (Status blieb running)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const warte = (ms) => new Promise(r => setTimeout(r, ms));

test('Auftragstabelle', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }
  const A = _req('utils/auftraege.js');
  const { erzeugeWorker } = _req('jobs/auftragsWorker.js');
  // Nur Zeilen dieses Tests: eine eigene Art, die kein anderer Worker kennt.
  const ART = `test-${process.pid}`;
  const MARKE = `test-${process.pid}`;
  const leeren = () => db.run(`DELETE FROM auftraege WHERE nutzlast->>'marke' = $1`, [MARKE]);
  const zeile = (id) => db.get('SELECT status, versuche, fehler, next_run_at > NOW() AS spaeter FROM auftraege WHERE id=$1', [id]);
  await leeren();

  try {
    await t.test('ein verwaister Auftrag wird nach seiner Frist erledigt', async () => {
      const id = await A.stelleAuftragEin(ART, { marke: MARKE, n: 1 });
      // Ein Prozess belegt ihn mit einer Frist von einer Sekunde und endet dann.
      const tot = await A.belegeAuftrag([ART], 1);
      assert.equal(tot.id, id);
      const erledigt = [];
      const w = erzeugeWorker({ [ART]: { ausfuehren: async (n) => { erledigt.push(n.n); } } }, { fristSek: 60 });
      assert.equal(await w.verarbeiteEinen(), false, 'vor Ablauf der Frist gehört er noch dem anderen');
      await warte(1200);
      assert.equal(await w.verarbeiteEinen(), true);
      assert.deepEqual(erledigt, [1]);
      assert.equal((await zeile(id)).status, 'erledigt');
      assert.equal((await zeile(id)).versuche, 2);
    });

    await t.test('ein Fehler wird wiederholt und endet nach dem letzten Versuch', async () => {
      await leeren();
      let mal = 0;
      const aufgegeben = [];
      const w = erzeugeWorker({ [ART]: {
        ausfuehren: async (n) => { mal++; if (n.immer || mal === 1) throw new Error('Quelle weg'); },
        aufgegeben: async (n, fehler) => { aufgegeben.push(fehler); },
      } });
      const id = await A.stelleAuftragEin(ART, { marke: MARKE }, { maxVersuche: 3 });
      assert.equal(await w.verarbeiteEinen(), true);
      const nachFehler = await zeile(id);
      assert.equal(nachFehler.status, 'offen', 'ein Fehler wird wiederholt');
      assert.equal(nachFehler.fehler, 'Quelle weg');
      assert.equal(nachFehler.spaeter, true, 'mit Wartezeit, nicht sofort');
      assert.equal(await w.verarbeiteEinen(), false);
      await db.run('UPDATE auftraege SET next_run_at = NOW() WHERE id=$1', [id]);
      assert.equal(await w.verarbeiteEinen(), true);
      assert.equal((await zeile(id)).status, 'erledigt');

      const id2 = await A.stelleAuftragEin(ART, { marke: MARKE, immer: true }, { maxVersuche: 2 });
      await w.verarbeiteEinen();
      await db.run('UPDATE auftraege SET next_run_at = NOW() WHERE id=$1', [id2]);
      await w.verarbeiteEinen();
      assert.equal((await zeile(id2)).status, 'fehler');
      assert.deepEqual(aufgegeben, ['Quelle weg'], 'aufgegeben genau einmal, nach dem letzten Versuch');
    });

    await t.test('derselbe Schlüssel steht nur einmal offen', async () => {
      await leeren();
      const a = await A.stelleAuftragEin(ART, { marke: MARKE }, { schluessel: `${MARKE}:s` });
      const b = await A.stelleAuftragEin(ART, { marke: MARKE }, { schluessel: `${MARKE}:s` });
      assert.ok(a);
      assert.equal(b, null);
    });

    await t.test('zwei Worker, jeder Auftrag genau einmal', async () => {
      await leeren();
      const N = 40;
      for (let i = 0; i < N; i++) await A.stelleAuftragEin(ART, { marke: MARKE, n: i });
      const laeufe = [];
      const bearbeiter = { [ART]: { ausfuehren: async (n) => { laeufe.push(n.n); await warte(15); } } };
      const w1 = erzeugeWorker(bearbeiter, { parallel: 4, taktMs: 20 });
      const w2 = erzeugeWorker(bearbeiter, { parallel: 4, taktMs: 20 });
      w1.starte(); w2.starte();
      for (let i = 0; i < 200; i++) {
        const offen = await db.get(`SELECT COUNT(*)::int AS n FROM auftraege WHERE nutzlast->>'marke' = $1 AND status <> 'erledigt'`, [MARKE]);
        if (offen.n === 0 && w1.laufend() === 0 && w2.laufend() === 0) break;
        await warte(25);
      }
      await w1.stoppe(0); await w2.stoppe(0);
      const doppelt = laeufe.filter((n, i) => laeufe.indexOf(n) !== i);
      assert.deepEqual(doppelt, [], 'Aufträge doppelt ausgeführt');
      assert.equal(new Set(laeufe).size, N);
    });
    await t.test('ein PDF-Auftrag entsteht im Worker', async () => {
      const NAME = `auftrag-pdf-${process.pid}`;
      await db.run('DELETE FROM users WHERE username=$1', [NAME]);
      const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
      const pdfA = _req('utils/pdfAuftraege.js');
      const jobId = _req('utils/pdfAuftraege.js').neueJobId();
      const w = _req('jobs/auftraegeStarten.js').starteAuftragsWorker({ arten: ['pdf'], taktMs: 50 });
      try {
        await pdfA.schreibeAuftrag(jobId, { status: 'running', error: null, user_id: uid });
        await A.stelleAuftragEin('pdf', { job_id: jobId, user_id: uid, sets: [],
          parts: [{ part_number: '3001', part_name: 'Stein', color_name: 'Rot', quantity: 2 }] }, { userId: uid });
        let stand;
        for (let i = 0; i < 200; i++) { stand = await pdfA.liesAuftrag(jobId); if (stand?.status !== 'running') break; await warte(25); }
        assert.equal(stand?.status, 'done', JSON.stringify(stand));
        const datei = pdfA.pdfDateiPfad(jobId);
        assert.equal(require('node:fs').readFileSync(datei).subarray(0, 5).toString(), '%PDF-');
        require('node:fs').rmSync(datei, { force: true });
      } finally {
        await _req('jobs/auftraegeStarten.js').stoppeAuftragsWorker();
        await db.run('DELETE FROM users WHERE id=$1', [uid]);
      }
    });
  } finally {
    await leeren();
    await _req('utils/pgNotify.js').close();
    await db.pool.end().catch(() => {});
  }
});
