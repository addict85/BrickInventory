import { konfig } from '../infra/konfig';
import { DATA_DIR } from '../infra/appPaths';
import multer from 'multer';
import crypto from 'node:crypto';
import type { Request } from 'express';
import { ausTabelle } from '../infra/validate';
import { dateiFehler } from '../infra/fehlerTexte';
import { ohneFehlendeDatei } from '../infra/fehler';
import fs from 'node:fs';
import path from 'node:path';

/** Für jedes Formular mit Datei: Ohne Grenzen nähme multer beliebig viele
 * Felder zu je 1 MB und beliebig viele Dateien in den Speicher. */
export const FORMULAR_GRENZEN = { files: 1, fields: 20, fieldSize: 64 * 1024, parts: 21, headerPairs: 200 };

/** Gross genug für einen BrickLink-Bestandsexport, klein genug für
 * `memoryStorage`, das die Datei ganz im Speicher hält. */
export const CSV_MAX_BYTES = 15 * 1024 * 1024;

/** memoryStorage: Die Importe zerlegen die Datei sofort und legen sie nie ab. */
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
export async function inhaltPasstZuTyp(datei: string, mime: string): Promise<boolean> {
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
export function uploadKontingentBytes(): number {
  return konfig().uploadKontingentMb * 1024 * 1024;
}

export async function belegterPlatz(ordner: string): Promise<number> {
  const eintraege = await fs.promises
    .readdir(ordner, { withFileTypes: true })
    .catch(ohneFehlendeDatei('upload:ordner', []));
  let summe = 0;
  for (const e of eintraege) if (e.isFile()) summe += (await fs.promises.stat(path.join(ordner, e.name))).size;
  return summe;
}

/** Hochgeladenes kann privat sein (Rechnungen): nur für den Dienst lesbar, auch
 * wenn der Ordner schon mit lockereren Rechten bestand. */
export async function privaterOrdner(wurzel: string, name: string): Promise<string> {
  const ordner = path.join(wurzel, name);
  await fs.promises.mkdir(ordner, { recursive: true, mode: 0o700 });
  for (const o of [wurzel, ordner]) await fs.promises.chmod(o, 0o700);
  return ordner;
}

/** Eine Datei in den privaten Ordner eines Kontos: Endung aus dem MIME-Typ, nie
 * aus dem Namen des Clients; der Name zufällig, damit er sich nicht erraten lässt. */
export function privaterEmpfang(o: {
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
        const ext = ausTabelle(o.typen, file.mimetype);
        if (!ext) return cb(dateiFehler('falscher_typ', 'datei_typ_falsch'), '');
        cb(null, `${o.praefix(req).replace(/[^a-z0-9-]/gi, '_')}_${crypto.randomBytes(12).toString('hex')}${ext}`);
      },
    }),
    limits: { ...FORMULAR_GRENZEN, fileSize: o.maxBytes },
    fileFilter: (_req, file, cb) => {
      if (ausTabelle(o.typen, file.mimetype)) cb(null, true);
      else cb(dateiFehler('falscher_typ', 'datei_typ_falsch'));
    },
  });
}

/** Vor dem Schreiben: Content-Length schliesst die Formularhülle ein, ist also nie kleiner. */
export async function kontingentReichtFuer(ordner: string, laenge: number): Promise<boolean> {
  return (await belegterPlatz(ordner)) + laenge <= uploadKontingentBytes();
}

/** Das Kontingent je Konto hält viele Konten nicht auf; diese Grenze gilt für alle zusammen. */
const GESAMT_WURZELN = ['uploads', 'vouchers'].map(n => path.join(DATA_DIR, n));
export const uploadGesamtMb = (): number => konfig().uploadGesamtMb;

async function gesamtBelegt(): Promise<number> {
  let summe = 0;
  for (const w of GESAMT_WURZELN)
    for (const k of await fs.promises.readdir(w, { withFileTypes: true }).catch(ohneFehlendeDatei('upload:gesamt', [])))
      if (k.isDirectory()) summe += await belegterPlatz(path.join(w, k.name));
  return summe;
}

export async function gesamtReichtFuer(laenge: number): Promise<boolean> {
  return (await gesamtBelegt()) + laenge <= uploadGesamtMb() * 1024 * 1024;
}

/** Der Pfad kommt aus der Anfrage (multer); was ausserhalb der Ablage läge, fasst der Dienst nicht an. */
export function unterWurzel(wurzel: string, datei: string): string {
  const w = path.resolve(wurzel);
  const d = path.resolve(datei);
  if (!d.startsWith(w + path.sep)) throw new Error(`Upload ausserhalb von ${w}`);
  return d;
}

/** Nach dem Schreiben: nur für den Dienst lesbar, Inhalt passt zum Typ, und das
 * Kontingent hält auch ohne Content-Length (chunked). Sonst ist die Datei wieder weg. */
export async function pruefeEmpfangeneDatei(
  wurzel: string,
  empfangen: string,
  mime: string,
): Promise<null | 'datei_inhalt_falsch' | 'upload_kontingent_voll' | 'upload_gesamt_voll'> {
  const datei = unterWurzel(wurzel, empfangen);
  await fs.promises.chmod(datei, 0o600);
  const grund = !(await inhaltPasstZuTyp(datei, mime))
    ? ('datei_inhalt_falsch' as const)
    : (await belegterPlatz(path.dirname(datei))) > uploadKontingentBytes()
      ? ('upload_kontingent_voll' as const)
      : !(await gesamtReichtFuer(0))
        ? ('upload_gesamt_voll' as const)
        : null;
  if (grund) await fs.promises.rm(datei, { force: true });
  return grund;
}
