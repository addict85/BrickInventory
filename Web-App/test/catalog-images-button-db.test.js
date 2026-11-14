/**
 * Knopf „Katalogbilder holen" und die Vorschau dazu.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// Herunterladen und Verkleinern abfangen — hier zählt, WAS aufgerufen wird.
let geladen = 0;
const verkleinert = [];

const { buildAndRequire, testDaten, testBildwerk } = require('./helpers/sources');
const _req = buildAndRequire();
testBildwerk(null, {
  setBildLaden: async (_u, sn) => {
    geladen++;
    return `/images/sets/${sn}.jpg`;
  },
  vorschauErzeugen: async p => {
    verkleinert.push(p);
    return true;
  },
});
const { keineDb } = require('./helpers/db');
const { leereWarteschlange } = require('./helpers/bildwarteschlange');
const { testServer } = require('./helpers/server');
const { verwalterMitFaktor } = require('./helpers/verwalter');
const db = testDaten();

test('Katalogbilder auf Knopfdruck', { concurrency: 1 }, async t => {
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  // Die Warteschlange gehoert VOR dem Benutzen geleert, nicht nur das eigene
  // Praefix — sonst nimmt der Stapel die Zeilen eines Vorgaengers. Begruendung
  // und Nachstellung in helpers/bildwarteschlange.js.
  await leereWarteschlange(db);

  const { SET_IMAGES_DIR } = _req('src/infra/appPaths.js');
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });
  const P = `KN${process.pid}`;
  const NUTZER = `kn-${process.pid}`;
  const dateien = [`${P}_1.jpg`, `${P}_2.jpg`, `${P}_2_thumb.jpg`];

  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash,is_admin) VALUES ($1,'x',true)`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;
  await db.run(`DELETE FROM rb_sets WHERE set_num LIKE $1`, [P + '%']);
  await db.run(`DELETE FROM image_wanted`);
  await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']);
  await db.run(
    `INSERT INTO rb_sets (set_num,name,year,theme_id,num_parts,set_img_url)
                SELECT $1||'_'||g,'S',2020,1,10,'https://cdn.rebrickable.com/media/sets/'||$1||'_'||g||'.jpg'
                  FROM generate_series(1,10) g`,
    [P],
  );
  // _1: Bild liegt, Vorschau fehlt. _2: beides liegt.
  // _3: BESTÄTIGTER 404 — bleibt draussen.
  // _4: Fehlanzeige OHNE Grund (Altbestand aus der Zeit vor einer früheren Runde, als
  //     jeder Netzwerkaussetzer als „gibt es nicht" galt) — wird zurückgenommen.
  fs.writeFileSync(path.join(SET_IMAGES_DIR, `${P}_1.jpg`), 'x');
  fs.writeFileSync(path.join(SET_IMAGES_DIR, `${P}_2.jpg`), 'x');
  fs.writeFileSync(path.join(SET_IMAGES_DIR, `${P}_2_thumb.jpg`), 'x');
  await db.run(`INSERT INTO image_misses (cache_key, reason) VALUES ($1,$2)`, [`set:${P}_3`, 'HTTP 404 vom CDN']);
  await db.run(`INSERT INTO image_misses (cache_key) VALUES ($1)`, [`set:${P}_4`]);

  await verwalterMitFaktor(_req, uid);
  const { base, srv } = testServer(_req, { sitzung: { userId: uid, isAdmin: 1 }, t });

  try {
    await t.test('der Knopf reiht ein, ohne bekannte Fehlanzeigen', async () => {
      const d = await (await fetch(`${base}/api/v1/admin/catalog-images`, { method: 'POST' })).json();
      assert.equal(d.success, true);
      // Fertiges bleibt aussen vor
      assert.equal(
        d.queued,
        8,
        `${d.queued} eingereiht statt 8 — draussen bleiben Sets mit BESTÄTIGTER ` +
          'Fehlanzeige UND solche, die Bild samt Vorschau schon lokal haben',
      );
      assert.equal(
        d.skipped,
        1,
        `skipped=${d.skipped} statt 1 — die Rückmeldung soll nennen, wie viele ` + 'schon fertig waren',
      );

      // „Kannst du die Logik so anpassen, dass er die image_misses löscht und
      // sie erneut versucht? Aktuell stehen in der Tabelle sehr viele
      // Einträge." — Die vielen Einträge sind der Fehler aus einer früheren Runde:
      // Jeder Netzwerkaussetzer galt als „gibt es nicht".
      assert.equal(
        d.verworfen,
        1,
        `verworfen=${d.verworfen} statt 1 — genau die Fehlanzeige ohne Grund ` + 'gehört zurückgenommen',
      );
      assert.equal(
        (await db.get(`SELECT COUNT(*)::int c FROM image_misses WHERE cache_key = $1`, [`set:${P}_3`])).c,
        1,
        'Der bestätigte 404 wurde mitgelöscht. Für alte Sets hat der CDN meist ' +
          'kein Bild — die alle erneut zu holen wäre ein halber Tag reiner ' +
          '404-Verkehr, und beim nächsten Klick wieder.',
      );
      assert.equal(
        (await db.get(`SELECT COUNT(*)::int c FROM image_misses WHERE cache_key = $1`, [`set:${P}_4`])).c,
        0,
        'Die grundlose Fehlanzeige steht noch — dann bleibt das Bild weitere ' +
          'sieben Tage aus, obwohl nie etwas an ihm war',
      );
      assert.ok(d.dauer_minuten >= 0, 'Die Dauerabschätzung fehlt');
    });

    await t.test('ein zweiter Klick reiht nichts Fertiges neu ein', async () => {
      // Der eigentliche Befund: Nach einem vollen Durchlauf brachte jeder Klick
      // den ganzen Katalog zurück in die Warteschlange. Der Job arbeitete das
      // richtig ab (Datei da → überspringen), aber die Kachel zeigte
      // Zehntausende offene Bilder, und jede Notiz kostete einen Durchgang.
      await db.run(`DELETE FROM image_wanted`);
      const extra = [];
      for (let i = 1; i <= 10; i++) {
        for (const suf of ['.jpg', '_thumb.jpg']) {
          const f = path.join(SET_IMAGES_DIR, `${P}_${i}${suf}`);
          try {
            fs.writeFileSync(f, 'x', { flag: 'wx' });
            extra.push(f);
          } catch (e) {
            if (e.code !== 'EEXIST') throw e;
          }
        }
      }
      try {
        const d = await (await fetch(`${base}/api/v1/admin/catalog-images`, { method: 'POST' })).json();
        assert.equal(d.queued, 0, `${d.queued} eingereiht, obwohl alles fertig ist — genau Marcos Befund`);
        assert.equal(d.pending, 0, 'Die Warteschlange darf leer bleiben');
      } finally {
        for (const f of extra) fs.rmSync(f, { force: true });
        // Die Warteschlange wieder in den Ausgangszustand bringen — der
        // Teilschritt darunter arbeitet sie ab und braucht sie gefüllt.
        await (await fetch(`${base}/api/v1/admin/catalog-images`, { method: 'POST' })).json();
      }
    });

    await t.test('der Job holt nur, was fehlt', async () => {
      const IQ = _req('src/katalog/bilder/bildbedarfLauf.js');
      let n = 0;
      // `.gesamt` = bearbeitete Notizen (geladen, Vorschau erzeugt oder
      // übersprungen). Seit einer früheren Runde liefert der Durchgang eine
      // Aufschlüsselung statt einer nackten Zahl — der Job schwieg sonst
      // genau dann, wenn er nur überspringt.
      for (let i = 0; i < 3; i++) n += (await IQ._arbeiteStapel()).gesamt;
      assert.equal(
        geladen,
        7,
        `${geladen} Downloads statt 7 — bereits vorhandene Bilder dürfen nicht ` + 'erneut geholt werden',
      );
      assert.ok(n >= 8, `nur ${n} Aufträge abgearbeitet`);
    });

    await t.test('fehlende Vorschauen werden nachgeholt, vorhandene nicht', async () => {
      // Marcos zweite Frage. Für Bilder, die vor dem Hintergrund-Job abgelegt
      // wurden, fehlt die Vorschau womöglich.
      assert.ok(verkleinert.includes(`/images/sets/${P}_1.jpg`), 'Das vorhandene Bild ohne Vorschau bekommt keine');
      assert.ok(
        !verkleinert.includes(`/images/sets/${P}_2.jpg`),
        'Für ein Bild mit vorhandener Vorschau wird erneut gerechnet',
      );
      // Und zu jedem frisch geholten Bild gehört eine.
      assert.equal(
        verkleinert.length,
        geladen + 1,
        `${verkleinert.length} Vorschauen bei ${geladen} Downloads + 1 nachgeholter`,
      );
    });

    // ── ZULETZT, weil dieser Teilschritt die Bühne verändert ───────────────
    //
    // Er nimmt die Fehlanzeige von _3 zurück und reiht das Set damit ein. Weiter
    // oben stand er zuerst — und liess die Job-Prüfungen darunter einen Download
    // mehr sehen, als sie erwarteten. Die Teilschritte hier teilen sich eine
    // Bühne; wer sie verändert, gehört ans Ende.
    await t.test('alle_erneut nimmt auch die bestätigten 404er zurück', async () => {
      // Für den Fall, dass der CDN Bilder nachgereicht hat. Bewusst NICHT die
      // Vorgabe: Für alte Sets hat Rebrickable meist gar kein Bild, und die
      // alle erneut zu holen kostet bei dreissig Anfragen je Minute Stunden.
      const d = await (
        await fetch(`${base}/api/v1/admin/catalog-images`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alle_erneut: true }),
        })
      ).json();
      assert.equal(d.success, true);
      assert.equal(
        (await db.get(`SELECT COUNT(*)::int c FROM image_misses WHERE cache_key = $1`, [`set:${P}_3`])).c,
        0,
        'Mit alle_erneut muss auch der bestätigte 404 zurückgenommen werden',
      );
    });
  } finally {
    for (const f of dateien) fs.rmSync(path.join(SET_IMAGES_DIR, f), { force: true });
    await db.run(`DELETE FROM rb_sets WHERE set_num LIKE $1`, [P + '%']).catch(() => {});
    await db.run(`DELETE FROM image_wanted`).catch(() => {});
    await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']).catch(() => {});
    await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});

test('der Knopf ist in der Kachel verdrahtet', () => {
  // Ohne Registrierung tut ein Klick nichts — und das fällt erst am Gerät auf.
  const core = require('./helpers/sources').coreQuelle();
  assert.match(core, /data-click="queueCatalogImages"/, 'Der Knopf fehlt in der Kachel');
  const admin = require('./helpers/sources').adminQuelle();
  assert.match(admin, /export async function queueCatalogImages/, 'Kein Klick-Handler');
  assert.match(admin, /^\s+queueCatalogImages,$/m, 'Der Handler ist nicht in der Aktions-Liste registriert');
  for (const loc of ['de', 'en']) {
    const l = fs.readFileSync(path.join(ROOT, 'public', 'locales', `${loc}.js`), 'utf8');
    assert.match(l, /'monitor\.catalog_images':/, `Beschriftung fehlt in ${loc}`);
    assert.match(l, /'monitor\.catalog_images_queued':/, `Rückmeldung fehlt in ${loc}`);
    // Zweite Fassung für den Fall, dass schon etwas vorhanden war: Ohne sie
    // sähe „0 Bilder in der Warteschlange" nach einem Fehlschlag aus, obwohl
    // es die beste aller Meldungen ist.
    assert.match(l, /'monitor\.catalog_images_queued_skipped':/, `Rückmeldung für „schon vorhanden" fehlt in ${loc}`);
    // Der Knopf nimmt jetzt Fehlanzeigen zurück und schätzt die
    // Dauer. Ohne beide Zahlen bliebe unklar, warum plötzlich wieder Bilder
    // anstehen, die zuletzt als fehlend galten — und ob das Minuten oder
    // Stunden dauert.
    assert.match(
      l,
      /'monitor\.catalog_images_retried':/,
      `Rückmeldung für zurückgenommene Fehlanzeigen fehlt in ${loc}`,
    );
    assert.match(l, /'monitor\.catalog_images_eta':/, `Dauerabschätzung fehlt in ${loc}`);
  }
});
