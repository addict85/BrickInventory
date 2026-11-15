/** Die Gutscheine eines Kontos: Anlegen (auch aus dem PDF), Ändern, Löschen,
 * Freigaben und Guthaben. Eine Absage ist ein Fachfehler; die Route wählt nur
 * die Antwort. */
import fs from 'node:fs';
import path from 'node:path';
import { Fachfehler, alsDoppelt, fachfehler, type FehlerCode } from '../infra/fehlerTexte';
import { ohneFehlendeDatei } from '../infra/fehler';
import type { GutscheinZeile } from './repository/gutscheine';
import {
  VOUCHER_DIR,
  gutscheinDatei,
  liesGutscheinPdf,
  liesGutscheinPdfOderNichts,
  schreibeGutscheinPdf,
} from './gutscheinDateien';
import { landErlaubt, landFuerWaehrung } from './gutscheinGuthaben';
import { frageGuthabenAb, type Gesperrt } from './gutscheinGuthabenSchranke';
import type { GutscheinWerte } from './gutscheinPdf';
import { verbindeGutscheine } from './gutscheinPdfSchreiben';
import { stelleTicketAus } from './pdfTicket';
import { HOECHSTENS_SEITEN, liesImHintergrund } from './pdfLesen';
import type { GutscheineKontext } from './kontext';
import { PIN_MASKE, gutscheinNummer, gutscheinPin, gutscheinWaehrung, nummerMaske } from '../infra/gutscheinWerte';

export type { GutscheinZeile } from './repository/gutscheine';

export { PIN_MASKE } from '../infra/gutscheinWerte';

export const maskiert = (z: { number: string; pin: string | null }) => ({
  number: nummerMaske(z.number),
  pin: z.pin ? PIN_MASKE : null,
});

type Geprueft = { number: string; pin: string | null; amount: number; currency: string | null };
/** Was der Vertrag geprüft hat (src/vertrag/gutscheine.ts): Format von Nummer, PIN und Währung. */
export interface NeuerGutschein {
  number: string;
  pin?: string | null | undefined;
  amount: number | null | undefined;
  currency?: string | null | undefined;
}

/** Der Betrag ist eine Fachregel, kein Format: Eine Null legte sonst einen Gutschein über nichts an. */
function betrag(roh: number | null | undefined, nullErlaubt = false): number {
  const amount = roh ?? Number.NaN;
  if (!Number.isFinite(amount) || amount > 1_000_000 || (nullErlaubt ? amount < 0 : amount <= 0))
    fachfehler('ungueltig', 'betrag_ungueltig');
  return amount;
}

const geprueft = (w: NeuerGutschein, nullErlaubt = false): Geprueft => ({
  number: w.number,
  pin: w.pin ?? null,
  amount: betrag(w.amount, nullErlaubt),
  currency: w.currency ?? null,
});

type Roh = { number?: unknown; pin?: unknown; amount?: unknown; currency?: unknown };

/** Nur für Werte, die der Server selbst aus einem PDF liest: Eingaben prüft der Vertrag. */
export function pruefeWerte(roh: Roh): ({ ok: true } & Geprueft) | { ok: false; code: FehlerCode } {
  try {
    return {
      ok: true,
      number: gutscheinNummer(roh.number == null ? '' : String(roh.number)),
      pin: gutscheinPin(roh.pin == null ? null : String(roh.pin)),
      // Number('') ist 0 und fällt am Betrag durch.
      amount: betrag(Number(roh.amount)),
      currency: gutscheinWaehrung(roh.currency == null ? null : String(roh.currency)),
    };
  } catch (e) {
    if (e instanceof Fachfehler) return { ok: false, code: e.code };
    throw e;
  }
}

const repo = (k: GutscheineKontext) => k.gutscheine;

export function gutscheinListe(k: GutscheineKontext, uid: number, ordnung?: 'neueste' | 'aelteste') {
  return repo(k).gutscheineDesKontos(uid, ordnung);
}

async function vorhanden(k: GutscheineKontext, uid: number, id: number): Promise<GutscheinZeile> {
  return (await repo(k).gutschein(uid, id)) ?? fachfehler('nicht_gefunden', 'nicht_gefunden');
}

/** Keine Zeile heisst „war schon da" — als Erfolg sähe der Nutzer nichts passieren. */
export async function gutscheinErfassen(k: GutscheineKontext, uid: number, e: NeuerGutschein): Promise<GutscheinZeile> {
  return (await repo(k).gutscheinAnlegen(uid, geprueft(e))) ?? fachfehler('konflikt', 'gutschein_existiert');
}

/** Der Stapelfall eines Sammel-PDFs: Was es schon gibt, wird ersetzt. */
export async function stapelAnlegen(k: GutscheineKontext, uid: number, gefunden: GutscheinWerte[]) {
  let added = 0,
    updated = 0,
    errors = 0;
  const results: { number: string; action: string; error?: string }[] = [];
  for (const g of gefunden) {
    const w = pruefeWerte({ number: g.nummer, pin: g.pin, amount: g.betrag, currency: g.waehrung });
    if (!w.ok) {
      errors++;
      results.push({ number: String(g.nummer ?? ''), action: 'error', error: w.code });
      continue;
    }
    const warNeu = await repo(k).gutscheinErsetzen(uid, w);
    if (warNeu) added++;
    else updated++;
    results.push({ number: w.number, action: warNeu ? 'added' : 'updated' });
  }
  return { added, updated, errors, total: gefunden.length, results };
}

/** Zeile und Datei zusammen oder gar nicht: Die Datei entsteht in der Transaktion
 * vor dem COMMIT und fällt wieder, wenn danach etwas scheitert. Sonst bliebe eine
 * Zeile ohne PDF oder ein verschlüsseltes PDF ohne Zeile. */
export async function gutscheinMitPdfAnlegen(
  k: GutscheineKontext,
  uid: number,
  w: Geprueft,
  pdf: Buffer,
): Promise<GutscheinZeile> {
  const geschrieben: string[] = [];
  try {
    return await k.transaktion(async t => {
      const z = (await repo(t).gutscheinAnlegen(uid, w)) ?? fachfehler('konflikt', 'gutschein_existiert');
      // Dateiname aus der ID, nicht aus dem Upload: Ein Name vom Klienten müsste gegen Pfadanteile geprüft werden.
      const relPfad = `${uid}/${z.id}.pdf`;
      geschrieben.push(path.join(VOUCHER_DIR, relPfad));
      await schreibeGutscheinPdf(geschrieben[0]!, pdf);
      await repo(t).gutscheinPdfMerken(uid, z.id, relPfad);
      return { ...z, pdf_path: relPfad };
    });
  } catch (e) {
    for (const datei of geschrieben)
      await fs.promises.unlink(datei).catch(ohneFehlendeDatei('gutschein:pdf zurücknehmen'));
    throw e;
  }
}

export type AusPdf =
  | { art: 'stapel'; bericht: Awaited<ReturnType<typeof stapelAnlegen>> }
  | { art: 'angelegt'; zeile: GutscheinZeile; gelesen: GutscheinWerte };

/** Die Felder der Formulare: So belegt die Oberfläche sie nach einer Absage vor. */
export const alsGelesen = (g: GutscheinWerte) => ({
  number: g.nummer,
  pin: g.pin,
  currency: g.waehrung,
  ...(g.betrag == null ? {} : { amount: g.betrag }),
});

const NICHTS_GELESEN: GutscheinWerte = { nummer: null, pin: null, betrag: null, waehrung: null };

/** Ein Weg für beide Apps: Getippte Felder gewinnen gegen das Ausgelesene. Erst ab
 * zwei Seiten ein Stapel; bei einer bleibt der 422-Vertrag der Formulare. */
export async function gutscheinAusPdf(
  k: GutscheineKontext,
  uid: number,
  pdf: Buffer,
  getippt: GutscheinAenderung,
): Promise<AusPdf> {
  const lesung = await liesImHintergrund(pdf);
  if (lesung.art === 'zu_viele_seiten')
    fachfehler('nicht_verarbeitbar', 'pdf_zu_viele_seiten', { seiten: lesung.seiten, max: HOECHSTENS_SEITEN });
  if (lesung.art === 'unlesbar') fachfehler('nicht_verarbeitbar', 'pdf_unlesbar');
  if (lesung.stapel.length >= 2) return { art: 'stapel', bericht: await stapelAnlegen(k, uid, lesung.stapel) };
  // Der Medientyp ist eine Behauptung des Klienten: Geprüft wird die Signatur, denn
  // die Datei geht später als application/pdf hinaus. Eine Entpackbombe gäbe der
  // Export an pdf-lib, das ohne Grenze entpackt.
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-' || lesung.einzeln === 'zu_gross')
    fachfehler('nicht_verarbeitbar', 'pdf_unlesbar');
  const gelesen = typeof lesung.einzeln === 'object' ? lesung.einzeln : NICHTS_GELESEN;
  const roh = {
    number: getippt.number ?? gelesen.nummer,
    pin: getippt.pin ?? gelesen.pin,
    amount: getippt.amount ?? gelesen.betrag,
    currency: getippt.currency ?? gelesen.waehrung,
  };
  const w = pruefeWerte(roh);
  if (w.ok) return { art: 'angelegt', zeile: await gutscheinMitPdfAnlegen(k, uid, w, pdf), gelesen };
  // Drei Absagen, weil der Nutzer bei jeder etwas anderes tun muss.
  const nichtsGetippt = !getippt.number && !getippt.pin && !getippt.amount;
  const nichtsGelesen = gelesen.nummer == null && gelesen.betrag == null;
  const code: FehlerCode =
    lesung.einzeln === 'fehler' ? 'pdf_unlesbar' : nichtsGelesen && nichtsGetippt ? 'kein_gutschein_im_pdf' : w.code;
  // 422: Die Anfrage war in Ordnung, nur das PDF gab nicht alles her; `gelesen` belegt die Felder vor.
  throw new Fachfehler('nicht_verarbeitbar', code, undefined, { gelesen: alsGelesen(gelesen) });
}

export interface GutscheinAenderung {
  number?: string | undefined;
  pin?: string | null | undefined;
  amount?: number | null | undefined;
  currency?: string | null | undefined;
}

/** Lesen, mischen, schreiben unter der Zeilensperre: Zwei gleichzeitige Änderungen
 * an verschiedenen Feldern gehen sonst eine verloren. Was nicht mitkommt oder
 * maskiert zurückkommt, bleibt stehen: Das Formular kennt nur die Maske. */
export function gutscheinBearbeiten(
  k: GutscheineKontext,
  uid: number,
  id: number,
  e: GutscheinAenderung,
): Promise<GutscheinZeile> {
  return k
    .transaktion(async t => {
      const alt = (await repo(t).gutscheinGesperrt(uid, id)) ?? fachfehler('nicht_gefunden', 'nicht_gefunden');
      const maske = maskiert(alt);
      const w = geprueft(
        {
          number: e.number === undefined || e.number === maske.number ? alt.number : e.number,
          pin: e.pin === PIN_MASKE ? alt.pin : e.pin === '' ? null : (e.pin ?? alt.pin),
          amount: e.amount ?? Number(alt.amount),
          currency: e.currency === '' ? null : (e.currency ?? alt.currency),
        },
        e.amount === undefined,
      );
      return (await repo(t).gutscheinAendern(uid, id, w)) ?? fachfehler('nicht_gefunden', 'nicht_gefunden');
    })
    .catch(alsDoppelt('gutschein_existiert'));
}

/** Erst die Zeile, dann die Datei: lieber eine verwaiste Datei als eine Zeile ins Leere. */
export async function gutscheinEntfernen(k: GutscheineKontext, uid: number, id: number): Promise<void> {
  const pdfPfad = await repo(k).gutscheinLoeschen(uid, id);
  if (pdfPfad === undefined) fachfehler('nicht_gefunden', 'nicht_gefunden');
  const datei = pdfPfad ? gutscheinDatei(uid, pdfPfad) : null;
  if (datei) await fs.promises.unlink(datei).catch(ohneFehlendeDatei('gutschein:pdf löschen'));
}

export async function gutscheinKlartext(k: GutscheineKontext, uid: number, id: number): Promise<GutscheinZeile> {
  const z = await vorhanden(k, uid, id);
  await k.konto.verwalter.verwalterAktionMerken(uid, uid, 'gutschein_klartext', maskiert(z).number);
  return z;
}

/** Die PDFs tragen Nummer und PIN: erst protokollieren, dann ein Ticket für genau einen Abruf. */
export async function pdfFreigeben(k: GutscheineKontext, uid: number, id: number): Promise<string> {
  const z = await vorhanden(k, uid, id);
  if (!z.pdf_path) fachfehler('nicht_gefunden', 'nicht_gefunden');
  await k.konto.verwalter.verwalterAktionMerken(uid, uid, 'gutschein_pdf', maskiert(z).number);
  return stelleTicketAus(k, uid, String(id));
}

export async function ausfuhrFreigeben(k: GutscheineKontext, uid: number): Promise<string> {
  const n = (await gutscheinListe(k, uid)).length;
  if (!n) fachfehler('nicht_gefunden', 'keine_gutscheine');
  await k.konto.verwalter.verwalterAktionMerken(uid, uid, 'gutschein_export', `${n}`);
  return stelleTicketAus(k, uid, 'export');
}

export async function gutscheinPdf(k: GutscheineKontext, uid: number, id: number): Promise<Buffer> {
  const z = await vorhanden(k, uid, id);
  const datei = z.pdf_path ? gutscheinDatei(uid, z.pdf_path) : null;
  const pdf = datei ? await liesGutscheinPdf(datei).catch(ohneFehlendeDatei('gutschein:pdf lesen', null)) : null;
  return pdf ?? fachfehler('nicht_gefunden', 'nicht_gefunden');
}

/** Eine fehlende Datei bricht den Export nicht ab, sonst nähme sie alle anderen Gutscheine mit. */
export async function gutscheineExportieren(k: GutscheineKontext, uid: number) {
  const zeilen = await gutscheinListe(k, uid, 'aelteste');
  if (!zeilen.length) fachfehler('nicht_gefunden', 'keine_gutscheine');
  const gutscheine = [];
  for (const z of zeilen)
    gutscheine.push({
      id: z.id,
      number: z.number,
      pin: z.pin,
      amount: Number(z.amount),
      currency: z.currency,
      pdf: z.pdf_path ? await liesGutscheinPdfOderNichts(gutscheinDatei(uid, z.pdf_path)) : null,
    });
  return verbindeGutscheine(gutscheine);
}

export type GuthabenErgebnis =
  | ({ art: 'gesperrt' } & Gesperrt)
  | { art: 'guthaben'; zeile: GutscheinZeile; angezeigt: string | null; waehrungGeaendert: boolean };

/** Die PIN und das Land prüft es VOR der Schranke: Ein Aufruf, der nicht stattfinden
 * kann, soll den einen Platz je 30 Sekunden nicht verbrauchen. Das Land gilt für
 * die ganze Installation, weil eine Karte nur im Shop ihres Ausgabelandes gilt. */
export async function guthabenAbfragen(k: GutscheineKontext, uid: number, id: number): Promise<GuthabenErgebnis> {
  const alt = await vorhanden(k, uid, id);
  if (!alt.pin) fachfehler('ungueltig', 'guthaben_pin_fehlt');
  const land = String(
    (await k.einstellungen.globalerWert('gutschein_land', '')) ||
      landFuerWaehrung(await k.einstellungen.nutzerWert(uid, 'currency', 'EUR')),
  );
  if (!landErlaubt(land)) fachfehler('ungueltig', 'guthaben_land_ungueltig');
  const ergebnis = await frageGuthabenAb(k, uid, alt.number, alt.pin, { locale: land });
  if (ergebnis.art === 'gesperrt') return ergebnis;
  const g = ergebnis.guthaben;
  // Die Währung der Gegenseite gewinnt; eine unbrauchbare Angabe zerstörte sonst die Summe der Liste.
  const waehrung = /^[A-Z]{3}$/.test(g.waehrung) ? g.waehrung : alt.currency;
  const zeile =
    (await repo(k).guthabenMerken(uid, id, g.betrag, waehrung)) ?? fachfehler('nicht_gefunden', 'nicht_gefunden');
  return { art: 'guthaben', zeile, angezeigt: g.angezeigt, waehrungGeaendert: waehrung !== alt.currency };
}
