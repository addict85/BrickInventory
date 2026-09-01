
import express from 'express';
const router  = express.Router();
import multer from 'multer';
import * as db from '../db/database';
import { handleRouteError, logAndContinue, meldeUndWeiter } from '../utils/httpError';
import { requireLogin, requireAdmin } from './auth';

import { setUserSetting, globalDefaultCondition, setGlobalSetting } from '../utils/settings';
import { getRateLimitStatus } from '../utils/financeCalc';
import { buildSetsCsv } from '../utils/setService';
import { buildPartsCsv } from './parts';
import { buildFigsCsv } from './minifigs';
import { DAILY_JOBS } from '../jobs/dailyScheduler';
import { escapeLike } from '../utils/auth';
import { sendMail, testSmtp } from './mailer';

// ── Öffentlich: aktuelles App-Design ─────────────────────────────────────────
// MUSS vor router.use(requireLogin) stehen. Der Kommentar sagte schon immer
// „von allen Nutzern lesbar", faktisch lag die Route aber hinter der
// Login-Pflicht — und damit war das global eingestellte Design auf dem Login-
// und dem Startup-Screen gar nicht abrufbar. Der Wert ist eine reine
// UI-Einstellung ('classic' | 'brick') und verrät nichts über Konten oder Daten.
router.get('/theme', async (req, res) => {
  const row = await db.get("SELECT value FROM global_settings WHERE key='app_theme'").catch(() => null);
  res.set('Cache-Control', 'no-cache');
  res.json({ success: true, theme: row?.value || 'classic' });
});

router.use(requireLogin);

/**
 * Schlüssel aus global_settings, deren WERT ein Geheimnis ist.
 *
 * ── Warum das nötig wurde ───────────────────────────────────────────────────
 * GET /api/settings/ hat die komplette global_settings-Tabelle in die Antwort
 * gespreadet — inklusive bricklink_consumer_secret, bricklink_token_secret,
 * brickset_api_key, rebrickable_api_key und smtp_pass. Schreiben durfte nur
 * ein Admin, LESEN aber jedes angemeldete Konto. Ein zweiter Benutzer ohne
 * Admin-Rechte konnte damit sämtliche API-Zugangsdaten der Installation
 * abziehen. Dasselbe galt für GET /api/settings/export.
 *
 * Verschärfend: Die Werte landeten im Frontend-JavaScript und damit im
 * Browser-Speicher — jede XSS-Lücke wäre automatisch ein Schlüsseldiebstahl
 * gewesen.
 *
 * Jetzt: Geheimnisse gehen nur maskiert raus (Länge + letzte vier Zeichen,
 * damit man im Formular erkennt, OB und WELCHER Wert hinterlegt ist).
 * Geschrieben wird nur, wenn der Client einen echten neuen Wert schickt —
 * die Maske selbst wird beim Speichern ignoriert (siehe isMaskedValue).
 */
const SECRET_KEYS = new Set([
  'bricklink_consumer_key', 'bricklink_consumer_secret',
  'bricklink_token', 'bricklink_token_secret',
  'brickset_api_key', 'rebrickable_api_key',
  'smtp_pass',
]);

/** Erkennungszeichen der Maske — kommt in echten Schlüsseln nicht vor. */
const MASK_CHAR = '\u2022';

/**
 * Geheimen Wert durch eine Maske ersetzen: 12 Punkte + die letzten vier
 * Zeichen. Leere Werte bleiben leer, damit das Formular "nicht gesetzt"
 * weiterhin von "gesetzt" unterscheiden kann.
 * @param {string|null|undefined} value
 * @returns {string}
 */
function maskSecret(value: string | null | undefined) {
  const v = String(value ?? '');
  if (!v) return '';
  return MASK_CHAR.repeat(12) + v.slice(-4);
}

/**
 * Ist der übergebene Wert die von uns ausgelieferte Maske (also unverändert
 * zurückgeschickt) statt eines echten neuen Geheimnisses?
 * @param {unknown} value
 * @returns {boolean}
 */
function isMaskedValue(value: string | null | undefined) {
  return typeof value === 'string' && value.includes(MASK_CHAR);
}

/**
 * global_settings so aufbereiten, wie sie an einen Client gehen dürfen:
 * Nicht-Admins bekommen die globalen Schlüssel gar nicht zu sehen, Admins
 * bekommen Geheimnisse maskiert.
 * @param {Record<string, string>} global
 * @param {boolean} isAdmin
 * @returns {Record<string, string>}
 */
function sanitizeGlobal(global: any, isAdmin: boolean) {
  const out: any = {};
  for (const [k, v] of Object.entries(global)) {
    if (SECRET_KEYS.has(k)) {
      // Nicht-Admins sehen den Schlüssel überhaupt nicht — auch nicht maskiert.
      if (isAdmin) out[k] = maskSecret(v as string | null | undefined);
      continue;
    }
    out[k] = v;
  }
  return out;
}

/**
 * Einstellungen so lesen, wie sie an einen Client gehen dürfen: globale Werte
 * durch sanitizeGlobal(), darüber die Werte des Nutzers.
 *
 * ── Warum als eigener Helfer ────────────────────────────────────────────────
 * Es gibt ZWEI Leserouten mit demselben Inhalt und verschiedener Verpackung:
 * `/` liefert flach, `/raw` unter `settings`. Die Abfrage stand zweimal da —
 * und nur die Fassung in `/` bekam die Maskierung. `/raw` gab die komplette
 * global_settings-Tabelle roh heraus, samt bricklink_*_secret,
 * brickset_api_key, rebrickable_api_key und smtp_pass, an JEDES angemeldete
 * Konto (der Router trägt nur requireLogin). Und ausgerechnet `/raw` ist die
 * Route, die die Einstellungsseite lädt (public/js/05-settings.js,
 * loadSettings) — die Maskierung war damit für ihren eigentlichen Konsumenten
 * wirkungslos.
 *
 * Jetzt lesen beide durch dieselbe Funktion; eine neue Verpackung kann die
 * Maskierung nicht mehr versehentlich umgehen.
 */
async function readSettings(userId: number, isAdmin: boolean) {
  const raw: any = {};
  (await db.all('SELECT key, value FROM global_settings')).forEach(r => { raw[r.key] = r.value; });
  const global = sanitizeGlobal(raw, !!isAdmin);
  const user: any = {};
  (await db.all('SELECT key, value FROM user_settings WHERE user_id = $1', [userId]))
    .forEach(r => { user[r.key] = r.value; });
  return { ...global, ...user };
}

router.get('/', async (req: LoggedInRequest, res) => {
  try {
    res.json({ success: true, ...(await readSettings(req.session.userId, !!req.session.isAdmin)) });
  } catch (e) { handleRouteError(res, e); }
});

router.post('/', async (req: LoggedInRequest, res) => {
  const globalKeys = ['bricklink_consumer_key','bricklink_consumer_secret','bricklink_token',
    'bricklink_token_secret','brickset_api_key','rebrickable_api_key','price_job_interval_minutes',
    'price_cache_ttl','api_limit_rebrickable','api_limit_bricklink','api_limit_brickset',
    'registration_enabled','smtp_host','smtp_port','smtp_user','smtp_pass','smtp_from','smtp_secure','smtp_insecure_tls',
    'default_price_condition'];
  const userKeys = ['currency', 'language', 'user_default_condition'];

  try {
    if (req.session.isAdmin) {
      // Check if brickset limit is being increased before saving
      const oldBricksetLimit = req.body.api_limit_brickset !== undefined
        ? parseInt((await db.get('SELECT value FROM global_settings WHERE key=$1', ['api_limit_brickset']))?.value || '100')
        : null;

      for (const key of globalKeys) {
        if (req.body[key] !== undefined) {
          // Das Formular bekommt Geheimnisse maskiert (siehe sanitizeGlobal).
          // Schickt der Client die Maske unverändert zurück — der Normalfall,
          // wenn nur ein anderes Feld geändert wurde —, darf sie NICHT als
          // neuer Wert gespeichert werden: Sonst überschreibt jedes Speichern
          // der Einstellungsseite die echten API-Schlüssel mit Punkten.
          if (SECRET_KEYS.has(key) && isMaskedValue(req.body[key])) continue;
          await db.run(
            'INSERT INTO global_settings (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
            [key, req.body[key]]
          );
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
        await setUserSetting(req.session.userId, key, req.body[key]);
      }
    }
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e); }
});

// /raw — dieselben Werte wie `/`, nur unter `settings` verpackt. Die
// Einstellungsseite lädt hierüber. Inhalt kommt aus readSettings(), damit die
// Maskierung nicht an der Verpackung vorbeigeht (siehe dort).
router.get('/raw', async (req: LoggedInRequest, res) => {
  try {
    res.json({ success: true, settings: await readSettings(req.session.userId, !!req.session.isAdmin) });
  } catch (e) { handleRouteError(res, e); }
});

// /cache-stats liegt seit Etappe 7 unter /api/v1/admin/cache-stats.

const EXPORT_EXCLUDE_KEYS = new Set([
  'rb_csv_last_sync',
  'rb_part_categories_last_sync',   // täglicher Sync-Marker (Laufzeit-Zustand)
  'job_reschedule_trigger',         // transientes Reschedule-Signal
  'instr_queue_trigger',            // transientes Queue-Signal
  'api_calls_brickset',    'api_calls_date_brickset',
  'api_calls_rebrickable', 'api_calls_date_rebrickable',
  'api_calls_bricklink',   'api_calls_date_bricklink',
]);

router.get('/export', async (req, res) => {
  try {
    const global: any = {};
    (await db.all('SELECT key, value FROM global_settings'))
      // Transiente Laufzeit-Zustände nicht mit exportieren: feste Ausschlussliste
      // plus alle Job-Monitor-Status (job_monitor_*), die nur den momentanen
      // Fortschritt der Hintergrund-Jobs abbilden und beim Import nichts verloren
      // hätten (der Import nutzt ohnehin eine Whitelist).
      // Geheimnisse gehören NICHT in eine Datei, die der Nutzer herunterlädt,
      // per Mail weiterschickt oder in ein Repo legt. Der Export ist als
      // Konfigurations-Sicherung gedacht, nicht als Schlüsselkopie — die
      // API-Zugangsdaten trägt man beim Wiederherstellen einmalig neu ein.
      .filter(r => !EXPORT_EXCLUDE_KEYS.has(r.key) && !r.key.startsWith('job_monitor_') && !SECRET_KEYS.has(r.key))
      .forEach(r => { global[r.key] = r.value; });
    const userSettings: any = {};
    (await db.all('SELECT key, value FROM user_settings WHERE user_id = $1', [req.session.userId]))
      .forEach(r => { userSettings[r.key] = r.value; });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="brickinventory-config-${new Date().toISOString().substring(0,10)}.json"`);
    res.json({ exported_at: new Date().toISOString(), exported_by: req.session.username, version: '3.0', global, user_settings: userSettings });
  } catch (e) { handleRouteError(res, e); }
});

// ── GET /api/settings/export/data — Sets, Teile und Minifiguren jeweils als CSV,
// gebündelt in einem ZIP (reuses the exact same CSV-building logic as the
// individual /api/sets|parts|minifigs/export/csv endpoints, implemented once).
// LoggedInRequest: Der Router liegt hinter requireLogin (oben), und die
// Augmentierung sichert userId als number zu — die drei CSV-Bauer verlangen das.
router.get('/export/data', async (req: LoggedInRequest, res) => {
  try {
    const archiver = require('archiver');
    const uid = req.session.userId;

    const [setsCsv, partsCsv, figsCsv] = await Promise.all([
      buildSetsCsv(uid), buildPartsCsv(uid), buildFigsCsv(uid),
    ]);

    const dateStr = new Date().toISOString().substring(0, 10);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="brickinventory-export-${dateStr}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err: any) => { console.error('[export-zip]', err.message); res.status(500).end(); });
    archive.pipe(res);
    archive.append('\uFEFF' + setsCsv,  { name: 'sets.csv' });
    archive.append('\uFEFF' + partsCsv, { name: 'teile.csv' });
    archive.append('\uFEFF' + figsCsv,  { name: 'minifiguren.csv' });
    await archive.finalize();
  } catch (e) { handleRouteError(res, e); }
});

const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 } });
router.post('/import', importUpload.single('file'), async (req: LoggedInRequest, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'Keine Datei' });
  let config;
  try { config = JSON.parse(req.file.buffer.toString('utf-8')); }
  catch (e) { return res.status(400).json({ success: false, error: 'Ungültige JSON-Datei' }); }

  const globalKeys = ['bricklink_consumer_key','bricklink_consumer_secret','bricklink_token',
    'bricklink_token_secret','brickset_api_key','rebrickable_api_key','price_job_interval_minutes',
    'price_cache_ttl','api_limit_rebrickable','api_limit_bricklink','api_limit_brickset',
    'registration_enabled','smtp_host','smtp_port','smtp_user','smtp_pass','smtp_from','smtp_secure','smtp_insecure_tls',
    'default_price_condition',
    // konfigurierbare Job-Zeiten aus dem Monitoring (job_time_<name>)
    ...DAILY_JOBS.map((j: any) => `job_time_${j.name}`)];
  const userKeys = ['currency', 'user_default_condition'];
  let imported = 0;
  try {
    if (config.global && req.session.isAdmin) {
      for (const key of globalKeys) {
        if (config.global[key] !== undefined) {
          // Eine Datei aus einem älteren Export kann noch maskierte Werte
          // enthalten — die dürfen die echten Schlüssel nicht überschreiben.
          if (SECRET_KEYS.has(key) && isMaskedValue(config.global[key])) continue;
          await db.run('INSERT INTO global_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [key, config.global[key]]);
          imported++;
        }
      }
    }
    if (config.user_settings) {
      for (const key of userKeys) {
        if (config.user_settings[key] !== undefined) {
          // Zentrale Stelle — eine importierte Währungsänderung stösst den
          // Preis-Job genauso an wie das Formular (utils/settings.ts).
          await setUserSetting(req.session.userId, key, config.user_settings[key]);
          imported++;
        }
      }
    }
    // ── Hier stand `await db.run('DELETE FROM price_cache')` ────────────────
    //
    // Ohne Admin-Prüfung, denn der Router trägt nur requireLogin. Jedes Konto —
    // auch ein Unterkonto im Haushalt — konnte damit eine Ein-Zeilen-Datei
    // ({"user_settings":{"currency":"CHF"}}) hochladen und den Preis-Cache der
    // GANZEN Installation leeren. Beliebig oft. Der nächste Bewertungslauf holt
    // dann alle Preise neu bei BrickLink, und deren Tageskontingent ist endlich.
    //
    // Genau diese Lücke ist in routes/finance.ts schon einmal geschlossen
    // worden (POST /refresh trägt seitdem requireAdmin, mit einer Notiz über
    // das verbrannte Kontingent). Dieser Weg wurde übersehen — er sieht ja
    // auch nicht nach „Cache leeren" aus.
    //
    // Ersatzlos gestrichen statt hinter isAdmin geschoben: price_cache ist über
    // set_number, condition UND currency_code verschlüsselt. Einträge in der
    // alten Währung stören nicht, sie passen einfach nicht mehr auf die
    // Abfrage, und für die neue Währung wird ohnehin frisch geholt. Das Leeren
    // war also von Anfang an ohne Wirkung auf die Richtigkeit — nur mit einer
    // auf das Kontingent. Wer den Cache wirklich leeren will, hat dafür
    // POST /api/finance/refresh (Admin).

    // Importierte Job-Zeiten / Preis-Intervall sofort übernehmen (Scheduler neu planen).
    if (req.session.isAdmin) {
      await db.run(`INSERT INTO global_settings (key, value) VALUES ('job_reschedule_trigger', NOW()::TEXT) ON CONFLICT (key) DO UPDATE SET value = NOW()::TEXT`)
        .catch(logAndContinue('settings:job_reschedule_trigger'));
      // Weckt die Scheduler sofort; ohne Signal bliebe der Eintrag bis zum
      // nächsten Verbindungsaufbau liegen.
      await require('../utils/pgNotify').notify('job_reschedule_trigger');
      try { await require('../jobs/dailyScheduler').rescheduleAll(); } catch (e) { meldeUndWeiter('einstellungen:zeitplan-neu-planen', e); }
    }
    res.json({ success: true, imported, note: req.session.isAdmin ? 'Globale + Benutzer-Einstellungen importiert' : 'Nur Benutzer-Einstellungen importiert' });
  } catch (e) { handleRouteError(res, e); }
});

router.get('/tokens', async (req, res) => {
  try {
    const tokens = await db.all('SELECT token, label, created_at, last_used, expires_at FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC', [req.session.userId]);
    res.json({ success: true, tokens: tokens.map(t => ({
      token_prefix: t.token.substring(0, 8),
      token_id:     t.token.substring(0, 16),
      label:        t.label,
      created_at:   t.created_at,
      last_used:    t.last_used,
      expires_at:   t.expires_at,
      never_expires: !t.expires_at,
    }))});
  } catch (e) { handleRouteError(res, e); }
});

router.delete('/tokens/:tokenId', async (req, res) => {
  try {
    // escapeLike: ohne das löscht ein "%" als tokenId ALLE Tokens des Nutzers.
    const prefix = escapeLike(String(req.params.tokenId || '')).slice(0, 64);
    if (!prefix) return res.status(400).json({ success: false, error: 'Token-ID fehlt' });
    const r = await db.run(
      "DELETE FROM api_tokens WHERE user_id = $1 AND token LIKE $2 ESCAPE '\\'",
      [req.session.userId, prefix + '%']);
    res.json({ success: true, deleted: r.changes });
  } catch (e) { handleRouteError(res, e); }
});

// SMTP Test-Endpoint
router.post('/smtp-test', async (req, res) => {
  if (!req.session?.isAdmin) return res.status(403).json({ success: false, error: 'Nur Admins' });
  try {

    // First verify connection
    const verify = await testSmtp();
    if (!verify.success) return res.json({ success: false, error: verify.error });

    // Determine recipient: use provided email, or look up admin's email from DB
    let to = (req.body.to || '').trim();
    if (!to) {
      const user = await db.get('SELECT email FROM users WHERE id = $1', [req.session.userId]);
      to = user?.email || '';
    }
    if (!to || !to.includes('@')) {
      return res.json({ success: false, error: 'Keine Ziel-E-Mail-Adresse angegeben. Bitte eine E-Mail-Adresse eingeben.' });
    }

    const result = await sendMail({
      to,
      subject: 'BrickInventory Manager — SMTP Test',
      text: 'Diese E-Mail bestätigt, dass deine SMTP-Konfiguration korrekt funktioniert.',
      html: '<div style="font-family:Arial,sans-serif;padding:20px"><h2>✅ SMTP-Test erfolgreich</h2><p>Deine SMTP-Konfiguration funktioniert korrekt.</p></div>',
    });
    res.json(result);
  } catch (e) { handleRouteError(res, e); }
});

// GET /api/settings/admin/cache-ttl
// Cache-Dauer liegt seit Etappe 7 unter /api/v1/admin/cache-ttl.

router.post('/admin/theme', requireAdmin, async (req, res) => {
  const theme = String(req.body?.theme || 'classic');
  if (!['classic', 'brick'].includes(theme)) return res.status(400).json({ success: false, error: 'Ungültiges Design' });
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
