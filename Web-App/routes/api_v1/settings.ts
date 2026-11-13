/** /api/v1/settings — ein Router für den ganzen Pfad, weil die Reihenfolge vor
 * und nach router.use(requireLogin) hier an einer Stelle entschieden wird. */
import multer from 'multer';
import { FORMULAR_GRENZEN } from '../../src/http/dateiEmpfang';
import { logAndContinue, meldeUndLiefere } from '../../src/infra/fehler';
import { fehlerAntwort, sendeFehler } from '../../src/http/httpAntwort';
import { requireApiAdmin as requireAdmin, requireToken, bearerToken, kontoSchranke } from './middleware';
import { hashToken, invalidateTheme } from '../../src/konto';
import { quellePruefen, hatGlobaleWerte } from '../../src/verwaltung';
import {
  resolveUserId,
  requireLoginOrToken,
  istVerwalter,
  nutzerName,
  bestaetigeMitFaktor,
  perSitzung,
} from '../../src/konto/http/anmeldung';
import { freigegeben, alsVerwalter } from '../../src/konto/http/schrittschutz';
import { sendMail, testSmtp, sendHaushaltVerknuepftMail } from '../../src/mail';
import { fehlerText, antwortSprache } from '../../src/infra/fehlerTexte';
import { tlsAuskunft } from '../../src/infra/tlsWurzel';
import { emailGueltig } from '../../src/infra/validate';
import { vertragsRouter, type Anfrage, type Antwort, type OffeneAnfrage } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../startup/verdrahtung';

const kennung = (v: string | number | null | undefined) => (v == null ? null : Number(v));

export function baueSettingsRouter(d: Dienste) {
  const router = vertragsRouter();

  const requireLogin = requireLoginOrToken;

  // Vor router.use(requireLogin): Anmelde- und Startbildschirm brauchen das
  // Design, und es verrät nichts über Konten.
  router.get(
    '/settings/theme',
    async (req: OffeneAnfrage<'GET /api/v1/settings/theme'>, res: Antwort<'GET /api/v1/settings/theme'>) => {
      const uid = await resolveUserId(req);
      res.set('Cache-Control', 'no-cache');
      res.set('Vary', 'Cookie, Authorization');
      res.json({ success: true, ...(await d.einstellungen.designFuer(uid)) });
    },
  );

  // Vor router.use(requireLogin), weil requireLogin nur die Sitzung kennt und
  // die App ihre Zugänge mit Token verwaltet.
  router.get(
    '/settings/tokens',
    requireToken,
    async (req: Anfrage<'GET /api/v1/settings/tokens'>, res: Antwort<'GET /api/v1/settings/tokens'>) => {
      const eigener = bearerToken(req);
      const eigenerHash = eigener ? hashToken(eigener) : null;
      // LEAST über beide Fristen: Den Nutzer interessiert der Tag, an dem dieses
      // Gerät ausgesperrt wird.
      const tokens = await d.konto.zugaengeListe(req.apiUser.user_id);
      res.json({
        success: true,
        tokens: tokens.map(t => ({
          token_prefix: t.token.substring(0, 8),
          token_id: t.token.substring(0, 16),
          label: t.label,
          created_at: t.created_at,
          last_used: t.last_used,
          expires_at: t.expires_at,
          hard_expires_at: t.hard_expires_at,
          never_expires: !t.expires_at,
          scope: t.scope,
          ip_bereich: t.ip_bereich,
          rotiert_am: t.rotiert_am,
          aktuell: t.token === eigenerHash,
        })),
      });
    },
  );

  /** Die Zeile ist sofort weg, der Token-Cache gilt aber noch kurz nach.
   * Einen FREMDEN Zugang widerruft nur, wer Passwort und Faktor kennt: Ein
   * erbeuteter Token soll den Inhaber nicht von seinen Geräten aussperren. */
  router.delete(
    '/settings/tokens/:tokenId',
    requireToken,
    async (
      req: Anfrage<'DELETE /api/v1/settings/tokens/:tokenId'>,
      res: Antwort<'DELETE /api/v1/settings/tokens/:tokenId'>,
    ) => {
      const uid = req.apiUser.user_id;
      const eigener = bearerToken(req);
      const eigenesGeraet = !!eigener && hashToken(eigener).startsWith(req.pfad.tokenId);
      if (!eigenesGeraet && !(await bestaetigeMitFaktor(req, res, uid, req.eingabe.password))) return;
      res.json({ success: true, deleted: await d.konto.zugangBeenden(uid, req.pfad.tokenId, eigenesGeraet) });
    },
  );

  // Mit Passwort: Eine erbeutete Sitzung soll den Inhaber nicht aussperren können.
  // `zugaenge` nimmt die App-Zugänge mit, damit ein Code für alles reicht.
  router.post(
    '/settings/sessions/andere-beenden',
    requireToken,
    async (
      req: Anfrage<'POST /api/v1/settings/sessions/andere-beenden'>,
      res: Antwort<'POST /api/v1/settings/sessions/andere-beenden'>,
    ) => {
      const uid = req.apiUser.user_id;
      if (!(await bestaetigeMitFaktor(req, res, uid, req.eingabe.password))) return;
      const { beendet, version } = await d.konto.andereSitzungenBeenden(uid, req.sessionID);
      // Nur eine echte Sitzung merkt sich die Version; sonst bekäme die App eine.
      if (perSitzung(req)) req.session.sitzungsVersion = version;
      const zugaenge = req.eingabe.zugaenge ? await d.konto.andereZugaengeBeenden(uid, bearerToken(req)) : 0;
      if (beendet || zugaenge) d.konto.hinweisNebenher(uid, 'zugaenge_beendet');
      res.json({ success: true, deleted: beendet, zugaenge });
    },
  );

  /** Ausdrücklich aufgezählt: Die App bekommt nur, was sie liest, keine globalen
   * oder Verwalterfelder. */
  const APP_FELDER = [
    'currency',
    'price_condition',
    'price_cache_ttl',
    'default_price_condition',
    'user_default_condition',
  ] as const;

  const APP_VORGABEN: Record<string, string> = {
    currency: 'EUR',
    price_condition: 'N',
    price_cache_ttl: '24',
    default_price_condition: 'N',
    user_default_condition: '',
  };

  router.get(
    '/settings',
    requireToken,
    async (req: Anfrage<'GET /api/v1/settings'>, res: Antwort<'GET /api/v1/settings'>) => {
      const uid = req.apiUser.user_id;
      // readSettings(), weil price_cache_ttl und default_price_condition global
      // sind; eine eigene Abfrage las sie nicht.
      const alle = await d.einstellungen.readSettings(uid, false);
      const gespeichert = Object.fromEntries(APP_FELDER.map(feld => [feld, alle[feld] ?? APP_VORGABEN[feld] ?? '']));
      res.json({
        success: true,
        settings: {
          ...(gespeichert as Record<(typeof APP_FELDER)[number], string>),
          // Die Regel steht in src/einstellungen/settings.ts, damit sie nicht neben dem
          // Webapp-Weg ein zweites Mal existiert.
          effective_condition: await d.einstellungen.nutzerStandardZustand(uid),
          // Das wirksame Design des Kontos, nicht die Vorgabe des Verwalters.
          app_theme: (await d.einstellungen.designFuer(uid)).theme,
        },
      });
    },
  );

  router.put(
    '/settings',
    requireToken,
    async (req: Anfrage<'PUT /api/v1/settings'>, res: Antwort<'PUT /api/v1/settings'>) => {
      const uid = req.apiUser.user_id;
      const allowed = ['currency', 'price_cache_ttl'];
      let updated = 0;
      for (const key of allowed) {
        if (req.eingabe[key] !== undefined) {
          // Zentrale Stelle: Eine ECHTE Währungsänderung stösst den Preis-Job an.
          await d.konto.setUserSetting(uid, key, String(req.eingabe[key]));
          updated++;
        }
      }
      res.json({ success: true, updated });
    },
  );

  // Der GLOBALE Default; den effektiven liefert GET /settings (effective_condition).
  router.get(
    '/settings/default-condition',
    requireToken,
    async (_req: AuthedRequest, res: Antwort<'GET /api/v1/settings/default-condition'>) => {
      res.json({ success: true, condition: await d.einstellungen.globalDefaultCondition() });
    },
  );

  // Der wirksame Wert, für Webapp und App aus einer Route.
  router.get(
    '/settings/user/default-condition',
    requireToken,
    async (
      req: Anfrage<'GET /api/v1/settings/user/default-condition'>,
      res: Antwort<'GET /api/v1/settings/user/default-condition'>,
    ) => {
      res.json({ success: true, condition: await d.einstellungen.nutzerStandardZustand(req.apiUser.user_id) });
    },
  );

  router.post(
    '/settings/user/default-condition',
    requireToken,
    async (
      req: Anfrage<'POST /api/v1/settings/user/default-condition'>,
      res: Antwort<'POST /api/v1/settings/user/default-condition'>,
    ) => {
      const condition = String(req.eingabe.condition ?? '');
      if (!['N', 'U', ''].includes(condition)) return sendeFehler(req, res, 400, 'zustand_n_oder_u');
      if (condition === '') {
        await d.einstellungen.deleteUserSetting(req.apiUser.user_id, 'user_default_condition');
      } else {
        // setUserSetting(): GENAU EINE Schreibstelle für Benutzereinstellungen.
        await d.konto.setUserSetting(req.apiUser.user_id, 'user_default_condition', condition);
      }
      res.json({ success: true, condition: condition || null });
    },
  );

  // ── Haushalt: Konten verknüpfen ──────────────────────────────────────────────
  // Dieselbe Umsetzung wie die Webapp (src/haushalt/haushalt.ts), damit die App
  // nicht ihre eigenen Regeln bekommt.
  router.get(
    '/settings/household',
    requireToken,
    async (req: Anfrage<'GET /api/v1/settings/household'>, res: Antwort<'GET /api/v1/settings/household'>) => {
      res.json({ success: true, ...(await d.haushalt.haushalt.haushaltsStand(req.apiUser.user_id)) });
    },
  );

  router.post(
    '/settings/household/invite',
    requireToken,
    async (
      req: Anfrage<'POST /api/v1/settings/household/invite'>,
      res: Antwort<'POST /api/v1/settings/household/invite'>,
    ) => {
      const r = await d.haushalt.haushalt.einladungAnlegen(req.apiUser.user_id);
      if ('fehler' in r) return sendeFehler(req, res, 409, r.fehler, 'vars' in r ? r.vars : undefined);
      res.json({ success: true, ...r });
    },
  );

  router.post(
    '/settings/household/redeem/pruefen',
    requireToken,
    async (
      req: Anfrage<'POST /api/v1/settings/household/redeem/pruefen'>,
      res: Antwort<'POST /api/v1/settings/household/redeem/pruefen'>,
    ) => {
      const zuOft = await d.konto.kontoGedrosselt('haushalt-pruefen', req.apiUser.user_id, 30, 60 * 60 * 1000);
      if (zuOft) return sendeFehler(req, res, 429, 'zu_viele_anfragen', { minuten: zuOft.waitMin });
      const r = await d.haushalt.haushalt.pruefeEinladung(req.apiUser.user_id, String(req.eingabe.code || ''));
      if ('fehler' in r) return sendeFehler(req, res, 409, r.fehler);
      res.json({ success: true, ...r });
    },
  );

  // Mit Passwort: Das Hauptkonto liest und schreibt danach den Bestand dieses
  // Kontos, auch über einen Passwortwechsel hinweg. Ein erbeutetes Token allein
  // soll das nicht einrichten können.
  router.post(
    '/settings/household/redeem',
    requireToken,
    async (
      req: Anfrage<'POST /api/v1/settings/household/redeem'>,
      res: Antwort<'POST /api/v1/settings/household/redeem'>,
    ) => {
      const uid = req.apiUser.user_id;
      // Die Verknüpfung ist ein Zugang zur Sammlung wie ein Passkey: bei aktivem zweitem Faktor nur mit Code.
      if (!(await bestaetigeMitFaktor(req, res, uid, req.eingabe.password, 'faktor_code'))) return;
      const r = await d.haushalt.haushalt.einladungEinloesen(uid, String(req.eingabe.code || ''));
      if ('fehler' in r) return sendeFehler(req, res, 409, r.fehler, 'vars' in r ? r.vars : undefined);
      const ich = await d.konto.profil(uid);
      if (ich?.email) {
        const sprache = await d.einstellungen
          .getSetting(uid, 'language', 'de')
          .catch(meldeUndLiefere('einstellungen:sprache', 'de'));
        const hauptkonto = 'linked_to' in r ? r.linked_to.username : '';
        void sendHaushaltVerknuepftMail(ich.email, ich.username, hauptkonto, String(sprache ?? 'de')).catch(
          logAndContinue('haushalt:hinweismail'),
        );
      }
      res.json({ success: true, ...r });
    },
  );

  router.post(
    '/settings/household/unlink',
    requireToken,
    async (
      req: Anfrage<'POST /api/v1/settings/household/unlink'>,
      res: Antwort<'POST /api/v1/settings/household/unlink'>,
    ) => {
      res.json({
        success: true,
        ...(await d.haushalt.haushalt.kontenTrennen(
          req.apiUser.user_id,
          kennung(req.eingabe.sub_user_id),
          kennung(req.eingabe.main_user_id),
        )),
      });
    },
  );

  router.post(
    '/settings/household/former/dismiss',
    requireToken,
    async (
      req: Anfrage<'POST /api/v1/settings/household/former/dismiss'>,
      res: Antwort<'POST /api/v1/settings/household/former/dismiss'>,
    ) => {
      const sub = parseInt(String(req.eingabe.sub_user_id), 10);
      if (!Number.isFinite(sub)) return sendeFehler(req, res, 400, 'konto_id_ungueltig');
      res.json({ success: true, ...(await d.haushalt.haushalt.verwerfeGetrennt(req.apiUser.user_id, sub)) });
    },
  );

  router.use('/settings', requireLogin);

  /** Zum Abgleich von Hand; derselbe Wert steht als `fp` im QR-Code der App. */
  router.get('/settings/tls', requireToken, async (_req: AuthedRequest, res: Antwort<'GET /api/v1/settings/tls'>) => {
    res.json({ success: true, ...(await tlsAuskunft()) });
  });

  router.post(
    '/settings',
    requireToken,
    async (req: Anfrage<'POST /api/v1/settings'>, res: Antwort<'POST /api/v1/settings'>) => {
      const uid = req.apiUser.user_id;
      // Globale Werte eines Verwalters gehen wie jede Verwalter-Route über den Schrittschutz.
      const verwalter = istVerwalter(req) && hatGlobaleWerte(req.eingabe);
      if (verwalter && !(await freigegeben(req, res, 'verwaltung'))) return;
      const fertig = await d.verwaltung.einstellungenSpeichern(req.eingabe, {
        uid,
        verwalter,
        name: nutzerName(req) ?? '',
        bestaetige: passwort => bestaetigeMitFaktor(req, res, uid, passwort),
      });
      if (fertig) res.json({ success: true });
    },
  );

  // Über readSettings(), damit die Maskierung nicht an der Verpackung vorbeigeht.
  router.get(
    '/settings/raw',
    requireToken,
    async (req: Anfrage<'GET /api/v1/settings/raw'>, res: Antwort<'GET /api/v1/settings/raw'>) => {
      res.json({
        success: true,
        settings: await d.einstellungen.readSettings(req.apiUser.user_id, await alsVerwalter(req)),
      });
    },
  );

  router.get(
    '/settings/export',
    requireToken,
    async (req: Anfrage<'GET /api/v1/settings/export'>, res: Antwort<'GET /api/v1/settings/export'>) => {
      const verwalter = await alsVerwalter(req);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="brickinventory-config-${new Date().toISOString().substring(0, 10)}.json"`,
      );
      res.json(await d.verwaltung.konfigExport(req.apiUser.user_id, verwalter, nutzerName(req) ?? null));
    },
  );

  router.get('/settings/export/data', requireToken, async (req: AuthedRequest, res) => {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="brickinventory-export-${new Date().toISOString().substring(0, 10)}.zip"`,
    );
    await d.verwaltung.datenZip(req.apiUser.user_id, res, e => {
      console.error('[export-zip]', e.message);
      res.status(500).end();
    });
  });

  const importUpload = multer({
    storage: multer.memoryStorage(),
    limits: { ...FORMULAR_GRENZEN, fileSize: 1024 * 1024 },
  });
  router.post(
    '/settings/import',
    requireToken,
    kontoSchranke('upload'),
    importUpload.single('file'),
    async (req: Anfrage<'POST /api/v1/settings/import'>, res: Antwort<'POST /api/v1/settings/import'>) => {
      if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
      // Als Verwalter schreibt der Import globale Werte und plant die Aufträge neu.
      const verwalter = istVerwalter(req);
      if (verwalter && !(await freigegeben(req, res, 'verwaltung'))) return;
      res.json({
        success: true,
        ...(await d.verwaltung.konfigImport(req.apiUser.user_id, verwalter, req.file.buffer)),
      });
    },
  );

  router.post(
    '/settings/smtp-test',
    requireAdmin,
    async (req: Anfrage<'POST /api/v1/settings/smtp-test'>, res: Antwort<'POST /api/v1/settings/smtp-test'>) => {
      const uid = req.apiUser.user_id;
      // Sonst wäre der Mailserver für eine erbeutete Verwaltersitzung ein Relais an jede Adresse.
      const zuOft = await d.konto.kontoGedrosselt('smtp-test', uid, 10, 60 * 60 * 1000);
      if (zuOft) return sendeFehler(req, res, 429, 'zu_viele_anfragen', { minuten: zuOft.waitMin });

      const eigene = (await d.konto.profil(uid))?.email || '';
      const to = (req.eingabe.to || '').trim() || eigene;
      if (!emailGueltig(to)) {
        return sendeFehler(req, res, 400, 'keine_ziel_email');
      }
      // Wie das Ändern der Mail-Einstellungen: an eine fremde Adresse nur mit Passwort.
      if (
        to.toLowerCase() !== eigene.toLowerCase() &&
        !(await bestaetigeMitFaktor(req, res, uid, req.eingabe.password))
      )
        return;

      const verify = await testSmtp();
      if (!verify.success) return sendeFehler(req, res, 400, verify.code, 'vars' in verify ? verify.vars : undefined);
      const result = await sendMail({
        to,
        subject: 'BrickInventory Manager — SMTP Test',
        text: 'Diese E-Mail bestätigt, dass deine SMTP-Konfiguration korrekt funktioniert.',
        html: '<div style="font-family:Arial,sans-serif;padding:20px"><h2>✅ SMTP-Test erfolgreich</h2><p>Deine SMTP-Konfiguration funktioniert korrekt.</p></div>',
      });
      res.json(result);
    },
  );

  // Offen, solange der Verwalter sie nicht abgeschlossen hat UND noch etwas
  // fehlt — eine eingerichtete Installation sieht den Assistenten nie.
  router.get(
    '/settings/einrichtung',
    requireAdmin,
    async (req: Anfrage<'GET /api/v1/settings/einrichtung'>, res: Antwort<'GET /api/v1/settings/einrichtung'>) => {
      const wert = async (k: string) => !!(await d.einstellungen.getGlobalSetting(k));
      const passwort = await d.konto.passwortWechselFaellig(req.apiUser.user_id);
      const quellen = {
        rebrickable: await wert('rebrickable_api_key'),
        brickset: await wert('brickset_api_key'),
        bricklink: (
          await Promise.all(
            ['bricklink_consumer_key', 'bricklink_consumer_secret', 'bricklink_token', 'bricklink_token_secret'].map(
              wert,
            ),
          )
        ).every(Boolean),
      };
      const erledigt = await wert('einrichtung_erledigt');
      res.json({
        success: true,
        offen: !erledigt && (passwort || !quellen.rebrickable),
        passwort_aendern: passwort,
        quellen,
      });
    },
  );

  router.post(
    '/settings/einrichtung/fertig',
    requireAdmin,
    async (_req: AuthedRequest, res: Antwort<'POST /api/v1/settings/einrichtung/fertig'>) => {
      await d.einstellungen.setGlobalSetting('einrichtung_erledigt', '1');
      res.json({ success: true });
    },
  );

  // Prüft den GESPEICHERTEN Zugang mit einem kleinen Abruf.
  router.post(
    '/settings/quelle-testen',
    requireAdmin,
    async (
      req: Anfrage<'POST /api/v1/settings/quelle-testen'>,
      res: Antwort<'POST /api/v1/settings/quelle-testen'>,
    ) => {
      const absage = await quellePruefen(String(req.eingabe.quelle ?? ''));
      if (!absage) return res.json({ success: true });
      res.status(400).json({
        success: false,
        code: absage.code,
        details: absage.grund,
        error: fehlerText(absage.code, antwortSprache(req), { quelle: absage.quelle, grund: absage.grund }),
      });
    },
  );

  // Leer heisst „Vorgabe des Verwalters".
  router.post(
    '/settings/user/theme',
    requireToken,
    async (req: Anfrage<'POST /api/v1/settings/user/theme'>, res: Antwort<'POST /api/v1/settings/user/theme'>) => {
      const uid = req.apiUser.user_id;
      await d.konto.setzeEigenesDesign(uid, req.eingabe.theme);
      res.json({ success: true, ...(await d.einstellungen.designFuer(uid)) });
    },
  );

  router.post(
    '/settings/admin/theme',
    requireAdmin,
    async (req: Anfrage<'POST /api/v1/settings/admin/theme'>, res: Antwort<'POST /api/v1/settings/admin/theme'>) => {
      const theme = req.eingabe.theme;
      await d.einstellungen.setGlobalSetting('app_theme', theme);
      // Das Design steckt im serverseitig gerenderten <html data-theme>; ohne
      // Verwerfen käme bis zum Neustart das alte.
      invalidateTheme();
      res.json({ success: true, theme });
    },
  );

  router.use(fehlerAntwort);
  return router;
}
