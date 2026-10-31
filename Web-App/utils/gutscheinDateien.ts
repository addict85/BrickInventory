import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../src/infra/appPaths';
import { verschluesselePuffer, entschluesselePuffer, istVerschluesselterPuffer } from '../src/infra/geheimnis';

/**
 * Gutschein-PDFs tragen Kartennummer und PIN im Klartext. Sie liegen deshalb
 * mit dem Datenschlüssel verschlüsselt unter data/vouchers/<konto>/: Eine
 * Kopie von data/ ohne Schlüssel (Sicherung, geteiltes Volume) gibt sie nicht preis.
 */
export const VOUCHER_DIR = path.join(DATA_DIR, 'vouchers');

/**
 * Gespeicherter Pfad → Dateipfad, oder null. Auch ein Pfad aus der eigenen
 * Datenbank muss dem Konto gehören und unter data/vouchers/<konto>/ liegen;
 * `basis + sep`, sonst gälte vouchers/12 als unterhalb von vouchers/1.
 */
export function gutscheinDatei(userId: number, pdfPfad: string): string | null {
  const basis = path.resolve(VOUCHER_DIR, String(userId));
  const ziel = path.resolve(VOUCHER_DIR, pdfPfad);
  return ziel.startsWith(basis + path.sep) ? ziel : null;
}

/** Verschlüsselt ablegen; erst die fertige Datei bekommt ihren Namen. */
export async function schreibeGutscheinPdf(datei: string, pdf: Buffer): Promise<void> {
  await fs.promises.mkdir(path.dirname(datei), { recursive: true, mode: 0o700 });
  const teil = `${datei}.${process.pid}.teil`;
  await fs.promises.writeFile(teil, verschluesselePuffer(pdf), { mode: 0o600 });
  await fs.promises.rename(teil, datei);
}

/** Entschlüsselt lesen; null, wenn der Schlüssel nicht passt. */
export async function liesGutscheinPdf(datei: string): Promise<Buffer | null> {
  return entschluesselePuffer(await fs.promises.readFile(datei));
}

/** Klartext-PDFs aus der Zeit vor der Verschlüsselung einmal umwandeln (bei jedem Start, Verschlüsseltes bleibt). */
export async function verschluesseleGutscheinAltbestand(): Promise<number> {
  if (!fs.existsSync(VOUCHER_DIR)) return 0;
  let n = 0;
  for (const konto of fs.readdirSync(VOUCHER_DIR).filter(k => /^\d+$/.test(k))) {
    const ordner = path.join(VOUCHER_DIR, konto);
    if (!fs.statSync(ordner).isDirectory()) continue;
    for (const name of fs.readdirSync(ordner).filter(f => /^\d+\.pdf$/.test(f))) {
      const datei = path.join(ordner, name);
      const roh = await fs.promises.readFile(datei);
      if (istVerschluesselterPuffer(roh)) continue;
      await schreibeGutscheinPdf(datei, roh);
      n++;
    }
  }
  return n;
}

/** Die Dateien eines gelöschten Kontos: eigene Anleitungen und Gutscheine. */
export async function loescheKontoDateien(userId: number): Promise<void> {
  if (!Number.isInteger(userId) || userId <= 0) return;
  for (const art of ['uploads', 'vouchers'])
    await fs.promises.rm(path.join(DATA_DIR, art, String(userId)), { recursive: true, force: true });
}
