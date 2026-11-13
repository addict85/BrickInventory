/**
 * Fünf Verdrahtungen, die bisher nur als Textmuster zugesichert waren.
 */
const test = require('node:test');
const { umgebung, testDaten } = require('./helpers/sources');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = testDaten();
const { testServer } = require('./helpers/server');
const { haeltSet, katalogSet } = require('./helpers/bestand');
const { mailAttrappe, mailserverEintragen } = require('./helpers/mail-attrappe');
mailAttrappe();

test.after(async () => {
  await db.pool.end().catch(() => {});
});

let HAUPT = 0,
  KIND = 0;
const SN = '75192-1';

async function aufbau() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(c);
  } finally {
    c.release();
  }
  await db.run(`INSERT INTO users (username,password_hash) VALUES ('haupt','x'),('kind','x')`);
  const id = async n => (await db.get(`SELECT id FROM users WHERE username=$1`, [n])).id;
  HAUPT = await id('haupt');
  KIND = await id('kind');
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2)`, [HAUPT, KIND]);
  await katalogSet(db, SN, { name: 'Falcon' });
  await db.run(`INSERT INTO part_catalog (part_number,part_name) VALUES ('3001','Brick')
                ON CONFLICT (part_number) DO NOTHING`);
  await db.run(`INSERT INTO part_color_catalog (part_number,color_id,color_name)
                VALUES ('3001',4,'Rot') ON CONFLICT (part_number,color_id) DO NOTHING`);
  await db.run(`INSERT INTO minifigs_catalog (fig_number,fig_name) VALUES ('sw0001','Han')
                ON CONFLICT (fig_number) DO NOTHING`);
}

test('die fünf Verdrahtungen über ihre echten Adressen', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    keineDb(t, e);
    return;
  }
  await aufbau();

  // ── Ein Server OHNE Token ────────────────────────────────────────────────
  //
  // apiNutzer weggelassen: Dann setzt der Helfer `req.apiUser` NICHT, und
  // requireToken sieht genau das, was es bei einer Anfrage ohne gültigen
  // Token sieht. Darum geht es im ersten Fall.
  const ohne = testServer(_req, {
    sitzung: {},
    routen: { '/api/v1': 'routes/api_v1/index.js' },
    t,
  });
  // ── Und einer MIT ────────────────────────────────────────────────────────
  const mit = testServer(_req, {
    sitzung: { userId: HAUPT },
    apiNutzer: { user_id: HAUPT, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js', '/api/v1/auth': 'routes/auth.js' },
    t,
  });
  // Der Bild-Proxy haengt nicht an einem Router, sondern wird auf die App
  // gesetzt (registerImgProxy). Express nimmt Routen auch nach listen() an.
  _req('routes/imgProxy.js').registerImgProxy(mit.app);

  await t.test('1. der PDF-Download antwortet ohne Token nicht mit der Datei', async () => {
    const r = await fetch(`${ohne.base}/api/v1/sets/partslist-pdf/download/irgendwas`);
    assert.ok(
      r.status === 401 || r.status === 403,
      `Erwartet 401 oder 403, bekam ${r.status}. Ohne requireToken lieferte diese ` +
        'Adresse eine fertige Teileliste an jeden aus, der die Auftragsnummer errät.',
    );
    assert.notEqual(r.headers.get('content-type'), 'application/pdf', 'Es kam trotzdem ein PDF zurück');
  });

  await t.test('2. der Bild-Proxy holt nichts von einem fremden Host', async () => {
    const fremd = encodeURIComponent('https://angreifer.example/x.jpg');
    const r = await fetch(`${mit.base}/api/v1/img-proxy?url=${fremd}`);
    assert.equal(
      r.status,
      403,
      `Erwartet 403, bekam ${r.status}. Ohne die Hostprüfung holt der Server jede ` +
        'Adresse, die ihm jemand unterschiebt — auch solche im eigenen Netz.',
    );

    // Die Gegenrichtung: Ein ERLAUBTER Host darf nicht am Filter scheitern.
    // Geholt wird hier nichts (kein Netz im Test) — geprüft wird nur, dass die
    // Antwort eine ANDERE ist als 403. Ohne diesen Fall wäre die Regel auch
    // erfüllt, wenn der Proxy alles abwiese.
    const erlaubt = encodeURIComponent('https://cdn.rebrickable.com/media/sets/75192-1.jpg');
    const r2 = await fetch(`${mit.base}/api/v1/img-proxy?url=${erlaubt}`);
    assert.notEqual(
      r2.status,
      403,
      'Auch ein erlaubter Host wurde mit 403 abgewiesen — dann prüft der Proxy ' +
        'nicht den Host, sondern lehnt grundsätzlich ab',
    );
  });

  await t.test('3. ein zu kurzes Passwort wird abgelehnt', async () => {
    // passwortZuKurz() liegt in src/konto/anmeldepruefung.ts und gilt für Registrierung,
    // Anlegen durch den Admin und das Ändern. Zugesichert war bisher, dass
    // die Routen die Funktion NENNEN.
    await db.run(`INSERT INTO global_settings (key,value) VALUES ('registration_enabled','1')
                  ON CONFLICT (key) DO UPDATE SET value='1'`);
    await mailserverEintragen(db);
    const basisVorher = process.env.APP_BASE_URL;
    umgebung({ APP_BASE_URL: 'http://localhost' });
    t.after(() => {
      if (basisVorher === undefined) umgebung({ APP_BASE_URL: undefined });
      else umgebung({ APP_BASE_URL: basisVorher });
    });
    const r = await fetch(`${mit.base}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'neuling', email: 'n@example.org', password: '12345678901', language: 'de' }),
    });
    const b = await r.json().catch(() => ({}));
    assert.equal(r.status, 400, `Erwartet 400, bekam ${r.status}: ${JSON.stringify(b)}`);
    // Die Antwort traegt den uebersetzten SATZ, nicht den Schluessel — die
    // Fehlersprache liegt zentral (src/infra/fehlerTexte.ts). Geprueft wird
    // deshalb der Satz; er nennt die Zahl, auf die es ankommt.
    assert.match(
      String(b.error || ''),
      /mindestens 12 Zeichen/,
      `Abgelehnt wurde mit „${b.error}" — erwartet die Passwortlänge. Ein anderer ` +
        'Grund hiesse, die Länge wurde gar nicht geprüft.',
    );
    assert.equal(
      (await db.get(`SELECT COUNT(*)::int c FROM users WHERE username='neuling'`)).c,
      0,
      'Das Konto wurde trotz Ablehnung angelegt',
    );

    // Gegenrichtung: zwölf Zeichen gehen durch. Ohne sie wäre die Regel auch
    // erfüllt, wenn JEDE Registrierung scheiterte.
    const r2 = await fetch(`${mit.base}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'neuling2', email: 'n2@example.org', password: 'zwoelf12Zchn', language: 'de' }),
    });
    assert.notEqual(r2.status, 400, 'Auch zwölf Zeichen wurden mit 400 abgelehnt — dann ist die Grenze nicht zwölf');
  });

  await t.test('4. ein Datum, an dem schon ein Kauf steht, wird abgelehnt', async () => {
    // findSameDayAcquisition() sitzt im ÄNDERN-Weg: Wer das Datum einer
    // Erfassung auf einen Tag schiebt, an dem für dieselbe Position schon
    // eine steht, bekommt 409. Ohne die Prüfung liefe es in den eindeutigen
    // Index (seit 0047 idx_set_acq_tag_merkmale) und käme als 500 zurück. …
    const heute = new Date().toISOString().slice(0, 10);
    const gestern = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]);
    await haeltSet(db, HAUPT, SN, 1, { preis: 100, am: gestern });
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition,created_at)
                  VALUES ($1,$2,1,100,'N',$3::timestamptz)`,
      [HAUPT, SN, heute],
    );
    const zeilen = await db.all(
      `SELECT id, created_at FROM set_acquisitions WHERE user_id=$1 AND set_number=$2
        ORDER BY created_at`,
      [HAUPT, SN],
    );
    assert.equal(zeilen.length, 2, 'Vorbedingung: zwei Erfassungen an zwei Tagen');

    // Die ÄLTERE auf den Tag der jüngeren schieben.
    const r = await fetch(`${mit.base}/api/v1/sets/${SN}/acquisitions/${zeilen[0].id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: heute }),
    });
    const b = await r.json().catch(() => ({}));
    assert.equal(
      r.status,
      409,
      `Erwartet 409, bekam ${r.status}: ${JSON.stringify(b)}. Ohne die Tagesprüfung ` +
        'landet das im eindeutigen Index und kommt als 500 zurück — ein Serverfehler ' +
        'statt einer Auskunft.',
    );
    assert.equal(
      (await db.get(`SELECT COUNT(*)::int c FROM set_acquisitions WHERE user_id=$1 AND set_number=$2`, [HAUPT, SN])).c,
      2,
      'Trotz Ablehnung hat sich die Zahl der Erfassungen geändert',
    );

    // Gegenrichtung: ein FREIER Tag geht durch. Ohne sie wäre die Regel auch
    // erfüllt, wenn jede Datumsänderung abgelehnt würde.
    const vorgestern = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
    const r2 = await fetch(`${mit.base}/api/v1/sets/${SN}/acquisitions/${zeilen[0].id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: vorgestern }),
    });
    assert.ok(
      r2.status < 400,
      `Ein freier Tag wurde mit ${r2.status} abgelehnt — dann prüft die Route nicht ` +
        'den Tag, sondern lehnt jede Datumsänderung ab',
    );
  });

  await t.test('5. ein Set verschieben ohne acquisition_ids wird abgelehnt', async () => {
    const r = await fetch(`${mit.base}/api/v1/sets/${SN}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to_user_id: KIND }),
    });
    const b = await r.json().catch(() => ({}));
    assert.equal(r.status, 400, `Erwartet 400, bekam ${r.status}: ${JSON.stringify(b)}`);
    // Wie bei der Passwortlänge: Die Antwort traegt den uebersetzten Satz,
    // nicht den Schluessel. `acquisition_ids` steht woertlich darin — genau
    // das Feld, das fehlt.
    assert.match(
      String(b.error || ''),
      /acquisition_ids/,
      `Abgelehnt wurde mit „${b.error}". Verschoben wird über den KAUFPREIS: Drei ` +
        'Erfassungen sind drei Käufe, die im Haushalt verschiedenen Kindern gehören ' +
        'können — wer alles verschieben will, wählt alle Zeilen.',
    );
    // Und nichts ist gewandert.
    assert.equal(
      (await db.get(`SELECT COUNT(*)::int c FROM sets WHERE user_id=$1 AND set_number=$2`, [KIND, SN])).c,
      0,
      'Trotz Ablehnung hat das Kind das Set bekommen',
    );
  });
});
