/**
 * Sperr-Namensräume gegen eine ECHTE Datenbank.
 *
 * Gegenprobe (am 27.10. gemessen): txLock wieder mit der user_id als erstem
 * Wert → rot: „die Bestandssperre eines Kontos trifft keinen Job". Seit die Sperre
 * eine Option von k.transaktion ist (14.11.2026) erneut: in sperreBestaende()
 * (src/infra/bereich.ts) die Konto-ID als Klasse → rot, derselbe Test.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip (ausser
 * REQUIRE_DB=1).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testDaten, testKontext } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = testDaten();
const { LOCKS } = _req('src/infra/lockNamespaces.js');

async function dbReachable() {
  try {
    await db.get('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

test('Sperr-Namensräume gegen echte Datenbank', async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    keineDb(t);
    return;
  }

  /** Eine Sperre auf einer eigenen Verbindung halten (nicht aus dem Pool: es gibt mehr
   * Namensräume als Pool-Plätze); gibt den Freigeber zurück. */
  async function halten(ns, zweiter = 0) {
    const c = await db.eigeneVerbindung();
    const { rows } = await c.query('SELECT pg_try_advisory_lock($1, $2) AS ok', [ns, zweiter]);
    if (!rows[0].ok) {
      await c.end();
      throw new Error(`Namensraum ${ns} war schon belegt`);
    }
    return () => c.end();
  }

  /** Bekommt eine ZWEITE Verbindung diese Sperre noch? */
  async function nochFrei(ns, zweiter = 0) {
    const c = await db.pool.connect();
    try {
      const { rows } = await c.query('SELECT pg_try_advisory_lock($1, $2) AS ok', [ns, zweiter]);
      if (rows[0].ok) await c.query('SELECT pg_advisory_unlock($1, $2)', [ns, zweiter]);
      return rows[0].ok;
    } finally {
      c.release();
    }
  }

  await t.test('alle Namensräume sind paarweise verschieden', () => {
    const eintraege = Object.entries(LOCKS);
    assert.ok(
      eintraege.length >= 8,
      `Nur ${eintraege.length} Namensräume gefunden — ist LOCKS noch die vollständige Liste?`,
    );

    const gesehen = new Map();
    for (const [name, zahl] of eintraege) {
      assert.equal(typeof zahl, 'number', `${name} ist keine Zahl`);
      // Beratungssperren sind 64-Bit; die einwertige Form nimmt bigint, die
      // zweiwertige zwei int4. Alle Einträge hier werden zweiwertig ODER
      // einwertig benutzt — int4 ist die engere Grenze und gilt deshalb.
      assert.ok(
        Number.isInteger(zahl) && zahl > 0 && zahl <= 2147483647,
        `${name} = ${zahl} passt nicht in einen int4-Namensraum`,
      );
      if (gesehen.has(zahl)) {
        assert.fail(
          `${name} und ${gesehen.get(zahl)} teilen sich den Namensraum ${zahl} — ` +
            'die beiden Vorgänge sperren sich gegenseitig aus',
        );
      }
      gesehen.set(zahl, name);
    }
  });

  await t.test('verschiedene Namensräume behindern sich nicht', async () => {
    // Der eigentliche Punkt: ALLE gleichzeitig halten. Gäbe es irgendwo eine
    // Dublette, scheiterte schon das Belegen — und zwar mit dem Namen dabei.
    const freigeben = [];
    try {
      for (const [name, zahl] of Object.entries(LOCKS)) {
        try {
          freigeben.push(await halten(zahl));
        } catch (e) {
          assert.fail(`${name} (${zahl}) liess sich nicht belegen: ${e.message}`);
        }
      }
      assert.equal(freigeben.length, Object.keys(LOCKS).length);
    } finally {
      for (const f of freigeben) await f();
    }
  });

  await t.test('derselbe Namensraum sperrt tatsächlich aus', async () => {
    // Gegenprobe zur vorigen Prüfung: Wäre pg_try_advisory_lock hier immer
    // erfolgreich, sagte „alle gleichzeitig belegbar" gar nichts.
    const frei = await halten(LOCKS.PREIS_JOB);
    try {
      assert.equal(
        await nochFrei(LOCKS.PREIS_JOB),
        false,
        'Eine zweite Verbindung bekam dieselbe Sperre — dann schützt sie nichts',
      );
    } finally {
      await frei();
    }
    assert.equal(await nochFrei(LOCKS.PREIS_JOB), true, 'Nach dem Freigeben muss die Sperre wieder zu haben sein');
  });

  await t.test('der zweite Wert unterteilt den Namensraum', async () => {
    // Bild-Download und CSV-Import verlassen sich darauf: dieselbe Zahl, aber
    // je Set bzw. je Tabelle ein eigener Schlüssel. Ohne diese Unterteilung
    // liefen sie nacheinander statt nebeneinander.
    const frei = await halten(LOCKS.BILD_DOWNLOAD, 111);
    try {
      assert.equal(
        await nochFrei(LOCKS.BILD_DOWNLOAD, 222),
        true,
        'Zwei verschiedene Sets müssen parallel laden dürfen',
      );
      assert.equal(
        await nochFrei(LOCKS.BILD_DOWNLOAD, 111),
        false,
        'Dasselbe Set darf NICHT zweimal gleichzeitig laden',
      );
    } finally {
      await frei();
    }
  });

  await t.test('die Bestandssperre eines Kontos trifft keinen Job', async () => {
    // Konto-ID = Nummer eines Jobs, Schlüssel = Setnummer: Mit der user_id als
    // erstem Wert war das genau die Sperre des Bild-Downloads für dieses Set.
    const SET = '60511-1';
    const zweiter = (await db.get('SELECT hashtext($1) AS h', [SET])).h;
    const frei = {};
    await testKontext('bestand').transaktion(
      async () => {
        frei.bild = await nochFrei(LOCKS.BILD_DOWNLOAD, zweiter);
        // Auf eigener Verbindung: db.get liefe hier über die Transaktion, die die Sperre schon hält.
        frei.selbst = await nochFrei(
          LOCKS.INVENTAR,
          (await db.pool.query('SELECT hashtext($1) AS h', [`${LOCKS.BILD_DOWNLOAD}|${SET}`])).rows[0].h,
        );
      },
      { sperren: [{ konto: LOCKS.BILD_DOWNLOAD, schluessel: SET }] },
    );
    assert.equal(frei.bild, true, 'Die Bestandssperre von Konto 42 hält den Bild-Download des Sets auf');
    assert.equal(
      frei.selbst,
      false,
      'Die Bestandssperre liegt nicht unter LOCKS.INVENTAR — dann prüft der Fall oben nichts',
    );
  });

  await t.test('keine blanke Zahl mehr in einem Sperr-Aufruf', () => {
    // Die einzige Quelltextprüfung, die hier bleibt — und sie prüft nicht
    // WELCHE Zahl irgendwo steht, sondern DASS keine mehr direkt dasteht.
    // Genau das macht die Liste oben zur einzigen Wahrheit: Ein Aufruf mit
    // einer eingetippten Zahl umginge sie.
    const fs = require('node:fs');
    const path = require('node:path');
    const { ROOT } = require('./helpers/sources');

    const dateien = [];
    (function sammle(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', 'dist', '.git', 'data', 'test'].includes(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) sammle(p);
        else if (e.name.endsWith('.ts')) dateien.push(p);
      }
    })(ROOT);

    const treffer = [];
    let geprueft = 0;
    for (const p of dateien) {
      if (p.endsWith(path.join('src/infra/lockNamespaces.ts'))) continue; // die Liste selbst
      for (const zeile of fs.readFileSync(p, 'utf8').split('\n')) {
        if (!/pg_(try_)?advisory(_xact)?(_)?lock|pg_advisory_unlock/.test(zeile)) continue;
        if (/^\s*[*/]/.test(zeile)) continue; // Kommentar
        geprueft++;
        if (/advisory[a-z_]*\(\s*\d/.test(zeile)) {
          treffer.push(`${path.relative(ROOT, p)}: ${zeile.trim().slice(0, 90)}`);
        }
      }
    }
    assert.ok(geprueft >= 10, `Nur ${geprueft} Sperr-Aufrufe gefunden — greift das Suchmuster noch?`);
    assert.deepEqual(
      treffer,
      [],
      'Sperr-Namensraum als eingetippte Zahl statt aus src/infra/lockNamespaces.ts:\n  ' + treffer.join('\n  '),
    );
  });

  await db.pool.end().catch(() => {});
});
