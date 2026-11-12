/** Die täglichen Katalogdateien von Rebrickable (gzip-CSV). Über abruf.ts wie
 * jeder andere Abruf: Host-Liste, Grössendeckel, Gesamtfrist und Abbruch. */
import fs from 'node:fs';
import { createGunzip } from 'node:zlib';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { oeffneHttps, AbrufFehler } from '../src/infra/abruf';

const CSV_BASIS = 'https://cdn.rebrickable.com/media/downloads/';
const CSV_HOSTS = ['cdn.rebrickable.com'] as const;
/** inventory_parts.csv.gz hat gepackt rund 30 MB, entpackt rund 1 GB. */
const GEPACKT_HOECHSTENS = 256 * 1024 * 1024;
const ENTPACKT_HOECHSTENS = 4 * 1024 * 1024 * 1024;
const FRIST_MS = 30 * 60_000;

export interface CsvLaden {
  signal?: AbortSignal;
  /** Gelesene gepackte Bytes und die angekündigte Gesamtzahl (0: unbekannt). */
  beiFortschritt?: (bytes: number, gesamt: number) => void;
}

/** Lädt `datei` (z. B. parts.csv.gz) entpackt nach `ziel`. */
export async function ladeKatalogCsv(datei: string, ziel: string, o: CsvLaden = {}): Promise<void> {
  if (!/^[a-z_]+\.csv\.gz$/.test(datei))
    throw new AbrufFehler('adresse', `Unbekannte Katalogdatei: ${datei.slice(0, 60)}`);
  const a = await oeffneHttps(CSV_BASIS + datei, {
    hosts: CSV_HOSTS,
    maxBytes: GEPACKT_HOECHSTENS,
    zeitlimitMs: FRIST_MS,
    ...(o.signal ? { signal: o.signal } : {}),
  });
  if (a.status !== 200) {
    a.verwerfen();
    throw new AbrufFehler('netz', `HTTP ${a.status} für ${datei}`);
  }
  const gesamt = Number(a.kopf['content-length']) || 0;
  let gelesen = 0,
    entpackt = 0;
  const zaehler = new Transform({
    transform(stueck: Buffer, _k, weiter) {
      gelesen += stueck.length;
      o.beiFortschritt?.(gelesen, gesamt);
      weiter(null, stueck);
    },
  });
  // Eine Gzip-Bombe endet am Deckel, nicht an der Platte.
  const deckel = new Transform({
    transform(stueck: Buffer, _k, weiter) {
      entpackt += stueck.length;
      weiter(
        entpackt > ENTPACKT_HOECHSTENS
          ? new AbrufFehler('zu-gross', `${datei} entpackt über ${ENTPACKT_HOECHSTENS} Byte`)
          : null,
        stueck,
      );
    },
  });
  // Ein Abbruch beendet den Abruf (abruf.ts) und damit die ganze Kette.
  await pipeline(a.strom(), zaehler, createGunzip(), deckel, fs.createWriteStream(ziel));
}
