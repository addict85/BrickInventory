/**
 * /api/v1/vouchers — LEGO-Geschenkkarten im eigenen Profil.
 *
 * ── Marcos Vorgabe zur Architektur ──────────────────────────────────────────
 *
 *   „Bitte die Login jeweils nur 1x im Backend bauen. Beide Apps sollen die
 *    gleichen Services des Backends verwenden."
 *
 * Deshalb gibt es diese Datei EINMAL und keine Schwester unter routes/. Das
 * geht auf, weil requireToken aus ./middleware beides annimmt: das
 * Sitzungs-Cookie der Webapp UND den Bearer-Token der Android-App. Die Webapp
 * ruft /api/v1 ohnehin schon an gut fuenfzig Stellen an; dies ist keine
 * Ausnahme, sondern der Normalfall des Baums.
 *
 * ── Warum Gutscheine strenger behandelt werden als alles andere ─────────────
 *
 * Ueberall sonst im Baum gilt das Haushalts-Blickfeld: Der Grossvater sieht
 * die Sets der Enkel, scopeIds() uebersetzt das. HIER NICHT.
 *
 * Nummer und PIN sind alles, was zum Einloesen noetig ist. Wer sie sieht, kann
 * den Gutschein ausgeben — unabhaengig davon, wem er gehoert. Das ist etwas
 * anderes als zu sehen, WELCHE Sets jemand besitzt. Deshalb:
 *
 *   • kein scopeIds — nur der Eigentuemer, auch nicht der Haushalt,
 *   • kein Admin-Durchgriff,
 *   • die PDF-Datei liegt unter data/vouchers/ und NICHT unter data/uploads/,
 *     weil der dortige Ausliefer-Weg (serveDataFile in server.ts) genau die
 *     beiden Ausnahmen kennt, die hier nicht gelten sollen.
 *
 * Jede Abfrage traegt deshalb `user_id = $…` im WHERE, und zwar auch dort, wo
 * schon ueber die id gefiltert wird. Das ist keine doppelte Arbeit, sondern
 * der Unterschied zwischen „nicht gefunden" und „fremder Gutschein geliefert".
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { DATA_DIR } from '../../utils/appPaths';
import { handleRouteError } from '../../utils/httpError';
import { sendeFehler, type FehlerCode } from '../../utils/fehlerTexte';
import { liefereDatei } from '../../utils/dateiAusliefern';
import { requireToken } from './middleware';
import { werteAusPdf } from '../../utils/gutscheinPdf';

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
  note: string | null;
  pdf_path: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

/**
 * Eine Zeile fuer die Oberflaechen aufbereiten.
 *
 * `amount` kommt als Zeichenkette aus dem Treiber (NUMERIC wird nicht
 * automatisch zu einer Zahl, weil nicht jedes NUMERIC in einen double passt).
 * Beide Apps rechnen damit, also wird hier EINMAL umgewandelt statt zweimal
 * in den Oberflaechen — und `hat_pdf` gesagt, statt den Dateipfad
 * herauszugeben: Der Pfad geht niemanden etwas an, die Frage „gibt es ein
 * PDF" schon.
 */
function fuerAussen(z: GutscheinZeile) {
  return {
    id: z.id,
    number: z.number,
    pin: z.pin,
    amount: Number(z.amount),
    currency: z.currency,
    note: z.note,
    hat_pdf: !!z.pdf_path,
    created_at: z.created_at,
    updated_at: z.updated_at,
  };
}

const SPALTEN = 'id, number, pin, amount, currency, note, pdf_path, created_at, updated_at';

/**
 * Die drei Pflichtwerte pruefen.
 *
 * Gibt die geprueften Werte zurueck oder einen Fehlercode. Eigene Funktion,
 * weil DREI Wege hier hereinkommen — manuelles Anlegen, Anlegen aus dem PDF
 * und Aendern — und eine Pruefung, die an drei Stellen steht, steht bald in
 * drei Fassungen da.
 */
function pruefeWerte(roh: { number?: unknown; pin?: unknown; amount?: unknown; currency?: unknown }):
  { ok: true; number: string; pin: string | null; amount: number; currency: string } | { ok: false; code: FehlerCode } {
  const number = String(roh.number ?? '').replace(/[\s-]/g, '');
  if (!/^\d{4,25}$/.test(number)) return { ok: false, code: 'nummer_ungueltig' };

  const pinRoh = String(roh.pin ?? '').trim();
  if (pinRoh && !/^\d{3,10}$/.test(pinRoh)) return { ok: false, code: 'pin_ungueltig' };

  const amount = Number(roh.amount);
  // Auch die Null faellt durch: Ein Gutschein ueber 0 ist keiner, und ein
  // leeres Feld wird von Number() zur Null — ohne diese Grenze haette ein
  // vergessenes Feld stillschweigend einen Gutschein ueber nichts angelegt.
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) return { ok: false, code: 'betrag_ungueltig' };

  const currency = String(roh.currency ?? 'CHF').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, code: 'waehrung_ungueltig' };

  return { ok: true, number, pin: pinRoh || null, amount, currency };
}

/** Freitext kuerzen — dieselbe Grenze wie bei den Anleitungen. */
function notiz(roh: unknown): string | null {
  const s = String(roh ?? '').trim();
  return s ? s.slice(0, 500) : null;
}

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
      `INSERT INTO vouchers (user_id, number, pin, amount, currency, note)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id, number) DO NOTHING
       RETURNING ${SPALTEN}`,
      [req.apiUser.user_id, w.number, w.pin, w.amount, w.currency, notiz(req.body?.note)]);
    // DO NOTHING liefert KEINE Zeile zurueck, wenn es die Karte schon gibt.
    // Das ist der Unterschied zwischen „angelegt" und „war schon da" — und
    // beides stillschweigend als Erfolg zu melden, hiesse: Der Nutzer legt
    // zweimal an und sieht einmal nichts passieren.
    if (!zeile) return sendeFehler(req, res, 409, 'gutschein_existiert');
    res.json({ success: true, voucher: fuerAussen(zeile as GutscheinZeile) });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── POST /api/v1/vouchers/pdf — aus dem PDF anlegen ─────────────────────────
//
// EIN Weg fuer beide Apps und fuer beide Ausgaenge. Die Felder number, pin,
// amount und currency duerfen MITGESCHICKT werden; was mitkommt, gewinnt
// gegen das Ausgelesene. Damit deckt dieselbe Route drei Faelle ab:
//
//   1. Alles ausgelesen           → Gutschein wird angelegt.
//   2. Teilweise ausgelesen       → der Nutzer ergaenzt und schickt die Datei
//                                   samt seiner Werte noch einmal.
//   3. Nichts ausgelesen          → 422 mit dem, was gefunden wurde (also
//                                   nichts), und die Oberflaeche zeigt das
//                                   Formular mit leeren Feldern.
//
// Die Datei wird ERST GESPEICHERT, WENN DIE ZEILE STEHT. Andersherum bliebe
// nach jedem misslungenen Versuch eine Datei liegen, die niemandem gehoert
// und die niemand je wieder loescht.
router.post('/vouchers/pdf', requireToken, upload.single('file'), async (req: AuthedRequest, res) => {
  try {
    if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');

    // Scheitert das Auslesen (kaputtes PDF, Scan, fremdes Format), ist das
    // kein Fehler der Anfrage — es bleibt bei dem, was der Nutzer mitschickt.
    let gelesen: ReturnType<typeof werteAusPdf>;
    try { gelesen = werteAusPdf(req.file.buffer); }
    catch { gelesen = { nummer: null, pin: null, betrag: null, waehrung: null }; }

    const zusammen = {
      number:   req.body?.number   ?? gelesen.nummer,
      pin:      req.body?.pin      ?? gelesen.pin,
      amount:   req.body?.amount   ?? gelesen.betrag,
      currency: req.body?.currency ?? gelesen.waehrung ?? 'CHF',
    };
    const w = pruefeWerte(zusammen);
    if (!w.ok) {
      // 422 und nicht 400: Die Anfrage war in Ordnung, nur das PDF hat nicht
      // hergegeben, was gebraucht wird. `gelesen` geht mit zurueck, damit die
      // Oberflaeche die Felder vorbelegen kann, die sehr wohl da waren.
      return res.status(422).json({
        success: false, error: w.code,
        gelesen: { number: gelesen.nummer, pin: gelesen.pin, amount: gelesen.betrag, currency: gelesen.waehrung },
      });
    }

    const zeile = await db.get(
      `INSERT INTO vouchers (user_id, number, pin, amount, currency, note)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id, number) DO NOTHING
       RETURNING ${SPALTEN}`,
      [req.apiUser.user_id, w.number, w.pin, w.amount, w.currency, notiz(req.body?.note)]);
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

// ── PUT /api/v1/vouchers/:id — aendern ──────────────────────────────────────
router.put('/vouchers/:id', requireToken, async (req: AuthedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
    const alt = await db.get(`SELECT ${SPALTEN} FROM vouchers WHERE id = $1 AND user_id = $2`,
      [id, req.apiUser.user_id]) as GutscheinZeile | undefined;
    if (!alt) return sendeFehler(req, res, 404, 'nicht_gefunden');

    // Was nicht mitkommt, bleibt stehen. Ohne das loescht ein Formular, das
    // nur den Betrag schickt, Nummer und PIN.
    const w = pruefeWerte({
      number:   req.body?.number   ?? alt.number,
      pin:      req.body?.pin      ?? alt.pin,
      amount:   req.body?.amount   ?? alt.amount,
      currency: req.body?.currency ?? alt.currency,
    });
    if (!w.ok) return sendeFehler(req, res, 400, w.code);

    const zeile = await db.get(
      `UPDATE vouchers SET number=$1, pin=$2, amount=$3, currency=$4, note=$5, updated_at=NOW()
        WHERE id=$6 AND user_id=$7 RETURNING ${SPALTEN}`,
      [w.number, w.pin, w.amount, w.currency,
       req.body?.note === undefined ? alt.note : notiz(req.body.note),
       id, req.apiUser.user_id]);
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

export = router;
