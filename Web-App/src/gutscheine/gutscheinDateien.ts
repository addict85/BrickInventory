import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../infra/appPaths';
import { verschluesselePuffer, entschluesselePuffer, istVerschluesselterPuffer, altenPufferLesen, kontext, pufferUmschluesseln } from '../infra/geheimnis';
import { ohneFehlendeDatei } from '../infra/fehler';

/** Die PDFs tragen Kartennummer und PIN im Klartext; verschlüsselt gibt eine
 * Kopie von data/ ohne Schlüssel sie nicht preis. */
export const VOUCHER_DIR = path.join(DATA_DIR, 'vouchers');

/** Auch ein Pfad aus der eigenen Datenbank muss dem Konto gehören; `basis + sep`,
 * sonst gälte vouchers/12 als unterhalb von vouchers/1. */
export function gutscheinDatei(userId: number, pdfPfad: string): string | null {
  const basis = path.resolve(VOUCHER_DIR, String(userId));
  const ziel = path.resolve(VOUCHER_DIR, pdfPfad);
  return ziel.startsWith(basis + path.sep) ? ziel : null;
}

/** Der Ort unter vouchers/ (Konto/Gutschein.pdf) im Kontext: Eine Datei, in
 * einen anderen Gutschein oder ein anderes Konto kopiert, bleibt unlesbar. */
function dateiKontext(datei: string) {
  return kontext('gutschein-pdf', path.relative(VOUCHER_DIR, datei).split(path.sep).join('/'));
}

/** Erst die fertige Datei bekommt ihren Namen. */
export async function schreibeGutscheinPdf(datei: string, pdf: Buffer): Promise<void> {
  await ersetzeDatei(datei, verschluesselePuffer(pdf, dateiKontext(datei)));
}

async function ersetzeDatei(datei: string, inhalt: Buffer): Promise<void> {
  await fs.promises.mkdir(path.dirname(datei), { recursive: true, mode: 0o700 });
  const teil = `${datei}.${process.pid}.teil`;
  await fs.promises.writeFile(teil, inhalt, { mode: 0o600 });
  await fs.promises.rename(teil, datei);
}

/** null, wenn Schlüssel oder Ort nicht passen oder die Datei unverschlüsselt ist. */
export async function liesGutscheinPdf(datei: string): Promise<Buffer | null> {
  return entschluesselePuffer(await fs.promises.readFile(datei), dateiKontext(datei));
}

/** Fehlt die Datei, wird die Seite neu erzeugt, ohne den Export abzubrechen. */
export async function liesGutscheinPdfOderNichts(datei: string | null): Promise<Buffer | null> {
  if (!datei) return null;
  return liesGutscheinPdf(datei).catch(ohneFehlendeDatei('gutschein:pdf lesen', null));
}

/** Unverschlüsselte und BIENC1-Dateien auf BIENC2, bei jedem Start; BIENC2 bleibt,
 * ausser `alle` (Schlüsselwechsel): Dann kommt, was nur der vorige öffnet, neu. */
export async function verschluesseleGutscheinAltbestand(o: { alle?: boolean } = {}): Promise<number> {
  if (!fs.existsSync(VOUCHER_DIR)) return 0;
  let n = 0;
  for (const konto of fs.readdirSync(VOUCHER_DIR).filter(k => /^\d+$/.test(k))) {
    const ordner = path.join(VOUCHER_DIR, konto);
    if (!fs.statSync(ordner).isDirectory()) continue;
    for (const name of fs.readdirSync(ordner).filter(f => /^\d+\.pdf$/.test(f))) {
      const datei = path.join(ordner, name);
      const roh = await fs.promises.readFile(datei);
      if (istVerschluesselterPuffer(roh)) {
        const neu = o.alle ? pufferUmschluesseln(roh, dateiKontext(datei)) : undefined;
        if (neu) { await ersetzeDatei(datei, neu); n++; }
        continue;
      }
      const klar = altenPufferLesen(roh, dateiKontext(datei));
      if (!klar) continue;
      await schreibeGutscheinPdf(datei, klar);
      n++;
    }
  }
  return n;
}

