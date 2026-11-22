/** Rebrickable's daily catalog files (gzip CSV). Through fetch.ts like
 * every other request: host list, size cap, total deadline and abort. */
import fs from 'node:fs';
import { createGunzip } from 'node:zlib';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { openHttps, AbrufFehler } from '../src/infra/fetch';

const CSV_BASIS = 'https://cdn.rebrickable.com/media/downloads/';
const CSV_HOSTS = ['cdn.rebrickable.com'] as const;
/** inventory_parts.csv.gz is about 30 MB packed, about 1 GB unpacked. */
const PACKED_AT_MOST = 256 * 1024 * 1024;
const UNPACKED_AT_MOST = 4 * 1024 * 1024 * 1024;
const FRIST_MS = 30 * 60_000;

export interface CsvLaden {
  signal?: AbortSignal;
  /** Packed bytes read and the announced total (0: unknown). */
  atProgress?: (bytes: number, total: number) => void;
}

/** Loads `datei` (e.g. parts.csv.gz) unpacked into `ziel`. */
export async function loadCatalogCsv(file: string, target: string, o: CsvLaden = {}): Promise<void> {
  if (!/^[a-z_]+\.csv\.gz$/.test(file))
    throw new AbrufFehler('adresse', `Unbekannte Katalogdatei: ${file.slice(0, 60)}`);
  const a = await openHttps(CSV_BASIS + file, {
    hosts: CSV_HOSTS,
    maxBytes: PACKED_AT_MOST,
    zeitlimitMs: FRIST_MS,
    ...(o.signal ? { signal: o.signal } : {}),
  });
  if (a.status !== 200) {
    a.verwerfen();
    throw new AbrufFehler('netz', `HTTP ${a.status} für ${file}`);
  }
  const total = Number(a.kopf['content-length']) || 0;
  let gelesen = 0,
    unpacked = 0;
  const counter = new Transform({
    transform(piece: Buffer, _k, next) {
      gelesen += piece.length;
      o.atProgress?.(gelesen, total);
      next(null, piece);
    },
  });
  // A gzip bomb ends at the cap, not at the disk.
  const deckel = new Transform({
    transform(piece: Buffer, _k, next) {
      unpacked += piece.length;
      next(
        unpacked > UNPACKED_AT_MOST
          ? new AbrufFehler('zu-gross', `${file} entpackt über ${UNPACKED_AT_MOST} Byte`)
          : null,
        piece,
      );
    },
  });
  // An abort ends the request (fetch.ts) and thereby the whole chain.
  await pipeline(a.strom(), counter, createGunzip(), deckel, fs.createWriteStream(target));
}
