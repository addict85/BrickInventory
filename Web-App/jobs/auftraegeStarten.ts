import path from 'node:path';
import { erzeugeWorker, type Bearbeitertabelle, type WorkerOptionen } from './auftragsWorker';
import { zieheNach, ladeSetBilder } from '../src/sets/nachErfassung';
import { erzeugePdf, pdfAufgegeben } from '../src/katalog/pdf/pdfErzeugung';
import { fuehreCsvImportAus, csvImportAufgegeben } from '../src/sets/csvImportLauf';
import { fuehreImportAus } from '../src/sammlung/importAuftraege';
import { anleitungLaden } from '../src/katalog/anleitungLaden';
import { bricksetNachlauf } from '../src/katalog/bricksetNachlauf';
import { bildbedarfAbarbeiten } from '../src/katalog/bilder/bildbedarfLauf';
import { redownloadMissingImages, downloadSetImages } from '../src/katalog/teileAnreicherung';
import { nachlauf } from '../src/verwaltung/startNachlaeufe';
import { csvAbgleich, setzeImportProzess } from '../src/katalog/csvAbgleich';
import { runPriceRefresh } from '../src/finanzen/preisLauf';
import { bildNachlauf } from '../src/katalog/bildNachlauf';
import { aufraeumen, aufraeumenTaeglich } from '../src/verwaltung/aufraeumen';
import type { AuftragsArt } from '../src/auftraege/auftraege';
import { kursauftrag } from '../src/finanzen/wechselkurse';
import { preiseNachladen } from '../src/finanzen/preiseNachladen';

/** Exklusiv sind Arten, die eine Gegenseite schonen oder Tabellen tauschen. */
const BEARBEITER: Bearbeitertabelle = {
  nacharbeit: {
    ausfuehren: (n, k) => zieheNach(n.set_number, n.user_id, n.art ?? 'neu', k),
  },
  bilder: {
    ausfuehren: async (n, k) => { if (n.nur_bilder) await downloadSetImages(n.set_number); else await ladeSetBilder(n.set_number, k); },
  },
  pdf: {
    ausfuehren: (n, k) => erzeugePdf(n, k),
    aufgegeben: (n, fehler) => pdfAufgegeben(n, fehler),
  },
  // Mit `quelle` ein Import, auf den eine Anfrage wartet; ohne das Set-CSV.
  csv_import: {
    ausfuehren: (n, k, a) => 'quelle' in n ? fuehreImportAus(n, k, a) : fuehreCsvImportAus(n, k),
    aufgegeben: async (n, fehler) => { if (!('quelle' in n)) await csvImportAufgegeben(n, fehler); },
  },
  wechselkurse:        { ausfuehren: (_n, k) => kursauftrag(undefined, k) },
  anleitung:           { ausfuehren: (n, k) => anleitungLaden(n, k), exklusiv: true },
  brickset:            { ausfuehren: (n, k) => bricksetNachlauf(n, k), exklusiv: true },
  bildbedarf:          { ausfuehren: (_n, k) => bildbedarfAbarbeiten(k), exklusiv: true },
  bilder_neu_laden:    { ausfuehren: async (_n, k) => { await redownloadMissingImages(k); }, exklusiv: true },
  nachlauf:            { ausfuehren: (n, k) => nachlauf(n, k) },
  csv_sync:            { ausfuehren: (n, k) => csvAbgleich(n, k), exklusiv: true },
  preise:              { ausfuehren: (_n, k) => runPriceRefresh(k), exklusiv: true },
  bild_nachlauf:       { ausfuehren: (_n, k) => bildNachlauf(k), exklusiv: true },
  aufraeumen:          { ausfuehren: (_n, k) => aufraeumen(k), exklusiv: true },
  aufraeumen_taeglich: { ausfuehren: (_n, k) => aufraeumenTaeglich(k), exklusiv: true },
  preise_nachladen:    { ausfuehren: (n, k) => preiseNachladen(n, k), exklusiv: true },
};

// Der Katalog-Import läuft in einem eigenen Prozess, dessen Einstieg neben dieser Datei liegt.
setzeImportProzess(path.join(__dirname, 'csvImportWorker.js'));

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
