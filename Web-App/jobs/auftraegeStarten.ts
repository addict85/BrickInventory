import { erzeugeWorker, type Bearbeitertabelle, type WorkerOptionen } from './auftragsWorker';
import { zieheNach, ladeSetBilder, type NacharbeitArt } from './nachErfassung';
import { erzeugePdf, pdfAufgegeben, type PdfNutzlast } from './pdfErzeugung';
import { fuehreCsvImportAus, csvImportAufgegeben, type CsvNutzlast } from './setCsvImport';
import type { AuftragsArt } from '../utils/auftraege';

/** Welche Art wie bearbeitet wird. Die Nutzlast hat der Einsteller geschrieben. */
const BEARBEITER: Bearbeitertabelle = {
  nacharbeit: {
    ausfuehren: (n) => zieheNach(String(n.set_number), Number(n.user_id), (n.art as NacharbeitArt) ?? 'neu'),
  },
  bilder: { ausfuehren: (n) => ladeSetBilder(String(n.set_number)) },
  pdf: {
    ausfuehren: (n) => erzeugePdf(n as unknown as PdfNutzlast),
    aufgegeben: (n, fehler) => pdfAufgegeben(n as unknown as PdfNutzlast, fehler),
  },
  csv_import: {
    ausfuehren: (n, k) => fuehreCsvImportAus(n as unknown as CsvNutzlast, k),
    aufgegeben: (n, fehler) => csvImportAufgegeben(n as unknown as CsvNutzlast, fehler),
  },
};

let _worker: ReturnType<typeof erzeugeWorker> | null = null;

/** Den Worker des Primär-Prozesses starten; `arten` schränkt ein (Tests). */
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
