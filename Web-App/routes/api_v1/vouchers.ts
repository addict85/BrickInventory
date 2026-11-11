// Für beide Apps: Cookie und Token.
import type express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { FORMULAR_GRENZEN } from '../../src/http/dateiEmpfang';
import { FREMDE_DATEI_CSP } from '../../src/http/dateiAusliefern';
import { ohneFehlendeDatei } from '../../src/infra/fehler';
import { fehlerAntwort, sendeFehler } from '../../src/http/httpAntwort';
import { fehlerText, antwortSprache, dateiFehler, type FehlerCode, alsDoppelt } from '../../src/infra/fehlerTexte';
import { getGlobalSetting, getSetting } from '../../src/einstellungen';
import { gutscheineBereich, landErlaubt, landFuerWaehrung, frageGuthabenAb, ABSTAND_SEK, VOUCHER_DIR, gutscheinDatei, schreibeGutscheinPdf, liesGutscheinPdf, liesGutscheinPdfOderNichts, stelleTicketAus, loeseTicketEin, TICKET_SEK, type GutscheinWerte, verbindeGutscheine, liesImHintergrund, HOECHSTENS_SEITEN, type ExportGutschein, type GutscheinZeile } from '../../src/gutscheine';
import { requireToken, kontoSchranke } from './middleware';
import { bestaetigeMitFaktor } from '../../src/konto/http/anmeldung';

import { seiteAus } from '../../src/infra/seite';
import { vertragsRouter, type Anfrage, type Antwort } from '../../src/http/vertragsRouter';
import { kontoBereich } from '../../src/konto';

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

/** Nach aussen nur das Ende: Ein erbeutetes App-Token soll nicht alle Codes samt PIN
 * abgreifen. Den Klartext gibt POST /vouchers/:id/klartext, bestätigt und protokolliert. */
const PIN_MASKE = '•••';
const maskiert = (z: { number: string; pin: string | null }) =>
  ({ number: '…' + z.number.slice(-4), pin: z.pin ? PIN_MASKE : null });

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
    // Auch NULL geht mit: Ein nie abgefragtes Guthaben soll sich von einem
    // abgefragten unterscheiden.
    guthaben_geprueft_am: z.guthaben_geprueft_am,
  };
}

const alsGelesen = (g: GutscheinWerte) => ({ number: g.nummer, pin: g.pin, currency: g.waehrung,
  ...(g.betrag == null ? {} : { amount: g.betrag }) });

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

router.get('/vouchers', requireToken, async (req: Anfrage<'GET /api/v1/vouchers'>, res: Antwort<'GET /api/v1/vouchers'>) => {
  const { eintraege, ...seite } = seiteAus(await gutscheineBereich().gutscheine.gutscheineDesKontos(req.apiUser.user_id), req.abfrage);
  res.json({ success: true, vouchers: eintraege.map(fuerAussen), ...seite });
});

router.post('/vouchers', requireToken, async (req: Anfrage<'POST /api/v1/vouchers'>, res: Antwort<'POST /api/v1/vouchers'>) => {
  const w = pruefeWerte(req.eingabe || {});
  if (!w.ok) return sendeFehler(req, res, 400, w.code);
  // Keine Zeile heisst „war schon da" — als Erfolg sähe der Nutzer nichts passieren.
  const zeile = await gutscheineBereich().gutscheine.gutscheinAnlegen(req.apiUser.user_id, w);
  if (!zeile) return sendeFehler(req, res, 409, 'gutschein_existiert');
  res.json({ success: true, voucher: fuerAussen(zeile) });
});

/** Der Stapelfall von POST /vouchers/pdf. */
async function stapelAnlegen(
  req: AuthedRequest, res: express.Response,
  gefunden: GutscheinWerte[],
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
    const warNeu = await gutscheineBereich().gutscheine.gutscheinErsetzen(uid, geprueft);
    if (warNeu) added++; else updated++;
    results.push({ number: geprueft.number, action: warNeu ? 'added' : 'updated' });
  }

  // Eigener Block, damit die Oberfläche an einem Feld erkennt, welcher Fall eintrat.
  return res.json({ success: true, mehrere: { added, updated, errors,
                                              total: gefunden.length, results } });
}

// EIN Weg für beide Apps: Mitgeschickte Felder gewinnen gegen das Ausgelesene.
router.post('/vouchers/pdf', requireToken, kontoSchranke('gutscheinPdf'), upload.single('file'), async (req: Anfrage<'POST /api/v1/vouchers/pdf'>, res: Antwort<'POST /api/v1/vouchers/pdf'>) => {
  if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');

  const lesung = await liesImHintergrund(req.file.buffer);
  if (lesung.art === 'zu_viele_seiten')
    return sendeFehler(req, res, 422, 'pdf_zu_viele_seiten', { seiten: lesung.seiten, max: HOECHSTENS_SEITEN });
  if (lesung.art === 'unlesbar') return sendeFehler(req, res, 422, 'pdf_unlesbar');
  // Erst ab ZWEI Seiten ein Stapel; bei einem bleibt der 422-Vertrag der Formulare.
  if (lesung.stapel.length >= 2) return stapelAnlegen(req, res, lesung.stapel);

  // Der Medientyp ist eine Behauptung des Klienten; geprüft wird die Signatur.
  const istPdf = req.file.buffer.subarray(0, 5).toString('latin1') === '%PDF-';
  // Auch mit getippten Werten nicht: Die Datei wird später als application/pdf
  // ausgeliefert.
  if (!istPdf) return sendeFehler(req, res, 422, 'pdf_unlesbar');

  // Eine Entpackbombe wird nicht abgelegt: Der Export gäbe sie an pdf-lib, das
  // ohne Grenze entpackt.
  if (lesung.einzeln === 'zu_gross') return sendeFehler(req, res, 422, 'pdf_unlesbar');
  const lesefehler = lesung.einzeln === 'fehler';
  const gelesen: GutscheinWerte = typeof lesung.einzeln === 'object' ? lesung.einzeln
    : { nummer: null, pin: null, betrag: null, waehrung: null };

  const zusammen = {
    number:   req.eingabe.number   ?? gelesen.nummer,
    pin:      req.eingabe.pin      ?? gelesen.pin,
    amount:   req.eingabe.amount   ?? gelesen.betrag,
    currency: req.eingabe.currency ?? gelesen.waehrung,
  };
  const w = pruefeWerte(zusammen);
  if (!w.ok) {
    // Drei Absagen, weil der Nutzer bei jeder etwas anderes tun muss.
    const nichtsGetippt = !req.eingabe.number && !req.eingabe.pin && !req.eingabe.amount;
    const nichtsGelesen = gelesen.nummer == null && gelesen.betrag == null;
    const code: FehlerCode =
      lesefehler ? 'pdf_unlesbar'
      : (nichtsGelesen && nichtsGetippt) ? 'kein_gutschein_im_pdf'
      : w.code;
    // 422: Die Anfrage war in Ordnung, nur das PDF gab nicht alles her. `gelesen`
    // belegt die Felder vor, die da waren.
    return res.status(422).json({
      success: false, code, error: fehlerText(code, antwortSprache(req)),
      gelesen: alsGelesen(gelesen),
    });
  }

  const z = await gutscheineBereich().gutscheine.gutscheinAnlegen(req.apiUser.user_id, w);
  if (!z) return sendeFehler(req, res, 409, 'gutschein_existiert');

  const dir = path.join(VOUCHER_DIR, String(req.apiUser.user_id));
  // Dateiname aus der id, NICHT aus dem Upload: Ein Name vom Klienten müsste
  // gegen Pfadanteile geprüft werden.
  const datei = `${z.id}.pdf`;
  await schreibeGutscheinPdf(path.join(dir, datei), req.file.buffer);
  const relPfad = `${req.apiUser.user_id}/${datei}`;
  await gutscheineBereich().gutscheine.gutscheinPdfMerken(req.apiUser.user_id, z.id, relPfad);

  res.json({
    success: true,
    voucher: fuerAussen({ ...z, pdf_path: relPfad }),
    // Damit die Oberfläche sagen kann, welche Werte gelesen wurden.
    gelesen: alsGelesen(gelesen),
  });
});

// Die Sammelwege VOR den :id-Wegen: Sonst fängt `:id` das Wort „export".

// Die PDFs tragen Nummer und PIN: erst bestätigen und protokollieren, dann ein Ticket für genau einen Abruf.
async function pdfFreigabe(req: AuthedRequest, res: express.Response, ziel: string, aktion: 'gutschein_pdf' | 'gutschein_export', was: string) {
  await kontoBereich().protokoll.protokolliere(req.apiUser.user_id, req.apiUser.user_id, aktion, was);
  res.json({ success: true, ticket: stelleTicketAus(req.apiUser.user_id, ziel), gueltig_sek: TICKET_SEK });
}

router.post('/vouchers/export/pdf-freigabe', requireToken, async (req: Anfrage<'POST /api/v1/vouchers/export/pdf-freigabe'>, res: Antwort<'POST /api/v1/vouchers/export/pdf-freigabe'>) => {
  if (!await bestaetigeMitFaktor(req, res, req.apiUser.user_id, req.eingabe.password)) return;
  const zeilen = await gutscheineBereich().gutscheine.gutscheineDesKontos(req.apiUser.user_id, 'aelteste');
  if (!zeilen.length) return sendeFehler(req, res, 404, 'keine_gutscheine');
  await pdfFreigabe(req, res, 'export', 'gutschein_export', `${zeilen.length}`);
});

router.get('/vouchers/export/pdf', requireToken, async (req: Anfrage<'GET /api/v1/vouchers/export/pdf'>, res: express.Response) => {
  const uid = req.apiUser.user_id;
  if (!loeseTicketEin(req.abfrage.ticket, uid, 'export')) return sendeFehler(req, res, 403, 'pdf_freigabe_noetig');
  const zeilen = await gutscheineBereich().gutscheine.gutscheineDesKontos(uid, 'aelteste');
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

router.put('/vouchers/:id', requireToken, async (req: Anfrage<'PUT /api/v1/vouchers/:id'>, res: Antwort<'PUT /api/v1/vouchers/:id'>) => {
    const id = req.pfad.id;
    if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
    const alt = await gutscheineBereich().gutscheine.gutschein(req.apiUser.user_id, id);
    if (!alt) return sendeFehler(req, res, 404, 'nicht_gefunden');

    // Was nicht mitkommt oder maskiert zurückkommt, bleibt stehen: Das Formular
    // kennt nur die Maske, und ein Formular mit nur dem Betrag löschte sonst Nummer und PIN.
    const maske = maskiert(alt);
    const w = pruefeWerte({
      number:   req.eingabe.number === maske.number ? alt.number : req.eingabe.number ?? alt.number,
      pin:      req.eingabe.pin === PIN_MASKE ? alt.pin : req.eingabe.pin ?? alt.pin,
      amount:   req.eingabe.amount   ?? alt.amount,
      currency: req.eingabe.currency ?? alt.currency,
    }, { nullBetragErlaubt: req.eingabe.amount === undefined });
    if (!w.ok) return sendeFehler(req, res, 400, w.code);

    // UNIQUE greift beim Umschreiben auf eine fremde Nummer: Nutzereingabe, kein
    // Serverfehler.
    const zeile = await gutscheineBereich().gutscheine.gutscheinAendern(req.apiUser.user_id, id, w).catch(alsDoppelt('gutschein_existiert'));
    if (!zeile) return sendeFehler(req, res, 404, 'nicht_gefunden');
    res.json({ success: true, voucher: fuerAussen(zeile) });
});

// Endgültig und Bargeld: mit Bestätigung wie das Leeren des Papierkorbs.
router.delete('/vouchers/:id', requireToken, async (req: Anfrage<'DELETE /api/v1/vouchers/:id'>, res: Antwort<'DELETE /api/v1/vouchers/:id'>) => {
  const id = req.pfad.id;
  if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
  if (!await bestaetigeMitFaktor(req, res, req.apiUser.user_id, req.eingabe.password)) return;
  const pdfPfad = await gutscheineBereich().gutscheine.gutscheinLoeschen(req.apiUser.user_id, id);
  if (pdfPfad === undefined) return sendeFehler(req, res, 404, 'nicht_gefunden');

  // Erst die Zeile, dann die Datei: lieber eine verwaiste Datei als eine Zeile ins Leere.
  if (pdfPfad) {
    const p = gutscheinDatei(req.apiUser.user_id, pdfPfad);
    if (p) await fs.promises.unlink(p).catch(() => { /* schon weg: in Ordnung */ });
  }
  res.json({ success: true });
});

router.post('/vouchers/:id/klartext', requireToken, async (req: Anfrage<'POST /api/v1/vouchers/:id/klartext'>, res: Antwort<'POST /api/v1/vouchers/:id/klartext'>) => {
  const id = req.pfad.id;
  if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
  if (!await bestaetigeMitFaktor(req, res, req.apiUser.user_id, req.eingabe.password)) return;
  const z = await gutscheineBereich().gutscheine.gutschein(req.apiUser.user_id, id);
  if (!z) return sendeFehler(req, res, 404, 'nicht_gefunden');
  await kontoBereich().protokoll.protokolliere(req.apiUser.user_id, req.apiUser.user_id, 'gutschein_klartext', maskiert(z).number);
  res.json({ success: true, id: z.id, number: z.number, pin: z.pin });
});

router.post('/vouchers/:id/pdf-freigabe', requireToken, async (req: Anfrage<'POST /api/v1/vouchers/:id/pdf-freigabe'>, res: Antwort<'POST /api/v1/vouchers/:id/pdf-freigabe'>) => {
  const id = req.pfad.id;
  if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
  if (!await bestaetigeMitFaktor(req, res, req.apiUser.user_id, req.eingabe.password)) return;
  const z = await gutscheineBereich().gutscheine.gutschein(req.apiUser.user_id, id);
  if (!z?.pdf_path) return sendeFehler(req, res, 404, 'nicht_gefunden');
  await pdfFreigabe(req, res, String(id), 'gutschein_pdf', maskiert(z).number);
});

router.get('/vouchers/:id/pdf', requireToken, async (req: Anfrage<'GET /api/v1/vouchers/:id/pdf'>, res: express.Response) => {
  const id = req.pfad.id;
  if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
  if (!loeseTicketEin(req.abfrage.ticket, req.apiUser.user_id, String(id))) return sendeFehler(req, res, 403, 'pdf_freigabe_noetig');
  const zeile = await gutscheineBereich().gutscheine.gutschein(req.apiUser.user_id, id);
  if (!zeile?.pdf_path) return sendeFehler(req, res, 404, 'nicht_gefunden');
  const datei = gutscheinDatei(req.apiUser.user_id, zeile.pdf_path);
  const pdf = datei ? await liesGutscheinPdf(datei).catch(ohneFehlendeDatei('gutschein:pdf lesen', null)) : null;
  if (!pdf) return sendeFehler(req, res, 404, 'nicht_gefunden');

  res.type('application/pdf');
  const alsDownload = req.abfrage.download ?? false;
  // Ohne Kartennummer: Dateinamen landen in Download-Listen und Protokollen.
  res.setHeader('Content-Disposition',
    `${alsDownload ? 'attachment' : 'inline'}; filename="gutschein-${zeile.id}.pdf"`);
  // Ein Gutschein gehört in keinen geteilten Zwischenspeicher.
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Security-Policy', FREMDE_DATEI_CSP);
  res.end(pdf);
});

// Keine Sammelroute: höchstens ein Abruf je 30 Sekunden über ALLE Benutzer,
// eine Sammelroute müsste diese Wartezeit verstecken.
router.post('/vouchers/:id/guthaben', requireToken, async (req: Anfrage<'POST /api/v1/vouchers/:id/guthaben'>, res: Antwort<'POST /api/v1/vouchers/:id/guthaben'>) => {
  const id = req.pfad.id;
  if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
  const alt = await gutscheineBereich().gutscheine.gutschein(req.apiUser.user_id, id);
  if (!alt) return sendeFehler(req, res, 404, 'nicht_gefunden');

  // VOR der Schranke: Ein Aufruf, der nicht stattfinden kann, soll den einen
  // Platz je 30 Sekunden nicht verbrauchen.
  if (!alt.pin) return sendeFehler(req, res, 400, 'guthaben_pin_fehlt');

  // EINE Einstellung für die Installation: Eine Karte gilt nur im Shop ihres
  // Ausgabelandes.
  const land = String(await getGlobalSetting('gutschein_land', '')
    || landFuerWaehrung(await getSetting(req.apiUser.user_id, 'currency', 'EUR')));
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
  const zeile = await gutscheineBereich().gutscheine.guthabenMerken(req.apiUser.user_id, id, g.betrag, waehrung);
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
