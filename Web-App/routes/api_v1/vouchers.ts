// Für beide Apps: Cookie und Token. Die Arbeit liegt in src/gutscheine/dienst.ts.
import type express from 'express';
import multer from 'multer';
import { FORMULAR_GRENZEN, gesamtReichtFuer, uploadGesamtMb } from '../../src/http/dateiEmpfang';
import { FREMDE_DATEI_CSP } from '../../src/http/dateiAusliefern';
import { Fachfehler, dateiFehler, type FehlerCode, fachfehler } from '../../src/infra/fehlerTexte';
import { ABSTAND_SEK, TICKET_SEK, alsGelesen, maskiert, type GutscheinZeile } from '../../src/gutscheine';
import { kontoSchranke, waechterFuer } from './middleware';
import { bestaetigeMitFaktor } from '../../src/konto/http/anmeldung';
import { seiteAus } from '../../src/infra/seite';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';

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

/** `wartenSek` geht mit, danach taktet sich die Oberfläche. */
function gesperrt(grund: string, wartenSek: number): never {
  const min = Math.ceil(wartenSek / 60);
  const [code, vars]: [FehlerCode, Record<string, number>] =
    grund === 'konto'
      ? ['zu_viele_anfragen', { minuten: min }]
      : grund === 'botschutz'
        ? ['guthaben_botschutz', { min }]
        : ['guthaben_abstand', { sek: ABSTAND_SEK, warten: wartenSek }];
  throw new Fachfehler('zu_viele', code, vars, { grund, wartenSek });
}

export function baueVouchersRouter(d: Pick<Dienste, 'konto' | 'gutscheine'>) {
  const { requireToken } = waechterFuer(d.konto);
  const router = vertragsRouter('/api/v1');

  /** Nur PDF: Ausgelesen wird nur Text, ein Foto könnte der Server nicht lesen. */
  const upload = multer({
    storage: multer.memoryStorage(),
    // 2 MB lassen Platz für ein Sammel-PDF; mehr hielte nur pdf-lib länger im Speicher.
    limits: { ...FORMULAR_GRENZEN, fileSize: 2 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      // Wörtlicher Vergleich: kein geerbter Tabellenwert, an dem man vorbeiliefe.
      if (file.mimetype === 'application/pdf') cb(null, true);
      else cb(dateiFehler('falscher_typ', 'nur_pdf'));
    },
  });

  router.endpunkt('GET /api/v1/vouchers', requireToken, async req => {
    const { eintraege, ...seite } = seiteAus(await d.gutscheine.gutscheinListe(req.apiUser.user_id), req.abfrage);
    return { vouchers: eintraege.map(fuerAussen), ...seite };
  });

  router.endpunkt('POST /api/v1/vouchers', requireToken, async req => {
    return { voucher: fuerAussen(await d.gutscheine.gutscheinErfassen(req.apiUser.user_id, req.eingabe)) };
  });

  router.endpunkt(
    'POST /api/v1/vouchers/pdf',
    requireToken,
    kontoSchranke('gutscheinPdf'),
    async (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      if (!(await gesamtReichtFuer(Number(req.headers['content-length']) || 0)))
        fachfehler('speicher_voll', 'upload_gesamt_voll', { mb: uploadGesamtMb() });
      next();
    },
    upload.single('file'),
    async req => {
      if (!req.file) fachfehler('ungueltig', 'keine_datei');
      const r = await d.gutscheine.gutscheinAusPdf(req.apiUser.user_id, req.file.buffer, req.eingabe);
      // Eigener Block, damit die Oberfläche an einem Feld erkennt, welcher Fall eintrat.
      if (r.art === 'stapel') return { mehrere: r.bericht };
      return { voucher: fuerAussen(r.zeile), gelesen: alsGelesen(r.gelesen) };
    },
  );

  // Die Sammelwege VOR den :id-Wegen: Sonst fängt `:id` das Wort „export".

  router.endpunkt('POST /api/v1/vouchers/export/pdf-freigabe', requireToken, async (req, res) => {
    if (!(await bestaetigeMitFaktor(d.konto, req, res, req.apiUser.user_id, req.eingabe.password))) return;
    return { ticket: await d.gutscheine.gibExportFrei(req.apiUser.user_id), gueltig_sek: TICKET_SEK };
  });

  router.endpunkt('GET /api/v1/vouchers/export/pdf', requireToken, async (req, res) => {
    const uid = req.apiUser.user_id;
    if (!d.gutscheine.loeseTicketEin(req.abfrage.ticket, uid, 'export')) fachfehler('verboten', 'pdf_freigabe_noetig');
    const { daten, befunde } = await d.gutscheine.gutscheineExportieren(uid);
    const tag = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="brickinventory-gutscheine-${tag}.pdf"`);
    // base64: Ein Umlaut im Grund zerlegte sonst die Kopfzeile.
    res.setHeader('X-Gutschein-Befunde', Buffer.from(JSON.stringify(befunde), 'utf-8').toString('base64'));
    res.setHeader('Access-Control-Expose-Headers', 'X-Gutschein-Befunde');
    res.end(daten);
  });

  router.endpunkt('PUT /api/v1/vouchers/:id', requireToken, async req => {
    const id = req.pfad.id;
    return { voucher: fuerAussen(await d.gutscheine.gutscheinBearbeiten(req.apiUser.user_id, id, req.eingabe)) };
  });

  // Endgültig und Bargeld: mit Bestätigung wie das Leeren des Papierkorbs.
  router.endpunkt('DELETE /api/v1/vouchers/:id', requireToken, async (req, res) => {
    const id = req.pfad.id;
    if (!(await bestaetigeMitFaktor(d.konto, req, res, req.apiUser.user_id, req.eingabe.password))) return;
    await d.gutscheine.gutscheinEntfernen(req.apiUser.user_id, id);
    return {};
  });

  router.endpunkt('POST /api/v1/vouchers/:id/klartext', requireToken, async (req, res) => {
    const id = req.pfad.id;
    if (!(await bestaetigeMitFaktor(d.konto, req, res, req.apiUser.user_id, req.eingabe.password))) return;
    const z = await d.gutscheine.gutscheinKlartext(req.apiUser.user_id, id);
    return { id: z.id, number: z.number, pin: z.pin };
  });

  router.endpunkt('POST /api/v1/vouchers/:id/pdf-freigabe', requireToken, async (req, res) => {
    const id = req.pfad.id;
    if (!(await bestaetigeMitFaktor(d.konto, req, res, req.apiUser.user_id, req.eingabe.password))) return;
    return { ticket: await d.gutscheine.pdfFreigeben(req.apiUser.user_id, id), gueltig_sek: TICKET_SEK };
  });

  router.endpunkt('GET /api/v1/vouchers/:id/pdf', requireToken, async (req, res) => {
    const id = req.pfad.id;
    if (!d.gutscheine.loeseTicketEin(req.abfrage.ticket, req.apiUser.user_id, String(id)))
      fachfehler('verboten', 'pdf_freigabe_noetig');
    const pdf = await d.gutscheine.gutscheinPdf(req.apiUser.user_id, id);
    res.type('application/pdf');
    // Ohne Kartennummer: Dateinamen landen in Download-Listen und Protokollen.
    const art = (req.abfrage.download ?? false) ? 'attachment' : 'inline';
    res.setHeader('Content-Disposition', `${art}; filename="gutschein-${id}.pdf"`);
    // Ein Gutschein gehört in keinen geteilten Zwischenspeicher.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Security-Policy', FREMDE_DATEI_CSP);
    res.end(pdf);
  });

  // Keine Sammelroute: höchstens ein Abruf je 30 s über ALLE Benutzer, das verbärge sie.
  router.endpunkt('POST /api/v1/vouchers/:id/guthaben', requireToken, async req => {
    const id = req.pfad.id;
    const r = await d.gutscheine.guthabenAbfragen(req.apiUser.user_id, id);
    if (r.art === 'gesperrt') gesperrt(r.grund, r.wartenSek);
    return {
      voucher: fuerAussen(r.zeile),
      angezeigt: r.angezeigt,
      // Eine still geänderte Währung wäre eine geänderte Summe ohne Hinweis.
      waehrung_geaendert: r.waehrungGeaendert,
    };
  });
  return router;
}
