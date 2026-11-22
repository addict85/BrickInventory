/**
 * The job table (migration 0066, src/jobQueue/jobs.ts, jobs/jobWorker.ts):
 * a job survives the end of its process, an error is retried
 * and ends as 'fehler' after the last attempt, and two workers never
 * execute the same job.
 *
 * Counter-checks (measured on 29.10.2026):
 *   A  in belegeAuftrag only `status = 'pending'` instead of `IN ('pending', 'running')`
 *      → red: “an orphaned job is done after its deadline”
 *   B  in fehlgeschlagen always 'fehler' instead of 'offen' → red: “an error is
 *      retried”
 *   C  `FOR UPDATE SKIP LOCKED` removed from belegeAuftrag → red: “two workers,
 *      every job exactly once” (jobs executed twice)
 *   D  the PDF job without a handler (EDITOR.pdf removed) → red: “a
 *      PDF job is created in the worker” (status stayed running)
 *
 * Since migration 0082 (measured on 30.10.2026):
 *   E  in belegeAuftrag the condition on job_pauses removed → red: “a
 *      paused kind waits, an exclusive one runs singly”
 *   F  in belegeAuftrag the condition for exclusive kinds removed → red:
 *      the same test (two at once)
 *   G  in verschoben() always count the attempts → red: “postponing
 *      only counts when it should”
 *   H  folgeplan() empty in the worker → red: “after a scheduled run
 *      the next one is pending”
 *   I  in erledigt() the condition `status = 'running'` removed → red: “an
 *      aborted job stays aborted”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, testAccess, asAccount } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { warte, bis } = require('./helpers/time');

test('job table', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const A = Object.assign({}, _req('src/jobQueue/jobs.js'), {
    ..._req('src/jobQueue/service.js'),
    ...require('./helpers/sources').testArea('jobQueue').jobs,
  });
  const { createWorker } = _req('jobs/jobWorker.js');
  // Only rows of this test: an own kind that no other worker knows.
  const ART = `test-${process.pid}`;
  const MARKE = `test-${process.pid}`;
  // A test kind needs a schema for its payload like any other.
  // … and a row in job_types (0109).
  for (const type of [ART, `${ART}-ex`]) {
    require('./helpers/sources')
      .testServices()
      .jobQueue.registerKind({ kind: type, payload: require('zod').looseObject({}), ausfuehren: async () => {} });
    await db.run('INSERT INTO job_types (type) VALUES ($1) ON CONFLICT DO NOTHING', [type]);
  }
  const leeren = () => db.run(`DELETE FROM jobs WHERE payload->>'marke' = $1`, [MARKE]);
  const row = id =>
    db.get('SELECT status, attempts, error_message, due_at > NOW() AS spaeter FROM jobs WHERE id=$1', [id]);
  await leeren();

  try {
    await t.test('an orphaned job is settled after its deadline', async () => {
      const id = await A.placeJobOne(ART, { marke: MARKE, n: 1 });
      // A process occupies it with a deadline of one second and then ends.
      const tot = await A.claimJob([ART], 1);
      assert.equal(tot.id, id);
      const done = [];
      const w = createWorker(
        require('./helpers/sources').testServices().jobQueue,
        {
          [ART]: {
            ausfuehren: async n => {
              done.push(n.n);
            },
          },
        },
        { deadlineSec: 60 },
      );
      assert.equal(await w.processOne(), false, 'vor Ablauf der Frist gehört er noch dem anderen');
      // The dead process's deadline expires; then the second one takes it.
      assert.ok(await bis(() => w.processOne(), 5000), 'nach Ablauf der Frist übernimmt der Worker');
      assert.deepEqual(done, [1]);
      assert.equal((await row(id)).status, 'done');
      assert.equal((await row(id)).attempts, 2);
    });

    await t.test('an error is retried and ends after the last attempt', async () => {
      await leeren();
      let mal = 0;
      const abandoned = [];
      const w = createWorker(require('./helpers/sources').testServices().jobQueue, {
        [ART]: {
          ausfuehren: async n => {
            mal++;
            if (n.immer || mal === 1) throw new Error('Quelle weg');
          },
          givenUp: async (_n, error_message) => {
            abandoned.push(error_message);
          },
        },
      });
      const id = await A.placeJobOne(ART, { marke: MARKE }, { maxAttempts: 3 });
      assert.equal(await w.processOne(), true);
      const afterError = await row(id);
      assert.equal(afterError.status, 'pending', 'ein Fehler wird wiederholt');
      assert.equal(afterError.error_message, 'Quelle weg');
      assert.equal(afterError.spaeter, true, 'mit Wartezeit, nicht sofort');
      assert.equal(await w.processOne(), false);
      await db.run('UPDATE jobs SET due_at = NOW() WHERE id=$1', [id]);
      assert.equal(await w.processOne(), true);
      assert.equal((await row(id)).status, 'done');

      const id2 = await A.placeJobOne(ART, { marke: MARKE, immer: true }, { maxAttempts: 2 });
      await w.processOne();
      await db.run('UPDATE jobs SET due_at = NOW() WHERE id=$1', [id2]);
      await w.processOne();
      assert.equal((await row(id2)).status, 'error');
      assert.deepEqual(abandoned, ['Quelle weg'], 'aufgegeben genau einmal, nach dem letzten Versuch');
    });

    await t.test('the same key is open only once', async () => {
      await leeren();
      const a = await A.placeJobOne(ART, { marke: MARKE }, { schluessel: `${MARKE}:s` });
      const b = await A.placeJobOne(ART, { marke: MARKE }, { schluessel: `${MARKE}:s` });
      assert.ok(a);
      assert.equal(b, null);
    });

    await t.test('two workers, every job exactly once', async () => {
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
        const open = await db.get(
          `SELECT COUNT(*)::int AS n FROM jobs WHERE payload->>'marke' = $1 AND status <> 'done'`,
          [MARKE],
        );
        if (open.n === 0 && w1.running() === 0 && w2.running() === 0) break;
        await warte(25);
      }
      await w1.stop(0);
      await w2.stop(0);
      const doppelt = runs.filter((n, i) => runs.indexOf(n) !== i);
      assert.deepEqual(doppelt, [], 'Aufträge doppelt ausgeführt');
      assert.equal(new Set(runs).size, N);
    });
    await t.test('a paused kind waits, an exclusive one runs alone', async () => {
      await leeren();
      const EX = `${ART}-ex`;
      for (let i = 0; i < 3; i++) await A.placeJobOne(EX, { marke: MARKE, n: i });
      await db.run('DELETE FROM job_pauses WHERE type = $1', [EX]);
      await A.pauseKind(EX, new Date(Date.now() + 60_000), 'Test');
      assert.equal(await A.claimJob([EX], 60, 'x', [EX]), null, 'trotz Pause belegt');
      await A.endPause(EX);
      let simultaneous = 0,
        hoechstens = 0;
      const w = createWorker(
        require('./helpers/sources').testServices().jobQueue,
        {
          [EX]: {
            exklusiv: true,
            ausfuehren: async () => {
              hoechstens = Math.max(hoechstens, ++simultaneous);
              await warte(60);
              simultaneous--;
            },
          },
        },
        { parallel: 3, taktMs: 20 },
      );
      w.starte();
      for (let i = 0; i < 100; i++) {
        const open = await db.get(`SELECT COUNT(*)::int AS n FROM jobs WHERE type = $1 AND status <> 'done'`, [EX]);
        if (open.n === 0 && w.running() === 0) break;
        await warte(25);
      }
      await w.stop(0);
      assert.equal(hoechstens, 1, `${hoechstens} exklusive Aufträge liefen gleichzeitig`);
      await db.run('DELETE FROM jobs WHERE type = $1', [EX]);
    });

    await t.test('postponing only counts when it should', async () => {
      await leeren();
      const { JobMove } = _req('jobs/jobWorker.js');
      let counted = false;
      const w = createWorker(require('./helpers/sources').testServices().jobQueue, {
        [ART]: {
          ausfuehren: async () => {
            throw new JobMove(new Date(Date.now() + 3_600_000), 'gedrosselt', counted);
          },
        },
      });
      const id = await A.placeJobOne(ART, { marke: MARKE }, { maxAttempts: 2 });
      await w.processOne();
      let z = await row(id);
      assert.deepEqual([z.status, z.attempts, z.error_message, z.spaeter], ['pending', 0, 'gedrosselt', true]);
      counted = true;
      for (let i = 0; i < 2; i++) {
        await db.run('UPDATE jobs SET due_at = NOW() WHERE id=$1', [id]);
        await w.processOne();
      }
      z = await row(id);
      assert.deepEqual([z.status, z.attempts], ['error', 2], 'gezählte Verschiebungen enden nach max_attempts');
    });

    await t.test('an aborted job stays aborted', async () => {
      await leeren();
      let lebt = null;
      // Without fixed waits: the handler reports that it is running, and
      // only asks for its heartbeat after the abort.
      let running = () => {},
        aborted = () => {};
      const started_at = new Promise(r => {
        running = () => r(null);
      });
      const afterAbort = new Promise(r => {
        aborted = () => r(null);
      });
      const w = createWorker(require('./helpers/sources').testServices().jobQueue, {
        [ART]: {
          ausfuehren: async (_n, k) => {
            running();
            await afterAbort;
            lebt = await k.heartbeat();
          },
        },
      });
      const id = await A.placeJobOne(ART, { marke: MARKE });
      const lauf = w.processOne();
      await started_at;
      assert.ok(await A.abortAb(id), 'ein laufender Auftrag lässt sich abbrechen');
      aborted();
      await lauf;
      assert.equal(lebt, false, 'der Bearbeiter erfährt vom Abbruch');
      assert.equal((await row(id)).status, 'cancelled');
      assert.equal(await A.repeat(id), true);
      assert.equal((await row(id)).status, 'pending', 'wiederholen stellt ihn neu ein');
    });

    await t.test('after a scheduled run the next one is pending', async () => {
      const Z = _req('src/jobQueue/schedule.js');
      await db.run(`DELETE FROM jobs WHERE type = 'cleanup'`);
      await Z.planeAll();
      await Z.planeAll();
      const plans = await db.all(`SELECT due_at FROM jobs WHERE dedupe_key = 'plan:cleanup' AND status = 'pending'`);
      assert.equal(plans.length, 1, 'planeAll legt je Art genau einen Termin an');
      assert.ok(new Date(plans[0].due_at) > new Date(Date.now() + 55 * 60_000), 'stündlich heisst in einer Stunde');
      assert.equal(await Z.pullPlanBefore('cleanup'), true);
      let lief = 0;
      const w = createWorker(require('./helpers/sources').testServices().jobQueue, {
        cleanup: {
          ausfuehren: async () => {
            lief++;
          },
        },
      });
      assert.equal(await w.processOne(), true);
      assert.equal(lief, 1);
      const danach = await db.all(`SELECT status, due_at FROM jobs WHERE dedupe_key = 'plan:cleanup' ORDER BY id`);
      assert.deepEqual(
        danach.map(z => z.status),
        ['done', 'pending'],
        'kein Folgetermin eingetragen',
      );
      assert.ok(new Date(danach[1].due_at) > new Date(Date.now() + 55 * 60_000));
      await db.run(`DELETE FROM jobs WHERE type = 'cleanup'`);
    });

    await t.test('a PDF job is created in the worker', async () => {
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
        let state;
        for (let i = 0; i < 200; i++) {
          // Like the route: in the request's account, under row security.
          state = await asAccount(uid, () => pdfA.readJob(jobId, uid));
          if (state?.status !== 'running') break;
          await warte(25);
        }
        assert.equal(state?.status, 'done', JSON.stringify(state));
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
