// Für beide Apps: Cookie und Token. Die Arbeit liegt in src/gutscheine/dienst.ts.
import type express from 'express';
import multer from 'multer';
import { FORMULAR_GRENZEN } from '../../src/http/dateiEmpfang';
import { FREMDE_DATEI_CSP } from '../../src/http/dateiAusliefern';
import { fehlerAntwort, sendeFehler } from '../../src/http/httpAntwort';
import { fehlerText, antwortSprache, dateiFehler, type FehlerCode } from '../../src/infra/fehlerTexte';
import {
  ABSTAND_SEK,
  TICKET_SEK,
  loeseTicketEin,
  maskiert,
  type GutscheinWerte,
  type GutscheinZeile,
} from '../../src/gutscheine';
import { kontoSchranke, waechterFuer } from './middleware';
import { bestaetigeMitFaktor } from '../../src/konto/http/anmeldung';
import { seiteAus } from '../../src/infra/seite';
import { vertragsRouter, type Anfrage, type Antwort } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../startup/verdrahtung';

// Betrag einmal als Zahl; `hat_pdf` statt des Pfads, der niemanden etwas angeht.
function fuerAussen(z: GutscheinZeile) {
  return {
    id: z.id,
    ...maskiert(z),
    amount: Number(z.amount),
    currency: z.currency,
    hat_pdf: !!z.pdf_path,
    created_at: z.created_at,
    updated_at: z.updated_at,
    // Auch NULL geht mit: Ein nie abgefragtes Guthaben soll sich von einem abgefragten unterscheiden.
    guthaben_geprueft_am: z.guthaben_geprueft_am,
  };
}

const alsGelesen = (g: GutscheinWerte) => ({
  number: g.nummer,
  pin: g.pin,
  currency: g.waehrung,
  ...(g.betrag == null ? {} : { amount: g.betrag }),
});

/** Die ID aus dem Pfad; eine Absage, wenn sie keine ganze Zahl ist. */
function idOderAbsage(req: express.Request & { pfad: { id: number } }, res: express.Response): number | null {
  if (Number.isInteger(req.pfad.id)) return req.pfad.id;
  sendeFehler(req, res, 400, 'id_ungueltig');
  return null;
}

/** Eigenes json(): `wartenSek` muss mit, danach taktet sich die Oberfläche. */
function gesperrtAntwort(req: express.Request, res: express.Response, grund: string, wartenSek: number) {
  const min = Math.ceil(wartenSek / 60);
  const [code, vars]: [FehlerCode, Record<string, number>] =
    grund === 'konto'
      ? ['zu_viele_anfragen', { minuten: min }]
      : grund === 'botschutz'
        ? ['guthaben_botschutz', { min }]
        : ['guthaben_abstand', { sek: ABSTAND_SEK, warten: wartenSek }];
  res.status(429).json({ success: false, code, error: fehlerText(code, antwortSprache(req), vars), grund, wartenSek });
}

export function baueVouchersRouter(d: Dienste) {
  const { requireToken } = waechterFuer(d.konto);
  const router = vertragsRouter();

  /** Nur PDF: Ausgelesen wird nur Text, ein Foto könnte der Server nicht lesen. */
  const upload = multer({
    storage: multer.memoryStorage(),
    // 2 MB lassen Platz für ein Sammel-PDF; mehr hielte nur pdf-lib länger im Speicher.
    limits: { ...FORMULAR_GRENZEN, fileSize: 2 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      // Wörtlicher Vergleich: Bei einem erlaubten Typ gibt es keinen geerbten
      // Tabellenwert, an dem man vorbeilaufen könnte.
      if (file.mimetype === 'application/pdf') cb(null, true);
      else cb(dateiFehler('falscher_typ', 'nur_pdf'));
    },
  });

  router.get(
    '/vouchers',
    requireToken,
    async (req: Anfrage<'GET /api/v1/vouchers'>, res: Antwort<'GET /api/v1/vouchers'>) => {
      const { eintraege, ...seite } = seiteAus(await d.gutscheine.gutscheinListe(req.apiUser.user_id), req.abfrage);
      res.json({ success: true, vouchers: eintraege.map(fuerAussen), ...seite });
    },
  );

  router.post(
    '/vouchers',
    requireToken,
    async (req: Anfrage<'POST /api/v1/vouchers'>, res: Antwort<'POST /api/v1/vouchers'>) => {
      res.json({
        success: true,
        voucher: fuerAussen(await d.gutscheine.gutscheinErfassen(req.apiUser.user_id, req.eingabe || {})),
      });
    },
  );

  router.post(
    '/vouchers/pdf',
    requireToken,
    kontoSchranke('gutscheinPdf'),
    upload.single('file'),
    async (req: Anfrage<'POST /api/v1/vouchers/pdf'>, res: Antwort<'POST /api/v1/vouchers/pdf'>) => {
      if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
      const r = await d.gutscheine.gutscheinAusPdf(req.apiUser.user_id, req.file.buffer, req.eingabe);
      // Eigener Block, damit die Oberfläche an einem Feld erkennt, welcher Fall eintrat.
      if (r.art === 'stapel') return res.json({ success: true, mehrere: r.bericht });
      if (r.art === 'abgelehnt') return sendeFehler(req, res, 422, r.code, r.vars);
      // 422: Die Anfrage war in Ordnung, nur das PDF gab nicht alles her; `gelesen` belegt die Felder vor.
      if (r.art === 'unvollstaendig')
        return res.status(422).json({
          success: false,
          code: r.code,
          error: fehlerText(r.code, antwortSprache(req)),
          gelesen: alsGelesen(r.gelesen),
        });
      res.json({ success: true, voucher: fuerAussen(r.zeile), gelesen: alsGelesen(r.gelesen) });
    },
  );

  // Die Sammelwege VOR den :id-Wegen: Sonst fängt `:id` das Wort „export".

  router.post(
    '/vouchers/export/pdf-freigabe',
    requireToken,
    async (
      req: Anfrage<'POST /api/v1/vouchers/export/pdf-freigabe'>,
      res: Antwort<'POST /api/v1/vouchers/export/pdf-freigabe'>,
    ) => {
      if (!(await bestaetigeMitFaktor(d.konto, req, res, req.apiUser.user_id, req.eingabe.password))) return;
      res.json({
        success: true,
        ticket: await d.gutscheine.exportFreigeben(req.apiUser.user_id),
        gueltig_sek: TICKET_SEK,
      });
    },
  );

  router.get(
    '/vouchers/export/pdf',
    requireToken,
    async (req: Anfrage<'GET /api/v1/vouchers/export/pdf'>, res: express.Response) => {
      const uid = req.apiUser.user_id;
      if (!loeseTicketEin(req.abfrage.ticket, uid, 'export')) return sendeFehler(req, res, 403, 'pdf_freigabe_noetig');
      const { daten, befunde } = await d.gutscheine.gutscheineExportieren(uid);
      const tag = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="brickinventory-gutscheine-${tag}.pdf"`);
      // base64: Ein Umlaut im Grund zerlegte sonst die Kopfzeile.
      res.setHeader('X-Gutschein-Befunde', Buffer.from(JSON.stringify(befunde), 'utf-8').toString('base64'));
      res.setHeader('Access-Control-Expose-Headers', 'X-Gutschein-Befunde');
      res.end(daten);
    },
  );

  router.put(
    '/vouchers/:id',
    requireToken,
    async (req: Anfrage<'PUT /api/v1/vouchers/:id'>, res: Antwort<'PUT /api/v1/vouchers/:id'>) => {
      const id = idOderAbsage(req, res);
      if (id === null) return;
      res.json({
        success: true,
        voucher: fuerAussen(await d.gutscheine.gutscheinBearbeiten(req.apiUser.user_id, id, req.eingabe)),
      });
    },
  );

  // Endgültig und Bargeld: mit Bestätigung wie das Leeren des Papierkorbs.
  router.delete(
    '/vouchers/:id',
    requireToken,
    async (req: Anfrage<'DELETE /api/v1/vouchers/:id'>, res: Antwort<'DELETE /api/v1/vouchers/:id'>) => {
      const id = idOderAbsage(req, res);
      if (id === null || !(await bestaetigeMitFaktor(d.konto, req, res, req.apiUser.user_id, req.eingabe.password)))
        return;
      await d.gutscheine.gutscheinEntfernen(req.apiUser.user_id, id);
      res.json({ success: true });
    },
  );

  router.post(
    '/vouchers/:id/klartext',
    requireToken,
    async (req: Anfrage<'POST /api/v1/vouchers/:id/klartext'>, res: Antwort<'POST /api/v1/vouchers/:id/klartext'>) => {
      const id = idOderAbsage(req, res);
      if (id === null || !(await bestaetigeMitFaktor(d.konto, req, res, req.apiUser.user_id, req.eingabe.password)))
        return;
      const z = await d.gutscheine.gutscheinKlartext(req.apiUser.user_id, id);
      res.json({ success: true, id: z.id, number: z.number, pin: z.pin });
    },
  );

  router.post(
    '/vouchers/:id/pdf-freigabe',
    requireToken,
    async (
      req: Anfrage<'POST /api/v1/vouchers/:id/pdf-freigabe'>,
      res: Antwort<'POST /api/v1/vouchers/:id/pdf-freigabe'>,
    ) => {
      const id = idOderAbsage(req, res);
      if (id === null || !(await bestaetigeMitFaktor(d.konto, req, res, req.apiUser.user_id, req.eingabe.password)))
        return;
      res.json({
        success: true,
        ticket: await d.gutscheine.pdfFreigeben(req.apiUser.user_id, id),
        gueltig_sek: TICKET_SEK,
      });
    },
  );

  router.get(
    '/vouchers/:id/pdf',
    requireToken,
    async (req: Anfrage<'GET /api/v1/vouchers/:id/pdf'>, res: express.Response) => {
      const id = idOderAbsage(req, res);
      if (id === null) return;
      if (!loeseTicketEin(req.abfrage.ticket, req.apiUser.user_id, String(id)))
        return sendeFehler(req, res, 403, 'pdf_freigabe_noetig');
      const pdf = await d.gutscheine.gutscheinPdf(req.apiUser.user_id, id);
      res.type('application/pdf');
      // Ohne Kartennummer: Dateinamen landen in Download-Listen und Protokollen.
      const art = (req.abfrage.download ?? false) ? 'attachment' : 'inline';
      res.setHeader('Content-Disposition', `${art}; filename="gutschein-${id}.pdf"`);
      // Ein Gutschein gehört in keinen geteilten Zwischenspeicher.
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Security-Policy', FREMDE_DATEI_CSP);
      res.end(pdf);
    },
  );

  // Keine Sammelroute: höchstens ein Abruf je 30 Sekunden über ALLE Benutzer,
  // eine Sammelroute müsste diese Wartezeit verstecken.
  router.post(
    '/vouchers/:id/guthaben',
    requireToken,
    async (req: Anfrage<'POST /api/v1/vouchers/:id/guthaben'>, res: Antwort<'POST /api/v1/vouchers/:id/guthaben'>) => {
      const id = idOderAbsage(req, res);
      if (id === null) return;
      const r = await d.gutscheine.guthabenAbfragen(req.apiUser.user_id, id);
      if (r.art === 'gesperrt') return gesperrtAntwort(req, res, r.grund, r.wartenSek);
      res.json({
        success: true,
        voucher: fuerAussen(r.zeile),
        angezeigt: r.angezeigt,
        // Eine still geänderte Währung wäre eine geänderte Summe ohne Hinweis.
        waehrung_geaendert: r.waehrungGeaendert,
      });
    },
  );

  router.use(fehlerAntwort);
  return router;
}
