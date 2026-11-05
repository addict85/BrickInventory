import { erzeugeWorker, type Bearbeitertabelle, type WorkerOptionen } from './auftragsWorker';
import { zieheNach, ladeSetBilder } from './nachErfassung';
import { erzeugePdf, pdfAufgegeben } from './pdfErzeugung';
import { fuehreCsvImportAus, csvImportAufgegeben } from './setCsvImport';
import { fuehreImportAus } from './importAuftraege';
import { anleitungLaden } from './instructionQueue';
import { bricksetNachlauf } from './bricksetRetry';
import { bildbedarfAbarbeiten } from './imageQueue';
import { redownloadMissingImages, downloadSetImages } from '../src/katalog/teileAnreicherung';
import { nachlauf } from './startNachlaeufe';
import { csvAbgleich } from './rebrickableCsvSync';
import { runPriceRefresh } from './priceJob';
import { bildNachlauf } from './bildNachlauf';
import { aufraeumen, aufraeumenTaeglich } from './aufraeumen';
import type { AuftragsArt } from '../src/auftraege/auftraege';
import { kursauftrag } from '../src/finanzen/wechselkurse';

/** Exklusiv sind Arten, die eine Gegenseite schonen oder Tabellen tauschen. */
const BEARBEITER: Bearbeitertabelle = {
  nacharbeit: {
    ausfuehren: (n) => zieheNach(n.set_number, n.user_id, n.art ?? 'neu'),
  },
  bilder: {
    ausfuehren: async (n) => { if (n.nur_bilder) await downloadSetImages(n.set_number); else await ladeSetBilder(n.set_number); },
  },
  pdf: {
    ausfuehren: (n) => erzeugePdf(n),
    aufgegeben: (n, fehler) => pdfAufgegeben(n, fehler),
  },
  // Mit `quelle` ein Import, auf den eine Anfrage wartet; ohne das Set-CSV.
  csv_import: {
    ausfuehren: (n, k, a) => 'quelle' in n ? fuehreImportAus(n, k, a) : fuehreCsvImportAus(n, k),
    aufgegeben: async (n, fehler) => { if (!('quelle' in n)) await csvImportAufgegeben(n, fehler); },
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

function starteAuftragsWorker(o: WorkerOptionen & { arten?: AuftragsArt[] } = {}) {
  if (_worker) return _worker;
  const tabelle: Bearbeitertabelle = o.arten
    ? Object.fromEntries(o.arten.map(a => [a, BEARBEITER[a]])) : BEARBEITER;
  _worker = erzeugeWorker(tabelle, o);
  _worker.starte();
  return _worker;
}

async function stoppeAuftragsWorker(): Promise<void> {
  const w = _worker;
  _worker = null;
  if (w) await w.stoppe();
}

export { BEARBEITER, starteAuftragsWorker, stoppeAuftragsWorker };
