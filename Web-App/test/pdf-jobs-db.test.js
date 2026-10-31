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
 * und ein PDF bauen); die Auftragszeilen werden direkt gelegt. Geprüft wird
 * der Abrufweg, und der ist genau der, an dem es fehlte.
 *
 * Gegenprobe zum Statusstrom (am 28.10.2026 gemessen): in schreibeAuftrag()
 * das notify() entfernt → rot: „der Statusstrom meldet das Ende sofort“
 * (erst der 15-Sekunden-Rückfall hätte es gemeldet). Seit der Status im
 * Auftrag steht (Migration 0083) am 30.10.2026 wiederholt: in erledigt()
 * (utils/auftraege.ts) meldeStand() entfernt → rot: derselbe Test.
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

  {
    const c = await db.pool.connect();
    try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  }
  const pdf = _req('routes/api_v1/pdf.js');
  const auftraege = _req('utils/pdfAuftraege.js');
  const { PDF_JOB_DIR } = _req('src/infra/appPaths.js');

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

  /** Auftrag direkt anlegen — der Lauf selbst ginge ins Netz. */
  async function auftragLegen(jobId, userId, status = 'done') {
    await db.run(`INSERT INTO auftraege (art, user_id, schluessel, status, belegt_von, frist_bis)
                  VALUES ('pdf', $2, $1, $3, CASE WHEN $3 = 'laeuft' THEN 'test' END,
                          CASE WHEN $3 = 'laeuft' THEN NOW() + INTERVAL '1 hour' END)`,
      [auftraege.pdfSchluessel(jobId), userId, status === 'done' ? 'erledigt' : 'laeuft']);
    await fs.mkdir(PDF_JOB_DIR, { recursive: true });
    if (status === 'done') {
      await fs.writeFile(path.join(PDF_JOB_DIR, `${jobId}.pdf`), '%PDF-1.4 test');
    }
  }
  const hol = (pfad, token) =>
    fetch(`${basis}/api/v1/sets/partslist-pdf/${pfad}`, { headers: { Authorization: `Bearer ${token}` } });

  try {
    const jobA = auftraege.neueJobId();
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
      await db.run(`DELETE FROM auftraege WHERE art = 'pdf'`);
      await auftragLegen(auftraege.neueJobId(), idA, 'running');
      await auftragLegen(auftraege.neueJobId(), idA, 'running');
      await auftragLegen(auftraege.neueJobId(), idB, 'running');   // fremder Lauf zählt nicht mit

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
      await db.run(`DELETE FROM auftraege WHERE art = 'pdf'`);
      const alt1 = auftraege.neueJobId(), alt2 = auftraege.neueJobId();
      await auftragLegen(alt1, idA, 'running');
      await auftragLegen(alt2, idA, 'running');
      // Stürzt ein Worker mitten im Lauf ab, bleibt der Auftrag auf 'running'.
      await db.run(`UPDATE auftraege SET erstellt = NOW() - INTERVAL '1 day' WHERE schluessel = ANY($1)`,
        [[alt1, alt2].map(auftraege.pdfSchluessel)]);
      const r = await fetch(`${basis}/api/v1/sets/partslist-pdf`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokA}`, 'content-type': 'application/json' },
        body: JSON.stringify({ sets: [], parts: [{ part_number: '3001', quantity: 1 }] }),
      });
      assert.equal(r.status, 200, 'ein hängengebliebener Lauf sperrt den Benutzer für immer aus');
    });

    await t.test('der Statusstrom meldet das Ende sofort', async () => {
      await db.run(`DELETE FROM auftraege WHERE art = 'pdf'`);
      const job = auftraege.neueJobId();
      await auftragLegen(job, idA, 'running');
      const ctrl = new AbortController();
      const r = await fetch(`${basis}/api/v1/sets/partslist-pdf/stream/${job}`,
        { headers: { Authorization: `Bearer ${tokA}` }, signal: ctrl.signal });
      assert.equal(r.status, 200);
      const leser = r.body.getReader();
      const dec = new TextDecoder();
      let text = '';
      const start = Date.now();
      // Der Worker meldet das Ende über erledigt(); der Auftrag gehört hier dem Belegenden 'test'.
      const zeile = await db.get(`SELECT id FROM auftraege WHERE schluessel = $1`, [auftraege.pdfSchluessel(job)]);
      setTimeout(() => _req('utils/auftraege.js').erledigt({ id: String(zeile.id), belegt_von: 'test' }), 300);
      while (!text.includes('"done"') && Date.now() - start < 8000) {
        const { value, done } = await Promise.race([leser.read(),
          new Promise(f => setTimeout(() => f({ done: true }), 8000 - (Date.now() - start)))]);
        if (done) break;
        text += dec.decode(value);
      }
      ctrl.abort();
      assert.match(text, /"done"/, `kein Ende im Strom: ${text}`);
      assert.ok(Date.now() - start < 5000, `erst nach ${Date.now() - start} ms`);
    });

    await t.test('die Auftragskennung kommt aus kryptografischem Zufall', () => {
      const ids = new Set(Array.from({ length: 200 }, () => auftraege.neueJobId()));
      assert.equal(ids.size, 200, 'Kennungen wiederholen sich');
      for (const id of ids) assert.ok(auftraege.gueltigeAuftragsKennung(id), `eigene Kennung ist ungültig: ${id}`);
      const zufallsteil = [...ids][0].split('-')[1];
      assert.match(zufallsteil, /^[0-9a-f]{12}$/, 'kein 6-Byte-Hex — stammt die Kennung noch aus Math.random()?');
    });
  } finally {
    srv.close();
    for (const f of await fs.readdir(PDF_JOB_DIR).catch(() => [])) {
      await fs.unlink(path.join(PDF_JOB_DIR, f)).catch(() => {});
    }
    await db.run(`DELETE FROM auftraege WHERE art = 'pdf'`).catch(() => {});
    await _req('db/pgNotify.js').close().catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
