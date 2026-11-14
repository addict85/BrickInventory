import path from 'node:path';
import { erzeugeWorker, type Bearbeitertabelle, type WorkerOptionen } from './auftragsWorker';
import { pdfAufgegeben, setzeImportProzess } from '../src/katalog';
import type { AuftragsArt } from '../src/auftraege';
import { loescheKontoDateien } from '../src/konto';
import type { Dienste } from '../src/dienste';

/** Exklusiv sind Arten, die eine Gegenseite schonen oder Tabellen tauschen. */
const bearbeiter = (
  d: Pick<Dienste, 'auftraege' | 'katalog' | 'bilder' | 'finanzen' | 'sets' | 'sammlung' | 'verwaltung'>,
): Bearbeitertabelle => ({
  nacharbeit: {
    ausfuehren: (n, k) => d.sets.zieheNach(n.set_number, n.user_id, n.art ?? 'neu', k),
  },
  bilder: {
    ausfuehren: async (n, k) => {
      if (n.nur_bilder) await d.katalog.downloadSetImages(n.set_number);
      else await d.sets.ladeSetBilder(n.set_number, k);
    },
  },
  pdf: {
    ausfuehren: (n, k) => d.katalog.erzeugePdf(n, k),
    aufgegeben: (n, fehler) => pdfAufgegeben(n, fehler),
  },
  // Mit `quelle` ein Import, auf den eine Anfrage wartet; ohne das Set-CSV.
  csv_import: {
    ausfuehren: (n, k, a) => ('quelle' in n ? d.sammlung.fuehreImportAus(n, k, a) : d.sets.fuehreCsvImportAus(n, k)),
    aufgegeben: async (n, fehler) => {
      if (!('quelle' in n)) await d.sets.csvImportAufgegeben(n, fehler);
    },
  },
  wechselkurse: { ausfuehren: (_n, k) => d.finanzen.kursauftrag(undefined, k) },
  anleitung: { ausfuehren: (n, k) => d.katalog.anleitungLaden(n, k), exklusiv: true },
  brickset: { ausfuehren: (n, k) => d.katalog.bricksetNachlauf(n, k), exklusiv: true },
  bildbedarf: { ausfuehren: (_n, k) => d.bilder.bildbedarfAbarbeiten(k), exklusiv: true },
  bilder_neu_laden: {
    ausfuehren: async (_n, k) => {
      await d.katalog.redownloadMissingImages(k);
    },
    exklusiv: true,
  },
  nachlauf: { ausfuehren: (n, k) => d.verwaltung.nachlauf(n, k) },
  csv_sync: { ausfuehren: (n, k) => d.katalog.csvAbgleich(n, k), exklusiv: true },
  preise: { ausfuehren: (_n, k) => d.finanzen.runPriceRefresh(k), exklusiv: true },
  bild_nachlauf: { ausfuehren: (_n, k) => d.katalog.bildNachlauf(k), exklusiv: true },
  aufraeumen: { ausfuehren: (_n, k) => d.verwaltung.aufraeumen(k), exklusiv: true },
  aufraeumen_taeglich: { ausfuehren: (_n, k) => d.verwaltung.aufraeumenTaeglich(k), exklusiv: true },
  preise_nachladen: { ausfuehren: (n, k) => d.finanzen.preiseNachladen(n, k), exklusiv: true },
  konto_dateien: { ausfuehren: n => loescheKontoDateien(n.user_id) },
});

// Der Katalog-Import läuft in einem eigenen Prozess, dessen Einstieg neben dieser Datei liegt.
setzeImportProzess(path.join(__dirname, 'csvImportWorker.js'));

/** Der Worker gehört dem, der ihn startet (startup/jobsProzess.ts, Testhilfen): Er hält ihn
 * und beendet ihn mit stoppe(); ein Speicher im Modul liesse zwei Starts einander sehen. */
function starteAuftragsWorker(
  d: Pick<Dienste, 'auftraege' | 'katalog' | 'bilder' | 'finanzen' | 'sets' | 'sammlung' | 'verwaltung'>,
  o: WorkerOptionen & { arten?: AuftragsArt[] } = {},
) {
  const alle = bearbeiter(d);
  const tabelle: Bearbeitertabelle = o.arten ? Object.fromEntries(o.arten.map(a => [a, alle[a]])) : alle;
  const worker = erzeugeWorker(d.auftraege, tabelle, o);
  worker.starte();
  return worker;
}

export type AuftragsWorker = ReturnType<typeof starteAuftragsWorker>;
export { bearbeiter, starteAuftragsWorker };
