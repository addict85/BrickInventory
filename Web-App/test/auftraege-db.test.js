/**
 * Die Auftragstabelle (Migration 0066, src/jobQueue/jobs.ts, jobs/jobWorker.ts):
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
 *   D  der PDF-Auftrag ohne Bearbeiter (EDITOR.pdf entfernt) → rot: „ein
 *      PDF-Auftrag entsteht im Worker“ (Status blieb running)
 *
 * Seit Migration 0082 (am 30.10.2026 gemessen):
 *   E  in belegeAuftrag die Bedingung zu job_pauses entfernt → rot: „eine
 *      pausierte Art waiting, eine exklusive läuft einzeln“
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

const { buildAndRequire, testData, testAccess, asAccount } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { warte, bis } = require('./helpers/zeit');

test('Auftragstabelle', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const A = Object.assign({}, _req('src/jobQueue/jobs.js'), {
    ..._req('src/jobQueue/service.js'),
    ...require('./helpers/sources').testArea('jobQueue').auftraege,
  });
  const { createWorker } = _req('jobs/jobWorker.js');
  // Nur Zeilen dieses Tests: eine eigene Art, die kein anderer Worker kennt.
  const ART = `test-${process.pid}`;
  const MARKE = `test-${process.pid}`;
  // Eine Testart braucht wie jede andere ein Schema für ihre Nutzlast.
  // … und eine Zeile in job_types (0109).
  for (const type of [ART, `${ART}-ex`]) {
    require('./helpers/sources')
      .testServices()
      .jobQueue.reportKindAn({ art: type, nutzlast: require('zod').looseObject({}), ausfuehren: async () => {} });
    await db.run('INSERT INTO job_types (type) VALUES ($1) ON CONFLICT DO NOTHING', [type]);
  }
  const leeren = () => db.run(`DELETE FROM jobs WHERE payload->>'marke' = $1`, [MARKE]);
  const zeile = id =>
    db.get('SELECT status, attempts, error_message, due_at > NOW() AS spaeter FROM jobs WHERE id=$1', [id]);
  await leeren();

  try {
    await t.test('ein verwaister Auftrag wird nach seiner Frist erledigt', async () => {
      const id = await A.placeJobOne(ART, { marke: MARKE, n: 1 });
      // Ein Prozess belegt ihn mit einer Frist von einer Sekunde und endet dann.
      const tot = await A.belegeAuftrag([ART], 1);
      assert.equal(tot.id, id);
      const erledigt = [];
      const w = createWorker(
        require('./helpers/sources').testServices().jobQueue,
        {
          [ART]: {
            ausfuehren: async n => {
              erledigt.push(n.n);
            },
          },
        },
        { deadlineSec: 60 },
      );
      assert.equal(await w.processOne(), false, 'vor Ablauf der Frist gehört er noch dem anderen');
      // Die Frist des toten Prozesses läuft ab; dann nimmt ihn der zweite.
      assert.ok(await bis(() => w.processOne(), 5000), 'nach Ablauf der Frist übernimmt der Worker');
      assert.deepEqual(erledigt, [1]);
      assert.equal((await zeile(id)).status, 'erledigt');
      assert.equal((await zeile(id)).attempts, 2);
    });

    await t.test('ein Fehler wird wiederholt und endet nach dem letzten Versuch', async () => {
      await leeren();
      let mal = 0;
      const aufgegeben = [];
      const w = createWorker(require('./helpers/sources').testServices().jobQueue, {
        [ART]: {
          ausfuehren: async n => {
            mal++;
            if (n.immer || mal === 1) throw new Error('Quelle weg');
          },
          aufgegeben: async (_n, error_message) => {
            aufgegeben.push(error_message);
          },
        },
      });
      const id = await A.placeJobOne(ART, { marke: MARKE }, { maxAttempts: 3 });
      assert.equal(await w.processOne(), true);
      const afterError = await zeile(id);
      assert.equal(afterError.status, 'offen', 'ein Fehler wird wiederholt');
      assert.equal(afterError.error_message, 'Quelle weg');
      assert.equal(afterError.spaeter, true, 'mit Wartezeit, nicht sofort');
      assert.equal(await w.processOne(), false);
      await db.run('UPDATE jobs SET due_at = NOW() WHERE id=$1', [id]);
      assert.equal(await w.processOne(), true);
      assert.equal((await zeile(id)).status, 'erledigt');

      const id2 = await A.placeJobOne(ART, { marke: MARKE, immer: true }, { maxAttempts: 2 });
      await w.processOne();
      await db.run('UPDATE jobs SET due_at = NOW() WHERE id=$1', [id2]);
      await w.processOne();
      assert.equal((await zeile(id2)).status, 'fehler');
      assert.deepEqual(aufgegeben, ['Quelle weg'], 'aufgegeben genau einmal, nach dem letzten Versuch');
    });

    await t.test('derselbe Schlüssel steht nur einmal offen', async () => {
      await leeren();
      const a = await A.placeJobOne(ART, { marke: MARKE }, { schluessel: `${MARKE}:s` });
      const b = await A.placeJobOne(ART, { marke: MARKE }, { schluessel: `${MARKE}:s` });
      assert.ok(a);
      assert.equal(b, null);
    });

    await t.test('zwei Worker, jeder Auftrag genau einmal', async () => {
      await leeren();
      const N = 40;
      for (let i = 0; i < N; i++) await A.placeJobOne(ART, { marke: MARKE, n: i });
      const runs = [];
      const editor = {
        [ART]: {
          ausfuehren: async n => {
            runs.push(n.n);
            await warte(15);
          },
        },
      };
      const w1 = createWorker(require('./helpers/sources').testServices().jobQueue, editor, {
        parallel: 4,
        taktMs: 20,
      });
      const w2 = createWorker(require('./helpers/sources').testServices().jobQueue, editor, {
        parallel: 4,
        taktMs: 20,
      });
      w1.starte();
      w2.starte();
      for (let i = 0; i < 200; i++) {
        const offen = await db.get(
          `SELECT COUNT(*)::int AS n FROM jobs WHERE payload->>'marke' = $1 AND status <> 'erledigt'`,
          [MARKE],
        );
        if (offen.n === 0 && w1.laufend() === 0 && w2.laufend() === 0) break;
        await warte(25);
      }
      await w1.stop(0);
      await w2.stop(0);
      const doppelt = runs.filter((n, i) => runs.indexOf(n) !== i);
      assert.deepEqual(doppelt, [], 'Aufträge doppelt ausgeführt');
      assert.equal(new Set(runs).size, N);
    });
    await t.test('eine pausierte Art waiting, eine exklusive läuft einzeln', async () => {
      await leeren();
      const EX = `${ART}-ex`;
      for (let i = 0; i < 3; i++) await A.placeJobOne(EX, { marke: MARKE, n: i });
      await db.run('DELETE FROM job_pauses WHERE type = $1', [EX]);
      await A.pauseKind(EX, new Date(Date.now() + 60_000), 'Test');
      assert.equal(await A.belegeAuftrag([EX], 60, 'x', [EX]), null, 'trotz Pause belegt');
      await A.endPause(EX);
      let gleichzeitig = 0,
        hoechstens = 0;
      const w = createWorker(
        require('./helpers/sources').testServices().jobQueue,
        {
          [EX]: {
            exklusiv: true,
            ausfuehren: async () => {
              hoechstens = Math.max(hoechstens, ++gleichzeitig);
              await warte(60);
              gleichzeitig--;
            },
          },
        },
        { parallel: 3, taktMs: 20 },
      );
      w.starte();
      for (let i = 0; i < 100; i++) {
        const offen = await db.get(`SELECT COUNT(*)::int AS n FROM jobs WHERE type = $1 AND status <> 'erledigt'`, [
          EX,
        ]);
        if (offen.n === 0 && w.laufend() === 0) break;
        await warte(25);
      }
      await w.stop(0);
      assert.equal(hoechstens, 1, `${hoechstens} exklusive Aufträge liefen gleichzeitig`);
      await db.run('DELETE FROM jobs WHERE type = $1', [EX]);
    });

    await t.test('verschieben zählt nur, wenn es soll', async () => {
      await leeren();
      const { JobMove } = _req('jobs/jobWorker.js');
      let zaehlt = false;
      const w = createWorker(require('./helpers/sources').testServices().jobQueue, {
        [ART]: {
          ausfuehren: async () => {
            throw new JobMove(new Date(Date.now() + 3_600_000), 'gedrosselt', zaehlt);
          },
        },
      });
      const id = await A.placeJobOne(ART, { marke: MARKE }, { maxAttempts: 2 });
      await w.processOne();
      let z = await zeile(id);
      assert.deepEqual([z.status, z.attempts, z.error_message, z.spaeter], ['offen', 0, 'gedrosselt', true]);
      zaehlt = true;
      for (let i = 0; i < 2; i++) {
        await db.run('UPDATE jobs SET due_at = NOW() WHERE id=$1', [id]);
        await w.processOne();
      }
      z = await zeile(id);
      assert.deepEqual([z.status, z.attempts], ['fehler', 2], 'gezählte Verschiebungen enden nach max_attempts');
    });

    await t.test('ein abgebrochener Auftrag bleibt abgebrochen', async () => {
      await leeren();
      let lebt = null;
      // Ohne feste Wartezeiten: Der Bearbeiter meldet, dass er läuft, und
      // fragt erst nach dem Abbruch nach seinem Lebenszeichen.
      let laeuft = () => {},
        abgebrochen = () => {};
      const started_at = new Promise(r => {
        laeuft = () => r(null);
      });
      const afterAbort = new Promise(r => {
        abgebrochen = () => r(null);
      });
      const w = createWorker(require('./helpers/sources').testServices().jobQueue, {
        [ART]: {
          ausfuehren: async (_n, k) => {
            laeuft();
            await afterAbort;
            lebt = await k.lebenszeichen();
          },
        },
      });
      const id = await A.placeJobOne(ART, { marke: MARKE });
      const lauf = w.processOne();
      await started_at;
      assert.ok(await A.abortAb(id), 'ein laufender Auftrag lässt sich abbrechen');
      abgebrochen();
      await lauf;
      assert.equal(lebt, false, 'der Bearbeiter erfährt vom Abbruch');
      assert.equal((await zeile(id)).status, 'abgebrochen');
      assert.equal(await A.repeat(id), true);
      assert.equal((await zeile(id)).status, 'offen', 'wiederholen stellt ihn neu ein');
    });

    await t.test('nach einem geplanten Lauf steht der nächste an', async () => {
      const Z = _req('src/jobQueue/schedule.js');
      await db.run(`DELETE FROM jobs WHERE type = 'aufraeumen'`);
      await Z.planeAll();
      await Z.planeAll();
      const plans = await db.all(`SELECT due_at FROM jobs WHERE dedupe_key = 'plan:aufraeumen' AND status = 'offen'`);
      assert.equal(plans.length, 1, 'planeAll legt je Art genau einen Termin an');
      assert.ok(new Date(plans[0].due_at) > new Date(Date.now() + 55 * 60_000), 'stündlich heisst in einer Stunde');
      assert.equal(await Z.pullPlanBefore('aufraeumen'), true);
      let lief = 0;
      const w = createWorker(require('./helpers/sources').testServices().jobQueue, {
        aufraeumen: {
          ausfuehren: async () => {
            lief++;
          },
        },
      });
      assert.equal(await w.processOne(), true);
      assert.equal(lief, 1);
      const danach = await db.all(`SELECT status, due_at FROM jobs WHERE dedupe_key = 'plan:aufraeumen' ORDER BY id`);
      assert.deepEqual(
        danach.map(z => z.status),
        ['erledigt', 'offen'],
        'kein Folgetermin eingetragen',
      );
      assert.ok(new Date(danach[1].due_at) > new Date(Date.now() + 55 * 60_000));
      await db.run(`DELETE FROM jobs WHERE type = 'aufraeumen'`);
    });

    await t.test('ein PDF-Auftrag entsteht im Worker', async () => {
      const NAME = `auftrag-pdf-${process.pid}`;
      await db.run('DELETE FROM users WHERE username=$1', [NAME]);
      const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
      const pdfA = _req('src/catalog/pdf/pdfJobs.js');
      const jobId = _req('src/catalog/pdf/pdfJobs.js').newJobId(Date.now());
      const worker = _req('jobs/startJobs.js').startJobWorker(require('./helpers/sources').testServices(), {
        arten: ['pdf'],
        taktMs: 50,
      });
      try {
        await A.placeJobOne(
          'pdf',
          {
            job_id: jobId,
            user_id: uid,
            sets: [],
            parts: [{ part_number: '3001', part_name: 'Stein', color_name: 'Rot', quantity: 2 }],
          },
          { userId: uid, schluessel: pdfA.pdfKey(jobId) },
        );
        let stand;
        for (let i = 0; i < 200; i++) {
          // Wie die Route: im Konto der Anfrage, unter Zeilenschutz.
          stand = await asAccount(uid, () => pdfA.readJob(jobId, uid));
          if (stand?.status !== 'running') break;
          await warte(25);
        }
        assert.equal(stand?.status, 'done', JSON.stringify(stand));
        const datei = pdfA.pdfFilePath(jobId);
        assert.equal(require('node:fs').readFileSync(datei).subarray(0, 5).toString(), '%PDF-');
        require('node:fs').rmSync(datei, { force: true });
      } finally {
        await worker.stop();
        await db.run('DELETE FROM users WHERE id=$1', [uid]);
      }
    });
  } finally {
    await leeren();
    await testAccess().notification.close();
    await db.pool.end().catch(() => {});
  }
});
