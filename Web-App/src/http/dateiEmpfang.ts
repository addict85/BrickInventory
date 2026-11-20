import { konfig } from '../infra/konfig';
import { DATA_DIR } from '../infra/appPaths';
import multer from 'multer';
import crypto from 'node:crypto';
import type { Request } from 'express';
import { fromTable } from '../infra/validate';
import { fileError } from '../infra/fehlerTexte';
import { withoutMissingFile } from '../infra/fehler';
import fs from 'node:fs';
import path from 'node:path';

/** Für jedes Formular mit Datei: Ohne Grenzen nähme multer beliebig viele
 * Felder zu je 1 MB und beliebig viele Dateien in den Speicher. */
export const FORM_LIMITS = { files: 1, fields: 20, fieldSize: 64 * 1024, parts: 21, headerPairs: 200 };

/** Gross genug für einen BrickLink-Bestandsexport, klein genug für
 * `memoryStorage`, das die Datei ganz im Speicher hält. */
export const CSV_MAX_BYTES = 15 * 1024 * 1024;

/** memoryStorage: Die Importe zerlegen die Datei sofort und legen sie nie ab. */
export const csvReceive = multer({
  storage: multer.memoryStorage(),
  limits: { ...FORM_LIMITS, fileSize: CSV_MAX_BYTES },
});

/** Rund 20 000 Posten; jeder kostet beim Zuordnen Abfragen, die CSV-Grenze wäre
 * ein Vielfaches dessen, was eine echte Liste braucht. */
export const XML_MAX_BYTES = 4 * 1024 * 1024;

export const xmlReceive = multer({
  storage: multer.memoryStorage(),
  limits: { ...FORM_LIMITS, fileSize: XML_MAX_BYTES },
});

const KENNUNG: Record<string, Buffer> = {
  'application/pdf': Buffer.from('%PDF-'),
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]),
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};

/** Den MIME-Typ setzt der Absender; ohne diesen Blick läge unter `.pdf`
 * beliebiger Inhalt, den der Server als application/pdf ausliefert. */
export async function contentFitsToType(datei: string, mime: string): Promise<boolean> {
  const kennung = Object.hasOwn(KENNUNG, mime) ? KENNUNG[mime] : undefined;
  if (!kennung) return false;
  const kopf = Buffer.alloc(kennung.length);
  const fd = await fs.promises.open(datei, 'r');
  try {
    await fd.read(kopf, 0, kopf.length, 0);
  } finally {
    await fd.close();
  }
  return kopf.equals(kennung);
}

/** Die Grenze je Datei begrenzt keinen, der hundert Dateien schickt — und alle
 * Konten teilen sich eine Platte. */
export function uploadQuotaBytes(): number {
  return konfig().uploadQuotaMb * 1024 * 1024;
}

export async function occupiedSpace(ordner: string): Promise<number> {
  const eintraege = await fs.promises
    .readdir(ordner, { withFileTypes: true })
    .catch(withoutMissingFile('upload:ordner', []));
  let summe = 0;
  for (const e of eintraege) if (e.isFile()) summe += (await fs.promises.stat(path.join(ordner, e.name))).size;
  return summe;
}

/** Hochgeladenes kann privat sein (Rechnungen): nur für den Dienst lesbar, auch
 * wenn der Ordner schon mit lockereren Rechten bestand. */
export async function privaterFolder(wurzel: string, name: string): Promise<string> {
  const ordner = path.join(wurzel, name);
  await fs.promises.mkdir(ordner, { recursive: true, mode: 0o700 });
  for (const o of [wurzel, ordner]) await fs.promises.chmod(o, 0o700);
  return ordner;
}

/** Eine Datei in den privaten Ordner eines Kontos: Endung aus dem MIME-Typ, nie
 * aus dem Namen des Clients; der Name zufällig, damit er sich nicht erraten lässt. */
export function privaterReceive(o: {
  ordner: (req: Request) => Promise<string>;
  praefix: (req: Request) => string;
  typen: Record<string, string>;
  maxBytes: number;
}) {
  return multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        o.ordner(req).then(
          d => cb(null, d),
          (e: Error) => cb(e, ''),
        );
      },
      filename: (req, file, cb) => {
        const ext = fromTable(o.typen, file.mimetype);
        if (!ext) return cb(fileError('falscher_typ', 'datei_typ_falsch'), '');
        cb(null, `${o.praefix(req).replace(/[^a-z0-9-]/gi, '_')}_${crypto.randomBytes(12).toString('hex')}${ext}`);
      },
    }),
    limits: { ...FORM_LIMITS, fileSize: o.maxBytes },
    fileFilter: (_req, file, cb) => {
      if (fromTable(o.typen, file.mimetype)) cb(null, true);
      else cb(fileError('falscher_typ', 'datei_typ_falsch'));
    },
  });
}

/** Vor dem Schreiben: Content-Length schliesst die Formularhülle ein, ist also nie kleiner. */
export async function quotaSufficesFor(ordner: string, laenge: number): Promise<boolean> {
  return (await occupiedSpace(ordner)) + laenge <= uploadQuotaBytes();
}

/** Das Kontingent je Konto hält viele Konten nicht auf; diese Grenze gilt für alle zusammen. */
const TOTAL_ROOTS = ['uploads', 'vouchers'].map(n => path.join(DATA_DIR, n));
export const uploadTotalMb = (): number => konfig().uploadTotalMb;

async function totalOccupied(): Promise<number> {
  let summe = 0;
  for (const w of TOTAL_ROOTS)
    for (const k of await fs.promises
      .readdir(w, { withFileTypes: true })
      .catch(withoutMissingFile('upload:gesamt', [])))
      if (k.isDirectory()) summe += await occupiedSpace(path.join(w, k.name));
  return summe;
}

export async function totalSufficesFor(laenge: number): Promise<boolean> {
  return (await totalOccupied()) + laenge <= uploadTotalMb() * 1024 * 1024;
}

/** Der Pfad kommt aus der Anfrage (multer); was ausserhalb der Ablage läge, fasst der Dienst nicht an. */
export function belowRoot(wurzel: string, datei: string): string {
  const w = path.resolve(wurzel);
  const d = path.resolve(datei);
  if (!d.startsWith(w + path.sep)) throw new Error(`Upload ausserhalb von ${w}`);
  return d;
}

/** Nach dem Schreiben: nur für den Dienst lesbar, Inhalt passt zum Typ, und das
 * Kontingent hält auch ohne Content-Length (chunked). Sonst ist die Datei wieder weg. */
export async function checkReceivedFile(wurzel: string, received: string, mime: string): Promise<void> {
  const datei = belowRoot(wurzel, received);
  await fs.promises.chmod(datei, 0o600);
  const absage = !(await contentFitsToType(datei, mime))
    ? fileError('ungueltig', 'datei_inhalt_falsch')
    : (await occupiedSpace(path.dirname(datei))) > uploadQuotaBytes()
      ? fileError('zu_gross', 'upload_kontingent_voll', { mb: Math.round(uploadQuotaBytes() / 1024 / 1024) })
      : !(await totalSufficesFor(0))
        ? fileError('speicher_voll', 'upload_gesamt_voll', { mb: uploadTotalMb() })
        : null;
  if (!absage) return;
  await fs.promises.rm(datei, { force: true });
  throw absage;
}
