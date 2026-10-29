/**
 * /api/v1/vouchers — LEGO-Geschenkkarten im eigenen Profil.
 * Ausführlich: docs/begruendungen/routes/api_v1/vouchers.ts.md#abschnitt
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import { verschluessele, entschluessele } from '../../utils/geheimnis';
import multer from 'multer';
import { DATA_DIR } from '../../utils/appPaths';
import { handleRouteError } from '../../utils/httpError';
import { sendeFehler, fehlerText, antwortSprache, type FehlerCode } from '../../utils/fehlerTexte';
import { getGlobalSetting } from '../../utils/settings';
import { verdecke, landErlaubt, LAND_STANDARD } from '../../utils/gutscheinGuthaben';
import { frageGuthabenAb, ABSTAND_SEK } from '../../utils/gutscheinGuthabenSchranke';
import { liefereDatei } from '../../utils/dateiAusliefern';
import { requireToken } from './middleware';
import { werteAusPdf } from '../../utils/gutscheinPdf';
import { verbindeGutscheine, seitenweiseLesen } from '../../utils/gutscheinPdfSchreiben';
import type { ExportGutschein } from '../../utils/gutscheinPdfSchreiben';

const db = require('../../db/database') as typeof import('../../db/database');

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
  // 20 MB. Marcos Beispiel wiegt 206 KB; der Spielraum ist fuer PDFs mit
  // eingebetteten Schriften und Bildern, nicht fuer Buecher.
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    // Woertlicher Vergleich statt Tabellenzugriff: Bei genau EINEM erlaubten
    // Typ gibt es nichts nachzuschlagen — und damit auch nicht den geerbten
    // Wert, an dem der Anleitungs-Upload einmal vorbeigelaufen ist (die
    // Begruendung steht dort bei INSTR_EXT_BY_MIME).
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('nur_pdf'));
  },
});

/** Eine Datenbankzeile, wie die Oberflaechen sie bekommen. */
interface GutscheinZeile {
  id: number;
  number: string;
  pin: string | null;
  amount: string | number;
  currency: string;
  pdf_path: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  /** Wann das Guthaben zuletzt bei LEGO abgefragt wurde, oder NULL. */
  guthaben_geprueft_am: string | Date | null;
}

/**
 * Eine Zeile fuer die Oberflaechen aufbereiten.
 * Ausführlich: docs/begruendungen/routes/api_v1/vouchers.ts.md#fueraussen
 */
function fuerAussen(z: GutscheinZeile) {
  return {
    id: z.id,
    number: z.number,
    pin: entschluessele(z.pin),
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

const SPALTEN = 'id, number, pin, amount, currency, pdf_path, created_at, updated_at, '
              + 'guthaben_geprueft_am';

/**
 * Die drei Pflichtwerte pruefen.
 *
 * Gibt die geprueften Werte zurueck oder einen Fehlercode. Eigene Funktion,
 * weil DREI Wege hier hereinkommen — manuelles Anlegen, Anlegen aus dem PDF
 * und Aendern — und eine Pruefung, die an drei Stellen steht, steht bald in
 * drei Fassungen da.
 */
function pruefeWerte(roh: { number?: unknown; pin?: unknown; amount?: unknown; currency?: unknown },
                     opt: { nullBetragErlaubt?: boolean } = {}):
  { ok: true; number: string; pin: string | null; amount: number; currency: string } | { ok: false; code: FehlerCode } {
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

  const currency = String(roh.currency ?? 'CHF').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, code: 'waehrung_ungueltig' };

  return { ok: true, number, pin: pinRoh || null, amount, currency };
}

// `notiz()` stand hier und kuerzte den Freitext. ENTFALLEN mit der Notiz
// selbst (Migration 0027): Marcos Vorgabe war „vollstaendig inkl. Spalten auf
// der Datenbank entfernen". Ein Helfer ohne Aufrufer waere genau der Rest, der
// beim naechsten Durchgang die Frage aufwirft, wofuer er da ist.

// ── GET /api/v1/vouchers — die eigenen Gutscheine ───────────────────────────
router.get('/vouchers', requireToken, async (req: AuthedRequest, res) => {
  try {
    const zeilen = await db.all(
      `SELECT ${SPALTEN} FROM vouchers WHERE user_id = $1 ORDER BY created_at DESC, id DESC`,
      [req.apiUser.user_id]);
    res.json({ success: true, vouchers: (zeilen as GutscheinZeile[]).map(fuerAussen) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── POST /api/v1/vouchers — manuell anlegen ─────────────────────────────────
router.post('/vouchers', requireToken, async (req: AuthedRequest, res) => {
  try {
    const w = pruefeWerte(req.body || {});
    if (!w.ok) return sendeFehler(req, res, 400, w.code);
    const zeile = await db.get(
      `INSERT INTO vouchers (user_id, number, pin, amount, currency)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, number) DO NOTHING
       RETURNING ${SPALTEN}`,
      [req.apiUser.user_id, w.number, verschluessele(w.pin), w.amount, w.currency]);
    // DO NOTHING liefert KEINE Zeile zurueck, wenn es die Karte schon gibt.
    // Das ist der Unterschied zwischen „angelegt" und „war schon da" — und
    // beides stillschweigend als Erfolg zu melden, hiesse: Der Nutzer legt
    // zweimal an und sieht einmal nichts passieren.
    if (!zeile) return sendeFehler(req, res, 409, 'gutschein_existiert');
    res.json({ success: true, voucher: fuerAussen(zeile as GutscheinZeile) });
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
      number: w.nummer, pin: w.pin, amount: w.betrag, currency: w.waehrung ?? 'CHF',
    });
    if (!geprueft.ok) {
      errors++;
      results.push({ number: String(w.nummer ?? ''), action: 'error', error: geprueft.code });
      continue;
    }
    const neu = await db.get(
      `INSERT INTO vouchers (user_id, number, pin, amount, currency)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, number) DO UPDATE
          SET pin = COALESCE(EXCLUDED.pin, vouchers.pin),
              amount = EXCLUDED.amount,
              currency = EXCLUDED.currency,
              updated_at = NOW()
       RETURNING id, (xmax = 0) AS war_neu`,
      [uid, geprueft.number, verschluessele(geprueft.pin), geprueft.amount, geprueft.currency]);
    if (neu?.war_neu) added++; else updated++;
    results.push({ number: geprueft.number, action: neu?.war_neu ? 'added' : 'updated' });
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
    catch { lesefehler = true; gelesen = { nummer: null, pin: null, betrag: null, waehrung: null }; }

    const zusammen = {
      number:   req.body?.number   ?? gelesen.nummer,
      pin:      req.body?.pin      ?? gelesen.pin,
      amount:   req.body?.amount   ?? gelesen.betrag,
      currency: req.body?.currency ?? gelesen.waehrung ?? 'CHF',
    };
    const w = pruefeWerte(zusammen);
    if (!w.ok) {
      // ── Drei verschiedene Absagen, und der Nutzer tut bei jeder etwas
      //    anderes ───────────────────────────────────────────────────────────
      //
      // Bis zum Zusammenlegen der beiden Dateifelder standen die ersten zwei
      // Texte in der Stapel-Route; hier gab es nur den Feldcode, also etwa
      // „betrag_ungueltig" fuer eine Datei, die gar kein PDF ist. Das war
      // schon vorher schief, ist aber erst jetzt aufgefallen: Seit es EINEN
      // Weg gibt, kommt auch die kaputte Datei hier an.
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

    const zeile = await db.get(
      `INSERT INTO vouchers (user_id, number, pin, amount, currency)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, number) DO NOTHING
       RETURNING ${SPALTEN}`,
      [req.apiUser.user_id, w.number, verschluessele(w.pin), w.amount, w.currency]);
    if (!zeile) return sendeFehler(req, res, 409, 'gutschein_existiert');

    const z = zeile as GutscheinZeile;
    const dir = path.join(VOUCHER_DIR, String(req.apiUser.user_id));
    await fs.promises.mkdir(dir, { recursive: true });
    // Der Dateiname kommt aus der id, NICHT aus dem hochgeladenen Namen: Ein
    // Name vom Klienten ist eine Behauptung und muesste gegen Pfadanteile
    // geprueft werden. Die id ist eine Zahl aus der eigenen Datenbank.
    const datei = `${z.id}.pdf`;
    await fs.promises.writeFile(path.join(dir, datei), req.file.buffer);
    const relPfad = `${req.apiUser.user_id}/${datei}`;
    await db.run('UPDATE vouchers SET pdf_path = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3',
      [relPfad, z.id, req.apiUser.user_id]);

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
/**
 * Die Arbeit steckt in utils/gutscheinPdfSchreiben.ts; diese Route tut, was
 * eine Route tun soll: eigene Zeilen holen, Dateien dazulegen, ausliefern.
 * Ausführlich: docs/begruendungen/routes/api_v1/vouchers.ts.md#get-vouchers-export-pdf
 */
router.get('/vouchers/export/pdf', requireToken, async (req: AuthedRequest, res) => {
  try {
    const uid = req.apiUser.user_id;
    const zeilen = await db.all(
      `SELECT ${SPALTEN} FROM vouchers WHERE user_id = $1 ORDER BY created_at, id`,
      [uid]) as GutscheinZeile[];
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
      gutscheine.push({ id: z.id, number: z.number, pin: entschluessele(z.pin),
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
    const alt = await db.get(`SELECT ${SPALTEN} FROM vouchers WHERE id = $1 AND user_id = $2`,
      [id, req.apiUser.user_id]) as GutscheinZeile | undefined;
    if (!alt) return sendeFehler(req, res, 404, 'nicht_gefunden');
    alt.pin = entschluessele(alt.pin);

    // Was nicht mitkommt, bleibt stehen. Ohne das loescht ein Formular, das
    // nur den Betrag schickt, Nummer und PIN.
    const w = pruefeWerte({
      number:   req.body?.number   ?? alt.number,
      pin:      req.body?.pin      ?? alt.pin,
      amount:   req.body?.amount   ?? alt.amount,
      currency: req.body?.currency ?? alt.currency,
    }, { nullBetragErlaubt: req.body?.amount === undefined });
    if (!w.ok) return sendeFehler(req, res, 400, w.code);

    const zeile = await db.get(
      `UPDATE vouchers SET number=$1, pin=$2, amount=$3, currency=$4, updated_at=NOW()
        WHERE id=$5 AND user_id=$6 RETURNING ${SPALTEN}`,
      [w.number, verschluessele(w.pin), w.amount, w.currency, id, req.apiUser.user_id]);
    res.json({ success: true, voucher: fuerAussen(zeile as GutscheinZeile) });
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
    const zeile = await db.get('SELECT pdf_path FROM vouchers WHERE id = $1 AND user_id = $2',
      [id, req.apiUser.user_id]) as { pdf_path: string | null } | undefined;
    if (!zeile) return sendeFehler(req, res, 404, 'nicht_gefunden');
    await db.run('DELETE FROM vouchers WHERE id = $1 AND user_id = $2', [id, req.apiUser.user_id]);

    // Erst die Zeile, dann die Datei — dieselbe Reihenfolge wie bei den
    // Anleitungen. Anders als dort kann die Datei hier niemandem sonst
    // gehoeren (sie traegt die id des Gutscheins), also braucht es keine
    // Zaehlung. Scheitert das Loeschen, bleibt eine verwaiste Datei liegen;
    // das ist unschoen, aber besser als eine Zeile, die ins Leere zeigt.
    if (zeile.pdf_path) {
      const p = sicherePdfDatei(req.apiUser.user_id, zeile.pdf_path);
      if (p) await fs.promises.unlink(p).catch(() => { /* schon weg: in Ordnung */ });
    }
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

/**
 * Aus dem gespeicherten Pfad einen echten Dateipfad machen — oder null.
 *
 * Der Pfad kommt zwar aus der eigenen Datenbank und nicht vom Klienten, aber
 * genau diese Annahme ist die, die irgendwann nicht mehr stimmt. Geprueft
 * wird deshalb beides: dass das erste Segment der anfragende Nutzer ist, und
 * dass das Ergebnis unterhalb von data/vouchers/ liegt.
 */
function sicherePdfDatei(userId: number, pdfPath: string): string | null {
  const basis = path.resolve(VOUCHER_DIR, String(userId));
  const ziel = path.resolve(VOUCHER_DIR, pdfPath);
  // `startsWith(basis + sep)` und nicht nur `startsWith(basis)`: Sonst gilt
  // /data/vouchers/12 als unterhalb von /data/vouchers/1.
  return ziel.startsWith(basis + path.sep) ? ziel : null;
}

// ── GET /api/v1/vouchers/:id/pdf — anzeigen oder herunterladen ──────────────
//
// Marcos Vorgabe: „Das PDF soll jeweils auch wieder heruntergeladen, resp. in
// einem neuen Fenster angezeigt werden können." Beides ist dieselbe Datei und
// unterscheidet sich nur im Content-Disposition — deshalb EINE Route mit
// `?download=1`, nicht zwei.
router.get('/vouchers/:id/pdf', requireToken, async (req: AuthedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
    const zeile = await db.get('SELECT pdf_path, number FROM vouchers WHERE id = $1 AND user_id = $2',
      [id, req.apiUser.user_id]) as { pdf_path: string | null; number: string } | undefined;
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
    const alt = await db.get(`SELECT ${SPALTEN} FROM vouchers WHERE id = $1 AND user_id = $2`,
      [id, req.apiUser.user_id]) as GutscheinZeile | undefined;
    if (!alt) return sendeFehler(req, res, 404, 'nicht_gefunden');
    alt.pin = entschluessele(alt.pin);

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
    const zeile = await db.get(
      `UPDATE vouchers SET amount = $1, currency = $2,
              guthaben_geprueft_am = NOW(), updated_at = NOW()
        WHERE id = $3 AND user_id = $4 RETURNING ${SPALTEN}`,
      [g.betrag, waehrung, id, req.apiUser.user_id]);
    res.json({
      success: true, voucher: fuerAussen(zeile as GutscheinZeile),
      angezeigt: g.angezeigt,
      // Damit die Oberflaeche es SAGEN kann: Eine stillschweigend geaenderte
      // Waehrung waere eine geaenderte Summe ohne Hinweis.
      waehrung_geaendert: waehrung !== alt.currency,
    });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

export = router;
