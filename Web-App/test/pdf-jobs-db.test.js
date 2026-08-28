/**
 * PDF-Aufträge gegen echte Routen: Wem gehört ein Auftrag, und wie viele darf
 * einer gleichzeitig starten?
 *
 * ── Warum Verhalten und nicht Quelltext ─────────────────────────────────────
 * Die Regel lautet „ein fremder Auftrag ist nicht abrufbar". Am Quelltext wäre
 * das die Frage, ob irgendwo `user_id` vorkommt — und genau diese Sorte
 * Prüfung hat in dieser Sammlung schon einmal eine Lücke festgeschrieben statt
 * sie zu finden. Hier laufen deshalb echte Routen mit echten Tokens.
 *
 * Der Auftrag selbst wird NICHT gestartet (er würde Bilder aus dem Netz laden
 * und ein PDF bauen); die Auftragsdateien werden direkt gelegt. Geprüft wird
 * der Abrufweg, und der ist genau der, an dem es fehlte.
 *
 * Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
 * Ohne DB: skip.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs/promises');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const _req    = require('./helpers/sources').buildAndRequire();
const db      = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));

test('PDF-Aufträge gehören ihrem Besteller', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  const pdf = _req('routes/api_v1/pdf.js');
  const { PDF_JOB_DIR } = pdf;

  for (const name of ['pdf_a', 'pdf_b']) await db.run('DELETE FROM users WHERE username = $1', [name]);
  await db.run("INSERT INTO users (username,password_hash,email_verified) VALUES ('pdf_a','x',1)");
  await db.run("INSERT INTO users (username,password_hash,email_verified) VALUES ('pdf_b','x',1)");
  const idA = (await db.get("SELECT id FROM users WHERE username='pdf_a'")).id;
  const idB = (await db.get("SELECT id FROM users WHERE username='pdf_b'")).id;

  // Tokens liegen GEHASHT in der Tabelle (utils/auth.ts) — der Klartextpfad
  // wurde bewusst entfernt. Der Test legt deshalb den Hash ab und schickt den
  // Klartext, genau wie ein echter Client.
  const { hashToken } = _req('utils/auth.js');
  const tokenFuer = async (uid, label) => {
    const t = require('node:crypto').randomBytes(24).toString('hex');
    await db.run(
      "INSERT INTO api_tokens (token, user_id, label, expires_at) VALUES ($1,$2,$3,NULL)",
      [hashToken(t), uid, label]);
    return t;
  };
  const tokA = await tokenFuer(idA, 'test-a');
  const tokB = await tokenFuer(idB, 'test-b');

  const app = express();
  app.use('/api/v1', pdf.default || pdf);
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}`;

  /** Auftragsdatei direkt legen — der Lauf selbst ginge ins Netz. */
  async function auftragLegen(jobId, userId, status = 'done') {
    await fs.mkdir(PDF_JOB_DIR, { recursive: true });
    await fs.writeFile(path.join(PDF_JOB_DIR, `${jobId}.json`),
      JSON.stringify({ status, error: null, user_id: userId }));
    if (status === 'done') {
      await fs.writeFile(path.join(PDF_JOB_DIR, `${jobId}.pdf`), '%PDF-1.4 test');
    }
  }
  const hol = (pfad, token) =>
    fetch(`${basis}/api/v1/sets/partslist-pdf/${pfad}`, { headers: { Authorization: `Bearer ${token}` } });

  try {
    const jobA = pdf.neueJobId();
    await auftragLegen(jobA, idA);

    await t.test('der eigene Auftrag ist abrufbar', async () => {
      const s = await hol(`status/${jobA}`, tokA);
      const body = await s.json();
      assert.equal(s.status, 200, JSON.stringify(body));
      assert.equal(body.status, 'done');
    });

    await t.test('ein fremder Auftrag ist es nicht — und zwar mit demselben 404', async () => {
      const s = await hol(`status/${jobA}`, tokB);
      assert.equal(s.status, 404, 'fremder Auftragsstatus war lesbar');

      const d = await hol(`download/${jobA}`, tokB);
      assert.equal(d.status, 404, 'fremdes PDF war herunterladbar');
      assert.doesNotMatch(await d.text(), /PDF/, 'die Antwort enthielt PDF-Inhalt');

      // Wichtig: Der Fehlversuch darf den Auftrag nicht beschädigen — der
      // Download löscht die Datei nach dem Ausliefern.
      const s2 = await hol(`status/${jobA}`, tokA);
      assert.equal(s2.status, 200, 'der eigene Auftrag ist durch den Fremdzugriff verschwunden');
    });

    await t.test('der Deckel greift beim dritten gleichzeitigen Auftrag', async () => {
      for (const f of await fs.readdir(PDF_JOB_DIR)) await fs.unlink(path.join(PDF_JOB_DIR, f)).catch(() => {});
      await auftragLegen(pdf.neueJobId(), idA, 'running');
      await auftragLegen(pdf.neueJobId(), idA, 'running');
      await auftragLegen(pdf.neueJobId(), idB, 'running');   // fremder Lauf zählt nicht mit

      const r = await fetch(`${basis}/api/v1/sets/partslist-pdf`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokA}`, 'content-type': 'application/json' },
        body: JSON.stringify({ sets: [], parts: [{ part_number: '3001', quantity: 1 }] }),
      });
      assert.equal(r.status, 429, `dritter Auftrag wurde angenommen (${r.status})`);

      // Der zweite Benutzer ist davon nicht betroffen.
      const r2 = await fetch(`${basis}/api/v1/sets/partslist-pdf`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokB}`, 'content-type': 'application/json' },
        body: JSON.stringify({ sets: [], parts: [{ part_number: '3001', quantity: 1 }] }),
      });
      assert.equal(r2.status, 200, `fremder Deckel hat den zweiten Benutzer gebremst (${r2.status})`);
    });

    await t.test('abgelaufene Läufe sperren niemanden dauerhaft aus', async () => {
      for (const f of await fs.readdir(PDF_JOB_DIR)) await fs.unlink(path.join(PDF_JOB_DIR, f)).catch(() => {});
      const alt1 = pdf.neueJobId(), alt2 = pdf.neueJobId();
      await auftragLegen(alt1, idA, 'running');
      await auftragLegen(alt2, idA, 'running');
      // Stürzt ein Worker mitten im Lauf ab, bleibt die Datei auf 'running'.
      const vorgestern = new Date(Date.now() - 24 * 3600 * 1000);
      for (const j of [alt1, alt2]) {
        await fs.utimes(path.join(PDF_JOB_DIR, `${j}.json`), vorgestern, vorgestern);
      }
      const r = await fetch(`${basis}/api/v1/sets/partslist-pdf`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokA}`, 'content-type': 'application/json' },
        body: JSON.stringify({ sets: [], parts: [{ part_number: '3001', quantity: 1 }] }),
      });
      assert.equal(r.status, 200, 'ein hängengebliebener Lauf sperrt den Benutzer für immer aus');
    });

    await t.test('die Auftragskennung kommt aus kryptografischem Zufall', () => {
      const ids = new Set(Array.from({ length: 200 }, () => pdf.neueJobId()));
      assert.equal(ids.size, 200, 'Kennungen wiederholen sich');
      for (const id of ids) assert.ok(pdf.validJobId(id), `eigene Kennung ist ungültig: ${id}`);
      const zufallsteil = [...ids][0].split('-')[1];
      assert.match(zufallsteil, /^[0-9a-f]{12}$/, 'kein 6-Byte-Hex — stammt die Kennung noch aus Math.random()?');
    });
  } finally {
    srv.close();
    for (const f of await fs.readdir(PDF_JOB_DIR).catch(() => [])) {
      await fs.unlink(path.join(PDF_JOB_DIR, f)).catch(() => {});
    }
    await db.pool.end().catch(() => {});
  }
});
