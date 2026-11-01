/** /api/v1/settings — ein Router für den ganzen Pfad, weil die Reihenfolge vor
 * und nach router.use(requireLogin) hier an einer Stelle entschieden wird. */
import multer from 'multer';
import { FORMULAR_GRENZEN } from '../../src/infra/dateiEmpfang';
import { fehlerAntwort, logAndContinue } from '../../src/infra/httpError';
import { requireApiAdmin as requireAdmin, requireToken, bearerToken } from './middleware';
import {
  SECRET_KEYS, isMaskedValue,
  readSettings, globaleWerteOhneGeheimnisse, 
  DESIGNS, designFuer, setzeEigenesDesign,
} from '../../src/konto/settings';
import { nutzerEinstellungen } from '../../src/konto/settings';
import { deleteUserSetting } from '../../src/konto/settings';
import { setGlobalSetting, globalerWertGueltig, deleteGlobalSetting } from '../../src/konto/settings';
import { globalDefaultCondition } from '../../src/konto/settings';
import { nutzerStandardZustand } from '../../src/konto/settings';
import { setUserSetting } from '../../src/konto/settings';
import { getGlobalSetting } from '../../src/konto/settings';
import { getSetting } from '../../src/konto/settings';
import { buildSetsCsv } from '../../src/sets/setService';
import { buildPartsCsv, buildFigsCsv } from '../../src/bestand/bestandExport';
import { buildMerklisteCsv } from '../../src/merkliste/merkliste';
import { buildPreisalarmeCsv } from '../../src/finanzen/preisalarm';
import { DAILY_JOBS } from '../../src/auftraege/zeitplan';
import { quellePruefen, bricksetLimitGesetzt, zeitplanNeuPlanen, protokolliere } from '../../src/verwaltung/dienst';
import { zugaengeDesKontos, zugaengeLoeschen, andereSitzungenBeenden, mussPasswortAendern, profil } from '../../src/konto/konten';
import { escapeLike, hashToken, leereTokenCache } from '../../src/konto/auth';
import { resolveUserId, requireLoginOrToken, nutzerId, angemeldeteNutzerId, istVerwalter, nutzerName, bestaetigePasswort } from '../../src/konto/http/anmeldung';
import { householdStatus, createInvite, redeemInvite, unlink, verwerfeGetrennt } from '../../src/haushalt/haushalt';
import { sendMail, testSmtp, sendHaushaltVerknuepftMail } from '../../src/infra/mailer';
import { sendeFehler } from '../../src/infra/fehlerTexte';
import { tlsStand } from '../../src/infra/tlsWurzel';
import { konfig } from '../../src/infra/konfig';
import { invalidateTheme } from '../../src/konto/indexHtml';
import { istAktiv as zweiterFaktorAktiv } from '../../src/konto/zweiterFaktor';
import { jsonOderNull } from '../../src/infra/validate';
import { vertragsRouter } from '../../src/infra/vertrag/pruefen';
import type { Antwort } from '../../src/infra/vertrag';
const router = vertragsRouter();

const requireLogin = requireLoginOrToken;

// Vor router.use(requireLogin): Anmelde- und Startbildschirm brauchen das
// Design, und es verrät nichts über Konten.
router.get('/settings/theme', async (req, res: Antwort<'GET /api/v1/settings/theme'>) => {
  const uid = await resolveUserId(req);
  res.set('Cache-Control', 'no-cache');
  res.set('Vary', 'Cookie, Authorization');
  res.json({ success: true, ...await designFuer(uid) });
});

// Vor router.use(requireLogin), weil requireLogin nur die Sitzung kennt und
// die App ihre Zugänge mit Token verwaltet.
// Ausführlich: docs/begruendungen/routes/api_v1/settings.ts.md#abschnitt
router.get('/settings/tokens', requireLoginOrToken, async (req: LoggedInRequest, res: Antwort<'GET /api/v1/settings/tokens'>) => {
  const eigener = bearerToken(req);
  const eigenerHash = eigener ? hashToken(eigener) : null;
  // LEAST über beide Fristen: Den Nutzer interessiert der Tag, an dem dieses
  // Gerät ausgesperrt wird.
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
});

/** Die Zeile ist sofort weg, der Token-Cache gilt aber noch kurz nach.
 * Ausführlich: docs/begruendungen/routes/api_v1/settings.ts.md#delete-tokens-tokenid */
router.delete('/settings/tokens/:tokenId', requireLoginOrToken, async (req: LoggedInRequest, res: Antwort<'DELETE /api/v1/settings/tokens/:tokenId'>) => {
  // escapeLike: ohne das löscht ein "%" als tokenId ALLE Tokens des Nutzers.
  const prefix = escapeLike(String(req.params.tokenId || '')).slice(0, 64);
  if (!prefix) return sendeFehler(req, res, 400, 'token_id_fehlt');
  const geloescht = await zugaengeLoeschen(angemeldeteNutzerId(req), prefix);
  if (geloescht) leereTokenCache();
  res.json({ success: true, deleted: geloescht });
});

router.post('/settings/sessions/andere-beenden', requireLogin, async (req: LoggedInRequest, res: Antwort<'POST /api/v1/settings/sessions/andere-beenden'>) => {
  res.json({ success: true, deleted: await andereSitzungenBeenden(angemeldeteNutzerId(req), req.sessionID) });
});

/** Ausdrücklich aufgezählt: Die App bekommt nur, was sie liest, keine globalen
 * oder Verwalterfelder.
 * Ausführlich: docs/begruendungen/routes/api_v1/settings.ts.md#app-felder */
const APP_FELDER = ['currency', 'price_condition', 'price_cache_ttl',
                    'default_price_condition', 'user_default_condition'] as const;

const APP_VORGABEN: Record<string, string> = {
  currency: 'EUR', price_condition: 'N', price_cache_ttl: '24',
  default_price_condition: 'N', user_default_condition: '',
};

router.get('/settings', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/settings'>) => {
  const uid = req.apiUser.user_id;
  // readSettings(), weil price_cache_ttl und default_price_condition global
  // sind; eine eigene Abfrage las sie nicht.
  const alle = await readSettings(uid, false);
  const gespeichert = Object.fromEntries(APP_FELDER.map(feld => [feld, alle[feld] ?? APP_VORGABEN[feld] ?? '']));
  res.json({ success:true, settings: {
    ...gespeichert as Record<(typeof APP_FELDER)[number], string>,
    // Die Regel steht in src/konto/settings.ts, damit sie nicht neben dem
    // Webapp-Weg ein zweites Mal existiert.
    effective_condition: await nutzerStandardZustand(uid),
    // Das wirksame Design des Kontos, nicht die Vorgabe des Verwalters.
    app_theme: (await designFuer(uid)).theme,
  } });
});

router.put('/settings', requireToken, async (req: AuthedRequest, res: Antwort<'PUT /api/v1/settings'>) => {
  const uid = req.apiUser.user_id;
  const allowed = ['currency','price_cache_ttl'];
  let updated = 0;
  for (const key of allowed) {
    if (req.body[key]!==undefined) {
      // Zentrale Stelle: Eine ECHTE Währungsänderung stösst den Preis-Job an.
      await setUserSetting(uid, key, String(req.body[key]));
      updated++;
    }
  }
  res.json({ success:true, updated });
});

// Der GLOBALE Default; den effektiven liefert GET /settings (effective_condition).
router.get('/settings/default-condition', requireToken, async (_req: AuthedRequest, res: Antwort<'GET /api/v1/settings/default-condition'>) => {
  res.json({ success: true, condition: await globalDefaultCondition() });
});

// Ausführlich: docs/begruendungen/routes/api_v1/settings.ts.md#get-settings-user-default-condition
router.get('/settings/user/default-condition', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/settings/user/default-condition'>) => {
  res.json({ success: true, condition: await nutzerStandardZustand(req.apiUser.user_id) });
});

router.post('/settings/user/default-condition', requireToken, async (req: AuthedRequest, res: Antwort<'POST /api/v1/settings/user/default-condition'>) => {
  const condition = String(req.body?.condition ?? '');
  if (!['N','U',''].includes(condition)) return sendeFehler(req, res, 400, 'zustand_n_oder_u');
  if (condition === '') {
    await deleteUserSetting(req.apiUser.user_id, 'user_default_condition');
  } else {
    // setUserSetting(): GENAU EINE Schreibstelle für Benutzereinstellungen.
    await setUserSetting(req.apiUser.user_id, 'user_default_condition', condition);
  }
  res.json({ success: true, condition: condition || null });
});

// ── Haushalt: Konten verknüpfen ──────────────────────────────────────────────
// Dieselbe Umsetzung wie die Webapp (src/haushalt/haushalt.ts), damit die App
// nicht ihre eigenen Regeln bekommt.
router.get('/settings/household', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/settings/household'>) => {
  res.json({ success: true, ...(await householdStatus(req.apiUser.user_id)) });
});

router.post('/settings/household/invite', requireToken, async (req: AuthedRequest, res: Antwort<'POST /api/v1/settings/household/invite'>) => {
  const r = await createInvite(req.apiUser.user_id);
  if ((r as any).fehler) return sendeFehler(req, res, 409, (r as any).fehler, (r as any).vars);
  res.json({ success: true, ...r });
});

// Mit Passwort: Das Hauptkonto liest und schreibt danach den Bestand dieses
// Kontos, auch über einen Passwortwechsel hinweg. Ein erbeutetes Token allein
// soll das nicht einrichten können.
router.post('/settings/household/redeem', requireToken, async (req: AuthedRequest, res: Antwort<'POST /api/v1/settings/household/redeem'>) => {
  const uid = req.apiUser.user_id;
  // Die Verknüpfung ist ein Zugang zur Sammlung wie ein Passkey: bei aktivem zweitem Faktor nur mit Code.
  const zusatz = await zweiterFaktorAktiv(uid) ? { zweiterFaktor: req.body?.faktor_code } : {};
  if (!await bestaetigePasswort(req, res, uid, req.body?.password, zusatz)) return;
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
});

router.post('/settings/household/unlink', requireToken, async (req: AuthedRequest, res: Antwort<'POST /api/v1/settings/household/unlink'>) => {
  res.json({ success: true,
    ...(await unlink(req.apiUser.user_id, req.body?.sub_user_id, req.body?.main_user_id)) });
});

router.post('/settings/household/former/dismiss', requireToken, async (req: AuthedRequest, res: Antwort<'POST /api/v1/settings/household/former/dismiss'>) => {
  const sub = parseInt(String(req.body?.sub_user_id));
  if (!Number.isFinite(sub)) return sendeFehler(req, res, 400, 'konto_id_ungueltig');
  res.json({ success: true, ...(await verwerfeGetrennt(req.apiUser.user_id, sub)) });
});

router.use('/settings', requireLogin);

/** Zum Abgleich von Hand; derselbe Wert steht als `fp` im QR-Code der App. */
router.get('/settings/tls', async (_req, res: Antwort<'GET /api/v1/settings/tls'>) => {
  const stand = await tlsStand();
  res.json({ success: true, https: konfig().hinterTls,
    ...(stand ? { fp: stand.fp, fp_hex: stand.fp_hex, subject: stand.subject,
                  gueltig_bis: stand.gueltig_bis, download: '/ca.crt' } : { fp: null }) });
});

router.post('/settings', async (req: LoggedInRequest, res: Antwort<'POST /api/v1/settings'>) => {
  const uid = angemeldeteNutzerId(req);
  const globalKeys = ['bricklink_consumer_key','bricklink_consumer_secret','bricklink_token',
    'bricklink_token_secret','brickset_api_key','rebrickable_api_key','price_job_interval_minutes',
    'price_cache_ttl','api_limit_rebrickable','api_limit_bricklink','api_limit_brickset',
    'registration_enabled','smtp_host','smtp_port','smtp_user','smtp_pass','smtp_from','smtp_secure',
    'smtp_tls_fingerprint','smtp_tls_ca',
    'default_price_condition',
    // Global, also nur vom Verwalter gesetzt; kein Geheimnis, lesen dürfen es alle.
    'gutschein_land'];
  const userKeys = ['currency', 'language', 'user_default_condition'];

  if (istVerwalter(req)) {
    if (globalKeys.some(k => req.body[k] !== undefined && !globalerWertGueltig(k, req.body[k])))
      return sendeFehler(req, res, 400, 'wert_ungueltig');
    // Mailserver nur mit Passwort umstellen: Wer eine Verwaltersitzung erbeutet,
    // läse sonst alle künftigen Rücksetz-Mails mit. Nur bei echter Änderung.
    const smtpGeaendert: string[] = [];
    for (const key of globalKeys.filter(k => k.startsWith('smtp_'))) {
      const neu = req.body[key];
      if (neu === undefined || (SECRET_KEYS.has(key) && isMaskedValue(neu))) continue;
      if (String(neu) !== String(await getGlobalSetting(key) ?? '')) smtpGeaendert.push(key);
    }
    if (smtpGeaendert.length && !await bestaetigePasswort(req, res, uid, req.body.admin_password)) return;

    const oldBricksetLimit = req.body.api_limit_brickset !== undefined
      ? parseInt(await getGlobalSetting('api_limit_brickset') || '100')
      : null;

    const geaendert: string[] = [];
    for (const key of globalKeys) {
      if (req.body[key] !== undefined) {
        // Eine unverändert zurückgeschickte Maske ist kein neuer Wert, sonst
        // überschriebe jedes Speichern die echten Schlüssel mit Punkten.
        if (SECRET_KEYS.has(key) && isMaskedValue(req.body[key])) continue;
        if (String(req.body[key]) !== String(await getGlobalSetting(key) ?? '')) geaendert.push(key);
        await setGlobalSetting(key, req.body[key]);
      }
    }
    if (geaendert.length) await protokolliere(uid, uid, 'einstellungen_geaendert', geaendert.join(', '));
    // Wer das Mailformular gespeichert hat, hat den Hinweis auf die alte Ausnahme gesehen.
    if (globalKeys.some(k => k.startsWith('smtp_') && req.body[k] !== undefined)) await deleteGlobalSetting('smtp_insecure_tls');

    if (oldBricksetLimit !== null) await bricksetLimitGesetzt(oldBricksetLimit, parseInt(req.body.api_limit_brickset));
  }
  for (const key of userKeys) {
    if (req.body[key] !== undefined) {
      // Zentrale Stelle: Eine ECHTE Währungsänderung stösst den Preis-Job an.
      await setUserSetting(uid, key, req.body[key]);
    }
  }
  res.json({ success: true });
});

// Über readSettings(), damit die Maskierung nicht an der Verpackung vorbeigeht.
router.get('/settings/raw', async (req: LoggedInRequest, res: Antwort<'GET /api/v1/settings/raw'>) => {
  res.json({ success: true, settings: await readSettings(angemeldeteNutzerId(req), istVerwalter(req)) });
});

router.get('/settings/export', async (req, res: Antwort<'GET /api/v1/settings/export'>) => {
  // Nur Verwalter: Der Import nimmt globale Werte nur von ihnen an, und
  // SMTP-Daten gehen ein Unterkonto nichts an.
  const global = istVerwalter(req) ? await globaleWerteOhneGeheimnisse() : {};
  const userSettings: any = await nutzerEinstellungen(nutzerId(req)!);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="brickinventory-config-${new Date().toISOString().substring(0,10)}.json"`);
  res.json({ exported_at: new Date().toISOString(), exported_by: nutzerName(req), version: '3.0', global, user_settings: userSettings });
});

router.get('/settings/export/data', async (req: LoggedInRequest, res) => {
  // archiver 8 ist ein ES-Modul; aus CommonJS geht nur require(), kein Import.
  const { ZipArchive } = require('archiver');
  const uid = angemeldeteNutzerId(req);

  // Alles im selben Archiv: Die Konfigurationsexporte können Bestandsdaten nicht tragen.
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
});

const importUpload = multer({ storage: multer.memoryStorage(), limits: { ...FORMULAR_GRENZEN, fileSize: 1024 * 1024 } });
router.post('/settings/import', importUpload.single('file'), async (req: LoggedInRequest, res: Antwort<'POST /api/v1/settings/import'>) => {
  if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
  const gelesen = jsonOderNull(req.file.buffer.toString('utf-8'));
  if (!gelesen) return sendeFehler(req, res, 400, 'json_ungueltig');
  const config = gelesen.wert as any;

  const globalKeys = ['bricklink_consumer_key','bricklink_consumer_secret','bricklink_token',
    'bricklink_token_secret','brickset_api_key','rebrickable_api_key','price_job_interval_minutes',
    'price_cache_ttl','api_limit_rebrickable','api_limit_bricklink','api_limit_brickset',
    // smtp_* fehlen mit Absicht: Eine Importdatei kommt von irgendwoher, und mit
    // smtp_host + smtp_tls_ca gingen Rücksetz-Mails an einen fremden Server.
    'registration_enabled', 'default_price_condition', 'gutschein_land',
    ...DAILY_JOBS.map(j => `job_time_${j.name}`)];
  const userKeys = ['currency', 'user_default_condition'];
  const uid = angemeldeteNutzerId(req);
  let imported = 0;
  const smtpUebergangen = config.global && typeof config.global === 'object'
    ? Object.keys(config.global).filter(k => k.startsWith('smtp_')) : [];
  if (config.global && istVerwalter(req)) {
    if (globalKeys.some(k => config.global[k] !== undefined && !globalerWertGueltig(k, config.global[k])))
      return sendeFehler(req, res, 400, 'wert_ungueltig');
    const geaendert: string[] = [];
    for (const key of globalKeys) {
      if (config.global[key] !== undefined) {
        // Maskierte Werte aus älteren Exporten dürfen echte Schlüssel nicht überschreiben.
        if (SECRET_KEYS.has(key) && isMaskedValue(config.global[key])) continue;
        if (String(config.global[key]) !== String(await getGlobalSetting(key) ?? '')) geaendert.push(key);
        await setGlobalSetting(key, config.global[key]);
        imported++;
      }
    }
    if (geaendert.length) await protokolliere(uid, uid, 'einstellungen_geaendert', `Import: ${geaendert.join(', ')}`);
  }
  if (config.user_settings) {
    for (const key of userKeys) {
      if (config.user_settings[key] !== undefined) {
        // Zentrale Stelle: Eine importierte Währungsänderung stösst den Preis-Job an.
        await setUserSetting(uid, key, config.user_settings[key]);
        imported++;
      }
    }
  }
  // Nur Verwalter: Sonst könnte jedes Konto per Ein-Zeilen-Datei den Preis-Cache
  // der ganzen Installation leeren.
  // Ausführlich: docs/begruendungen/routes/api_v1/settings.ts.md#abschnitt-2

  if (istVerwalter(req)) await zeitplanNeuPlanen();
  const note = (istVerwalter(req) ? 'Globale + Benutzer-Einstellungen importiert' : 'Nur Benutzer-Einstellungen importiert')
    + (istVerwalter(req) && smtpUebergangen.length ? '; SMTP nicht übernommen — bitte im Formular setzen' : '');
  res.json({ success: true, imported, note, smtp_uebergangen: istVerwalter(req) ? smtpUebergangen : [] });
});

router.post('/settings/smtp-test', async (req, res: Antwort<'POST /api/v1/settings/smtp-test'>) => {
  if (!istVerwalter(req)) return sendeFehler(req, res, 403, 'nur_admins');
  const verify = await testSmtp();
  if (!verify.success) return sendeFehler(req, res, 400, verify.code, 'vars' in verify ? verify.vars : undefined);

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
});

// Offen, solange der Verwalter sie nicht abgeschlossen hat UND noch etwas
// fehlt — eine eingerichtete Installation sieht den Assistenten nie.
router.get('/settings/einrichtung', async (req, res: Antwort<'GET /api/v1/settings/einrichtung'>) => {
  if (!istVerwalter(req)) return sendeFehler(req, res, 403, 'nur_admins');
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
});

router.post('/settings/einrichtung/fertig', async (req, res: Antwort<'POST /api/v1/settings/einrichtung/fertig'>) => {
  if (!istVerwalter(req)) return sendeFehler(req, res, 403, 'nur_admins');
  await setGlobalSetting('einrichtung_erledigt', '1');
  res.json({ success: true });
});

// Prüft den GESPEICHERTEN Zugang mit einem kleinen Abruf.
router.post('/settings/quelle-testen', async (req, res: Antwort<'POST /api/v1/settings/quelle-testen'>) => {
  if (!istVerwalter(req)) return sendeFehler(req, res, 403, 'nur_admins');
  await quellePruefen(String(req.body?.quelle ?? ''));
  res.json({ success: true });
});

// Leer heisst „Vorgabe des Verwalters".
router.post('/settings/user/theme', async (req: LoggedInRequest, res: Antwort<'POST /api/v1/settings/user/theme'>) => {
  const uid = angemeldeteNutzerId(req);
  await setzeEigenesDesign(uid, req.body?.theme);
  res.json({ success: true, ...await designFuer(uid) });
});

router.post('/settings/admin/theme', requireAdmin, async (req, res: Antwort<'POST /api/v1/settings/admin/theme'>) => {
  const theme = String(req.body?.theme || 'classic');
  if (!DESIGNS.includes(theme)) {
    return sendeFehler(req, res, 400, 'design_ungueltig');
  }
  setGlobalSetting('app_theme', theme);
  // Das Design steckt im serverseitig gerenderten <html data-theme>; ohne
  // Verwerfen käme bis zum Neustart das alte.
  invalidateTheme();
  res.json({ success: true, theme });
});

router.use(fehlerAntwort);

export = router;
