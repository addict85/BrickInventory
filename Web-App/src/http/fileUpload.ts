import { konfig } from '../infra/config';
import { DATA_DIR } from '../infra/appPaths';
import multer from 'multer';
import crypto from 'node:crypto';
import type { Request } from 'express';
import { fromTable } from '../infra/validate';
import { fileError } from '../infra/errorTexts';
import { withoutMissingFile } from '../infra/error';
import fs from 'node:fs';
import path from 'node:path';

/** For every form with a file: without limits multer would take arbitrarily many
 * fields of 1 MB each and arbitrarily many files into memory. */
export const FORM_LIMITS = { files: 1, fields: 20, fieldSize: 64 * 1024, parts: 21, headerPairs: 200 };

/** Large enough for a BrickLink inventory export, small enough for
 * `memoryStorage`, which keeps the whole file in memory. */
export const CSV_MAX_BYTES = 15 * 1024 * 1024;

/** memoryStorage: the imports parse the file immediately and never store it. */
export const csvReceive = multer({
  storage: multer.memoryStorage(),
  limits: { ...FORM_LIMITS, fileSize: CSV_MAX_BYTES },
});

/** About 20,000 items; each costs queries when mapping, the CSV limit would be
 * a multiple of what a real list needs. */
export const XML_MAX_BYTES = 4 * 1024 * 1024;

export const xmlReceive = multer({
  storage: multer.memoryStorage(),
  limits: { ...FORM_LIMITS, fileSize: XML_MAX_BYTES },
});

const IDENTIFIER: Record<string, Buffer> = {
  'application/pdf': Buffer.from('%PDF-'),
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]),
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};

/** The sender sets the MIME type; without this look, arbitrary content could sit
 * under `.pdf`, which the server would deliver as application/pdf. */
export async function contentFitsToType(file: string, mime: string): Promise<boolean> {
  const key = Object.hasOwn(IDENTIFIER, mime) ? IDENTIFIER[mime] : undefined;
  if (!key) return false;
  const header = Buffer.alloc(key.length);
  const fd = await fs.promises.open(file, 'r');
  try {
    await fd.read(header, 0, header.length, 0);
  } finally {
    await fd.close();
  }
  return header.equals(key);
}

/** The per-file limit does not stop anyone who sends a hundred files — and all
 * accounts share one disk. */
export function uploadQuotaBytes(): number {
  return konfig().uploadQuotaMb * 1024 * 1024;
}

export async function occupiedSpace(folder: string): Promise<number> {
  const entries = await fs.promises
    .readdir(folder, { withFileTypes: true })
    .catch(withoutMissingFile('upload:ordner', []));
  let sum = 0;
  for (const e of entries) if (e.isFile()) sum += (await fs.promises.stat(path.join(folder, e.name))).size;
  return sum;
}

/** Uploads can be private (invoices): readable only by the service, even
 * if the folder already existed with looser permissions. */
export async function privaterFolder(wurzel: string, name: string): Promise<string> {
  const folder = path.join(wurzel, name);
  await fs.promises.mkdir(folder, { recursive: true, mode: 0o700 });
  for (const o of [wurzel, folder]) await fs.promises.chmod(o, 0o700);
  return folder;
}

/** A file into an account's private folder: extension from the MIME type, never
 * from the client's name; the name random so that it cannot be guessed. */
export function privaterReceive(o: {
  folder: (req: Request) => Promise<string>;
  prefix: (req: Request) => string;
  typen: Record<string, string>;
  maxBytes: number;
}) {
  return multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        o.folder(req).then(
          d => cb(null, d),
          (e: Error) => cb(e, ''),
        );
      },
      filename: (req, file, cb) => {
        const ext = fromTable(o.typen, file.mimetype);
        if (!ext) return cb(fileError('falscher_typ', 'datei_typ_falsch'), '');
        cb(null, `${o.prefix(req).replace(/[^a-z0-9-]/gi, '_')}_${crypto.randomBytes(12).toString('hex')}${ext}`);
      },
    }),
    limits: { ...FORM_LIMITS, fileSize: o.maxBytes },
    fileFilter: (_req, file, cb) => {
      if (fromTable(o.typen, file.mimetype)) cb(null, true);
      else cb(fileError('falscher_typ', 'datei_typ_falsch'));
    },
  });
}

/** Before writing: Content-Length includes the form envelope, so it is never smaller. */
export async function quotaSufficesFor(folder: string, length: number): Promise<boolean> {
  return (await occupiedSpace(folder)) + length <= uploadQuotaBytes();
}

/** The per-account quota does not stop many accounts; this limit applies to all of them together. */
const TOTAL_ROOTS = ['uploads', 'vouchers'].map(n => path.join(DATA_DIR, n));
export const uploadTotalMb = (): number => konfig().uploadTotalMb;

async function totalOccupied(): Promise<number> {
  let sum = 0;
  for (const w of TOTAL_ROOTS)
    for (const k of await fs.promises
      .readdir(w, { withFileTypes: true })
      .catch(withoutMissingFile('upload:gesamt', [])))
      if (k.isDirectory()) sum += await occupiedSpace(path.join(w, k.name));
  return sum;
}

export async function totalSufficesFor(length: number): Promise<boolean> {
  return (await totalOccupied()) + length <= uploadTotalMb() * 1024 * 1024;
}

/** The path comes from the request (multer); the service does not touch what would lie outside the storage. */
export function belowRoot(wurzel: string, file: string): string {
  const w = path.resolve(wurzel);
  const d = path.resolve(file);
  if (!d.startsWith(w + path.sep)) throw new Error(`Upload ausserhalb von ${w}`);
  return d;
}

/** After writing: readable only by the service, content matches the type, and the
 * quota holds even without Content-Length (chunked). Otherwise the file is gone again. */
export async function checkReceivedFile(wurzel: string, received: string, mime: string): Promise<void> {
  const file = belowRoot(wurzel, received);
  await fs.promises.chmod(file, 0o600);
  const refusal = !(await contentFitsToType(file, mime))
    ? fileError('ungueltig', 'datei_inhalt_falsch')
    : (await occupiedSpace(path.dirname(file))) > uploadQuotaBytes()
      ? fileError('zu_gross', 'upload_kontingent_voll', { mb: Math.round(uploadQuotaBytes() / 1024 / 1024) })
      : !(await totalSufficesFor(0))
        ? fileError('speicher_voll', 'upload_gesamt_voll', { mb: uploadTotalMb() })
        : null;
  if (!refusal) return;
  await fs.promises.rm(file, { force: true });
  throw refusal;
}
