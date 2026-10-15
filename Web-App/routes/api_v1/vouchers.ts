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
  //
  // EINE Ausnahme, und sie kommt nicht aus der Eingabe: Eine ABGEFRAGTE Null
  // ist eine Auskunft — die Karte ist aufgebraucht (siehe die Guthaben-Route
  // unten, die `amount = 0` schreibt). Wer danach die PIN korrigiert, schickt
  // keinen Betrag mit; dann wird der gespeicherte uebernommen, und ohne diese
  // Ausnahme waere eine leergekaufte Karte nicht mehr aenderbar. Ein von Hand
  // eingetippte 0 faellt weiterhin durch.
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
      [req.apiUser.user_id, w.number, w.pin, w.amount, w.currency]);
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
      `INSERT INTO vouchers (user_id, number, pin, amount, currency)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, number) DO NOTHING
       RETURNING ${SPALTEN}`,
      [req.apiUser.user_id, w.number, w.pin, w.amount, w.currency]);
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

// ── Die beiden Sammelwege stehen VOR den :id-Wegen ──────────────────────────
//
// Express nimmt die ERSTE Route, die passt. Stand `/vouchers/export/pdf`
// hinter `/vouchers/:id/pdf`, fing `:id` das Wort „export", Number('export')
// ergab NaN, und die Antwort war 400 „id_ungueltig". GEMESSEN, nicht
// ueberlegt: Genau so ist der erste Lauf von
// test/gutscheine-export-import-db.test.js gescheitert.
//
// Eine Ziffernpruefung in der :id-Route waere die andere Loesung. Die
// Reihenfolge ist die bessere: Sie gilt fuer jeden weiteren Sammelweg, der
// hier einmal dazukommt, ohne dass jemand daran denken muss.

// ── GET /api/v1/vouchers/export/pdf — alle Gutscheine in EIN PDF ────────────
/**
 * Marcos Vorgabe: „Wenn alle Gutscheine exportiert werden sollen, ein PDF
 * erstellen mit allen Gutscheinen."
 *
 * Die Arbeit steckt in utils/gutscheinPdfSchreiben.ts; diese Route tut, was
 * eine Route tun soll: eigene Zeilen holen, Dateien dazulegen, ausliefern.
 *
 * ── Warum die Befunde in einen Kopf und nicht in den Rumpf ─────────────────
 *
 * Der Rumpf IST das PDF. Welche Gutscheine ersetzt wurden, welche unveraendert
 * durchgingen und warum, steht deshalb als Kopfzeile `X-Gutschein-Befunde`
 * dabei — die Oberflaeche liest sie und sagt es dem Nutzer. Ein zweiter Aufruf
 * nur fuer die Befunde hiesse, alles zweimal zu rechnen.
 *
 * Nur eigene Gutscheine (`user_id = $1`), kein Blickfeld: Dieselbe Regel wie im
 * ganzen Gutschein-Teil — die Karten liegen unter data/vouchers/<user>/ und
 * sind AUSSCHLIESSLICH ueber die eigene Route erreichbar (die Begruendung steht
 * in Migration 0026).
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

// ── POST /api/v1/vouchers/import/pdf — mehrere Gutscheine aus EINEM PDF ─────
/**
 * „Das PDF soll auch wieder importiert werden koennen (mehrere Seiten in einem
 * PDF ergeben mehrere Gutschein-Eintraege)."
 *
 * ── Warum eine EIGENE Route und nicht POST /vouchers/pdf erweitert ─────────
 *
 * Die bestehende Route legt EINEN Gutschein an und hat dafuer einen festen
 * Vertrag, auf dem beide Oberflaechen stehen: 422 mit `gelesen`, damit das
 * Formular sich vorbelegen laesst. Daraus eine Route zu machen, die manchmal
 * einen und manchmal zwanzig anlegt, hiesse diesen Vertrag aufzuweichen. Die
 * neue Route hat die Form der anderen Importe (added/updated/errors/results),
 * die beide Oberflaechen schon auswerten.
 *
 * ── Warum ON CONFLICT DO UPDATE und nicht DO NOTHING ──────────────────────
 *
 * Der Betrag ist genau das, was sich aendert: Ein Gutschein, von dem etwas
 * abgebucht wurde, soll beim Wiedereinlesen den NEUEREN Stand tragen. Mit DO
 * NOTHING waere der Import auf einem Konto, das die Karten schon kennt,
 * wirkungslos — und genau dann braucht man ihn.
 *
 * Die PIN zieht nur mit, wenn die Datei eine hat (COALESCE): Ein Sammel-PDF
 * ohne PIN darf eine gespeicherte nicht loeschen.
 *
 * Die Datei selbst wird NICHT gespeichert: Ein Sammel-PDF ist die Sicherung,
 * nicht die Karte. Jede Seite als eigene Datei abzulegen hiesse, dasselbe
 * Dokument zwanzigmal zu speichern.
 */
router.post('/vouchers/import/pdf', requireToken, upload.single('file'),
  async (req: AuthedRequest, res) => {
    try {
      if (!req.file) return sendeFehler(req, res, 400, 'keine_datei');
      const uid = req.apiUser.user_id;

      let gefunden;
      // Ein kaputtes PDF ist eine Aussage ueber die Datei, kein Serverfehler.
      try { gefunden = await seitenweiseLesen(req.file.buffer); }
      catch { return sendeFehler(req, res, 422, 'pdf_unlesbar'); }
      if (!gefunden.length) return sendeFehler(req, res, 422, 'kein_gutschein_im_pdf');

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
          [uid, geprueft.number, geprueft.pin, geprueft.amount, geprueft.currency]);
        if (neu?.war_neu) added++; else updated++;
        results.push({ number: geprueft.number, action: neu?.war_neu ? 'added' : 'updated' });
      }

      res.json({ success: true, added, updated, errors,
                 total: gefunden.length, results });
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
    }, { nullBetragErlaubt: req.body?.amount === undefined });
    if (!w.ok) return sendeFehler(req, res, 400, w.code);

    const zeile = await db.get(
      `UPDATE vouchers SET number=$1, pin=$2, amount=$3, currency=$4, updated_at=NOW()
        WHERE id=$5 AND user_id=$6 RETURNING ${SPALTEN}`,
      [w.number, w.pin, w.amount, w.currency, id, req.apiUser.user_id]);
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

// ── POST /api/v1/vouchers/:id/guthaben — das Guthaben bei LEGO abfragen ─────
//
// ── Marcos Vorgaben ─────────────────────────────────────────────────────────
//
//   „Kannst du dies bei den Gutscheinen einbauen, damit dies auf Knopfdruck
//    abgefragt und gespeichert werden kann?"
//
//   „Wichtig das Ausgabeland soll in den Einstellungen bei den Gutscheinen
//    fuer alle erfasst werden koennen (wie in der Prototyp-App). Der
//    Zurueckgemeldete Betrag soll im Feld Betrag gespeichert werden."
//
// ── EINE Route, auch fuer „alle abfragen" ───────────────────────────────────
//
// Es gibt keinen zweiten Endpunkt, der alle Karten durchgeht. Das ist keine
// Sparsamkeit, sondern die Folge von Marcos Grenze: hoechstens ein Aufruf je
// 30 Sekunden ueber ALLE Benutzer. Eine Sammelroute muesste diese Wartezeit
// INNERHALB einer HTTP-Anfrage absitzen — bei fuenf Karten gut zwei Minuten,
// mit einer offenen Verbindung und einer Antwort, die niemand mehr abholt,
// wenn der Browser vorher aufgibt.
//
// Stattdessen taktet die Oberflaeche: Sie ruft diese Route je Karte auf, und
// wenn sie 429 bekommt, wartet sie die gemeldeten `wartenSek` ab. Die Grenze
// bleibt dabei dort, wo sie hingehoert — auf dem Server
// (utils/gutscheinGuthabenSchranke.ts). Ein Client, der sich nicht taktet,
// bekommt 429 und sonst nichts.
//
// ── Was NICHT gespeichert wird ──────────────────────────────────────────────
//
// Der formatierte Text der Gegenseite („CHF 250.00") geht in die Antwort,
// aber in keine Spalte: Er ist in der Sprache und Schreibweise des
// Ausgabelandes, und die Anzeige formatiert selbst (fmtN). Gespeichert werden
// Betrag, Waehrung und der Zeitpunkt — nicht mehr.
router.post('/vouchers/:id/guthaben', requireToken, async (req: AuthedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return sendeFehler(req, res, 400, 'id_ungueltig');
    const alt = await db.get(`SELECT ${SPALTEN} FROM vouchers WHERE id = $1 AND user_id = $2`,
      [id, req.apiUser.user_id]) as GutscheinZeile | undefined;
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
      //
      // verdecke() noch einmal, obwohl die fremden Texte es schon durchlaufen
      // haben: Hier kommen auch Fehler durch, die NICHT aus
      // gutscheinGuthaben.ts stammen (ein Netzfehler des Treibers etwa), und
      // die Zusicherung „die PIN steht in keinem Protokoll" soll an der
      // Stelle gelten, an der der Text die Anwendung verlaesst.
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
