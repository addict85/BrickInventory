/** Globale Einstellungen, Ein- und Ausfuhr, Einrichtung, Quellen- und SMTP-Test; in settings.ts hinter requireLogin. */
import multer from 'multer';
import { FORMULAR_GRENZEN } from '../../src/http/dateiEmpfang';
import { fehlerAntwort, sendeFehler } from '../../src/http/httpAntwort';
import { kontoSchranke, waechterFuer } from './middleware';
import { hatGlobaleWerte } from '../../src/verwaltung';
import { istVerwalter, nutzerName, bestaetigeMitFaktor } from '../../src/konto/http/anmeldung';
import { freigegeben, alsVerwalter } from '../../src/konto/http/schrittschutz';
import { fehlerText, antwortSprache } from '../../src/infra/fehlerTexte';
import { emailGueltig } from '../../src/infra/validate';
import { vertragsRouter, type Anfrage, type Antwort } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';

export function baueSettingsGlobalRouter(d: Pick<Dienste, 'einstellungen' | 'mail' | 'konto' | 'verwaltung'>) {
  const { requireApiAdmin: requireAdmin, requireToken } = waechterFuer(d.konto);
  const router = vertragsRouter();

  router.post(
    '/settings',
    requireToken,
    async (req: Anfrage<'POST /api/v1/settings'>, res: Antwort<'POST /api/v1/settings'>) => {
      const uid = req.apiUser.user_id;
      // Globale Werte eines Verwalters gehen wie jede Verwalter-Route über den Schrittschutz.
      const verwalter = istVerwalter(req) && hatGlobaleWerte(req.eingabe);
      if (verwalter && !(await freigegeben(d.konto, req, res, 'verwaltung'))) return;
      const fertig = await d.verwaltung.einstellungenSpeichern(req.eingabe, {
        uid,
        verwalter,
        name: nutzerName(req) ?? '',
        bestaetige: passwort => bestaetigeMitFaktor(d.konto, req, res, uid, passwort),
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
        settings: await d.einstellungen.readSettings(req.apiUser.user_id, await alsVerwalter(d.konto, req)),
      });
    },
  );

  router.get(
    '/settings/export',
    requireToken,
    async (req: Anfrage<'GET /api/v1/settings/export'>, res: Antwort<'GET /api/v1/settings/export'>) => {
      const verwalter = await alsVerwalter(d.konto, req);
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
      if (verwalter && !(await freigegeben(d.konto, req, res, 'verwaltung'))) return;
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
        !(await bestaetigeMitFaktor(d.konto, req, res, uid, req.eingabe.password))
      )
        return;

      const result = await d.mail.sendeSmtpTest(to);
      if ('code' in result) return sendeFehler(req, res, 400, result.code, 'vars' in result ? result.vars : undefined);
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
      const absage = await d.verwaltung.quellePruefen(String(req.eingabe.quelle ?? ''));
      if (!absage) return res.json({ success: true });
      res.status(400).json({
        success: false,
        code: absage.code,
        details: absage.grund,
        error: fehlerText(absage.code, antwortSprache(req), { quelle: absage.quelle, grund: absage.grund }),
      });
    },
  );

  router.post(
    '/settings/admin/theme',
    requireAdmin,
    async (req: Anfrage<'POST /api/v1/settings/admin/theme'>, res: Antwort<'POST /api/v1/settings/admin/theme'>) => {
      const theme = req.eingabe.theme;
      await d.konto.setzeGlobalesDesign(theme);
      res.json({ success: true, theme });
    },
  );

  router.use(fehlerAntwort);
  return router;
}
