/**
 * PDF jobs against real routes: who owns a job, and how many may
 * someone start at the same time?
 *
 * Counter-check for the status stream (measured on 28.10.2026): in schreibeAuftrag()
 * the notify() removed → red: “the status stream reports the end immediately”
 * (only the 15-second fallback would have reported it). Since the status stands in the
 * job (migration 0083) repeated on 30.10.2026: in erledigt()
 * (src/jobQueue/jobs.ts) reportStatus() removed → red: the same test.
 *
 * Counter-checks for the parts list (measured on 02.11.2026), each red: “the
 * parts list is checked …”: `eingabe: PdfInput` deleted from the contract;
 * in the route again `req.body` instead of PdfInput.parse()
 * („unbekannte Felder gehen in den Auftrag“); `.max(5000)` deleted
 * („zu viele Posten“ got 200).
 *
 * Prerequisite: test DB (contents are cleared!) via TEST_DATABASE_URL.
 * Without DB: skip.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { keineDb } = require('./helpers/db');
const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire, testData, testAccess } = require('./helpers/sources');
const _req = buildAndRequire();
const db = testData();
const express = require(path.join(ROOT, 'node_modules', 'express'));

test('PDF jobs belong to whoever ordered them', { concurrency: 1 }, async t => {
  try {
    await db.initSchema();
  } catch (e) {
    keineDb(t, e);
    return;
  }

  {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }
  const jobs = _req('src/catalog/pdf/pdfJobs.js');
  const { PDF_JOB_DIR } = _req('src/infra/appPaths.js');

  for (const name of ['pdf_a', 'pdf_b']) await db.run('DELETE FROM users WHERE username = $1', [name]);
  await db.run("INSERT INTO users (username,password_hash,email_verified) VALUES ('pdf_a','x',true)");
  await db.run("INSERT INTO users (username,password_hash,email_verified) VALUES ('pdf_b','x',true)");
  const idA = (await db.get("SELECT id FROM users WHERE username='pdf_a'")).id;
  const idB = (await db.get("SELECT id FROM users WHERE username='pdf_b'")).id;

  // Tokens lie HASHED in the table (src/account/deviceToken.ts) — the plaintext path
  // was removed deliberately. The test therefore stores the hash and sends the
  // plaintext, exactly like a real client.
  const { tokenDigest } = _req('src/account/deviceToken.js');
  const tokenFor = async (uid, label) => {
    const t = require('node:crypto').randomBytes(24).toString('hex');
    await db.run('INSERT INTO api_tokens (token, user_id, label, expires_at) VALUES ($1,$2,$3,NULL)', [
      tokenDigest(t),
      uid,
      label,
    ]);
    return t;
  };
  const tokA = await tokenFor(idA, 'test-a');
  const tokB = await tokenFor(idB, 'test-b');

  const app = express();
  // As in operation the body is read by the server's parser, not the router.
  app.use(express.json({ limit: '4mb' })); // like server.ts for this route
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use('/api/v2', require('./helpers/sources').routerFrom(_req, 'routes/api/pdf.js'));
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}`;

  /** Create the job directly — the run itself would go to the network. */
  async function jobPut(jobId, userId, status = 'done') {
    await db.run(
      `INSERT INTO jobs (type, user_id, dedupe_key, status, locked_by, deadline_at)
                  VALUES ('pdf', $2, $1, $3, CASE WHEN $3 = 'laeuft' THEN 'test' END,
                          CASE WHEN $3 = 'laeuft' THEN NOW() + INTERVAL '1 hour' END)`,
      [jobs.pdfKey(jobId), userId, status === 'done' ? 'done' : 'running'],
    );
    await fs.mkdir(PDF_JOB_DIR, { recursive: true });
    if (status === 'done') {
      await fs.writeFile(path.join(PDF_JOB_DIR, `${jobId}.pdf`), '%PDF-1.4 test');
    }
  }
  const hol = (path, token) =>
    fetch(`${basis}/api/v2/sets/partslist-pdf/${path}`, { headers: { Authorization: `Bearer ${token}` } });

  try {
    const jobA = jobs.newJobId(Date.now());
    await jobPut(jobA, idA);

    await t.test('the own job can be fetched', async () => {
      const s = await hol(`status/${jobA}`, tokA);
      const body = await s.json();
      assert.equal(s.status, 200, JSON.stringify(body));
      assert.equal(body.status, 'done');
    });

    await t.test('a foreign job cannot — and with the same 404', async () => {
      const s = await hol(`status/${jobA}`, tokB);
      assert.equal(s.status, 404, 'fremder Auftragsstatus war lesbar');

      const d = await hol(`download/${jobA}`, tokB);
      assert.equal(d.status, 404, 'fremdes PDF war herunterladbar');
      assert.doesNotMatch(await d.text(), /PDF/, 'die Antwort enthielt PDF-Inhalt');

      // Important: the failed attempt must not damage the job — the
      // download deletes the file after delivering it.
      const s2 = await hol(`status/${jobA}`, tokA);
      assert.equal(s2.status, 200, 'der eigene Auftrag ist durch den Fremdzugriff verschwunden');
    });

    await t.test('the cap applies at the third concurrent job', async () => {
      await db.run(`DELETE FROM jobs WHERE type = 'pdf'`);
      await jobPut(jobs.newJobId(Date.now()), idA, 'running');
      await jobPut(jobs.newJobId(Date.now()), idA, 'running');
      await jobPut(jobs.newJobId(Date.now()), idB, 'running'); // a foreign run does not count

      const r = await fetch(`${basis}/api/v2/sets/partslist-pdf`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokA}`, 'content-type': 'application/json' },
        body: JSON.stringify({ sets: [], parts: [{ part_number: '3001', quantity: 1 }] }),
      });
      assert.equal(r.status, 429, `dritter Auftrag wurde angenommen (${r.status})`);

      // The second user is not affected by it.
      const r2 = await fetch(`${basis}/api/v2/sets/partslist-pdf`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokB}`, 'content-type': 'application/json' },
        body: JSON.stringify({ sets: [], parts: [{ part_number: '3001', quantity: 1 }] }),
      });
      assert.equal(r2.status, 200, `fremder Deckel hat den zweiten Benutzer gebremst (${r2.status})`);
    });

    await t.test('expired runs do not lock anyone out permanently', async () => {
      await db.run(`DELETE FROM jobs WHERE type = 'pdf'`);
      const alt1 = jobs.newJobId(Date.now()),
        alt2 = jobs.newJobId(Date.now());
      await jobPut(alt1, idA, 'running');
      await jobPut(alt2, idA, 'running');
      // If a worker crashes in the middle of the run, the job stays at 'running'.
      await db.run(`UPDATE jobs SET created_at = NOW() - INTERVAL '1 day' WHERE dedupe_key = ANY($1)`, [
        [alt1, alt2].map(jobs.pdfKey),
      ]);
      const r = await fetch(`${basis}/api/v2/sets/partslist-pdf`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokA}`, 'content-type': 'application/json' },
        body: JSON.stringify({ sets: [], parts: [{ part_number: '3001', quantity: 1 }] }),
      });
      assert.equal(r.status, 200, 'ein hängengebliebener Lauf sperrt den Benutzer für immer aus');
    });

    await t.test('the status stream reports the end immediately', async () => {
      await db.run(`DELETE FROM jobs WHERE type = 'pdf'`);
      const job = jobs.newJobId(Date.now());
      await jobPut(job, idA, 'running');
      const ctrl = new AbortController();
      const r = await fetch(`${basis}/api/v2/sets/partslist-pdf/stream/${job}`, {
        headers: { Authorization: `Bearer ${tokA}` },
        signal: ctrl.signal,
      });
      assert.equal(r.status, 200);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let text = '';
      const start = Date.now();
      // The worker reports the end via erledigt(); the job here belongs to the claimer 'test'.
      const row = await db.get(`SELECT id FROM jobs WHERE dedupe_key = $1`, [jobs.pdfKey(job)]);
      setTimeout(
        () =>
          Object.assign({}, _req('src/jobQueue/jobs.js'), {
            ..._req('src/jobQueue/service.js'),
            ...require('./helpers/sources').testArea('jobQueue').jobs,
          }).done({ id: String(row.id), locked_by: 'test', type: 'pdf' }),
        300,
      );
      while (!text.includes('"done"') && Date.now() - start < 8000) {
        const { value, done } = await Promise.race([
          reader.read(),
          new Promise(f => setTimeout(() => f({ done: true }), 8000 - (Date.now() - start))),
        ]);
        if (done) break;
        text += dec.decode(value);
      }
      ctrl.abort();
      assert.match(text, /"done"/, `kein Ende im Strom: ${text}`);
      assert.ok(Date.now() - start < 5000, `erst nach ${Date.now() - start} ms`);
    });

    await t.test('the parts list is checked before a job arises', async () => {
      await db.run(`DELETE FROM jobs WHERE type = 'pdf'`);
      const starte = rumpf =>
        fetch(`${basis}/api/v2/sets/partslist-pdf`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokA}`, 'content-type': 'application/json' },
          body: JSON.stringify(rumpf),
        }).then(async r => ({ status: r.status, body: await r.json() }));
      const teil = (mehr = {}) => ({ part_number: '3001', quantity: 2, color_id: 5, color_hex: 'C91A09', ...mehr });
      const falsch = {
        'zu viele Posten': { parts: Array.from({ length: 5001 }, () => teil()) },
        'Menge 0': { parts: [teil({ quantity: 0 })] },
        'Menge 10000': { parts: [teil({ quantity: 10000 })] },
        'Menge als Unsinn': { parts: [teil({ quantity: '2; DROP' })] },
        'zu lange Teilenummer': { parts: [teil({ part_number: 'x'.repeat(65) })] },
        'zu langer Name': { parts: [teil({ part_name: 'n'.repeat(501) })] },
        'Farbe als Text': { parts: [teil({ color_hex: 'red);evil' })] },
        'parts kein Array': { parts: 'alles' },
        'Teil ohne Nummer': { parts: [{ quantity: 1 }] },
      };
      for (const [fall, rumpf] of Object.entries(falsch)) {
        const r = await starte(rumpf);
        assert.equal(r.status, 400, `${fall}: ${JSON.stringify(r.body).slice(0, 200)}`);
        assert.equal(r.body.code, 'input_invalid', fall);
      }
      assert.equal((await db.get(`SELECT count(*)::int n FROM jobs WHERE type = 'pdf'`)).n, 0, 'ein Auftrag trotz 400');

      const ok = await starte({
        sets: [{ set_number: '10001-1', name: 'Probe' }],
        parts: [teil({ quantity: '12', boese: 'x'.repeat(10000) }), ...Array.from({ length: 4999 }, () => teil())],
      });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      const payload = (await db.get(`SELECT payload FROM jobs WHERE type = 'pdf'`)).payload;
      assert.equal(payload.parts.length, 5000);
      assert.equal(payload.parts[0].quantity, '12');
      assert.ok(!('boese' in payload.parts[0]), 'unbekannte Felder gehen in den Auftrag');
    });

    await t.test('the job identifier comes from cryptographic randomness', () => {
      const ids = new Set(Array.from({ length: 200 }, () => jobs.newJobId(Date.now())));
      assert.equal(ids.size, 200, 'Kennungen wiederholen sich');
      for (const id of ids) assert.ok(jobs.validJobId(id), `eigene Kennung ist ungültig: ${id}`);
      const zufallsteil = [...ids][0].split('-')[1];
      assert.match(zufallsteil, /^[0-9a-f]{12}$/, 'kein 6-Byte-Hex — stammt die Kennung noch aus Math.random()?');
    });
  } finally {
    srv.close();
    for (const f of await fs.readdir(PDF_JOB_DIR).catch(() => [])) {
      await fs.unlink(path.join(PDF_JOB_DIR, f)).catch(() => {});
    }
    await db.run(`DELETE FROM jobs WHERE type = 'pdf'`).catch(() => {});
    await testAccess()
      .notification.close()
      .catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
