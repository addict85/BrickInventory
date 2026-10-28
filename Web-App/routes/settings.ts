
import { bestaetigePasswort } from '../utils/passwortBestaetigung';
import express from 'express';
const router  = express.Router();
import multer from 'multer';
import * as db from '../db/database';
import { handleRouteError, logAndContinue, meldeUndWeiter, fehlertext } from '../utils/httpError';
import { pruefeRebrickableZugang } from '../clients/rebrickable';
import { pruefeBricksetZugang } from '../clients/brickset';
import { pruefeBricklinkZugang } from '../clients/bricklink';
import { requireApiAdmin as requireAdmin } from './api_v1/middleware';
const requireLogin = requireLoginOrToken;

import { setUserSetting, setGlobalSetting, getGlobalSetting, SECRET_KEYS, isMaskedValue, readSettings, nutzerEinstellungen } from '../utils/settings';
import { getRateLimitStatus } from '../utils/financeCalc';
import { buildSetsCsv } from '../utils/setService';
import { buildPartsCsv, buildFigsCsv } from '../utils/bestandExport';
import { buildMerklisteCsv } from '../utils/merkliste';
import { buildPreisalarmeCsv } from '../utils/preisalarm';
import { DAILY_JOBS } from '../jobs/dailyScheduler';
import { escapeLike, requireLoginOrToken, nutzerId, angemeldeteNutzerId, istVerwalter, nutzerName, hashToken, leereTokenCache } from '../utils/auth';
import { bearerToken } from './api_v1/middleware';
import { sendMail, testSmtp } from '../utils/mailer';
import { sendeFehler } from '../utils/fehlerTexte';
import { setzeAusloeser } from '../utils/laufzustand';

// ── Öffentlich: aktuelles App-Design ─────────────────────────────────────────
// MUSS vor router.use(requireLogin) stehen. Der Kommentar sagte schon immer
// „von allen Nutzern lesbar", faktisch lag die Route aber hinter der
// Login-Pflicht — und damit war das global eingestellte Design auf dem Login-
// und dem Startup-Screen gar nicht abrufbar. Der Wert ist eine reine
// UI-Einstellung ('classic' | 'brick') und verrät nichts über Konten oder Daten.
router.get('/theme', async (_req, res) => {
  const theme = await getGlobalSetting('app_theme');
  res.set('Cache-Control', 'no-cache');
  res.json({ success: true, theme: theme || 'classic' });
});

// Angemeldete Geräte: Sitzung ODER Token
// MUSS vor router.use(requireLogin) stehen — aus demselben Grund wie /theme
// darüber, nur andersherum: Nicht weil gar keine Anmeldung nötig wäre,
// sondern weil requireLogin NUR die Sitzung kennt. Die App hat keine; sie …
// Ausführlich: docs/begruendungen/routes/settings.ts.md#abschnitt
/**
 * GET /api/v1/settings/tokens — die eigenen Zugänge auflisten.
 * Ausführlich: docs/begruendungen/routes/settings.ts.md#get-tokens
 */
router.get('/tokens', requireLoginOrToken, async (req: LoggedInRequest, res) => {
  try {
    const uid = nutzerId(req);
    const eigener = bearerToken(req);
    const eigenerHash = eigener ? hashToken(eigener) : null;
    // LEAST ueber beide Fristen: `expires_at` ist die gleitende („so lange
    // ungenutzt"), `hard_expires_at` die feste, die beim QR-Code gewaehlt
    // wurde. Was den Nutzer interessiert, ist der FRUEHERE der beiden — der
    // Tag, an dem dieses Geraet ausgesperrt wird.
    // Ausführlich: docs/begruendungen/routes/settings.ts.md#get-tokens-tokens
    const tokens = await db.all(
      `SELECT token, label, created_at, last_used, hard_expires_at,
              LEAST(expires_at, hard_expires_at) AS expires_at
         FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC`,
      [uid]);
    res.json({ success: true, tokens: tokens.map((t: any) => ({
      token_prefix: t.token.substring(0, 8),
      token_id:     t.token.substring(0, 16),
      label:        t.label,
      created_at:   t.created_at,
      last_used:    t.last_used,
      expires_at:   t.expires_at,
      hard_expires_at: t.hard_expires_at,
      never_expires: !t.expires_at,
      aktuell:      t.token === eigenerHash,
    }))});
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

/**
 * DELETE /api/v1/settings/tokens/:tokenId — einen Zugang entwerten.
 * Ausführlich: docs/begruendungen/routes/settings.ts.md#delete-tokens-tokenid
 */
router.delete('/tokens/:tokenId', requireLoginOrToken, async (req: LoggedInRequest, res) => {
  try {
    const uid = nutzerId(req);
    // escapeLike: ohne das löscht ein "%" als tokenId ALLE Tokens des Nutzers.
    const prefix = escapeLike(String(req.params.tokenId || '')).slice(0, 64);
    if (!prefix) return sendeFehler(req, res, 400, 'token_id_fehlt');
    const r = await db.run(
      "DELETE FROM api_tokens WHERE user_id = $1 AND token LIKE $2 ESCAPE '\\'",
      [uid, prefix + '%']);
    if (r.changes) leereTokenCache();
    res.json({ success: true, deleted: r.changes });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

/** Die übrigen Browser-Sitzungen beenden; die eigene bleibt. */
router.post('/sessions/andere-beenden', requireLogin, async (req: LoggedInRequest, res) => {
  try {
    const r = await db.run(
      "DELETE FROM user_sessions WHERE sess::jsonb->>'userId' = $1 AND sid <> $2",
      [String(angemeldeteNutzerId(req)), req.sessionID]);
    res.json({ success: true, deleted: r.changes });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.use(requireLogin);

// GET /api/settings ist ENTFERNT
// Sie lieferte GENAU DASSELBE wie GET /raw achtzig Zeilen weiter unten —
// beide riefen readSettings(userId, isAdmin) —, nur in einer anderen Huelle:
// hier ausgebreitet (`{ success, ...settings }`), dort verschachtelt …
// Ausführlich: docs/begruendungen/routes/settings.ts.md#post

router.post('/', async (req: LoggedInRequest, res) => {
  const uid = angemeldeteNutzerId(req);
  const globalKeys = ['bricklink_consumer_key','bricklink_consumer_secret','bricklink_token',
    'bricklink_token_secret','brickset_api_key','rebrickable_api_key','price_job_interval_minutes',
    'price_cache_ttl','api_limit_rebrickable','api_limit_bricklink','api_limit_brickset',
    'registration_enabled','smtp_host','smtp_port','smtp_user','smtp_pass','smtp_from','smtp_secure','smtp_insecure_tls',
    'default_price_condition',
    // Das Ausgabeland der Gutscheine. GLOBAL und nicht je Nutzer, weil Marco
    // es so wollte: „das Ausgabeland soll in den Einstellungen bei den
    // Gutscheinen fuer alle erfasst werden koennen". Damit liegt es hier und
    // nicht in userKeys — und damit darf es, wie alle globalen Werte, nur ein
    // Verwalter setzen. Lesen duerfen es alle (es ist kein Geheimnis, steht
    // also nicht in SECRET_KEYS), sonst stuende im Auswahlfeld nichts.
    'gutschein_land'];
  const userKeys = ['currency', 'language', 'user_default_condition'];

  try {
    if (istVerwalter(req)) {
      // Mailserver nur mit Passwort umstellen: Wer eine Verwaltersitzung
      // erbeutet, läse sonst alle künftigen Rücksetz-Mails mit. Gefragt wird
      // nur bei einer echten Änderung, nicht beim Speichern der ganzen Seite.
      const smtpGeaendert: string[] = [];
      for (const key of globalKeys.filter(k => k.startsWith('smtp_'))) {
        const neu = req.body[key];
        if (neu === undefined || (SECRET_KEYS.has(key) && isMaskedValue(neu))) continue;
        if (String(neu) !== String(await getGlobalSetting(key) ?? '')) smtpGeaendert.push(key);
      }
      if (smtpGeaendert.length && !await bestaetigePasswort(req, res, uid, req.body.admin_password)) return;

      // Check if brickset limit is being increased before saving
      const oldBricksetLimit = req.body.api_limit_brickset !== undefined
        ? parseInt(await getGlobalSetting('api_limit_brickset') || '100')
        : null;

      for (const key of globalKeys) {
        if (req.body[key] !== undefined) {
          // Das Formular bekommt Geheimnisse maskiert (siehe sanitizeGlobal).
          // Schickt der Client die Maske unverändert zurück — der Normalfall,
          // wenn nur ein anderes Feld geändert wurde —, darf sie NICHT als
          // neuer Wert gespeichert werden: Sonst überschreibt jedes Speichern
          // der Einstellungsseite die echten API-Schlüssel mit Punkten.
          if (SECRET_KEYS.has(key) && isMaskedValue(req.body[key])) continue;
          await setGlobalSetting(key, req.body[key]);
        }
      }

      // If brickset limit was increased, check if retry queue can now be processed
      if (oldBricksetLimit !== null) {
        const newLimit = parseInt(req.body.api_limit_brickset);
        if (newLimit > oldBricksetLimit) {
          const rl = await getRateLimitStatus('brickset').catch(() => null);
          const remaining = rl ? Math.max(0, newLimit - (rl.count || 0)) : 0;
          if (remaining > 0) {
            console.log(`[brickset] Limit increased from ${oldBricksetLimit} to ${newLimit} — ${remaining} calls available, processing retry queue`);
            setImmediate(() => require('../jobs/bricksetRetry').processRetryQueue().catch(() => {}));
          }
        }
      }
    }
    for (const key of userKeys) {
      if (req.body[key] !== undefined) {
        // Zentrale Stelle — stösst bei einer ECHTEN Währungsänderung den
        // Preis-Job an (Begründung in utils/settings.ts).
        await setUserSetting(uid, key, req.body[key]);
      }
    }
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// /raw — dieselben Werte wie `/`, nur unter `settings` verpackt. Die
// Einstellungsseite lädt hierüber. Inhalt kommt aus readSettings(), damit die
// Maskierung nicht an der Verpackung vorbeigeht (siehe dort).
router.get('/raw', async (req: LoggedInRequest, res) => {
  try {
    res.json({ success: true, settings: await readSettings(angemeldeteNutzerId(req), istVerwalter(req)) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// /cache-stats liegt seit Etappe 7 unter /api/v1/admin/cache-stats.

router.get('/export', async (req, res) => {
  try {
    const global: any = {};
    // Nur Verwalter bekommen die Installation mit: Der Import nimmt globale
    // Werte ohnehin nur von ihnen an, und SMTP-Host, -Konto und Absender
    // gehen ein Unterkonto nichts an.
    if (istVerwalter(req)) (await db.all('SELECT key, value FROM global_settings'))
      // Laufzeitzustände stehen seit Migration 0063 nicht mehr hier (laufzustand).
      // Geheimnisse gehören NICHT in eine Datei, die der Nutzer herunterlädt,
      // per Mail weiterschickt oder in ein Repo legt. Der Export ist als
      // Konfigurations-Sicherung gedacht, nicht als Schlüsselkopie — die
      // API-Zugangsdaten trägt man beim Wiederherstellen einmalig neu ein.
      .filter(r => !SECRET_KEYS.has(r.key))
      .forEach(r => { global[r.key] = r.value; });
    const userSettings: any = await nutzerEinstellungen(nutzerId(req)!);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="brickinventory-config-${new Date().toISOString().substring(0,10)}.json"`);
    res.json({ exported_at: new Date().toISOString(), exported_by: nutzerName(req), version: '3.0', global, user_settings: userSettings });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── GET /api/settings/export/data — Sets, Teile und Minifiguren jeweils als CSV,
// gebündelt in einem ZIP (reuses the exact same CSV-building logic as the
// individual /api/sets|parts|minifigs/export/csv endpoints, implemented once).
// LoggedInRequest: Der Router liegt hinter requireLogin (oben), und die
// Augmentierung sichert userId als number zu — die drei CSV-Bauer verlangen das.
router.get('/export/data', async (req: LoggedInRequest, res) => {
  try {
    // archiver 8 (05.10.) exportiert KEINE aufrufbare Funktion mehr, sondern
    // Klassen — das Paket ist `type: module`. Node kann es aus CommonJS
    // heraus weiterhin per `require()` holen (seit 22.12 stabil, wir fahren
    // 26), was herauskommt ist dann aber ein Objekt.
    //
    // NACHGEMESSEN gegen archiver 8.0.0: `new ZipArchive(opts)` traegt
    // dieselben vier Dinge, die hier gebraucht werden — append, pipe,
    // finalize, on('error') — und erzeugt ein Archiv mit PK-Signatur.
    const { ZipArchive } = require('archiver');
    const uid = angemeldeteNutzerId(req);

    // merkliste.csv kam dazu: „Merklisten sollen
    // ebenfalls analog den anderen Seiten exportiert und importiert werden."
    // Im SELBEN Archiv und nicht als eigene Route — die drei einzelnen
    // /export/csv-Routen sind in diesem Baum ausdruecklich ENTFERNT worden …
    // Ausführlich: docs/begruendungen/routes/settings.ts.md#get-export-data
    const [setsCsv, partsCsv, figsCsv, merkCsv, alarmCsv] = await Promise.all([
      buildSetsCsv(uid), buildPartsCsv(uid), buildFigsCsv(uid), buildMerklisteCsv(uid),
      buildPreisalarmeCsv(uid),
    ]);

    const dateStr = new Date().toISOString().substring(0, 10);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="brickinventory-export-${dateStr}.zip"`);

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on('error', (err: any) => { console.error('[export-zip]', err.message); res.status(500).end(); });
    archive.pipe(res);
    archive.append('\uFEFF' + setsCsv,  { name: 'sets.csv' });
    archive.append('\uFEFF' + partsCsv, { name: 'teile.csv' });
    archive.append('\uFEFF' + figsCsv,  { name: 'minifiguren.csv' });
    archive.append('\uFEFF' + merkCsv,  { name: 'merkliste.csv' });
    archive.append('\uFEFF' + alarmCsv, { name: 'preisalarme.csv' });
    await archive.finalize();
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 } });
router.post('/import', importUpload.single('file'), async (req: LoggedInRequest, res) => {
  if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
  let config;
  try { config = JSON.parse(req.file.buffer.toString('utf-8')); }
  catch (e) { return sendeFehler(req, res, 400, 'json_ungueltig'); }

  const globalKeys = ['bricklink_consumer_key','bricklink_consumer_secret','bricklink_token',
    'bricklink_token_secret','brickset_api_key','rebrickable_api_key','price_job_interval_minutes',
    'price_cache_ttl','api_limit_rebrickable','api_limit_bricklink','api_limit_brickset',
    'registration_enabled','smtp_host','smtp_port','smtp_user','smtp_pass','smtp_from','smtp_secure','smtp_insecure_tls',
    'default_price_condition', 'gutschein_land',
    // konfigurierbare Job-Zeiten aus dem Monitoring (job_time_<name>)
    ...DAILY_JOBS.map((j: any) => `job_time_${j.name}`)];
  const userKeys = ['currency', 'user_default_condition'];
  const uid = angemeldeteNutzerId(req);
  let imported = 0;
  try {
    if (config.global && istVerwalter(req)) {
      for (const key of globalKeys) {
        if (config.global[key] !== undefined) {
          // Eine Datei aus einem älteren Export kann noch maskierte Werte
          // enthalten — die dürfen die echten Schlüssel nicht überschreiben.
          if (SECRET_KEYS.has(key) && isMaskedValue(config.global[key])) continue;
          await setGlobalSetting(key, config.global[key]);
          imported++;
        }
      }
    }
    if (config.user_settings) {
      for (const key of userKeys) {
        if (config.user_settings[key] !== undefined) {
          // Zentrale Stelle — eine importierte Währungsänderung stösst den
          // Preis-Job genauso an wie das Formular (utils/settings.ts).
          await setUserSetting(uid, key, config.user_settings[key]);
          imported++;
        }
      }
    }
    // Ohne Admin-Prüfung, denn der Router trägt nur requireLogin. Jedes Konto —
    // auch ein Unterkonto im Haushalt — konnte damit eine Ein-Zeilen-Datei
    // ({"user_settings":{"currency":"CHF"}}) hochladen und den Preis-Cache der
    // GANZEN Installation leeren. Beliebig oft. Der nächste Bewertungslauf holt …
    // Ausführlich: docs/begruendungen/routes/settings.ts.md#abschnitt-2

    // Importierte Job-Zeiten / Preis-Intervall sofort übernehmen (Scheduler neu planen).
    if (istVerwalter(req)) {
      await setzeAusloeser('job_reschedule_trigger')
        .catch(logAndContinue('settings:job_reschedule_trigger'));
      // Weckt die Scheduler sofort; ohne Signal bliebe der Eintrag bis zum
      // nächsten Verbindungsaufbau liegen.
      await require('../utils/pgNotify').notify('job_reschedule_trigger');
      try { await require('../jobs/dailyScheduler').rescheduleAll(); } catch (e) { meldeUndWeiter('einstellungen:zeitplan-neu-planen', e); }
    }
    res.json({ success: true, imported, note: istVerwalter(req) ? 'Globale + Benutzer-Einstellungen importiert' : 'Nur Benutzer-Einstellungen importiert' });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// SMTP Test-Endpoint
router.post('/smtp-test', async (req, res) => {
  if (!istVerwalter(req)) return sendeFehler(req, res, 403, 'nur_admins');
  try {

    // First verify connection
    const verify = await testSmtp();
    if (!verify.success) return sendeFehler(req, res, 400, (verify as any).code);

    // Determine recipient: use provided email, or look up admin's email from DB
    let to = (req.body.to || '').trim();
    if (!to) {
      const user = await db.get('SELECT email FROM users WHERE id = $1', [nutzerId(req)]);
      to = user?.email || '';
    }
    if (!to || !to.includes('@')) {
      return sendeFehler(req, res, 400, 'keine_ziel_email');
    }

    const result = await sendMail({
      to,
      subject: 'BrickInventory Manager — SMTP Test',
      text: 'Diese E-Mail bestätigt, dass deine SMTP-Konfiguration korrekt funktioniert.',
      html: '<div style="font-family:Arial,sans-serif;padding:20px"><h2>✅ SMTP-Test erfolgreich</h2><p>Deine SMTP-Konfiguration funktioniert korrekt.</p></div>',
    });
    res.json(result);
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── Einrichtung beim ersten Start (public/js/22-einrichtung.js) ─────────────
// Offen, solange der Verwalter sie nicht abgeschlossen hat UND noch etwas
// fehlt — eine eingerichtete Installation sieht den Assistenten nie.
router.get('/einrichtung', async (req, res) => {
  if (!istVerwalter(req)) return sendeFehler(req, res, 403, 'nur_admins');
  try {
    const wert = async (k: string) => !!(await getGlobalSetting(k));
    const ich = await db.get('SELECT must_change_password FROM users WHERE id = $1', [nutzerId(req)]);
    const passwort = ich?.must_change_password === 1 || ich?.must_change_password === true;
    const quellen = {
      rebrickable: await wert('rebrickable_api_key'),
      brickset:    await wert('brickset_api_key'),
      bricklink:   (await Promise.all(['bricklink_consumer_key', 'bricklink_consumer_secret',
                     'bricklink_token', 'bricklink_token_secret'].map(wert))).every(Boolean),
    };
    const erledigt = await wert('einrichtung_erledigt');
    res.json({ success: true, offen: !erledigt && (passwort || !quellen.rebrickable),
               passwort_aendern: passwort, quellen });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.post('/einrichtung/fertig', async (req, res) => {
  if (!istVerwalter(req)) return sendeFehler(req, res, 403, 'nur_admins');
  try {
    await setGlobalSetting('einrichtung_erledigt', '1');
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// Testknopf je Quelle: prüft den GESPEICHERTEN Zugang mit einem kleinen Abruf.
router.post('/quelle-testen', async (req, res) => {
  if (!istVerwalter(req)) return sendeFehler(req, res, 403, 'nur_admins');
  const pruefer: Record<string, () => Promise<void>> = {
    rebrickable: pruefeRebrickableZugang, brickset: pruefeBricksetZugang, bricklink: pruefeBricklinkZugang,
  };
  const quelle = String(req.body?.quelle ?? '');
  const pruefe = Object.hasOwn(pruefer, quelle) ? pruefer[quelle] : undefined;
  if (!pruefe) return sendeFehler(req, res, 400, 'quelle_unbekannt');
  try {
    await pruefe();
    res.json({ success: true });
  } catch (e) {
    sendeFehler(req, res, 400, 'quelle_test_fehlgeschlagen', { grund: fehlertext(e).slice(0, 200) });
  }
});

// GET /api/settings/admin/cache-ttl
// Cache-Dauer liegt seit Etappe 7 unter /api/v1/admin/cache-ttl.

router.post('/admin/theme', requireAdmin, async (req, res) => {
  const theme = String(req.body?.theme || 'classic');
  // Dieselbe Liste wie ALLOWED in public/js/00-theme-boot.js und wie die
  // Dateien unter public/themes/ — theme.test.js haelt die drei zusammen.
  if (!['classic', 'brick', 'werkbank', 'farbfaecher', 'noppe', 'hochglanz'].includes(theme)) {
    return sendeFehler(req, res, 400, 'design_ungueltig');
  }
  setGlobalSetting('app_theme', theme);
  // Der Wert steckt im serverseitig gerenderten <html data-theme> — Cache
  // verwerfen, sonst liefert der Server bis zum Neustart das alte Design aus.
  require('../utils/indexHtml').invalidateTheme();
  res.json({ success: true, theme });
});

// GET /api/settings/default-condition — readable by all authenticated users
// GET /api/settings/admin/default-condition
// Der globale Standard-Zustand liegt unter /api/v1/settings/default-condition
// (lesen) und /api/v1/admin/default-condition (setzen) — Etappe 7.

export = router;
