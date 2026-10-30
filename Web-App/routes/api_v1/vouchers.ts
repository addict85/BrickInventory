/**
 * /api/v1/vouchers — LEGO-Geschenkkarten im eigenen Profil.
 * Ausführlich: docs/begruendungen/routes/api_v1/vouchers.ts.md#abschnitt
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { DATA_DIR } from '../../utils/appPaths';
import { handleRouteError } from '../../utils/httpError';
import { sendeFehler, fehlerText, antwortSprache, type FehlerCode } from '../../utils/fehlerTexte';
import { getGlobalSetting } from '../../utils/settings';
import { verdecke, landErlaubt, LAND_STANDARD } from '../../utils/gutscheinGuthaben';
import { frageGuthabenAb, ABSTAND_SEK } from '../../utils/gutscheinGuthabenSchranke';
import { liefereDatei } from '../../utils/dateiAusliefern';
import { requireToken } from './middleware';
import { werteAusPdf, PdfZuGross } from '../../utils/gutscheinPdf';
import { verbindeGutscheine, seitenweiseLesen } from '../../utils/gutscheinPdfSchreiben';
import type { ExportGutschein } from '../../utils/gutscheinPdfSchreiben';

import { gutscheineDesKontos, gutschein, gutscheinAnlegen, gutscheinErsetzen, gutscheinAendern,
         gutscheinPdfMerken, gutscheinLoeschen, guthabenMerken } from '../../utils/dienste/gutscheine';
import type { GutscheinZeile } from '../../utils/dienste/gutscheine';

const router = express.Router();
type AuthedRequest = express.Request & { apiUser: { user_id: number } };

/** Wo die PDFs liegen: data/vouchers/<benutzer-id>/<datei>. */
const VOUCHER_DIR = path.join(DATA_DIR, 'vouchers');

/**
 * Nur PDF. Anders als bei den Bauanleitungen (PDF/JPG/PNG) gibt es hier
 * keinen Grund fuer Bilder: Ausgelesen wird ohnehin nur Text, und ein Foto
 * des Gutscheins koennte der Server nicht lesen.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  // 2 MB. Marcos Beispiel wiegt 206 KB; das lässt Platz für ein Sammel-PDF
  // aus einigen Gutscheinen. Mehr hält nur pdf-lib länger im Speicher.
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    // Woertlicher Vergleich statt Tabellenzugriff: Bei genau EINEM erlaubten
    // Typ gibt es nichts nachzuschlagen — und damit auch nicht den geerbten
    // Wert, an dem der Anleitungs-Upload einmal vorbeigelaufen ist (die
    // Begruendung steht dort bei INSTR_EXT_BY_MIME).
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('nur_pdf'));
  },
});

/**
 * Eine Zeile fuer die Oberflaechen aufbereiten.
 * Ausführlich: docs/begruendungen/routes/api_v1/vouchers.ts.md#fueraussen
 */
function fuerAussen(z: GutscheinZeile) {
  return {
    id: z.id,
    number: z.number,
    pin: z.pin,
    amount: Number(z.amount),
    currency: z.currency,
    hat_pdf: !!z.pdf_path,
    created_at: z.created_at,
    updated_at: z.updated_at,
    // Geht MIT heraus, auch wenn es NULL ist: „250 CHF" allein ist keine
    // Auskunft, „250 CHF, abgefragt am 15.10." ist eine — und ein Gutschein,
    // dessen Guthaben nie abgefragt wurde, soll sich davon unterscheiden
    // koennen. Die Begruendung steht in Migration 0039.
    guthaben_geprueft_am: z.guthaben_geprueft_am,
  };
}

/**
 * Die drei Pflichtwerte prüfen: geprüfte Werte oder ein Fehlercode. Eine
 * Funktion für Anlegen, Anlegen aus dem PDF und Ändern.
 */
function pruefeWerte(roh: { number?: unknown; pin?: unknown; amount?: unknown; currency?: unknown },
                     opt: { nullBetragErlaubt?: boolean } = {}):
  { ok: true; number: string; pin: string | null; amount: number; currency: string | null } | { ok: false; code: FehlerCode } {
  const number = String(roh.number ?? '').replace(/[\s-]/g, '');
  if (!/^\d{4,25}$/.test(number)) return { ok: false, code: 'nummer_ungueltig' };

  const pinRoh = String(roh.pin ?? '').trim();
  if (pinRoh && !/^\d{3,10}$/.test(pinRoh)) return { ok: false, code: 'pin_ungueltig' };

  const amount = Number(roh.amount);
  // Auch die Null faellt durch: Ein Gutschein ueber 0 ist keiner, und ein
  // leeres Feld wird von Number() zur Null — ohne diese Grenze haette ein
  // vergessenes Feld stillschweigend einen Gutschein ueber nichts angelegt.
  // Ausführlich: docs/begruendungen/routes/api_v1/vouchers.ts.md#pruefewerte
  if (!Number.isFinite(amount) || amount > 1_000_000) return { ok: false, code: 'betrag_ungueltig' };
  if (opt.nullBetragErlaubt ? amount < 0 : amount <= 0) return { ok: false, code: 'betrag_ungueltig' };

  // Ohne Angabe setzt die Datenbank die Währung des Kontos (Migration 0073).
  const currency = roh.currency == null || roh.currency === '' ? null : String(roh.currency).toUpperCase();
  if (currency !== null && !/^[A-Z]{3}$/.test(currency)) return { ok: false, code: 'waehrung_ungueltig' };

  return { ok: true, number, pin: pinRoh || null, amount, currency };
}

// `notiz()` stand hier und kuerzte den Freitext. ENTFALLEN mit der Notiz
// selbst (Migration 0027): Marcos Vorgabe war „vollstaendig inkl. Spalten auf
// der Datenbank entfernen". Ein Helfer ohne Aufrufer waere genau der Rest, der
// beim naechsten Durchgang die Frage aufwirft, wofuer er da ist.

// ── GET /api/v1/vouchers — die eigenen Gutscheine ───────────────────────────
router.get('/vouchers', requireToken, async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, vouchers: (await gutscheineDesKontos(req.apiUser.user_id)).map(fuerAussen) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── POST /api/v1/vouchers — manuell anlegen ─────────────────────────────────
router.post('/vouchers', requireToken, async (req: AuthedRequest, res) => {
  try {
    const w = pruefeWerte(req.body || {});
    if (!w.ok) return sendeFehler(req, res, 400, w.code);
    // Keine Zeile heisst „war schon da“ — als Erfolg gemeldet, sähe der Nutzer
    // beim zweiten Anlegen nichts passieren.
    const zeile = await gutscheinAnlegen(req.apiUser.user_id, w);
    if (!zeile) return sendeFehler(req, res, 409, 'gutschein_existiert');
    res.json({ success: true, voucher: fuerAussen(zeile) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

/**
 * Mehrere Gutscheine aus EINEM PDF anlegen — der Stapelfall von
 * POST /vouchers/pdf.
 * Ausführlich: docs/begruendungen/routes/api_v1/vouchers.ts.md#stapelanlegen
 */
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

  // `mehrere` als eigener Block und nicht flach daneben: So kann eine
  // Oberflaeche an EINEM Feld erkennen, welcher der beiden Faelle eingetreten
  // ist, statt aus dem Fehlen von `voucher` zu schliessen.
  return res.json({ success: true, mehrere: { added, updated, errors,
                                              total: gefunden.length, results } });
}

// POST /api/v1/vouchers/pdf — aus dem PDF anlegen
// EIN Weg fuer beide Apps und fuer beide Ausgaenge. Die Felder number, pin,
// amount und currency duerfen MITGESCHICKT werden; was mitkommt, gewinnt
// gegen das Ausgelesene. Damit deckt dieselbe Route vier Faelle ab:
// Ausführlich: docs/begruendungen/routes/api_v1/vouchers.ts.md#post-vouchers-pdf
router.post('/vouchers/pdf', requireToken, upload.single('file'), async (req: AuthedRequest, res) => {
  try {
    if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');

    // Zuerst die Frage: Wie viele Gutscheine stehen in dieser Datei?
    // Seitenweise gelesen, weil ein Sammel-PDF je Seite einen Gutschein
    // traegt. Erst ab ZWEI ist es ein Stapel; bei einem bleibt alles wie
    // bisher — samt dem 422-Vertrag, auf dem beide Formulare stehen.
    // Ausführlich: docs/begruendungen/routes/api_v1/vouchers.ts.md#post-vouchers-pdf-seiten
    let seiten: Awaited<ReturnType<typeof seitenweiseLesen>> = [];
    try { seiten = await seitenweiseLesen(req.file.buffer); } catch { seiten = []; }
    if (seiten.length >= 2) return stapelAnlegen(req, res, seiten);

    // Scheitert das Auslesen (kaputtes PDF, Scan, fremdes Format), ist das
    // kein Fehler der Anfrage — es bleibt bei dem, was der Nutzer mitschickt.
    // Ist das ueberhaupt ein PDF? Multer prueft den gemeldeten Medientyp, und
    // der ist eine BEHAUPTUNG des Klienten — eine Textdatei mit …
    // Ausführlich: docs/begruendungen/routes/api_v1/vouchers.ts.md#post-vouchers-pdf-istpdf
    const istPdf = req.file.buffer.subarray(0, 5).toString('latin1') === '%PDF-';
    // Auch mit getippten Werten nicht: Die Datei wird als .pdf abgelegt und
    // später mit application/pdf ausgeliefert.
    if (!istPdf) return sendeFehler(req, res, 422, 'pdf_unlesbar');

    let gelesen: ReturnType<typeof werteAusPdf>;
    let lesefehler = !istPdf;
    try { gelesen = werteAusPdf(req.file.buffer); }
    catch (e) {
      // Eine Entpackbombe wird auch mit getippten Werten nicht abgelegt: Der
      // Export gäbe sie später an pdf-lib, das ohne Grenze entpackt.
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
      // Drei Absagen, weil der Nutzer bei jeder etwas anderes tun muss:
      // kein PDF, nichts lesbar, oder ein Feld fehlt.
      const nichtsGetippt = !req.body?.number && !req.body?.pin && !req.body?.amount;
      const nichtsGelesen = gelesen.nummer == null && gelesen.betrag == null;
      const code: FehlerCode =
        lesefehler ? 'pdf_unlesbar'
        : (nichtsGelesen && nichtsGetippt) ? 'kein_gutschein_im_pdf'
        : w.code;
      // 422 und nicht 400: Die Anfrage war in Ordnung, nur das PDF hat nicht
      // hergegeben, was gebraucht wird. `gelesen` geht mit zurueck, damit die
      // Oberflaeche die Felder vorbelegen kann, die sehr wohl da waren.
      return res.status(422).json({
        success: false, code, error: fehlerText(code, antwortSprache(req)),
        gelesen: { number: gelesen.nummer, pin: gelesen.pin, amount: gelesen.betrag, currency: gelesen.waehrung },
      });
    }

    const z = await gutscheinAnlegen(req.apiUser.user_id, w);
    if (!z) return sendeFehler(req, res, 409, 'gutschein_existiert');

    const dir = path.join(VOUCHER_DIR, String(req.apiUser.user_id));
    await fs.promises.mkdir(dir, { recursive: true });
    // Der Dateiname kommt aus der id, NICHT aus dem hochgeladenen Namen: Ein
    // Name vom Klienten ist eine Behauptung und muesste gegen Pfadanteile
    // geprueft werden. Die id ist eine Zahl aus der eigenen Datenbank.
    const datei = `${z.id}.pdf`;
    await fs.promises.writeFile(path.join(dir, datei), req.file.buffer);
    const relPfad = `${req.apiUser.user_id}/${datei}`;
    await gutscheinPdfMerken(req.apiUser.user_id, z.id, relPfad);

    res.json({
      success: true,
      voucher: fuerAussen({ ...z, pdf_path: relPfad }),
      // Was aus dem PDF kam — damit die Oberflaeche sagen kann „diese Werte
      // habe ich gelesen" statt den Nutzer raten zu lassen, ob sie stimmen.
      gelesen: { number: gelesen.nummer, pin: gelesen.pin, amount: gelesen.betrag, currency: gelesen.waehrung },
    });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// Die beiden Sammelwege stehen VOR den :id-Wegen
// Express nimmt die ERSTE Route, die passt. Stand `/vouchers/export/pdf`
// hinter `/vouchers/:id/pdf`, fing `:id` das Wort „export", Number('export')
// ergab NaN, und die Antwort war 400 „id_ungueltig". GEMESSEN, nicht …
// Ausführlich: docs/begruendungen/routes/api_v1/vouchers.ts.md#abschnitt-2

// ── GET /api/v1/vouchers/export/pdf — alle Gutscheine in EIN PDF ────────────
/** Das PDF baut utils/gutscheinPdfSchreiben.ts; die Route holt die eigenen Zeilen und liefert aus. */
router.get('/vouchers/export/pdf', requireToken, async (req: AuthedRequest, res) => {
  try {
    const uid = req.apiUser.user_id;
    const zeilen = await gutscheineDesKontos(uid, 'aelteste');
    if (!zeilen.length) return sendeFehler(req, res, 404, 'keine_gutscheine');

    const gutscheine: ExportGutschein[] = [];
    for (const z of zeilen) {
      let pdf: Buffer | null = null;
      if (z.pdf_path) {
        // Fehlt die Datei (von Hand geloescht, Band nicht eingebunden), ist das
        // kein Abbruch: Dann wird die Seite erzeugt. Ein Export, der an einer
        // fehlenden Datei ganz scheitert, nimmt dem Nutzer auch die neunzehn
        // anderen Gutscheine.
        try { pdf = await fs.promises.readFile(path.join(VOUCHER_DIR, z.pdf_path)); }
        catch { pdf = null; }
      }
      gutscheine.push({ id: z.id, number: z.number, pin: z.pin,
                        amount: Number(z.amount), currency: z.currency, pdf });
    }

    const { daten, befunde } = await verbindeGutscheine(gutscheine);
    const tag = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="brickinventory-gutscheine-${tag}.pdf"`);
    // JSON in einem Kopf, base64: ASCII-sicher, damit ein Umlaut im Grund die
    // Kopfzeile nicht zerlegt.
    res.setHeader('X-Gutschein-Befunde',
      Buffer.from(JSON.stringify(befunde), 'utf-8').toString('base64'));
    res.setHeader('Access-Control-Expose-Headers', 'X-Gutschein-Befunde');
    res.end(daten);
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── PUT /api/v1/vouchers/:id — aendern ──────────────────────────────────────
router.put('/vouchers/:id', requireToken, async (req: AuthedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
    const alt = await gutschein(req.apiUser.user_id, id);
    if (!alt) return sendeFehler(req, res, 404, 'nicht_gefunden');

    // Was nicht mitkommt, bleibt stehen. Ohne das loescht ein Formular, das
    // nur den Betrag schickt, Nummer und PIN.
    const w = pruefeWerte({
      number:   req.body?.number   ?? alt.number,
      pin:      req.body?.pin      ?? alt.pin,
      amount:   req.body?.amount   ?? alt.amount,
      currency: req.body?.currency ?? alt.currency,
    }, { nullBetragErlaubt: req.body?.amount === undefined });
    if (!w.ok) return sendeFehler(req, res, 400, w.code);

    const zeile = await gutscheinAendern(req.apiUser.user_id, id, w);
    if (!zeile) return sendeFehler(req, res, 404, 'nicht_gefunden');
    res.json({ success: true, voucher: fuerAussen(zeile) });
  } catch (e) {
    // Die UNIQUE-Bedingung schlaegt zu, wenn jemand eine Karte auf die Nummer
    // einer anderen umschreibt. Das ist eine Nutzereingabe, kein Serverfehler.
    if ((e as { code?: string })?.code === '23505') return sendeFehler(req, res, 409, 'gutschein_existiert');
    handleRouteError(res, e, undefined, req);
  }
});

// ── DELETE /api/v1/vouchers/:id — loeschen ──────────────────────────────────
router.delete('/vouchers/:id', requireToken, async (req: AuthedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
    const pdfPfad = await gutscheinLoeschen(req.apiUser.user_id, id);
    if (pdfPfad === undefined) return sendeFehler(req, res, 404, 'nicht_gefunden');

    // Erst die Zeile, dann die Datei: Eine verwaiste Datei ist besser als
    // eine Zeile, die ins Leere zeigt.
    if (pdfPfad) {
      const p = sicherePdfDatei(req.apiUser.user_id, pdfPfad);
      if (p) await fs.promises.unlink(p).catch(() => { /* schon weg: in Ordnung */ });
    }
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

/**
 * Gespeicherter Pfad → Dateipfad, oder null. Auch ein Pfad aus der eigenen
 * Datenbank muss dem Nutzer gehören und unter data/vouchers/ liegen.
 */
function sicherePdfDatei(userId: number, pdfPath: string): string | null {
  const basis = path.resolve(VOUCHER_DIR, String(userId));
  const ziel = path.resolve(VOUCHER_DIR, pdfPath);
  // `startsWith(basis + sep)` und nicht nur `startsWith(basis)`: Sonst gilt
  // /data/vouchers/12 als unterhalb von /data/vouchers/1.
  return ziel.startsWith(basis + path.sep) ? ziel : null;
}

// ── GET /api/v1/vouchers/:id/pdf — anzeigen oder (?download=1) herunterladen;
// beides ist dieselbe Datei, nur Content-Disposition unterscheidet sich.
router.get('/vouchers/:id/pdf', requireToken, async (req: AuthedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
    const zeile = await gutschein(req.apiUser.user_id, id);
    if (!zeile?.pdf_path) return sendeFehler(req, res, 404, 'nicht_gefunden');
    const datei = sicherePdfDatei(req.apiUser.user_id, zeile.pdf_path);
    if (!datei) return sendeFehler(req, res, 404, 'nicht_gefunden');

    res.type('application/pdf');
    const alsDownload = String(req.query.download ?? '') === '1';
    // Der Dateiname fuer den Nutzer traegt die Kartennummer — beim
    // Herunterladen mehrerer Gutscheine heissen sie sonst alle „12.pdf".
    res.setHeader('Content-Disposition',
      `${alsDownload ? 'attachment' : 'inline'}; filename="gutschein-${zeile.number}.pdf"`);
    // Ein Gutschein gehoert in keinen Zwischenspeicher, den sich jemand
    // teilt — und auch nicht in den des Browsers, laenger als noetig.
    res.setHeader('Cache-Control', 'private, no-store');
    liefereDatei(res, datei);
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// EINE Route, auch fuer „alle abfragen"
// Es gibt keinen zweiten Endpunkt, der alle Karten durchgeht. Das ist keine
// Sparsamkeit, sondern die Folge von Marcos Grenze: hoechstens ein Aufruf je
// 30 Sekunden ueber ALLE Benutzer. Eine Sammelroute muesste diese Wartezeit …
// Ausführlich: docs/begruendungen/routes/api_v1/vouchers.ts.md#post-vouchers-id-guthaben
router.post('/vouchers/:id/guthaben', requireToken, async (req: AuthedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
    const alt = await gutschein(req.apiUser.user_id, id);
    if (!alt) return sendeFehler(req, res, 404, 'nicht_gefunden');

    // Ohne PIN gibt es keine Antwort — LEGO fragt beides ab. Das VOR der
    // Schranke pruefen: Ein Aufruf, der nicht stattfinden kann, soll den
    // einen Platz je 30 Sekunden nicht verbrauchen.
    if (!alt.pin) return sendeFehler(req, res, 400, 'guthaben_pin_fehlt');

    // Das Ausgabeland: EINE Einstellung fuer die ganze Installation („fuer
    // alle"), nicht je Nutzer. Eine Karte gilt nur im Shop ihres
    // Ausgabelandes, und das Land geht als Adresse und als Keks mit.
    const land = String(await getGlobalSetting('gutschein_land', LAND_STANDARD) || LAND_STANDARD);
    if (!landErlaubt(land)) return sendeFehler(req, res, 400, 'guthaben_land_ungueltig');

    let ergebnis;
    try {
      ergebnis = await frageGuthabenAb(alt.number, alt.pin, { locale: land });
    } catch (e) {
      // Ein Fehler der Gegenseite ist KEIN Serverfehler: Der Mensch, der
      // gerade auf den Knopf gedrueckt hat, soll lesen, was los war —
      // handleRouteError machte daraus ein nichtssagendes 500.
      // Ausführlich: docs/begruendungen/routes/api_v1/vouchers.ts.md#post-vouchers-id-guthaben-grund
      const grund = verdecke(String((e as Error)?.message || e), alt.number, alt.pin);
      console.warn(`[guthaben] Abfrage gescheitert (Gutschein ${id}): ${grund}`);
      return res.status(502).json({
        success: false, code: 'guthaben_fehlgeschlagen',
        error: fehlerText('guthaben_fehlgeschlagen', antwortSprache(req), { grund }),
      });
    }

    if (ergebnis.art === 'gesperrt') {
      const botschutz = ergebnis.grund === 'botschutz';
      const code: FehlerCode = botschutz ? 'guthaben_botschutz' : 'guthaben_abstand';
      const vars = botschutz
        ? { min: Math.ceil(ergebnis.wartenSek / 60) }
        : { sek: ABSTAND_SEK, warten: ergebnis.wartenSek };
      // Eigenes json() statt sendeFehler(): `wartenSek` muss MIT in die
      // Antwort, denn danach taktet sich die Oberflaeche (siehe oben).
      // sendeFehler schickt nur success/error/code.
      return res.status(429).json({
        success: false, code, error: fehlerText(code, antwortSprache(req), vars),
        grund: ergebnis.grund, wartenSek: ergebnis.wartenSek,
      });
    }

    const g = ergebnis.guthaben;
    // Die Waehrung der Gegenseite gewinnt — sie gehoert zur Karte. Nur wenn
    // sie unbrauchbar ist, bleibt die bisherige stehen: Eine leere oder
    // kaputte Angabe duerfte sonst `currency` zerstoeren, und die Summe in
    // der Liste rechnet nur, wenn alle Gutscheine dieselbe Waehrung tragen.
    const waehrung = /^[A-Z]{3}$/.test(g.waehrung) ? g.waehrung : alt.currency;
    const zeile = await guthabenMerken(req.apiUser.user_id, id, g.betrag, waehrung);
    if (!zeile) return sendeFehler(req, res, 404, 'nicht_gefunden');
    res.json({
      success: true, voucher: fuerAussen(zeile),
      angezeigt: g.angezeigt,
      // Damit die Oberflaeche es SAGEN kann: Eine stillschweigend geaenderte
      // Waehrung waere eine geaenderte Summe ohne Hinweis.
      waehrung_geaendert: waehrung !== alt.currency,
    });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

export = router;
