/** /api/v1/settings — ein Router für den ganzen Pfad, weil die Reihenfolge vor
 * und nach router.use(requireLogin) hier an einer Stelle entschieden wird. */
import multer from 'multer';
import { FORMULAR_GRENZEN } from '../../src/http/dateiEmpfang';
import { logAndContinue, meldeUndLiefere } from '../../src/infra/fehler';
import { fehlerAntwort, sendeFehler } from '../../src/http/httpAntwort';
import { requireApiAdmin as requireAdmin, requireToken, bearerToken, kontoSchranke } from './middleware';
import { SECRET_KEYS, isMaskedValue, readSettings, designFuer, deleteUserSetting, setGlobalSetting, globalerWertGueltig, deleteGlobalSetting, globalDefaultCondition, nutzerStandardZustand, getGlobalSetting, getSetting } from '../../src/einstellungen/settings';
import { setzeEigenesDesign, setUserSetting } from '../../src/konto/nutzerEinstellung';
import { quellePruefen, bricksetLimitGesetzt, protokolliere } from '../../src/verwaltung/dienst';
import { zugaengeDesKontos, zugangLoeschen, andereZugaengeLoeschen, andereSitzungenBeenden, mussPasswortAendern, profil } from '../../src/konto/konten';
import { hashToken, leereTokenCache } from '../../src/konto/auth';
import { kontoGedrosselt } from '../../src/konto/zielDrossel';
import { resolveUserId, requireLoginOrToken, nutzerId, angemeldeteNutzerId, istVerwalter, nutzerName, bestaetigeMitFaktor, perSitzung } from '../../src/konto/http/anmeldung';
import { hinweisNebenher, verwalterHinweisNebenher } from '../../src/konto/kontoHinweis';
import { householdStatus, createInvite, redeemInvite, pruefeEinladung, unlink, verwerfeGetrennt } from '../../src/haushalt/haushalt';
import { sendMail, testSmtp, sendHaushaltVerknuepftMail, mailBereit } from '../../src/mail/mailer';
import { fehlerText, antwortSprache } from '../../src/infra/fehlerTexte';
import { tlsAuskunft } from '../../src/infra/tlsWurzel';
import { invalidateTheme } from '../../src/konto/indexHtml';
import { emailGueltig } from '../../src/infra/validate';
import { konfigExport, datenZip, konfigImport, istHeikel } from '../../src/verwaltung/datenexport';
import { GLOBALE_EINSTELLUNGEN, KONTO_EINSTELLUNGEN } from '../../src/vertrag/einstellungen';
import type { Request } from 'express';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Anfrage, Antwort, OffeneAnfrage } from '../../src/http/vertragsRouter';
const router = vertragsRouter();

const requireLogin = requireLoginOrToken;

// Vor router.use(requireLogin): Anmelde- und Startbildschirm brauchen das
// Design, und es verrät nichts über Konten.
router.get('/settings/theme', async (req: OffeneAnfrage<'GET /api/v1/settings/theme'>, res: Antwort<'GET /api/v1/settings/theme'>) => {
  const uid = await resolveUserId(req);
  res.set('Cache-Control', 'no-cache');
  res.set('Vary', 'Cookie, Authorization');
  res.json({ success: true, ...await designFuer(uid) });
});

// Vor router.use(requireLogin), weil requireLogin nur die Sitzung kennt und
// die App ihre Zugänge mit Token verwaltet. Ausführlich: docs/begruendungen/routes/api_v1/settings.ts.md#abschnitt
router.get('/settings/tokens', requireLoginOrToken, async (req: OffeneAnfrage<'GET /api/v1/settings/tokens'>, res: Antwort<'GET /api/v1/settings/tokens'>) => {
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
 * Einen FREMDEN Zugang widerruft nur, wer Passwort und Faktor kennt: Ein
 * erbeuteter Token soll den Inhaber nicht von seinen Geräten aussperren.
 * Ausführlich: docs/begruendungen/routes/api_v1/settings.ts.md#delete-tokens-tokenid */
router.delete('/settings/tokens/:tokenId', requireLoginOrToken, async (req: OffeneAnfrage<'DELETE /api/v1/settings/tokens/:tokenId'>, res: Antwort<'DELETE /api/v1/settings/tokens/:tokenId'>) => {
  const uid = angemeldeteNutzerId(req);
  const eigener = bearerToken(req);
  const eigenesGeraet = !!eigener && hashToken(eigener).startsWith(req.pfad.tokenId);
  if (!eigenesGeraet && !await bestaetigeMitFaktor(req, res, uid, req.eingabe.password)) return;
  const { anzahl, label } = await zugangLoeschen(uid, req.pfad.tokenId);
  if (anzahl) {
    leereTokenCache();
    if (!eigenesGeraet) hinweisNebenher(uid, 'zugang_beendet', label ?? undefined);
  }
  res.json({ success: true, deleted: anzahl });
});

// Mit Passwort: Eine erbeutete Sitzung soll den Inhaber nicht aussperren können.
// `zugaenge` nimmt die App-Zugänge mit, damit ein Code für alles reicht.
router.post('/settings/sessions/andere-beenden', requireLogin, async (req: OffeneAnfrage<'POST /api/v1/settings/sessions/andere-beenden'>, res: Antwort<'POST /api/v1/settings/sessions/andere-beenden'>) => {
  const uid = angemeldeteNutzerId(req);
  if (!await bestaetigeMitFaktor(req, res, uid, req.eingabe.password)) return;
  const { beendet, version } = await andereSitzungenBeenden(uid, req.sessionID);
  // Nur eine echte Sitzung merkt sich die Version; sonst bekäme die App eine.
  if (perSitzung(req)) req.session.sitzungsVersion = version;
  const eigener = bearerToken(req);
  const zugaenge = req.eingabe.zugaenge ? await andereZugaengeLoeschen(uid, eigener ? hashToken(eigener) : null) : 0;
  if (zugaenge) leereTokenCache();
  if (beendet || zugaenge) hinweisNebenher(uid, 'zugaenge_beendet');
  res.json({ success: true, deleted: beendet, zugaenge });
});

/** Ausdrücklich aufgezählt: Die App bekommt nur, was sie liest, keine globalen
 * oder Verwalterfelder. Ausführlich: docs/begruendungen/routes/api_v1/settings.ts.md#app-felder */
const APP_FELDER = ['currency', 'price_condition', 'price_cache_ttl',
                    'default_price_condition', 'user_default_condition'] as const;

const APP_VORGABEN: Record<string, string> = {
  currency: 'EUR', price_condition: 'N', price_cache_ttl: '24',
  default_price_condition: 'N', user_default_condition: '',
};

router.get('/settings', requireToken, async (req: Anfrage<'GET /api/v1/settings'>, res: Antwort<'GET /api/v1/settings'>) => {
  const uid = req.apiUser.user_id;
  // readSettings(), weil price_cache_ttl und default_price_condition global
  // sind; eine eigene Abfrage las sie nicht.
  const alle = await readSettings(uid, false);
  const gespeichert = Object.fromEntries(APP_FELDER.map(feld => [feld, alle[feld] ?? APP_VORGABEN[feld] ?? '']));
  res.json({ success:true, settings: {
    ...gespeichert as Record<(typeof APP_FELDER)[number], string>,
    // Die Regel steht in src/einstellungen/settings.ts, damit sie nicht neben dem
    // Webapp-Weg ein zweites Mal existiert.
    effective_condition: await nutzerStandardZustand(uid),
    // Das wirksame Design des Kontos, nicht die Vorgabe des Verwalters.
    app_theme: (await designFuer(uid)).theme,
  } });
});

router.put('/settings', requireToken, async (req: Anfrage<'PUT /api/v1/settings'>, res: Antwort<'PUT /api/v1/settings'>) => {
  const uid = req.apiUser.user_id;
  const allowed = ['currency','price_cache_ttl'];
  let updated = 0;
  for (const key of allowed) {
    if (req.eingabe[key]!==undefined) {
      // Zentrale Stelle: Eine ECHTE Währungsänderung stösst den Preis-Job an.
      await setUserSetting(uid, key, String(req.eingabe[key]));
      updated++;
    }
  }
  res.json({ success:true, updated });
});

// Der GLOBALE Default; den effektiven liefert GET /settings (effective_condition).
router.get('/settings/default-condition', requireToken, async (_req: AuthedRequest, res: Antwort<'GET /api/v1/settings/default-condition'>) => {
  res.json({ success: true, condition: await globalDefaultCondition() });
});

// Der wirksame Wert, für Webapp und App aus einer Route.
// Ausführlich: docs/begruendungen/routes/api_v1/settings.ts.md#get-settings-user-default-condition
router.get('/settings/user/default-condition', requireToken, async (req: Anfrage<'GET /api/v1/settings/user/default-condition'>, res: Antwort<'GET /api/v1/settings/user/default-condition'>) => {
  res.json({ success: true, condition: await nutzerStandardZustand(req.apiUser.user_id) });
});

router.post('/settings/user/default-condition', requireToken, async (req: Anfrage<'POST /api/v1/settings/user/default-condition'>, res: Antwort<'POST /api/v1/settings/user/default-condition'>) => {
  const condition = String(req.eingabe.condition ?? '');
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
router.get('/settings/household', requireToken, async (req: Anfrage<'GET /api/v1/settings/household'>, res: Antwort<'GET /api/v1/settings/household'>) => {
  res.json({ success: true, ...(await householdStatus(req.apiUser.user_id)) });
});

router.post('/settings/household/invite', requireToken, async (req: Anfrage<'POST /api/v1/settings/household/invite'>, res: Antwort<'POST /api/v1/settings/household/invite'>) => {
  const r = await createInvite(req.apiUser.user_id);
  if ('fehler' in r) return sendeFehler(req, res, 409, r.fehler, 'vars' in r ? r.vars : undefined);
  res.json({ success: true, ...r });
});

router.post('/settings/household/redeem/pruefen', requireToken, async (req: Anfrage<'POST /api/v1/settings/household/redeem/pruefen'>, res: Antwort<'POST /api/v1/settings/household/redeem/pruefen'>) => {
  const zuOft = await kontoGedrosselt('haushalt-pruefen', req.apiUser.user_id, 30, 60 * 60 * 1000);
  if (zuOft) return sendeFehler(req, res, 429, 'zu_viele_anfragen', { minuten: zuOft.waitMin });
  const r = await pruefeEinladung(req.apiUser.user_id, String(req.eingabe.code || ''));
  if ('fehler' in r) return sendeFehler(req, res, 409, r.fehler);
  res.json({ success: true, ...r });
});

// Mit Passwort: Das Hauptkonto liest und schreibt danach den Bestand dieses
// Kontos, auch über einen Passwortwechsel hinweg. Ein erbeutetes Token allein
// soll das nicht einrichten können.
router.post('/settings/household/redeem', requireToken, async (req: Anfrage<'POST /api/v1/settings/household/redeem'>, res: Antwort<'POST /api/v1/settings/household/redeem'>) => {
  const uid = req.apiUser.user_id;
  // Die Verknüpfung ist ein Zugang zur Sammlung wie ein Passkey: bei aktivem zweitem Faktor nur mit Code.
  if (!await bestaetigeMitFaktor(req, res, uid, req.eingabe.password, 'faktor_code')) return;
  const r = await redeemInvite(uid, String(req.eingabe.code || ''));
  if ('fehler' in r) return sendeFehler(req, res, 409, r.fehler, 'vars' in r ? r.vars : undefined);
  const ich = await profil(uid);
  if (ich?.email) {
    const sprache = await getSetting(uid, 'language', 'de').catch(meldeUndLiefere('einstellungen:sprache', 'de'));
    const hauptkonto = 'linked_to' in r ? r.linked_to.username : '';
    void sendHaushaltVerknuepftMail(ich.email, ich.username, hauptkonto, String(sprache ?? 'de'))
      .catch(logAndContinue('haushalt:hinweismail'));
  }
  res.json({ success: true, ...r });
});

const kennung = (v: string | number | null | undefined) => v == null ? null : Number(v);

router.post('/settings/household/unlink', requireToken, async (req: Anfrage<'POST /api/v1/settings/household/unlink'>, res: Antwort<'POST /api/v1/settings/household/unlink'>) => {
  res.json({ success: true,
    ...(await unlink(req.apiUser.user_id, kennung(req.eingabe.sub_user_id), kennung(req.eingabe.main_user_id))) });
});

router.post('/settings/household/former/dismiss', requireToken, async (req: Anfrage<'POST /api/v1/settings/household/former/dismiss'>, res: Antwort<'POST /api/v1/settings/household/former/dismiss'>) => {
  const sub = parseInt(String(req.eingabe.sub_user_id));
  if (!Number.isFinite(sub)) return sendeFehler(req, res, 400, 'konto_id_ungueltig');
  res.json({ success: true, ...(await verwerfeGetrennt(req.apiUser.user_id, sub)) });
});

router.use('/settings', requireLogin);

/** Zum Abgleich von Hand; derselbe Wert steht als `fp` im QR-Code der App. */
router.get('/settings/tls', async (_req, res: Antwort<'GET /api/v1/settings/tls'>) => {
  res.json({ success: true, ...await tlsAuskunft() });
});


router.post('/settings', async (req: OffeneAnfrage<'POST /api/v1/settings'>, res: Antwort<'POST /api/v1/settings'>) => {
  const uid = angemeldeteNutzerId(req);
  const globalKeys = GLOBALE_EINSTELLUNGEN, userKeys = KONTO_EINSTELLUNGEN;

  if (istVerwalter(req)) {
    if (globalKeys.some(k => req.eingabe[k] !== undefined && !globalerWertGueltig(k, req.eingabe[k])))
      return sendeFehler(req, res, 400, 'wert_ungueltig');
    if (String(req.eingabe.registration_enabled) === '1' && await getGlobalSetting('registration_enabled') !== '1' && !await mailBereit(req.eingabe))
      return sendeFehler(req, res, 400, 'registrierung_braucht_mail');
    // Mailserver, Registrierung und API-Schlüssel nur mit Passwort: Eine erbeutete
    // Verwaltersitzung läse sonst Rücksetz-Mails mit oder öffnete still die Registrierung.
    // Ein erster API-Schlüssel lenkt nichts um; nur der Einrichtungsassistent fragt dafür nicht nach.
    const heikel: string[] = [];
    const einrichtung = !await getGlobalSetting('einrichtung_erledigt');
    for (const key of globalKeys.filter(istHeikel)) {
      const neu = req.eingabe[key];
      if (neu === undefined || (SECRET_KEYS.has(key) && isMaskedValue(neu))) continue;
      const alt = String(await getGlobalSetting(key) ?? '');
      if (String(neu) === alt || (einrichtung && alt === '' && !key.startsWith('smtp_') && key !== 'registration_enabled')) continue;
      heikel.push(key);
    }
    if (heikel.length && !req.eingabe.admin_password) return sendeFehler(req, res, 400, 'aktuelles_passwort_erforderlich');
    if (heikel.length && !await bestaetigeMitFaktor(req, res, uid, req.eingabe.admin_password)) return;
    if (heikel.some(k => !k.startsWith('smtp_')))
      verwalterHinweisNebenher('einstellungen_geaendert', { konto: heikel.join(', '), durch: nutzerName(req) ?? '' });

    const oldBricksetLimit = req.eingabe.api_limit_brickset !== undefined
      ? parseInt(await getGlobalSetting('api_limit_brickset') || '100')
      : null;

    const geaendert: string[] = [];
    for (const key of globalKeys) {
      if (req.eingabe[key] !== undefined) {
        // Eine unverändert zurückgeschickte Maske ist kein neuer Wert, sonst
        // überschriebe jedes Speichern die echten Schlüssel mit Punkten.
        if (SECRET_KEYS.has(key) && isMaskedValue(req.eingabe[key])) continue;
        if (String(req.eingabe[key]) !== String(await getGlobalSetting(key) ?? '')) geaendert.push(key);
        await setGlobalSetting(key, req.eingabe[key]);
      }
    }
    if (geaendert.length) await protokolliere(uid, uid, 'einstellungen_geaendert', geaendert.join(', '));
    // Wer das Mailformular gespeichert hat, hat den Hinweis auf die alte Ausnahme gesehen.
    if (globalKeys.some(k => k.startsWith('smtp_') && req.eingabe[k] !== undefined)) await deleteGlobalSetting('smtp_insecure_tls');

    if (oldBricksetLimit !== null) await bricksetLimitGesetzt(oldBricksetLimit, parseInt(String(req.eingabe.api_limit_brickset)));
  }
  for (const key of userKeys) {
    if (req.eingabe[key] !== undefined) {
      // Zentrale Stelle: Eine ECHTE Währungsänderung stösst den Preis-Job an.
      await setUserSetting(uid, key, req.eingabe[key]);
    }
  }
  res.json({ success: true });
});

// Über readSettings(), damit die Maskierung nicht an der Verpackung vorbeigeht.
router.get('/settings/raw', async (req: OffeneAnfrage<'GET /api/v1/settings/raw'>, res: Antwort<'GET /api/v1/settings/raw'>) => {
  res.json({ success: true, settings: await readSettings(angemeldeteNutzerId(req), istVerwalter(req)) });
});

router.get('/settings/export', async (req: OffeneAnfrage<'GET /api/v1/settings/export'>, res: Antwort<'GET /api/v1/settings/export'>) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="brickinventory-config-${new Date().toISOString().substring(0,10)}.json"`);
  res.json(await konfigExport(nutzerId(req)!, istVerwalter(req), nutzerName(req) ?? null));
});

router.get('/settings/export/data', async (req: Request, res) => {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="brickinventory-export-${new Date().toISOString().substring(0, 10)}.zip"`);
  await datenZip(angemeldeteNutzerId(req), res, (e) => { console.error('[export-zip]', e.message); res.status(500).end(); });
});

const importUpload = multer({ storage: multer.memoryStorage(), limits: { ...FORMULAR_GRENZEN, fileSize: 1024 * 1024 } });
router.post('/settings/import', kontoSchranke('upload'), importUpload.single('file'), async (req: OffeneAnfrage<'POST /api/v1/settings/import'>, res: Antwort<'POST /api/v1/settings/import'>) => {
  if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
  res.json(await konfigImport(angemeldeteNutzerId(req), istVerwalter(req), req.file.buffer));
});

router.post('/settings/smtp-test', async (req: OffeneAnfrage<'POST /api/v1/settings/smtp-test'>, res: Antwort<'POST /api/v1/settings/smtp-test'>) => {
  if (!istVerwalter(req)) return sendeFehler(req, res, 403, 'nur_admins');
  const uid = angemeldeteNutzerId(req);
  // Sonst wäre der Mailserver für eine erbeutete Verwaltersitzung ein Relais an jede Adresse.
  const zuOft = await kontoGedrosselt('smtp-test', uid, 10, 60 * 60 * 1000);
  if (zuOft) return sendeFehler(req, res, 429, 'zu_viele_anfragen', { minuten: zuOft.waitMin });

  const eigene = (await profil(uid))?.email || '';
  const to = (req.eingabe.to || '').trim() || eigene;
  if (!emailGueltig(to)) {
    return sendeFehler(req, res, 400, 'keine_ziel_email');
  }
  // Wie das Ändern der Mail-Einstellungen: an eine fremde Adresse nur mit Passwort.
  if (to.toLowerCase() !== eigene.toLowerCase() && !await bestaetigeMitFaktor(req, res, uid, req.eingabe.password)) return;

  const verify = await testSmtp();
  if (!verify.success) return sendeFehler(req, res, 400, verify.code, 'vars' in verify ? verify.vars : undefined);
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
router.get('/settings/einrichtung', async (req: OffeneAnfrage<'GET /api/v1/settings/einrichtung'>, res: Antwort<'GET /api/v1/settings/einrichtung'>) => {
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

router.post('/settings/einrichtung/fertig', async (req: OffeneAnfrage<'POST /api/v1/settings/einrichtung/fertig'>, res: Antwort<'POST /api/v1/settings/einrichtung/fertig'>) => {
  if (!istVerwalter(req)) return sendeFehler(req, res, 403, 'nur_admins');
  await setGlobalSetting('einrichtung_erledigt', '1');
  res.json({ success: true });
});

// Prüft den GESPEICHERTEN Zugang mit einem kleinen Abruf.
router.post('/settings/quelle-testen', async (req: OffeneAnfrage<'POST /api/v1/settings/quelle-testen'>, res: Antwort<'POST /api/v1/settings/quelle-testen'>) => {
  if (!istVerwalter(req)) return sendeFehler(req, res, 403, 'nur_admins');
  const absage = await quellePruefen(String(req.eingabe.quelle ?? ''));
  if (!absage) return res.json({ success: true });
  res.status(400).json({ success: false, code: absage.code, details: absage.grund,
    error: fehlerText(absage.code, antwortSprache(req), { quelle: absage.quelle, grund: absage.grund }) });
});

// Leer heisst „Vorgabe des Verwalters".
router.post('/settings/user/theme', async (req: OffeneAnfrage<'POST /api/v1/settings/user/theme'>, res: Antwort<'POST /api/v1/settings/user/theme'>) => {
  const uid = angemeldeteNutzerId(req);
  await setzeEigenesDesign(uid, req.eingabe.theme);
  res.json({ success: true, ...await designFuer(uid) });
});

router.post('/settings/admin/theme', requireAdmin, async (req: OffeneAnfrage<'POST /api/v1/settings/admin/theme'>, res: Antwort<'POST /api/v1/settings/admin/theme'>) => {
  const theme = req.eingabe.theme;
  await setGlobalSetting('app_theme', theme);
  // Das Design steckt im serverseitig gerenderten <html data-theme>; ohne
  // Verwerfen käme bis zum Neustart das alte.
  invalidateTheme();
  res.json({ success: true, theme });
});

router.use(fehlerAntwort);

export = router;
