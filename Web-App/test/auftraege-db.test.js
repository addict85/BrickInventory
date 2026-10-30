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
 * Seit Migration 0082 (am 30.10.2026 gemessen):
 *   E  in belegeAuftrag die Bedingung zu auftrag_pausen entfernt → rot: „eine
 *      pausierte Art wartet, eine exklusive läuft einzeln“
 *   F  in belegeAuftrag die Bedingung für exklusive Arten entfernt → rot:
 *      derselbe Test (zwei gleichzeitig)
 *   G  in verschoben() die Versuche immer zählen lassen → rot: „verschieben
 *      zählt nur, wenn es soll“
 *   H  folgeplan() im Worker leer → rot: „nach einem geplanten Lauf steht
 *      der nächste an“
 *   I  in erledigt() die Bedingung `status = 'laeuft'` entfernt → rot: „ein
 *      abgebrochener Auftrag bleibt abgebrochen“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

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
  const zeile = (id) => db.get('SELECT status, versuche, fehler, faellig_ab > NOW() AS spaeter FROM auftraege WHERE id=$1', [id]);
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
      await db.run('UPDATE auftraege SET faellig_ab = NOW() WHERE id=$1', [id]);
      assert.equal(await w.verarbeiteEinen(), true);
      assert.equal((await zeile(id)).status, 'erledigt');

      const id2 = await A.stelleAuftragEin(ART, { marke: MARKE, immer: true }, { maxVersuche: 2 });
      await w.verarbeiteEinen();
      await db.run('UPDATE auftraege SET faellig_ab = NOW() WHERE id=$1', [id2]);
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
    await t.test('eine pausierte Art wartet, eine exklusive läuft einzeln', async () => {
      await leeren();
      const EX = `${ART}-ex`;
      for (let i = 0; i < 3; i++) await A.stelleAuftragEin(EX, { marke: MARKE, n: i });
      await db.run('DELETE FROM auftrag_pausen WHERE art = $1', [EX]);
      await A.pausiereArt(EX, new Date(Date.now() + 60_000), 'Test');
      assert.equal(await A.belegeAuftrag([EX], 60, 'x', [EX]), null, 'trotz Pause belegt');
      await A.beendePause(EX);
      let gleichzeitig = 0, hoechstens = 0;
      const w = erzeugeWorker({ [EX]: { exklusiv: true, ausfuehren: async () => {
        hoechstens = Math.max(hoechstens, ++gleichzeitig); await warte(60); gleichzeitig--; } } }, { parallel: 3, taktMs: 20 });
      w.starte();
      for (let i = 0; i < 100; i++) {
        const offen = await db.get(`SELECT COUNT(*)::int AS n FROM auftraege WHERE art = $1 AND status <> 'erledigt'`, [EX]);
        if (offen.n === 0 && w.laufend() === 0) break;
        await warte(25);
      }
      await w.stoppe(0);
      assert.equal(hoechstens, 1, `${hoechstens} exklusive Aufträge liefen gleichzeitig`);
      await db.run('DELETE FROM auftraege WHERE art = $1', [EX]);
    });

    await t.test('verschieben zählt nur, wenn es soll', async () => {
      await leeren();
      const { AuftragVerschieben } = _req('jobs/auftragsWorker.js');
      let zaehlt = false;
      const w = erzeugeWorker({ [ART]: { ausfuehren: async () => {
        throw new AuftragVerschieben(new Date(Date.now() + 3_600_000), 'gedrosselt', zaehlt); } } });
      const id = await A.stelleAuftragEin(ART, { marke: MARKE }, { maxVersuche: 2 });
      await w.verarbeiteEinen();
      let z = await zeile(id);
      assert.deepEqual([z.status, z.versuche, z.fehler, z.spaeter], ['offen', 0, 'gedrosselt', true]);
      zaehlt = true;
      for (let i = 0; i < 2; i++) { await db.run('UPDATE auftraege SET faellig_ab = NOW() WHERE id=$1', [id]); await w.verarbeiteEinen(); }
      z = await zeile(id);
      assert.deepEqual([z.status, z.versuche], ['fehler', 2], 'gezählte Verschiebungen enden nach max_versuche');
    });

    await t.test('ein abgebrochener Auftrag bleibt abgebrochen', async () => {
      await leeren();
      let lebt = null;
      const w = erzeugeWorker({ [ART]: { ausfuehren: async (_n, k) => { await warte(80); lebt = await k.lebenszeichen(); } } });
      const id = await A.stelleAuftragEin(ART, { marke: MARKE });
      const lauf = w.verarbeiteEinen();
      await warte(30);
      assert.ok(await A.brichAb(id), 'ein laufender Auftrag lässt sich abbrechen');
      await lauf;
      assert.equal(lebt, false, 'der Bearbeiter erfährt vom Abbruch');
      assert.equal((await zeile(id)).status, 'abgebrochen');
      assert.equal(await A.wiederhole(id), true);
      assert.equal((await zeile(id)).status, 'offen', 'wiederholen stellt ihn neu ein');
    });

    await t.test('nach einem geplanten Lauf steht der nächste an', async () => {
      const Z = _req('utils/zeitplan.js');
      await db.run(`DELETE FROM auftraege WHERE art = 'aufraeumen'`);
      await Z.planeAlle();
      await Z.planeAlle();
      const plaene = await db.all(`SELECT faellig_ab FROM auftraege WHERE schluessel = 'plan:aufraeumen' AND status = 'offen'`);
      assert.equal(plaene.length, 1, 'planeAlle legt je Art genau einen Termin an');
      assert.ok(new Date(plaene[0].faellig_ab) > new Date(Date.now() + 55 * 60_000), 'stündlich heisst in einer Stunde');
      assert.equal(await Z.ziehePlanVor('aufraeumen'), true);
      let lief = 0;
      const w = erzeugeWorker({ aufraeumen: { ausfuehren: async () => { lief++; } } });
      assert.equal(await w.verarbeiteEinen(), true);
      assert.equal(lief, 1);
      const danach = await db.all(`SELECT status, faellig_ab FROM auftraege WHERE schluessel = 'plan:aufraeumen' ORDER BY id`);
      assert.deepEqual(danach.map(z => z.status), ['erledigt', 'offen'], 'kein Folgetermin eingetragen');
      assert.ok(new Date(danach[1].faellig_ab) > new Date(Date.now() + 55 * 60_000));
      await db.run(`DELETE FROM auftraege WHERE art = 'aufraeumen'`);
    });

    await t.test('ein PDF-Auftrag entsteht im Worker', async () => {
      const NAME = `auftrag-pdf-${process.pid}`;
      await db.run('DELETE FROM users WHERE username=$1', [NAME]);
      const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
      const pdfA = _req('utils/pdfAuftraege.js');
      const jobId = _req('utils/pdfAuftraege.js').neueJobId();
      const w = _req('jobs/auftraegeStarten.js').starteAuftragsWorker({ arten: ['pdf'], taktMs: 50 });
      try {
        await A.stelleAuftragEin('pdf', { job_id: jobId, user_id: uid, sets: [],
          parts: [{ part_number: '3001', part_name: 'Stein', color_name: 'Rot', quantity: 2 }] },
          { userId: uid, schluessel: pdfA.pdfSchluessel(jobId) });
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
