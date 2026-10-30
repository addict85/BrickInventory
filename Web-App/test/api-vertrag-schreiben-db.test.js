/**
 * Jede SCHREIBENDE Route der App gegen ihr Kotlin-Modell.
 *
 * Gegenstück zu api-vertrag-kotlin-db (dort die GET-Routen). Die App liest
 * ohne coerceInputValues: Ein null in einem nicht-nullbaren Feld ist dort ein
 * Fehler — und bei einer Schreibantwort hiesse das „gescheitert", obwohl
 * gespeichert wurde. Deshalb läuft hier jede Route der App einmal echt durch,
 * oder sie steht mit Grund in AUSGELASSEN. Eine neue Route ohne beides macht
 * den Test rot.
 *
 * Fehlende Felder MIT Standardwert zählen hier nicht (anders als bei den
 * GET-Routen): GenericResponse und GenericAdminResponse sind Sammeltypen für
 * Dutzende Routen, jedes ihrer Felder gilt nur für einige.
 *
 * Die Schritte laufen in einer festen Reihenfolge, weil sie aufeinander
 * aufbauen (anlegen → ändern → löschen) und die Sitzung zwischen drei Konten
 * wechselt (Haushalt einladen und beitreten).
 *
 * Gegenproben (am 27.10. gemessen):
 *   A  in routes/api_v1/sets.ts PUT /storage/default mit `success: null` →
 *      rot: „passt zum Kotlin-Modell" nennt
 *      PUT /api/v1/storage/default.success: null statt boolean
 *   B  einen Schritt aus SCHRITTE entfernt (PUT /api/v1/vouchers/{id}) → rot:
 *      „jede schreibende Route ist geprüft oder begründet ausgelassen"
 *   C  in AUSGELASSEN einen Pfad ergänzt, den die App nicht kennt → rot:
 *      „keine tote Ausnahme"
 *   D  in routes/parts.ts wieder `NULLIF($1, 0)` ohne ::numeric → rot: „jeder
 *      Schritt antwortet mit 200" (PUT /parts: 500, invalid input syntax for
 *      type integer) und „Stückpreis mit Nachkommastellen"
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, '..', 'Android-App', 'app', 'src', 'main', 'java', 'ch', 'brickinventoryapp');
const _req = require('./helpers/sources').buildAndRequire();
const { routerEinhaengungen } = require('./helpers/sources');
const db = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const bcrypt  = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const PDFDocument = require('pdfkit');
const { kotlinModelle, schreibRouten, pruefe } = require(path.join(ROOT, 'scripts', 'kotlin-vertrag.js'));

const NAME = `kschreib_${process.pid}`, PASS = 'VertragsPasswort1!';
const SET = '99075-1', SET2 = '99076-1', TEIL = '3001ks', FARBE = 5, FARBE2 = 1, FIGUR = 'ks0001';

/** Routen, die hier nicht laufen dürfen oder können — mit Grund. */
const AUSGELASSEN = new Map([
  ['POST /api/v1/admin/trigger-csv-sync',          'startet den Katalogabgleich mit Rebrickable im Netz'],
  ['POST /api/v1/admin/reimport-instructions',      'lädt Anleitungen bei LEGO im Netz'],
  ['POST /api/v1/admin/trigger-price-job',          'fragt BrickLink im Netz'],
  ['POST /api/v1/admin/redownload-missing-images',  'lädt Bilder im Netz'],
  ['POST /api/v1/admin/catalog-images',             'reiht Bilder für den Download im Netz ein'],
  ['POST /api/v1/vouchers/{id}/guthaben',           'fragt das Guthaben bei LEGO im Netz ab'],
  ['POST /api/v1/sets/partslist-pdf',               'liefert eine Datei, kein JSON-Modell'],
]);

/** Ein PDF mit den übergebenen Zeilen. */
function pdfMit(zeilen) {
  return new Promise((fertig) => {
    const doc = new PDFDocument({ compress: true });
    const stuecke = [];
    doc.on('data', s => stuecke.push(s));
    doc.on('end', () => fertig(Buffer.concat(stuecke)));
    for (const z of zeilen) doc.text(z);
    doc.end();
  });
}

/** Ein Formular mit einer Datei unter `file` — so schickt es die App. */
function formular(inhalt, typ, name, felder = {}) {
  const f = new FormData();
  f.append('file', new Blob([inhalt], { type: typ }), name);
  for (const [k, v] of Object.entries(felder)) f.append(k, v);
  return f;
}

test('die Schreibantworten passen zu den Kotlin-Modellen', { concurrency: 1, timeout: 180_000 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  // ── Drei Konten: Haupt, Unterkonto, ein drittes für die Einladung ──────
  const namen = [NAME, `${NAME}_sub`, `${NAME}_neu`, `${NAME}_reg`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  const hash = await bcrypt.hash(PASS, 4);
  const anlegen = async (n, admin) => (await db.get(
    `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
     VALUES ($1, $2, $3, $4, 1, 1) RETURNING id`, [n, `${n}@example.org`, hash, admin ? 1 : 0])).id;
  const uid = await anlegen(NAME, true), sub = await anlegen(`${NAME}_sub`, false);
  const neu = await anlegen(`${NAME}_neu`, false);
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [uid, sub]);

  const globaleVorher = await db.all(
    `SELECT key, value FROM global_settings WHERE key = ANY($1)`,
    [['cache_ttl_hours', 'default_price_condition', 'app_theme', 'rate_limit_rebrickable',
      'rate_limit_bricklink', 'rate_limit_brickset', 'registration_enabled', 'price_job_interval_minutes']]).catch(() => []);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]).catch(() => {});
    for (const tab of ['set_catalog', 'set_parts_catalog', 'set_minifigs_catalog', 'brickset_queue'])
      await db.run(`DELETE FROM ${tab} WHERE set_number = ANY($1)`, [[SET, SET2]]).catch(() => {});
    await db.run('DELETE FROM part_catalog WHERE part_number = $1', [TEIL]).catch(() => {});
    await db.run('DELETE FROM part_color_catalog WHERE part_number = $1', [TEIL]).catch(() => {});
    await db.run('DELETE FROM minifigs_catalog WHERE fig_number = $1', [FIGUR]).catch(() => {});
    for (const { key, value } of globaleVorher)
      await db.run('UPDATE global_settings SET value = $2 WHERE key = $1', [key, value]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  // Die Drosseln für Registrieren & Co. zählen je IP über Läufe hinweg.
  await db.run(`DELETE FROM rate_limit_attempts WHERE key ~ '^(register|forgot-password|qr-login)\\|'`);
  // Die Währung steht schon: Ein Wechsel stiesse den Preisauftrag samt Zeitgeber an.
  // Für alle drei: Der Haushaltsbeitritt verlangt dieselbe Währung, und die
  // Vorgabe des Servers kann ein anderer Test verstellt haben.
  for (const k of [uid, sub, neu])
    await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'EUR')
                  ON CONFLICT (user_id, key) DO UPDATE SET value = 'EUR'`, [k]);

  // ── Katalog, damit Anlegen ohne Netz geht ──────────────────────────────
  for (const s of [SET, SET2])
    await db.run(`INSERT INTO set_catalog (set_number, name, year, theme, pieces, minifigs)
                  VALUES ($1, 'Schreibprobe', 2024, 'Test', 10, 1) ON CONFLICT (set_number) DO NOTHING`, [s]);
  await db.run(`INSERT INTO part_catalog (part_number, part_name, category_name) VALUES ($1, 'Stein 2x2', 'Steine')
                ON CONFLICT DO NOTHING`, [TEIL]);
  for (const [f, n] of [[FARBE, 'Rot'], [FARBE2, 'Blau']])
    await db.run(`INSERT INTO part_color_catalog (part_number, color_id, color_name, color_hex) VALUES ($1, $2, $3, 'C91A09')
                  ON CONFLICT DO NOTHING`, [TEIL, f, n]);
  await db.run(`INSERT INTO minifigs_catalog (fig_number, fig_name) VALUES ($1, 'Probefigur') ON CONFLICT DO NOTHING`, [FIGUR]);
  await db.run(`INSERT INTO brickset_queue (set_number, attempts) VALUES ($1, 1) ON CONFLICT DO NOTHING`, [SET2]).catch(() => {});

  // ── Server wie in server.ts; die Sitzung lässt sich umstellen ──────────
  let als = { id: uid, name: NAME, admin: true };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = {
      userId: als.id, username: als.name, isAdmin: als.admin,
      regenerate(cb) { cb(); }, save(cb) { cb && cb(); }, destroy(cb) { cb && cb(); },
    };
    req.apiUser = { user_id: als.id, username: als.name, is_admin: als.admin ? 1 : 0 };
    next();
  });
  app.use('/api/v1', _req('routes/api_v1/index.js'));
  for (const r of routerEinhaengungen()) app.use(r.mount, _req(`routes/${r.name}.js`));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const basis = `http://127.0.0.1:${srv.address().port}`;

  const modelle = kotlinModelle(APP);
  const routen = schreibRouten(path.join(APP, 'data', 'api'));
  const typJe = new Map(routen.map(r => [`${r.methode} ${r.pfad}`, r.typ]));

  /** Werte für die Platzhalter im Pfad; Schritte tragen neue nach. */
  const w = { setNumber: SET, partNumber: TEIL, colorId: String(FARBE), figNumber: FIGUR };
  const erst = async (sql, werte) => (await db.get(sql, werte));

  /** @type {{ m: string, p: string, body?: any, form?: () => Promise<FormData>|FormData, q?: string, als?: object, davor?: () => Promise<void>, danach?: (j: any) => Promise<void>|void }[]} */
  const SCHRITTE = [
    // ── Anmeldung und Konto ───────────────────────────────────────────────
    { m: 'POST', p: '/api/v1/auth/login', body: { username: NAME, password: PASS, label: 'Vertrag', never_expires: true } },
    { m: 'POST', p: '/api/v1/auth/qr-login', davor: async () => {
        const nonce = 'vertrag' + process.pid + Date.now();
        await db.run(`INSERT INTO qr_login_tokens (token, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '5 minutes')`,
          [_req('utils/auth.js').hashToken(nonce), uid]);
        w.qr = 'bim:' + nonce;
      }, body: () => ({ token: w.qr }) },
    { m: 'POST', p: '/api/v1/auth/register', davor: async () => {
        await db.run(`UPDATE global_settings SET value = '1' WHERE key = 'registration_enabled'`).catch(() => {});
      }, body: { username: `${NAME}_reg`, email: `${NAME}_reg@example.org`, password: PASS, language: 'de' } },
    { m: 'POST', p: '/api/v1/auth/forgot-password', body: { email: `${NAME}@example.org` } },
    { m: 'PUT',  p: '/api/v1/auth/profile', body: { username: NAME, email: `${NAME}@example.org`, first_name: 'Vera', last_name: 'Trag' } },
    { m: 'POST', p: '/api/v1/auth/zweiter-faktor/einrichten', body: { password: PASS },
      danach: (j) => { w.geheimnis = j.geheimnis; } },
    { m: 'POST', p: '/api/v1/auth/zweiter-faktor/bestaetigen', body: () => {
        const zf = _req('utils/zweiterFaktor.js');
        return { code: zf.hotp(zf.ausBase32(w.geheimnis), zf.zeitschritt()) };
      }, danach: (j) => { w.codes = j.codes; } },
    { m: 'POST', p: '/api/v1/auth/zweiter-faktor/codes', body: () => ({ code: w.codes[0] }),
      danach: (j) => { w.codes = j.codes; } },
    { m: 'POST', p: '/api/v1/auth/zweiter-faktor/abschalten', body: () => ({ password: PASS, code: w.codes[0] }) },

    // ── Einstellungen ─────────────────────────────────────────────────────
    { m: 'PUT',  p: '/api/v1/settings', body: { currency: 'EUR', price_condition: 'N' } },
    { m: 'POST', p: '/api/v1/settings/user/default-condition', body: { condition: 'N' } },
    { m: 'POST', p: '/api/v1/settings/admin/theme', body: { theme: 'classic' } },
    // Eigenes Design (Konto-Bildschirm der App), danach zurück zur Vorgabe.
    { m: 'POST', p: '/api/v1/settings/user/theme', body: { theme: 'noppe' },
      danach: (j) => { assert.deepEqual([j.theme, j.vorgabe, j.eigenes], ['noppe', 'classic', 'noppe']); } },
    { m: 'POST', p: '/api/v1/settings/user/theme', body: { theme: '' },
      danach: (j) => { assert.deepEqual([j.theme, j.eigenes], ['classic', null]); } },
    { m: 'DELETE', p: '/api/v1/settings/tokens/{tokenId}', davor: async () => {
        await _req('utils/auth.js').createToken(uid, 'Zum Entwerten');
        w.tokenId = (await erst(`SELECT substring(token, 1, 16) AS t FROM api_tokens WHERE user_id = $1 AND label = 'Zum Entwerten'`, [uid])).t;
      } },

    // ── Lagerorte ─────────────────────────────────────────────────────────
    { m: 'POST', p: '/api/v1/storage/locations', body: { name: 'Regal Probe' }, danach: (j) => { w.id = String(j.ort.id); } },
    { m: 'PUT',  p: '/api/v1/storage/locations/{id}', body: { name: 'Regal Probe 2' } },
    { m: 'PUT',  p: '/api/v1/storage/default', body: () => ({ id: Number(w.id) }) },

    // ── Sets ──────────────────────────────────────────────────────────────
    { m: 'POST', p: '/api/v1/sets', body: { set_number: SET, quantity: 1, purchase_price: 49.9, condition: 'N' } },
    { m: 'PUT',  p: '/api/v1/sets/{setNumber}', body: { quantity: 2, purchase_price: 40, condition: 'N' },
      danach: async () => {
        w.acqId = String((await erst(`SELECT id FROM set_acquisitions WHERE user_id = $1 AND set_number = $2 ORDER BY id LIMIT 1`, [uid, SET])).id);
      } },
    { m: 'PUT',  p: '/api/v1/sets/{setNumber}/acquisitions/{acqId}', body: { purchase_price: 45 } },
    { m: 'DELETE', p: '/api/v1/sets/{setNumber}/acquisitions/{acqId}' },
    // Die einzige Erfassung ist weg und mit ihr das Set — neu anlegen.
    { m: 'POST', p: '/api/v1/sets', body: { set_number: SET, quantity: 1, condition: 'N' } },
    { m: 'PUT',  p: '/api/v1/sets/{setNumber}/alert', body: { richtung: 'unter', schwelle: 30, condition: 'N' } },
    { m: 'DELETE', p: '/api/v1/sets/{setNumber}/alert', q: 'condition=N' },
    { m: 'PUT',  p: '/api/v1/sets/{setNumber}/storage', body: { storage: 'Regal Probe 2' } },
    { m: 'POST', p: '/api/v1/sets/{setNumber}/instructions/upload',
      form: async () => formular(await pdfMit(['Bauanleitung']), 'application/pdf', 'anleitung.pdf', { description: 'Probe' }),
      danach: async () => {
        w.instrId = String((await erst(`SELECT id FROM instructions WHERE set_number = $1 AND user_id = $2 ORDER BY id DESC LIMIT 1`, [SET, uid])).id);
      } },
    { m: 'DELETE', p: '/api/v1/sets/{setNumber}/instructions/{instrId}' },
    { m: 'DELETE', p: '/api/v1/sets/{setNumber}' },

    // ── Teile ─────────────────────────────────────────────────────────────
    { m: 'POST', p: '/api/v1/parts', body: { part_number: TEIL, color_id: FARBE, color_name: 'Rot', quantity: 3, unit_price: 0.2, condition: 'N' } },
    { m: 'PUT',  p: '/api/v1/parts/{partNumber}/{colorId}', body: { quantity: 4, unit_price: 0.25, condition: 'N' },
      danach: async () => {
        w.teilPreis = (await erst(`SELECT unit_price::float AS p FROM part_acquisitions WHERE user_id = $1 AND part_number = $2
                                    ORDER BY created_at DESC, id DESC LIMIT 1`, [uid, TEIL])).p;
        w.id = String((await erst(`SELECT id FROM part_acquisitions WHERE user_id = $1 AND part_number = $2 ORDER BY id LIMIT 1`, [uid, TEIL])).id);
      } },
    { m: 'PUT',  p: '/api/v1/parts/{partNumber}/{colorId}/acquisitions/{id}', body: { unit_price: 0.3 } },
    { m: 'DELETE', p: '/api/v1/parts/{partNumber}/{colorId}/acquisitions/{id}' },
    { m: 'POST', p: '/api/v1/parts', body: { part_number: TEIL, color_id: FARBE, color_name: 'Rot', quantity: 2, condition: 'N' } },
    { m: 'PUT',  p: '/api/v1/parts/{partNumber}/{colorId}/storage', body: { storage: 'Kiste' } },
    { m: 'POST', p: '/api/v1/parts/owned', body: { teile: [{ part_number: TEIL, color_id: FARBE }] } },
    { m: 'PUT',  p: '/api/v1/parts/{partNumber}/{colorId}/color', body: { color_id: FARBE2, color_name: 'Blau', color_hex: '0055BF' },
      danach: () => { w.colorId = String(FARBE2); } },
    { m: 'DELETE', p: '/api/v1/parts/{partNumber}/{colorId}' },

    // ── Minifiguren ───────────────────────────────────────────────────────
    { m: 'POST', p: '/api/v1/minifigs', body: { fig_number: FIGUR, quantity: 1, unit_price: 4, condition: 'N' } },
    { m: 'PUT',  p: '/api/v1/minifigs/{figNumber}', body: { quantity: 2, unit_price: 4.5, condition: 'N' },
      danach: async () => {
        w.id = String((await erst(`SELECT id FROM minifig_acquisitions WHERE user_id = $1 AND fig_number = $2 ORDER BY id LIMIT 1`, [uid, FIGUR])).id);
      } },
    { m: 'PUT',  p: '/api/v1/minifigs/{figNumber}/acquisitions/{id}', body: { unit_price: 5 } },
    { m: 'DELETE', p: '/api/v1/minifigs/{figNumber}/acquisitions/{id}' },
    { m: 'POST', p: '/api/v1/minifigs', body: { fig_number: FIGUR, quantity: 1, condition: 'N' } },
    { m: 'PUT',  p: '/api/v1/minifigs/{figNumber}/storage', body: { storage: 'Kiste' } },
    { m: 'DELETE', p: '/api/v1/minifigs/{figNumber}' },

    // ── Merkliste ─────────────────────────────────────────────────────────
    { m: 'POST', p: '/api/v1/wanted', body: { set_number: SET2, condition: 'N' } },
    { m: 'POST', p: '/api/v1/wanted/{setNumber}/{condition}/uebernehmen', davor: async () => { w.setNumber = SET2; w.condition = 'N'; },
      body: { quantity: 1, purchase_price: 30 } },
    // Die Übernahme hat SET2 erfasst — der Kaufpreis wandert ins Unterkonto.
    { m: 'POST', p: '/api/v1/sets/{setNumber}/move', body: async () => ({
        to_user_id: sub,
        acquisition_ids: (await db.all('SELECT id FROM set_acquisitions WHERE user_id = $1 AND set_number = $2', [uid, SET2])).map(r => r.id),
      }) },
    { m: 'POST', p: '/api/v1/wanted', body: { set_number: SET2, condition: 'U' }, danach: () => { w.condition = 'U'; } },
    { m: 'PUT',  p: '/api/v1/wanted/{setNumber}/{condition}/inhaber', body: () => ({ owner_user_id: uid, neuer_inhaber: sub }) },
    { m: 'DELETE', p: '/api/v1/wanted/{setNumber}/{condition}', q: () => `owner_user_id=${sub}` },

    // ── Lagerort wegräumen (nach Sets/Teilen, die ihn benutzten) ──────────
    { m: 'DELETE', p: '/api/v1/storage/locations/{id}', davor: async () => {
        await db.run(`UPDATE sets SET storage_id = NULL WHERE user_id = ANY($1)`, [[uid, sub]]);
        w.id = String((await erst(`SELECT id FROM storage_locations WHERE user_id = $1 ORDER BY id LIMIT 1`, [uid])).id);
      } },

    // ── Gutscheine ────────────────────────────────────────────────────────
    { m: 'POST', p: '/api/v1/vouchers', body: { number: '5045076374450011111', pin: '1234', amount: 50, currency: 'CHF' },
      danach: (j) => { w.id = String(j.voucher.id); } },
    { m: 'PUT',  p: '/api/v1/vouchers/{id}', body: { number: '5045076374450011111', pin: '4321', amount: 40, currency: 'CHF' } },
    { m: 'DELETE', p: '/api/v1/vouchers/{id}' },
    { m: 'POST', p: '/api/v1/vouchers/pdf',
      form: async () => formular(await pdfMit(['Ihre LEGO-Geschenkkarte im Wert von 25 CHF:', '5045076374450012222', 'PIN: 4711']),
        'application/pdf', 'gutschein.pdf') },

    // ── Haushalt: einladen, als drittes Konto beitreten, lösen ────────────
    { m: 'POST', p: '/api/v1/settings/household/invite', danach: (j) => { w.code = j.code; } },
    { m: 'POST', p: '/api/v1/settings/household/redeem', als: { id: neu, name: `${NAME}_neu`, admin: false },
      body: () => ({ code: w.code, password: PASS }) },
    { m: 'POST', p: '/api/v1/settings/household/unlink', body: () => ({ sub_user_id: neu }) },
    { m: 'POST', p: '/api/v1/settings/household/former/dismiss', davor: async () => {
        await erst(`INSERT INTO household_former_links (main_user_id, sub_user_id) VALUES ($1, $2)
                    ON CONFLICT DO NOTHING`, [uid, neu]);
      }, body: () => ({ sub_user_id: neu }) },

    // ── CSV-Importe: nur die Kopfzeile, damit kein Auftrag ins Netz geht ──
    { m: 'POST', p: '/api/v1/sets/import/csv', form: () => formular(`set_number,quantity\n${SET},1\n`, 'text/csv', 'sets.csv') },
    { m: 'POST', p: '/api/v1/sets/import/csv/cancel' },
    { m: 'POST', p: '/api/v1/parts/import/csv', form: () => formular('part_number,color_id,quantity\n', 'text/csv', 'teile.csv') },
    { m: 'POST', p: '/api/v1/minifigs/import/csv', form: () => formular('fig_number,quantity\n', 'text/csv', 'figuren.csv') },
    { m: 'POST', p: '/api/v1/wanted/import/csv', form: () => formular('set_number,condition\n', 'text/csv', 'merkliste.csv') },
    { m: 'POST', p: '/api/v1/alerts/import/csv', form: () => formular('set_number,condition,richtung,schwelle\n', 'text/csv', 'alarme.csv') },

    // ── Verwaltung ────────────────────────────────────────────────────────
    { m: 'POST', p: '/api/v1/admin/job-schedule', davor: async () => {
        w.minuten = Number((await erst(`SELECT value FROM global_settings WHERE key = 'price_job_interval_minutes'`, []))?.value) || 60;
      }, body: () => ({ name: 'priceJob', minutes: w.minuten }) },
    { m: 'POST', p: '/api/v1/admin/cache-ttl', body: { ttl: '24' } },
    { m: 'POST', p: '/api/v1/admin/cache-clear', body: {} },
    { m: 'POST', p: '/api/v1/admin/default-condition', body: { condition: 'N' } },
    { m: 'PUT',  p: '/api/v1/admin/api-limits', davor: async () => {
        const g = await db.all(`SELECT key, value FROM global_settings WHERE key LIKE 'rate_limit_%'`).catch(() => []);
        w.limits = Object.fromEntries(g.map(r => [r.key.replace('rate_limit_', ''), Number(r.value) || 1000]));
      }, body: () => ({ rebrickable: w.limits.rebrickable ?? 1000, bricklink: w.limits.bricklink ?? 1000, brickset: w.limits.brickset ?? 1000 }) },
    { m: 'POST', p: '/api/v1/admin/brickset-queue/{setNumber}/retry', davor: async () => { w.setNumber = SET2; } },
    { m: 'DELETE', p: '/api/v1/admin/brickset-queue/{setNumber}' },

    // ── Zum Schluss: Passwort ändern (verwirft alle Token), abmelden ──────
    { m: 'POST', p: '/api/v1/auth/change-password', body: { current: PASS, newPassword: PASS + 'x' } },
    { m: 'POST', p: '/api/v1/auth/logout' },
  ];

  const abweichungen = [], status = [], gelaufen = new Set();
  const dauer = [];
  for (const s of SCHRITTE) {
    const schluessel = `${s.m} ${s.p}`;
    const start = Date.now();
    if (s.davor) await s.davor();
    if (s.als) als = s.als;
    const pfad = s.p.replace(/\{(\w+)\}/g, (_, n) => encodeURIComponent(w[n] ?? `<${n}>`));
    const q = typeof s.q === 'function' ? s.q() : s.q;
    const body = typeof s.body === 'function' ? await s.body() : s.body;
    // Eine Zeitgrenze je Schritt: Ein hängender Schritt wird so ein roter, kein hängender Test.
    const init = { method: s.m, signal: AbortSignal.timeout(15_000) };
    if (s.form) init.body = await s.form();
    else if (body !== undefined) { init.body = JSON.stringify(body); init.headers = { 'Content-Type': 'application/json' }; }
    let antwort;
    try { antwort = await fetch(basis + pfad + (q ? '?' + q : ''), init); }
    catch (e) { status.push(`${schluessel}: ${e.name}`); als = { id: uid, name: NAME, admin: true }; continue; }
    als = { id: uid, name: NAME, admin: true };
    const text = await antwort.text();
    let json; try { json = JSON.parse(text); } catch { status.push(`${schluessel}: ${antwort.status} kein JSON`); continue; }
    if (antwort.status !== 200) { status.push(`${schluessel}: ${antwort.status} ${text.slice(0, 160)}`); continue; }
    gelaufen.add(schluessel);
    const typ = typJe.get(schluessel);
    if (typ && modelle.has(typ))
      abweichungen.push(...pruefe(json, { art: 'klasse', name: typ, nullbar: false }, modelle, schluessel,
        { standardwerte: false }));
    if (s.danach) await s.danach(json);
    dauer.push([Date.now() - start, schluessel]);
  }
  if (process.env.VERTRAG_DAUER) console.error(dauer.sort((a, b) => b[0] - a[0]).slice(0, 5));

  await t.test('jeder Schritt antwortet mit 200', () => assert.deepEqual(status, []));
  await t.test('passt zum Kotlin-Modell', () => assert.deepEqual(abweichungen, []));
  await t.test('jede schreibende Route ist geprüft oder begründet ausgelassen', () => {
    const offen = routen.map(r => `${r.methode} ${r.pfad}`)
      .filter(k => !gelaufen.has(k) && !AUSGELASSEN.has(k));
    assert.deepEqual(offen, []);
  });
  await t.test('ein Stückpreis mit Nachkommastellen bleibt beim Ändern erhalten', () =>
    assert.equal(w.teilPreis, 0.25));
  await t.test('keine tote Ausnahme', () => {
    const bekannt = new Set(routen.map(r => `${r.methode} ${r.pfad}`));
    assert.deepEqual([...AUSGELASSEN.keys()].filter(k => !bekannt.has(k)), []);
  });
  t.diagnostic(`geprüft: ${gelaufen.size} von ${routen.length}`);
});
