import { konfig } from './konfig';
import multer from 'multer';
import fs from 'fs';
import path from 'path';

/** Für jedes Formular mit Datei: Ohne Grenzen nähme multer beliebig viele
 * Felder zu je 1 MB und beliebig viele Dateien in den Speicher. */
export const FORMULAR_GRENZEN = { files: 1, fields: 20, fieldSize: 64 * 1024, parts: 21, headerPairs: 200 };

/** Gross genug für einen BrickLink-Bestandsexport, klein genug für
 * `memoryStorage`, das die Datei ganz im Speicher hält. */
export const CSV_MAX_BYTES = 15 * 1024 * 1024;

/** memoryStorage: Die Importe zerlegen die Datei sofort und legen sie nie ab.
 * Ausführlich: docs/begruendungen/src/infra/dateiEmpfang.ts.md#csvempfang */
export const csvEmpfang = multer({
  storage: multer.memoryStorage(),
  limits: { ...FORMULAR_GRENZEN, fileSize: CSV_MAX_BYTES },
});

/** Rund 20 000 Posten; jeder kostet beim Zuordnen Abfragen, die CSV-Grenze wäre
 * ein Vielfaches dessen, was eine echte Liste braucht. */
export const XML_MAX_BYTES = 4 * 1024 * 1024;

export const xmlEmpfang = multer({
  storage: multer.memoryStorage(),
  limits: { ...FORMULAR_GRENZEN, fileSize: XML_MAX_BYTES },
});

const KENNUNG: Record<string, Buffer> = {
  'application/pdf': Buffer.from('%PDF-'),
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]),
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};

/** Den MIME-Typ setzt der Absender; ohne diesen Blick läge unter `.pdf`
 * beliebiger Inhalt, den der Server als application/pdf ausliefert. */
export function inhaltPasstZuTyp(datei: string, mime: string): boolean {
  const kennung = Object.hasOwn(KENNUNG, mime) ? KENNUNG[mime] : undefined;
  if (!kennung) return false;
  const kopf = Buffer.alloc(kennung.length);
  const fd = fs.openSync(datei, 'r');
  try { fs.readSync(fd, kopf, 0, kopf.length, 0); } finally { fs.closeSync(fd); }
  return kopf.equals(kennung);
}

/** Die Grenze je Datei begrenzt keinen, der hundert Dateien schickt — und alle
 * Konten teilen sich eine Platte. */
export function uploadKontingentBytes(): number {
  return konfig().uploadKontingentMb * 1024 * 1024;
}

export function belegterPlatz(ordner: string): number {
  let summe = 0;
  for (const e of fs.readdirSync(ordner, { withFileTypes: true }))
    if (e.isFile()) summe += fs.statSync(path.join(ordner, e.name)).size;
  return summe;
}
