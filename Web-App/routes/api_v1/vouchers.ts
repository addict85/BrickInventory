// Ausführlich: docs/begruendungen/routes/api_v1/vouchers.ts.md#abschnitt
import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { FORMULAR_GRENZEN } from '../../src/infra/dateiEmpfang';
import { fehlerAntwort, ohneFehlendeDatei } from '../../src/infra/httpError';
import { sendeFehler, fehlerText, antwortSprache, dateiFehler, type FehlerCode, alsDoppelt } from '../../src/infra/fehlerTexte';
import { getGlobalSetting } from '../../src/konto/settings';
import { landErlaubt, LAND_STANDARD } from '../../src/gutscheine/gutscheinGuthaben';
import { frageGuthabenAb, ABSTAND_SEK } from '../../src/gutscheine/gutscheinGuthabenSchranke';
import { VOUCHER_DIR, gutscheinDatei, schreibeGutscheinPdf, liesGutscheinPdf, liesGutscheinPdfOderNichts } from '../../src/gutscheine/gutscheinDateien';
import { requireToken } from './middleware';
import { bestaetigeMitFaktor } from '../../src/konto/http/anmeldung';
import { protokolliere } from '../../src/verwaltung/dienst';
import { stelleTicketAus, loeseTicketEin, TICKET_SEK } from '../../src/gutscheine/pdfTicket';
import { werteAusPdf, PdfZuGross } from '../../src/gutscheine/gutscheinPdf';
import { verbindeGutscheine, seitenweiseLesen, seitenOderKeine } from '../../src/gutscheine/gutscheinPdfSchreiben';
import type { ExportGutschein } from '../../src/gutscheine/gutscheinPdfSchreiben';

import { gutscheineDesKontos, gutschein, gutscheinAnlegen, gutscheinErsetzen, gutscheinAendern,
         gutscheinPdfMerken, gutscheinLoeschen, guthabenMerken } from '../../src/gutscheine/dienst';
import type { GutscheinZeile } from '../../src/gutscheine/dienst';
import { vertragsRouter } from '../../src/infra/vertrag/pruefen';
import type { Antwort } from '../../src/infra/vertrag';

const router = vertragsRouter();
type AuthedRequest = express.Request & { apiUser: { user_id: number } };

/** Nur PDF: Ausgelesen wird nur Text, ein Foto könnte der Server nicht lesen. */
const upload = multer({
  storage: multer.memoryStorage(),
  // 2 MB lassen Platz für ein Sammel-PDF; mehr hielte nur pdf-lib länger im Speicher.
  limits: { ...FORMULAR_GRENZEN, fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // Wörtlicher Vergleich: Bei einem erlaubten Typ gibt es keinen geerbten
    // Tabellenwert, an dem man vorbeilaufen könnte.
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(dateiFehler('nur_pdf', 415));
  },
});

/** Nach aussen nur das Ende: Ein erbeutetes App-Token soll nicht alle Codes samt PIN
 * abgreifen. Den Klartext gibt POST /vouchers/:id/klartext, bestätigt und protokolliert. */
const PIN_MASKE = '•••';
const maskiert = (z: { number: string; pin: string | null }) =>
  ({ number: '…' + z.number.slice(-4), pin: z.pin ? PIN_MASKE : null });

// Ausführlich: docs/begruendungen/routes/api_v1/vouchers.ts.md#fueraussen
function fuerAussen(z: GutscheinZeile) {
  return {
    id: z.id,
    ...maskiert(z),
    amount: Number(z.amount),
    currency: z.currency,
    hat_pdf: !!z.pdf_path,
    created_at: z.created_at,
    updated_at: z.updated_at,
    // Auch NULL geht mit: Ein nie abgefragtes Guthaben soll sich von einem
    // abgefragten unterscheiden.
    guthaben_geprueft_am: z.guthaben_geprueft_am,
  };
}

/** Eine Funktion für Anlegen, Anlegen aus dem PDF und Ändern. */
function pruefeWerte(roh: { number?: unknown; pin?: unknown; amount?: unknown; currency?: unknown },
                     opt: { nullBetragErlaubt?: boolean } = {}):
  { ok: true; number: string; pin: string | null; amount: number; currency: string | null } | { ok: false; code: FehlerCode } {
  const number = String(roh.number ?? '').replace(/[\s-]/g, '');
  if (!/^\d{4,25}$/.test(number)) return { ok: false, code: 'nummer_ungueltig' };

  const pinRoh = String(roh.pin ?? '').trim();
  if (pinRoh && !/^\d{3,10}$/.test(pinRoh)) return { ok: false, code: 'pin_ungueltig' };

  const amount = Number(roh.amount);
  // Auch die Null fällt durch: Number('') ist 0, und ein vergessenes Feld legte
  // sonst einen Gutschein über nichts an.
  if (!Number.isFinite(amount) || amount > 1_000_000) return { ok: false, code: 'betrag_ungueltig' };
  if (opt.nullBetragErlaubt ? amount < 0 : amount <= 0) return { ok: false, code: 'betrag_ungueltig' };

  // Ohne Angabe setzt die Datenbank die Währung des Kontos (Migration 0073).
  const currency = roh.currency == null || roh.currency === '' ? null : String(roh.currency).toUpperCase();
  if (currency !== null && !/^[A-Z]{3}$/.test(currency)) return { ok: false, code: 'waehrung_ungueltig' };

  return { ok: true, number, pin: pinRoh || null, amount, currency };
}

router.get('/vouchers', requireToken, async (req: AuthedRequest, res: Antwort<'GET /api/v1/vouchers'>) => {
  res.json({ success: true, vouchers: (await gutscheineDesKontos(req.apiUser.user_id)).map(fuerAussen) });
});

router.post('/vouchers', requireToken, async (req: AuthedRequest, res: Antwort<'POST /api/v1/vouchers'>) => {
  const w = pruefeWerte(req.body || {});
  if (!w.ok) return sendeFehler(req, res, 400, w.code);
  // Keine Zeile heisst „war schon da" — als Erfolg sähe der Nutzer nichts passieren.
  const zeile = await gutscheinAnlegen(req.apiUser.user_id, w);
  if (!zeile) return sendeFehler(req, res, 409, 'gutschein_existiert');
  res.json({ success: true, voucher: fuerAussen(zeile) });
});

/** Der Stapelfall von POST /vouchers/pdf.
 * Ausführlich: docs/begruendungen/routes/api_v1/vouchers.ts.md#stapelanlegen */
async function stapelAnlegen(
  req: AuthedRequest, res: express.Response,
  gefunden: Awaited<ReturnType<typeof seitenweiseLesen>>,
) {
  const uid = req.apiUser.user_id;
  let added = 0, updated = 0, errors = 0;
  const results: { number: string; action: string; error?: string }[] = [];

  for (const w of gefunden) {
    const geprueft = pruefeWerte({
      number: w.nummer, pin: w.pin, amount: w.betrag, currency: w.waehrung,
    });
    if (!geprueft.ok) {
      errors++;
      results.push({ number: String(w.nummer ?? ''), action: 'error', error: geprueft.code });
      continue;
    }
    const warNeu = await gutscheinErsetzen(uid, geprueft);
    if (warNeu) added++; else updated++;
    results.push({ number: geprueft.number, action: warNeu ? 'added' : 'updated' });
  }

  // Eigener Block, damit die Oberfläche an einem Feld erkennt, welcher Fall eintrat.
  return res.json({ success: true, mehrere: { added, updated, errors,
                                              total: gefunden.length, results } });
}

// EIN Weg für beide Apps: Mitgeschickte Felder gewinnen gegen das Ausgelesene.
// Ausführlich: docs/begruendungen/routes/api_v1/vouchers.ts.md#post-vouchers-pdf
router.post('/vouchers/pdf', requireToken, upload.single('file'), async (req: AuthedRequest, res: Antwort<'POST /api/v1/vouchers/pdf'>) => {
  if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');

  // Erst ab ZWEI Seiten ein Stapel; bei einem bleibt der 422-Vertrag der Formulare.
  const seiten = await seitenOderKeine(req.file.buffer);
  if (seiten.length >= 2) return stapelAnlegen(req, res, seiten);

  // Der Medientyp ist eine Behauptung des Klienten; geprüft wird die Signatur.
  const istPdf = req.file.buffer.subarray(0, 5).toString('latin1') === '%PDF-';
  // Auch mit getippten Werten nicht: Die Datei wird später als application/pdf
  // ausgeliefert.
  if (!istPdf) return sendeFehler(req, res, 422, 'pdf_unlesbar');

  let gelesen: ReturnType<typeof werteAusPdf>;
  let lesefehler = !istPdf;
  try { gelesen = werteAusPdf(req.file.buffer); }
  catch (e) {
    // Eine Entpackbombe wird nicht abgelegt: Der Export gäbe sie an pdf-lib, das
    // ohne Grenze entpackt.
    if (e instanceof PdfZuGross) return sendeFehler(req, res, 422, 'pdf_unlesbar');
    lesefehler = true; gelesen = { nummer: null, pin: null, betrag: null, waehrung: null };
  }

  const zusammen = {
    number:   req.body?.number   ?? gelesen.nummer,
    pin:      req.body?.pin      ?? gelesen.pin,
    amount:   req.body?.amount   ?? gelesen.betrag,
    currency: req.body?.currency ?? gelesen.waehrung,
  };
  const w = pruefeWerte(zusammen);
  if (!w.ok) {
    // Drei Absagen, weil der Nutzer bei jeder etwas anderes tun muss.
    const nichtsGetippt = !req.body?.number && !req.body?.pin && !req.body?.amount;
    const nichtsGelesen = gelesen.nummer == null && gelesen.betrag == null;
    const code: FehlerCode =
      lesefehler ? 'pdf_unlesbar'
      : (nichtsGelesen && nichtsGetippt) ? 'kein_gutschein_im_pdf'
      : w.code;
    // 422: Die Anfrage war in Ordnung, nur das PDF gab nicht alles her. `gelesen`
    // belegt die Felder vor, die da waren.
    return res.status(422).json({
      success: false, code, error: fehlerText(code, antwortSprache(req)),
      gelesen: { number: gelesen.nummer, pin: gelesen.pin, amount: gelesen.betrag, currency: gelesen.waehrung },
    });
  }

  const z = await gutscheinAnlegen(req.apiUser.user_id, w);
  if (!z) return sendeFehler(req, res, 409, 'gutschein_existiert');

  const dir = path.join(VOUCHER_DIR, String(req.apiUser.user_id));
  // Dateiname aus der id, NICHT aus dem Upload: Ein Name vom Klienten müsste
  // gegen Pfadanteile geprüft werden.
  const datei = `${z.id}.pdf`;
  await schreibeGutscheinPdf(path.join(dir, datei), req.file.buffer);
  const relPfad = `${req.apiUser.user_id}/${datei}`;
  await gutscheinPdfMerken(req.apiUser.user_id, z.id, relPfad);

  res.json({
    success: true,
    voucher: fuerAussen({ ...z, pdf_path: relPfad }),
    // Damit die Oberfläche sagen kann, welche Werte gelesen wurden.
    gelesen: { number: gelesen.nummer, pin: gelesen.pin, amount: gelesen.betrag, currency: gelesen.waehrung },
  });
});

// Die Sammelwege VOR den :id-Wegen: Sonst fängt `:id` das Wort „export".

// Die PDFs tragen Nummer und PIN: erst bestätigen und protokollieren, dann ein Ticket für genau einen Abruf.
async function pdfFreigabe(req: AuthedRequest, res: express.Response, ziel: string, aktion: 'gutschein_pdf' | 'gutschein_export', was: string) {
  await protokolliere(req.apiUser.user_id, req.apiUser.user_id, aktion, was);
  res.json({ success: true, ticket: stelleTicketAus(req.apiUser.user_id, ziel), gueltig_sek: TICKET_SEK });
}

router.post('/vouchers/export/pdf-freigabe', requireToken, async (req: AuthedRequest, res: Antwort<'POST /api/v1/vouchers/export/pdf-freigabe'>) => {
  if (!await bestaetigeMitFaktor(req, res, req.apiUser.user_id, req.body?.password)) return;
  const zeilen = await gutscheineDesKontos(req.apiUser.user_id, 'aelteste');
  if (!zeilen.length) return sendeFehler(req, res, 404, 'keine_gutscheine');
  await pdfFreigabe(req, res, 'export', 'gutschein_export', `${zeilen.length}`);
});

router.get('/vouchers/export/pdf', requireToken, async (req: AuthedRequest, res) => {
  const uid = req.apiUser.user_id;
  if (!loeseTicketEin(req.query.ticket, uid, 'export')) return sendeFehler(req, res, 403, 'pdf_freigabe_noetig');
  const zeilen = await gutscheineDesKontos(uid, 'aelteste');
  if (!zeilen.length) return sendeFehler(req, res, 404, 'keine_gutscheine');

  const gutscheine: ExportGutschein[] = [];
  for (const z of zeilen) {
    let pdf: Buffer | null = null;
    if (z.pdf_path) {
      // Eine fehlende Datei bricht den Export nicht ab, sonst nähme sie dem Nutzer
      // auch alle anderen Gutscheine.
      pdf = await liesGutscheinPdfOderNichts(gutscheinDatei(uid, z.pdf_path));
    }
    gutscheine.push({ id: z.id, number: z.number, pin: z.pin,
                      amount: Number(z.amount), currency: z.currency, pdf });
  }

  const { daten, befunde } = await verbindeGutscheine(gutscheine);
  const tag = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition',
    `attachment; filename="brickinventory-gutscheine-${tag}.pdf"`);
  // base64: Ein Umlaut im Grund zerlegte sonst die Kopfzeile.
  res.setHeader('X-Gutschein-Befunde',
    Buffer.from(JSON.stringify(befunde), 'utf-8').toString('base64'));
  res.setHeader('Access-Control-Expose-Headers', 'X-Gutschein-Befunde');
  res.end(daten);
});

router.put('/vouchers/:id', requireToken, async (req: AuthedRequest, res: Antwort<'PUT /api/v1/vouchers/:id'>) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
    const alt = await gutschein(req.apiUser.user_id, id);
    if (!alt) return sendeFehler(req, res, 404, 'nicht_gefunden');

    // Was nicht mitkommt oder maskiert zurückkommt, bleibt stehen: Das Formular
    // kennt nur die Maske, und ein Formular mit nur dem Betrag löschte sonst Nummer und PIN.
    const maske = maskiert(alt);
    const w = pruefeWerte({
      number:   req.body?.number === maske.number ? alt.number : req.body?.number ?? alt.number,
      pin:      req.body?.pin === PIN_MASKE ? alt.pin : req.body?.pin ?? alt.pin,
      amount:   req.body?.amount   ?? alt.amount,
      currency: req.body?.currency ?? alt.currency,
    }, { nullBetragErlaubt: req.body?.amount === undefined });
    if (!w.ok) return sendeFehler(req, res, 400, w.code);

    // UNIQUE greift beim Umschreiben auf eine fremde Nummer: Nutzereingabe, kein
    // Serverfehler.
    const zeile = await gutscheinAendern(req.apiUser.user_id, id, w).catch(alsDoppelt('gutschein_existiert'));
    if (!zeile) return sendeFehler(req, res, 404, 'nicht_gefunden');
    res.json({ success: true, voucher: fuerAussen(zeile) });
});

// Endgültig und Bargeld: mit Bestätigung wie das Leeren des Papierkorbs.
router.delete('/vouchers/:id', requireToken, async (req: AuthedRequest, res: Antwort<'DELETE /api/v1/vouchers/:id'>) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
  if (!await bestaetigeMitFaktor(req, res, req.apiUser.user_id, req.body?.password)) return;
  const pdfPfad = await gutscheinLoeschen(req.apiUser.user_id, id);
  if (pdfPfad === undefined) return sendeFehler(req, res, 404, 'nicht_gefunden');

  // Erst die Zeile, dann die Datei: lieber eine verwaiste Datei als eine Zeile ins Leere.
  if (pdfPfad) {
    const p = gutscheinDatei(req.apiUser.user_id, pdfPfad);
    if (p) await fs.promises.unlink(p).catch(() => { /* schon weg: in Ordnung */ });
  }
  res.json({ success: true });
});

router.post('/vouchers/:id/klartext', requireToken, async (req: AuthedRequest, res: Antwort<'POST /api/v1/vouchers/:id/klartext'>) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
  if (!await bestaetigeMitFaktor(req, res, req.apiUser.user_id, req.body?.password)) return;
  const z = await gutschein(req.apiUser.user_id, id);
  if (!z) return sendeFehler(req, res, 404, 'nicht_gefunden');
  await protokolliere(req.apiUser.user_id, req.apiUser.user_id, 'gutschein_klartext', maskiert(z).number);
  res.json({ success: true, id: z.id, number: z.number, pin: z.pin });
});

router.post('/vouchers/:id/pdf-freigabe', requireToken, async (req: AuthedRequest, res: Antwort<'POST /api/v1/vouchers/:id/pdf-freigabe'>) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
  if (!await bestaetigeMitFaktor(req, res, req.apiUser.user_id, req.body?.password)) return;
  const z = await gutschein(req.apiUser.user_id, id);
  if (!z?.pdf_path) return sendeFehler(req, res, 404, 'nicht_gefunden');
  await pdfFreigabe(req, res, String(id), 'gutschein_pdf', maskiert(z).number);
});

router.get('/vouchers/:id/pdf', requireToken, async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
  if (!loeseTicketEin(req.query.ticket, req.apiUser.user_id, String(id))) return sendeFehler(req, res, 403, 'pdf_freigabe_noetig');
  const zeile = await gutschein(req.apiUser.user_id, id);
  if (!zeile?.pdf_path) return sendeFehler(req, res, 404, 'nicht_gefunden');
  const datei = gutscheinDatei(req.apiUser.user_id, zeile.pdf_path);
  const pdf = datei ? await liesGutscheinPdf(datei).catch(ohneFehlendeDatei('gutschein:pdf lesen', null)) : null;
  if (!pdf) return sendeFehler(req, res, 404, 'nicht_gefunden');

  res.type('application/pdf');
  const alsDownload = String(req.query.download ?? '') === '1';
  // Ohne Kartennummer: Dateinamen landen in Download-Listen und Protokollen.
  res.setHeader('Content-Disposition',
    `${alsDownload ? 'attachment' : 'inline'}; filename="gutschein-${zeile.id}.pdf"`);
  // Ein Gutschein gehört in keinen geteilten Zwischenspeicher.
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(pdf);
});

// Keine Sammelroute: höchstens ein Abruf je 30 Sekunden über ALLE Benutzer,
// eine Sammelroute müsste diese Wartezeit verstecken.
// Ausführlich: docs/begruendungen/routes/api_v1/vouchers.ts.md#post-vouchers-id-guthaben
router.post('/vouchers/:id/guthaben', requireToken, async (req: AuthedRequest, res: Antwort<'POST /api/v1/vouchers/:id/guthaben'>) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
  const alt = await gutschein(req.apiUser.user_id, id);
  if (!alt) return sendeFehler(req, res, 404, 'nicht_gefunden');

  // VOR der Schranke: Ein Aufruf, der nicht stattfinden kann, soll den einen
  // Platz je 30 Sekunden nicht verbrauchen.
  if (!alt.pin) return sendeFehler(req, res, 400, 'guthaben_pin_fehlt');

  // EINE Einstellung für die Installation: Eine Karte gilt nur im Shop ihres
  // Ausgabelandes.
  const land = String(await getGlobalSetting('gutschein_land', LAND_STANDARD) || LAND_STANDARD);
  if (!landErlaubt(land)) return sendeFehler(req, res, 400, 'guthaben_land_ungueltig');

  const ergebnis = await frageGuthabenAb(req.apiUser.user_id, alt.number, alt.pin, { locale: land });

  if (ergebnis.art === 'gesperrt') {
    const min = Math.ceil(ergebnis.wartenSek / 60);
    const [code, vars]: [FehlerCode, Record<string, number>] = ergebnis.grund === 'konto' ? ['zu_viele_anfragen', { minuten: min }]
      : ergebnis.grund === 'botschutz' ? ['guthaben_botschutz', { min }]
      : ['guthaben_abstand', { sek: ABSTAND_SEK, warten: ergebnis.wartenSek }];
    // Eigenes json(): `wartenSek` muss mit, danach taktet sich die Oberfläche.
    return res.status(429).json({
      success: false, code, error: fehlerText(code, antwortSprache(req), vars),
      grund: ergebnis.grund, wartenSek: ergebnis.wartenSek,
    });
  }

  const g = ergebnis.guthaben;
  // Die Währung der Gegenseite gewinnt; eine unbrauchbare Angabe zerstörte sonst
  // `currency` und damit die Summe der Liste.
  const waehrung = /^[A-Z]{3}$/.test(g.waehrung) ? g.waehrung : alt.currency;
  const zeile = await guthabenMerken(req.apiUser.user_id, id, g.betrag, waehrung);
  if (!zeile) return sendeFehler(req, res, 404, 'nicht_gefunden');
  res.json({
    success: true, voucher: fuerAussen(zeile),
    angezeigt: g.angezeigt,
    // Eine still geänderte Währung wäre eine geänderte Summe ohne Hinweis.
    waehrung_geaendert: waehrung !== alt.currency,
  });
});

router.use(fehlerAntwort);

export = router;
