/**
 * Dateien entgegennehmen — die Grenzen stehen an EINER Stelle.
 * Ausführlich: docs/begruendungen/utils/dateiEmpfang.ts.md#abschnitt
 */
import multer from 'multer';
import fs from 'fs';
import path from 'path';

/**
 * Wie gross eine hochgeladene CSV-Datei sein darf.
 *
 * 15 MB ist der gewachsene Wert aus den drei Fassungen; er ist gross genug für
 * einen vollständigen Bestandsexport aus BrickLink und klein genug, dass eine
 * versehentlich gewählte Datei den Speicher nicht sprengt — `memoryStorage`
 * hält sie vollständig im Arbeitsspeicher.
 */
export const CSV_MAX_BYTES = 15 * 1024 * 1024;

/**
 * Die Annahme für Textdateien, die sofort zerlegt werden: die CSV-Importe
 * (Sets, Teile, Minifiguren, Merkliste, Preisalarme). Die Wanted-Liste als XML
 * hat mit `xmlEmpfang` eine eigene, engere Grenze.
 * Ausführlich: docs/begruendungen/utils/dateiEmpfang.ts.md#csvempfang
 */
export const csvEmpfang = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CSV_MAX_BYTES },
});

/**
 * Wie gross eine BrickLink-Wanted-Liste (XML) sein darf. Ein Posten braucht
 * rund 200 Bytes; 4 MB fassen also an die 20 000 Posten. Jeder Posten kostet
 * beim Zuordnen Datenbank- und womöglich Rebrickable-Abfragen — die CSV-Grenze
 * von 15 MB wäre dafür ein Vielfaches dessen, was eine echte Liste braucht.
 */
export const XML_MAX_BYTES = 4 * 1024 * 1024;

/** Die Annahme für die Wanted-Liste: wie `csvEmpfang`, nur mit eigener Grenze. */
export const xmlEmpfang = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: XML_MAX_BYTES },
});

/** Die ersten Bytes, an denen sich jede erlaubte Anleitungsdatei erkennen lässt. */
const KENNUNG: Record<string, Buffer> = {
  'application/pdf': Buffer.from('%PDF-'),
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]),
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};

/**
 * Ob der Inhalt zum angegebenen Typ passt. Den MIME-Typ setzt der Absender;
 * ohne diesen Blick läge unter `.pdf` beliebiger Inhalt, den der Server später
 * mit `application/pdf` ausliefert.
 */
export function inhaltPasstZuTyp(datei: string, mime: string): boolean {
  const kennung = Object.hasOwn(KENNUNG, mime) ? KENNUNG[mime] : undefined;
  if (!kennung) return false;
  const kopf = Buffer.alloc(kennung.length);
  const fd = fs.openSync(datei, 'r');
  try { fs.readSync(fd, kopf, 0, kopf.length, 0); } finally { fs.closeSync(fd); }
  return kopf.equals(kennung);
}

/**
 * Wie viel Platz eigene Anleitungen je Konto belegen dürfen. Die 50 MB je
 * Datei begrenzen keinen, der hundert Dateien schickt — und alle Konten teilen
 * sich eine Platte.
 */
export function uploadKontingentBytes(): number {
  const mb = Number(process.env.UPLOAD_KONTINGENT_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 2048) * 1024 * 1024;
}

export function belegterPlatz(ordner: string): number {
  let summe = 0;
  for (const e of fs.readdirSync(ordner, { withFileTypes: true }))
    if (e.isFile()) summe += fs.statSync(path.join(ordner, e.name)).size;
  return summe;
}
