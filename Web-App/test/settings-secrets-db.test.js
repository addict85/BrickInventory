/**
 * KEINE Leseroute der Einstellungen gibt ein Geheimnis im Klartext heraus.
 *
 * ── Woher dieser Test kommt ─────────────────────────────────────────────────
 * `GET /api/settings/` maskiert die API-Zugangsdaten seit Langem, und der
 * Kommentar über sanitizeGlobal() beschreibt genau, warum: Der Router trägt
 * nur requireLogin, LESEN darf also jedes angemeldete Konto — auch ein
 * Unterkonto ohne Adminrechte.
 *
 * `GET /api/settings/raw` war eine zweite Fassung derselben Abfrage, nur
 * anders verpackt, und hatte die Maskierung nie bekommen: Sie spreizte
 * global_settings roh, samt bricklink_*_secret, brickset_api_key,
 * rebrickable_api_key und smtp_pass. Und ausgerechnet `/raw` ist die Route,
 * über die die Einstellungsseite lädt (public/js/05-settings.js) — die
 * Maskierung war damit für ihren eigentlichen Konsumenten wirkungslos.
 *
 * ── Warum der Test über ALLE Leserouten geht ────────────────────────────────
 * Eine Prüfung nur auf `/raw` hätte denselben Wert wie der bisherige Zustand:
 * Sie sichert die eine Stelle, die man gerade repariert hat. Die Regel lautet
 * aber „keine Leseroute dieser Datei gibt Geheimnisse heraus" — deshalb läuft
 * der Test über die Liste der Leserouten und wird rot, sobald eine neue
 * hinzukommt, die sie durchreicht.
 *
 * Gegenprobe (durchgeführt): readSettings() in `/raw` durch die alte, rohe
 * Abfrage ersetzt → beide Teilschritte für /raw werden rot (Nicht-Admin sieht
 * den Wert, Admin sieht ihn unmaskiert).
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));

/** Geheimnisse, die in keiner Antwort im Klartext stehen dürfen. */
const GEHEIM = {
  bricklink_consumer_secret: 'GEHEIM-bl-cs-4711',
  bricklink_token_secret:    'GEHEIM-bl-ts-4712',
  brickset_api_key:          'GEHEIM-bs-key-4713',
  rebrickable_api_key:       'GEHEIM-rb-key-4714',
  smtp_pass:                 'GEHEIM-smtp-4715',
};

/** Leserouten, die global_settings ausliefern. Neue gehören hierher. */
const LESEROUTEN = ['/api/settings/', '/api/settings/raw'];

/** Alle Zeichenketten einer Antwort — egal wie tief verpackt. */
function alleWerte(x, out = []) {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) x.forEach(v => alleWerte(v, out));
  else if (x && typeof x === 'object') Object.values(x).forEach(v => alleWerte(v, out));
  return out;
}

test('Einstellungen geben Geheimnisse nie im Klartext heraus', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  const NUTZER = `sec-user-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;

  const vorher = {};
  for (const [k, v] of Object.entries(GEHEIM)) {
    vorher[k] = (await db.get(`SELECT value FROM global_settings WHERE key=$1`, [k]))?.value ?? null;
    await db.run(`INSERT INTO global_settings (key,value) VALUES ($1,$2)
                  ON CONFLICT (key) DO UPDATE SET value=$2`, [k, v]);
  }

  const appFuer = (isAdmin) => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { userId: uid, isAdmin };
      next();
    });
    app.use('/api/settings', _req('routes/settings.js'));
    return app;
  };
  const srvUser  = appFuer(false).listen(0);
  const srvAdmin = appFuer(true).listen(0);
  const baseUser  = `http://localhost:${srvUser.address().port}`;
  const baseAdmin = `http://localhost:${srvAdmin.address().port}`;

  const hol = async (base, pfad) => {
    const r = await fetch(base + pfad);
    assert.equal(r.status, 200, `${pfad} -> ${r.status}`);
    return alleWerte(await r.json());
  };

  try {
    for (const pfad of LESEROUTEN) {
      // 1. Ein Konto OHNE Adminrechte darf die Schlüssel gar nicht sehen.
      const alsNutzer = await hol(baseUser, pfad);
      for (const [k, v] of Object.entries(GEHEIM)) {
        assert.ok(!alsNutzer.includes(v),
          `${pfad}: ein Konto ohne Adminrechte bekommt ${k} im Klartext`);
      }

      // 2. Auch ein Admin bekommt nur die Maske — die Werte landen sonst im
      //    Browser-Speicher, wo jede XSS-Lücke sie mitnimmt.
      const alsAdmin = await hol(baseAdmin, pfad);
      for (const [k, v] of Object.entries(GEHEIM)) {
        assert.ok(!alsAdmin.includes(v),
          `${pfad}: auch ein Admin darf ${k} nur maskiert bekommen`);
      }
      // Gegenrichtung: Die Maske muss überhaupt ankommen, sonst kann das
      // Formular „gesetzt" nicht von „nicht gesetzt" unterscheiden — ein Test,
      // der nur das Fehlen prüft, wäre auch bei einer leeren Antwort grün.
      assert.ok(alsAdmin.some(s => s.includes('\u2022') && s.endsWith('4713')),
        `${pfad}: der Admin muss die maskierte Fassung sehen (Punkte + letzte vier Zeichen)`);
    }
  } finally {
    for (const [k, v] of Object.entries(vorher)) {
      if (v === null) await db.run(`DELETE FROM global_settings WHERE key=$1`, [k]).catch(() => {});
      else await db.run(`UPDATE global_settings SET value=$2 WHERE key=$1`, [k, v]).catch(() => {});
    }
    await db.run(`DELETE FROM user_settings WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]).catch(() => {});
    await new Promise(r => srvUser.close(r));
    await new Promise(r => srvAdmin.close(r));
    await db.pool.end().catch(() => {});
  }
});
