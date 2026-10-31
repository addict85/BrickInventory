/**
 * /api/v1/settings — Einstellungen, Zugänge, Haushalt, Export und Import.
 * Ein Router für den ganzen Pfad; die App liest GET / und den Haushalt, die
 * Webapp zusätzlich Design, Export und Verwaltung.
 */
import express from 'express';
import multer from 'multer';
import { bestaetigePasswort } from '../../src/konto/passwortBestaetigung';
import { handleRouteError, logAndContinue } from '../../src/infra/httpError';
import { requireApiAdmin as requireAdmin, requireToken, bearerToken } from './middleware';
import {
  setUserSetting, deleteUserSetting, setGlobalSetting, getGlobalSetting, getSetting, SECRET_KEYS, isMaskedValue,
  readSettings, nutzerEinstellungen, globaleWerteOhneGeheimnisse, nutzerStandardZustand, globalDefaultCondition,
  DESIGNS, designFuer, setzeEigenesDesign,
} from '../../src/konto/settings';
import { buildSetsCsv } from '../../src/sets/setService';
import { buildPartsCsv, buildFigsCsv } from '../../src/bestand/bestandExport';
import { buildMerklisteCsv } from '../../src/merkliste/merkliste';
import { buildPreisalarmeCsv } from '../../src/finanzen/preisalarm';
import { DAILY_JOBS } from '../../src/auftraege/zeitplan';
import { quellePruefen, bricksetLimitGesetzt, zeitplanNeuPlanen } from '../../src/verwaltung/dienst';
import { zugaengeDesKontos, zugaengeLoeschen, andereSitzungenBeenden, mussPasswortAendern, profil } from '../../src/konto/konten';
import { resolveUserId, escapeLike, requireLoginOrToken, nutzerId, angemeldeteNutzerId, istVerwalter, nutzerName, hashToken, leereTokenCache } from '../../src/konto/auth';
import { householdStatus, createInvite, redeemInvite, unlink, verwerfeGetrennt } from '../../src/haushalt/haushalt';
import { sendMail, testSmtp, sendHaushaltVerknuepftMail } from '../../src/infra/mailer';
import { sendeFehler } from '../../src/infra/fehlerTexte';
import { tlsStand } from '../../src/infra/tlsWurzel';
import { konfig } from '../../src/infra/konfig';
import { invalidateTheme } from '../../src/konto/indexHtml';
const router = express.Router();

const requireLogin = requireLoginOrToken;

// ── Öffentlich: aktuelles App-Design — vor router.use(requireLogin), denn
// Anmelde- und Startbildschirm brauchen es; es verrät nichts über Konten.
// Angemeldet gilt das Design des Kontos, sonst die Vorgabe des Verwalters.
router.get('/settings/theme', async (req, res) => {
  try {
    const uid = await resolveUserId(req);
    res.set('Cache-Control', 'no-cache');
    res.set('Vary', 'Cookie, Authorization');
    res.json({ success: true, ...await designFuer(uid) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// Angemeldete Geräte: Sitzung ODER Token
// MUSS vor router.use(requireLogin) stehen — aus demselben Grund wie /theme
// darüber, nur andersherum: Nicht weil gar keine Anmeldung nötig wäre,
// sondern weil requireLogin NUR die Sitzung kennt. Die App hat keine; sie …
// Ausführlich: docs/begruendungen/routes/api_v1/settings.ts.md#abschnitt
/**
 * GET /api/v1/settings/tokens — die eigenen Zugänge auflisten.
 * Ausführlich: docs/begruendungen/routes/api_v1/settings.ts.md#get-tokens
 */
router.get('/settings/tokens', requireLoginOrToken, async (req: LoggedInRequest, res) => {
  try {
    const eigener = bearerToken(req);
    const eigenerHash = eigener ? hashToken(eigener) : null;
    // LEAST ueber beide Fristen: `expires_at` ist die gleitende („so lange
    // ungenutzt"), `hard_expires_at` die feste, die beim QR-Code gewaehlt
    // wurde. Was den Nutzer interessiert, ist der FRUEHERE der beiden — der
    // Tag, an dem dieses Geraet ausgesperrt wird.
    // Ausführlich: docs/begruendungen/routes/api_v1/settings.ts.md#get-tokens-tokens
    const tokens = await zugaengeDesKontos(angemeldeteNutzerId(req));
    res.json({ success: true, tokens: tokens.map(t => ({
      token_prefix: t.token.substring(0, 8),
      token_id:     t.token.substring(0, 16),
      label:        t.label,
      created_at:   t.created_at,
      last_used:    t.last_used,
      expires_at:   t.expires_at,
      hard_expires_at: t.hard_expires_at,
      never_expires: !t.expires_at,
      scope:        t.scope,
      ip_bereich:   t.ip_bereich,
      rotiert_am:   t.rotiert_am,
      aktuell:      t.token === eigenerHash,
    }))});
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

/**
 * DELETE /api/v1/settings/tokens/:tokenId — einen Zugang entwerten.
 * Ausführlich: docs/begruendungen/routes/api_v1/settings.ts.md#delete-tokens-tokenid
 */
router.delete('/settings/tokens/:tokenId', requireLoginOrToken, async (req: LoggedInRequest, res) => {
  try {
    // escapeLike: ohne das löscht ein "%" als tokenId ALLE Tokens des Nutzers.
    const prefix = escapeLike(String(req.params.tokenId || '')).slice(0, 64);
    if (!prefix) return sendeFehler(req, res, 400, 'token_id_fehlt');
    const geloescht = await zugaengeLoeschen(angemeldeteNutzerId(req), prefix);
    if (geloescht) leereTokenCache();
    res.json({ success: true, deleted: geloescht });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

/** Die übrigen Browser-Sitzungen beenden; die eigene bleibt. */
router.post('/settings/sessions/andere-beenden', requireLogin, async (req: LoggedInRequest, res) => {
  try {
    res.json({ success: true, deleted: await andereSitzungenBeenden(angemeldeteNutzerId(req), req.sessionID) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

/**
 * Was die App aus den Einstellungen liest — ausdrücklich aufgezählt.
 * Ausführlich: docs/begruendungen/routes/api_v1/settings.ts.md#app-felder
 */
const APP_FELDER = ['currency', 'price_condition', 'price_cache_ttl',
                    'default_price_condition', 'user_default_condition'] as const;

/** Vorgaben, falls weder global noch beim Nutzer etwas steht. */
const APP_VORGABEN: Record<string, string> = {
  currency: 'EUR', price_condition: 'N', price_cache_ttl: '24',
  default_price_condition: 'N', user_default_condition: '',
};

router.get('/settings', requireToken, async (req: AuthedRequest, res) => {
  const uid = req.apiUser.user_id;
  // readSettings() statt eigener Abfrage: Hier stand `SELECT … FROM
  // user_settings` mit einer eigenen Vorgabeliste — und las damit die
  // GLOBALEN Werte gar nicht. price_cache_ttl und default_price_condition
  // sind aber global; die App bekam dauerhaft die fest verdrahtete 24 bzw.
  // 'N', egal was der Verwalter eingestellt hatte.
  //
  // isAdmin=false: Die App ist nie die Verwaltungsoberfläche, und
  // sanitizeGlobal() blendet Geheimnisse für Nicht-Admins vollständig aus.
  const alle = await readSettings(uid, false);
  const settings: Record<string, string> = {};
  for (const feld of APP_FELDER) {
    settings[feld] = alle[feld] ?? APP_VORGABEN[feld] ?? '';
  }
  // Effektiver Zustand: eigener Wert → globaler Standard → 'N'. Die Regel
  // steht in src/konto/settings.ts, damit sie nicht neben dem Webapp-Weg ein
  // zweites Mal existiert (Etappe 6).
  settings['effective_condition'] = await nutzerStandardZustand(uid);
  // Das wirksame Design des Kontos, wie /settings/theme: Mit der Vorgabe des
  // Verwalters überschrieb dieser Abruf das eigene Design in der App.
  settings['app_theme'] = (await designFuer(uid)).theme;
  res.json({ success:true, settings });
});

router.put('/settings', requireToken, async (req: AuthedRequest, res) => {
  const uid = req.apiUser.user_id;
  const allowed = ['currency','price_cache_ttl'];
  let updated = 0;
  for (const key of allowed) {
    if (req.body[key]!==undefined) {
      // Zentrale Stelle — stösst bei einer ECHTEN Währungsänderung den
      // Preis-Job an (Begründung in src/konto/settings.ts). Parität zur Webapp.
      await setUserSetting(uid, key, String(req.body[key]));
      updated++;
    }
  }
  res.json({ success:true, updated });
});

// GET /api/v1/settings/default-condition — der GLOBALE Default (Monitoring-UI).
// Für den effektiven, benutzerspezifischen Wert: GET /settings (effective_condition).
router.get('/settings/default-condition', requireToken, async (_req: AuthedRequest, res) => {
  try {
    res.json({ success: true, condition: await globalDefaultCondition() });
  } catch (e) { handleRouteError(res, e, undefined, _req); }
});

/**
 * GET /api/v1/settings/user/default-condition — der EFFEKTIVE Wert des
 * Nutzers, zum Vorbelegen der Erfassungsformulare.
 * Ausführlich: docs/begruendungen/routes/api_v1/settings.ts.md#get-settings-user-default-condition
 */
router.get('/settings/user/default-condition', requireToken, async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, condition: await nutzerStandardZustand(req.apiUser.user_id) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// POST /api/v1/settings/user/default-condition — benutzerspezifischer Default.
// Token-authentifiziertes Pendant zu /api/settings/user/default-condition:
// die Android-App lief vorher gegen den Session-Endpoint und scheiterte mit
// Bearer-Token still an requireLogin.
router.post('/settings/user/default-condition', requireToken, async (req: AuthedRequest, res) => {
  const condition = String(req.body?.condition ?? '');
  if (!['N','U',''].includes(condition)) return sendeFehler(req, res, 400, 'zustand_n_oder_u');
  try {
    if (condition === '') {
      // Leeren → auf globalen Standard zurückfallen
      await deleteUserSetting(req.apiUser.user_id, 'user_default_condition');
    } else {
      // setUserSetting() statt eigenem INSERT: Es soll GENAU EINE Schreibstelle
      // für Benutzereinstellungen geben. Hier stand ein zweites,
      // wortgleiches ON CONFLICT — harmlos, solange nichts dazukommt, aber die
      // Regel gilt nur, wenn sie ausnahmslos gilt.
      await setUserSetting(req.apiUser.user_id, 'user_default_condition', condition);
    }
    res.json({ success: true, condition: condition || null });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── Haushalt: Konten verknüpfen ──────────────────────────────────────────────
// Gegenstücke zu /api/settings/household*. Dieselbe Umsetzung
// (src/haushalt/haushalt.ts), damit die App nicht ihre eigenen Regeln bekommt.
router.get('/settings/household', requireToken, async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, ...(await householdStatus(req.apiUser.user_id)) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.post('/settings/household/invite', requireToken, async (req: AuthedRequest, res) => {
  try {
    const r = await createInvite(req.apiUser.user_id);
    if ((r as any).fehler) return sendeFehler(req, res, 409, (r as any).fehler, (r as any).vars);
    res.json({ success: true, ...r });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// Mit Passwort: Das Hauptkonto liest und schreibt danach den Bestand dieses
// Kontos, und das übersteht auch einen Passwortwechsel. Ein erbeutetes Token
// allein soll das nicht einrichten können.
router.post('/settings/household/redeem', requireToken, async (req: AuthedRequest, res) => {
  try {
    const uid = req.apiUser.user_id;
    if (!await bestaetigePasswort(req, res, uid, req.body?.password)) return;
    const r = await redeemInvite(uid, String(req.body?.code || ''));
    if ((r as any).fehler) return sendeFehler(req, res, 409, (r as any).fehler, (r as any).vars);
    const ich = await profil(uid);
    if (ich?.email) {
      const sprache = await getSetting(uid, 'language', 'de').catch(() => 'de');
      const hauptkonto = 'linked_to' in r ? r.linked_to.username : '';
      sendHaushaltVerknuepftMail(ich.email, ich.username, hauptkonto, String(sprache ?? 'de'))
        .catch(logAndContinue('haushalt:hinweismail'));
    }
    res.json({ success: true, ...r });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.post('/settings/household/unlink', requireToken, async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true,
      ...(await unlink(req.apiUser.user_id, req.body?.sub_user_id, req.body?.main_user_id)) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.post('/settings/household/former/dismiss', requireToken, async (req: AuthedRequest, res) => {
  try {
    const sub = parseInt(String(req.body?.sub_user_id));
    if (!Number.isFinite(sub)) return sendeFehler(req, res, 400, 'konto_id_ungueltig');
    res.json({ success: true, ...(await verwerfeGetrennt(req.apiUser.user_id, sub)) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.use('/settings', requireLogin);

/**
 * GET /api/v1/settings/tls — der Fingerabdruck der internen CA zum Abgleich
 * von Hand; derselbe Wert steht als `fp` im QR-Code der App.
 */
router.get('/settings/tls', async (req, res) => {
  try {
    const stand = await tlsStand();
    res.json({ success: true, https: konfig().hinterTls,
      ...(stand ? { fp: stand.fp, fp_hex: stand.fp_hex, subject: stand.subject,
                    gueltig_bis: stand.gueltig_bis, download: '/ca.crt' } : { fp: null }) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// GET /api/settings ist ENTFERNT
// Sie lieferte GENAU DASSELBE wie GET /raw achtzig Zeilen weiter unten —
// beide riefen readSettings(userId, isAdmin) —, nur in einer anderen Huelle:
// hier ausgebreitet (`{ success, ...settings }`), dort verschachtelt …
// Ausführlich: docs/begruendungen/routes/api_v1/settings.ts.md#post

router.post('/settings', async (req: LoggedInRequest, res) => {
  const uid = angemeldeteNutzerId(req);
  const globalKeys = ['bricklink_consumer_key','bricklink_consumer_secret','bricklink_token',
    'bricklink_token_secret','brickset_api_key','rebrickable_api_key','price_job_interval_minutes',
    'price_cache_ttl','api_limit_rebrickable','api_limit_bricklink','api_limit_brickset',
    'registration_enabled','smtp_host','smtp_port','smtp_user','smtp_pass','smtp_from','smtp_secure','smtp_insecure_tls',
    'default_price_condition',
    // Ausgabeland der Gutscheine: global für alle Konten, also nur vom
    // Verwalter gesetzt; kein Geheimnis, lesen dürfen es alle.
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
          // Eine unverändert zurückgeschickte Maske ist kein neuer Wert, sonst
          // überschriebe jedes Speichern die echten Schlüssel mit Punkten.
          if (SECRET_KEYS.has(key) && isMaskedValue(req.body[key])) continue;
          await setGlobalSetting(key, req.body[key]);
        }
      }

      if (oldBricksetLimit !== null) await bricksetLimitGesetzt(oldBricksetLimit, parseInt(req.body.api_limit_brickset));
    }
    for (const key of userKeys) {
      if (req.body[key] !== undefined) {
        // Zentrale Stelle — stösst bei einer ECHTEN Währungsänderung den
        // Preis-Job an (Begründung in src/konto/settings.ts).
        await setUserSetting(uid, key, req.body[key]);
      }
    }
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// /raw — dieselben Werte wie `/`, nur unter `settings` verpackt. Die
// Einstellungsseite lädt hierüber. Inhalt kommt aus readSettings(), damit die
// Maskierung nicht an der Verpackung vorbeigeht (siehe dort).
router.get('/settings/raw', async (req: LoggedInRequest, res) => {
  try {
    res.json({ success: true, settings: await readSettings(angemeldeteNutzerId(req), istVerwalter(req)) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// /cache-stats liegt seit Etappe 7 unter /api/v1/admin/cache-stats.

router.get('/settings/export', async (req, res) => {
  try {
    // Nur Verwalter bekommen die Installation mit: Der Import nimmt globale
    // Werte ohnehin nur von ihnen an, und SMTP-Daten gehen ein Unterkonto nichts an.
    const global = istVerwalter(req) ? await globaleWerteOhneGeheimnisse() : {};
    const userSettings: any = await nutzerEinstellungen(nutzerId(req)!);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="brickinventory-config-${new Date().toISOString().substring(0,10)}.json"`);
    res.json({ exported_at: new Date().toISOString(), exported_by: nutzerName(req), version: '3.0', global, user_settings: userSettings });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── GET /api/settings/export/data — Sets, Teile, Figuren, Merkliste und Alarme
// als CSV in einem ZIP; dieselben CSV-Bauer wie die Einzelexporte.
router.get('/settings/export/data', async (req: LoggedInRequest, res) => {
  try {
    // archiver 8 ist ein ES-Modul; aus CommonJS geht nur require(), kein Import.
    const { ZipArchive } = require('archiver');
    const uid = angemeldeteNutzerId(req);

    // merkliste.csv kam dazu: „Merklisten sollen
    // ebenfalls analog den anderen Seiten exportiert und importiert werden."
    // Im SELBEN Archiv und nicht als eigene Route — die drei einzelnen
    // /export/csv-Routen sind in diesem Baum ausdruecklich ENTFERNT worden …
    // Ausführlich: docs/begruendungen/routes/api_v1/settings.ts.md#get-export-data
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
router.post('/settings/import', importUpload.single('file'), async (req: LoggedInRequest, res) => {
  if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
  let config;
  try { config = JSON.parse(req.file.buffer.toString('utf-8')); }
  catch (e) { return sendeFehler(req, res, 400, 'json_ungueltig'); }

  const globalKeys = ['bricklink_consumer_key','bricklink_consumer_secret','bricklink_token',
    'bricklink_token_secret','brickset_api_key','rebrickable_api_key','price_job_interval_minutes',
    'price_cache_ttl','api_limit_rebrickable','api_limit_bricklink','api_limit_brickset',
    // smtp_* fehlen mit Absicht: Ein Mailserver wird nur im Formular und mit
    // Passwort umgestellt (POST /). Eine Importdatei kommt von irgendwoher, und
    // mit smtp_host + smtp_insecure_tls gingen Passwort und Rücksetz-Mails an
    // einen fremden Server. Das SMTP-Passwort steht ohnehin in keinem Export.
    'registration_enabled', 'default_price_condition', 'gutschein_land',
    // konfigurierbare Job-Zeiten aus dem Monitoring (job_time_<name>)
    ...DAILY_JOBS.map(j => `job_time_${j.name}`)];
  const userKeys = ['currency', 'user_default_condition'];
  const uid = angemeldeteNutzerId(req);
  let imported = 0;
  const smtpUebergangen = config.global && typeof config.global === 'object'
    ? Object.keys(config.global).filter(k => k.startsWith('smtp_')) : [];
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
          // Preis-Job genauso an wie das Formular (src/konto/settings.ts).
          await setUserSetting(uid, key, config.user_settings[key]);
          imported++;
        }
      }
    }
    // Ohne Admin-Prüfung, denn der Router trägt nur requireLogin. Jedes Konto —
    // auch ein Unterkonto im Haushalt — konnte damit eine Ein-Zeilen-Datei
    // ({"user_settings":{"currency":"CHF"}}) hochladen und den Preis-Cache der
    // GANZEN Installation leeren. Beliebig oft. Der nächste Bewertungslauf holt …
    // Ausführlich: docs/begruendungen/routes/api_v1/settings.ts.md#abschnitt-2

    // Importierte Job-Zeiten / Preis-Intervall sofort übernehmen (Scheduler neu planen).
    if (istVerwalter(req)) await zeitplanNeuPlanen();
    const note = (istVerwalter(req) ? 'Globale + Benutzer-Einstellungen importiert' : 'Nur Benutzer-Einstellungen importiert')
      + (istVerwalter(req) && smtpUebergangen.length ? '; SMTP nicht übernommen — bitte im Formular setzen' : '');
    res.json({ success: true, imported, note, smtp_uebergangen: istVerwalter(req) ? smtpUebergangen : [] });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// SMTP Test-Endpoint
router.post('/settings/smtp-test', async (req, res) => {
  if (!istVerwalter(req)) return sendeFehler(req, res, 403, 'nur_admins');
  try {

    // First verify connection
    const verify = await testSmtp();
    if (!verify.success) return sendeFehler(req, res, 400, (verify as any).code);

    // Determine recipient: use provided email, or look up admin's email from DB
    let to = (req.body.to || '').trim();
    if (!to) {
      to = (await profil(angemeldeteNutzerId(req)))?.email || '';
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
router.get('/settings/einrichtung', async (req, res) => {
  if (!istVerwalter(req)) return sendeFehler(req, res, 403, 'nur_admins');
  try {
    const wert = async (k: string) => !!(await getGlobalSetting(k));
    const passwort = await mussPasswortAendern(angemeldeteNutzerId(req));
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

router.post('/settings/einrichtung/fertig', async (req, res) => {
  if (!istVerwalter(req)) return sendeFehler(req, res, 403, 'nur_admins');
  try {
    await setGlobalSetting('einrichtung_erledigt', '1');
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// Testknopf je Quelle: prüft den GESPEICHERTEN Zugang mit einem kleinen Abruf.
router.post('/settings/quelle-testen', async (req, res) => {
  if (!istVerwalter(req)) return sendeFehler(req, res, 403, 'nur_admins');
  try {
    await quellePruefen(String(req.body?.quelle ?? ''));
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// GET /api/settings/admin/cache-ttl
// Cache-Dauer liegt seit Etappe 7 unter /api/v1/admin/cache-ttl.

// Eigenes Design des Kontos; leer heisst „Vorgabe des Verwalters“.
router.post('/settings/user/theme', async (req: LoggedInRequest, res) => {
  try {
    const uid = angemeldeteNutzerId(req);
    await setzeEigenesDesign(uid, req.body?.theme);
    res.json({ success: true, ...await designFuer(uid) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.post('/settings/admin/theme', requireAdmin, async (req, res) => {
  const theme = String(req.body?.theme || 'classic');
  if (!DESIGNS.includes(theme)) {
    return sendeFehler(req, res, 400, 'design_ungueltig');
  }
  setGlobalSetting('app_theme', theme);
  // Der Wert steckt im serverseitig gerenderten <html data-theme> — Cache
  // verwerfen, sonst liefert der Server bis zum Neustart das alte Design aus.
  invalidateTheme();
  res.json({ success: true, theme });
});

// GET /api/settings/default-condition — readable by all authenticated users
// GET /api/settings/admin/default-condition
// Der globale Standard-Zustand liegt unter /api/v1/settings/default-condition
// (lesen) und /api/v1/admin/default-condition (setzen) — Etappe 7.

export = router;
