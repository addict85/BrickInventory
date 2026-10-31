import { erzeugeWorker, type Bearbeitertabelle, type WorkerOptionen } from './auftragsWorker';
import { zieheNach, ladeSetBilder, type NacharbeitArt } from './nachErfassung';
import { erzeugePdf, pdfAufgegeben, type PdfNutzlast } from './pdfErzeugung';
import { fuehreCsvImportAus, csvImportAufgegeben, type CsvNutzlast } from './setCsvImport';
import { anleitungLaden } from './instructionQueue';
import { bricksetNachlauf } from './bricksetRetry';
import { bildbedarfAbarbeiten } from './imageQueue';
import { redownloadMissingImages, downloadSetImages } from './partsCatalogEnrich';
import { nachlauf } from './startNachlaeufe';
import { csvAbgleich } from './rebrickableCsvSync';
import { runPriceRefresh } from './priceJob';
import { bildNachlauf } from './bildNachlauf';
import { aufraeumen, aufraeumenTaeglich } from './aufraeumen';
import type { AuftragsArt } from '../utils/auftraege';
import { kursauftrag } from '../src/finanzen/wechselkurse';

/**
 * Welche Art wie bearbeitet wird. Die Nutzlast hat der Einsteller geschrieben.
 * Exklusiv sind Arten, die eine Gegenseite schonen oder Tabellen tauschen.
 */
const BEARBEITER: Bearbeitertabelle = {
  nacharbeit: {
    ausfuehren: (n) => zieheNach(String(n.set_number), Number(n.user_id), (n.art as NacharbeitArt) ?? 'neu'),
  },
  bilder: {
    ausfuehren: async (n) => { if (n.nur_bilder) await downloadSetImages(String(n.set_number)); else await ladeSetBilder(String(n.set_number)); },
  },
  pdf: {
    ausfuehren: (n) => erzeugePdf(n as unknown as PdfNutzlast),
    aufgegeben: (n, fehler) => pdfAufgegeben(n as unknown as PdfNutzlast, fehler),
  },
  csv_import: {
    ausfuehren: (n, k) => fuehreCsvImportAus(n as unknown as CsvNutzlast, k),
    aufgegeben: (n, fehler) => csvImportAufgegeben(n as unknown as CsvNutzlast, fehler),
  },
  wechselkurse:        { ausfuehren: () => kursauftrag() },
  anleitung:           { ausfuehren: (n) => anleitungLaden(n), exklusiv: true },
  brickset:            { ausfuehren: (n) => bricksetNachlauf(n), exklusiv: true },
  bildbedarf:          { ausfuehren: (_n, k) => bildbedarfAbarbeiten(k), exklusiv: true },
  bilder_neu_laden:    { ausfuehren: async () => { await redownloadMissingImages(); }, exklusiv: true },
  nachlauf:            { ausfuehren: (n) => nachlauf(n) },
  csv_sync:            { ausfuehren: (n) => csvAbgleich(n), exklusiv: true },
  preise:              { ausfuehren: (_n, k) => runPriceRefresh(k), exklusiv: true },
  bild_nachlauf:       { ausfuehren: (_n, k) => bildNachlauf(k), exklusiv: true },
  aufraeumen:          { ausfuehren: () => aufraeumen(), exklusiv: true },
  aufraeumen_taeglich: { ausfuehren: () => aufraeumenTaeglich(), exklusiv: true },
};

let _worker: ReturnType<typeof erzeugeWorker> | null = null;

/** Den Worker des Job-Prozesses starten; `arten` schränkt ein (Tests). */
function starteAuftragsWorker(o: WorkerOptionen & { arten?: AuftragsArt[] } = {}) {
  if (_worker) return _worker;
  const tabelle: Bearbeitertabelle = o.arten
    ? Object.fromEntries(o.arten.map(a => [a, BEARBEITER[a]])) : BEARBEITER;
  _worker = erzeugeWorker(tabelle, o);
  _worker.starte();
  return _worker;
}

/** Beim Herunterfahren: laufende Aufträge an sicherer Stelle anhalten und zurückgeben. */
async function stoppeAuftragsWorker(): Promise<void> {
  const w = _worker;
  _worker = null;
  if (w) await w.stoppe();
}

export { BEARBEITER, starteAuftragsWorker, stoppeAuftragsWorker };
