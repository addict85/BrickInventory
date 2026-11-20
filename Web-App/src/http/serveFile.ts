import path from 'node:path';
import type { Response } from 'express';

/** For uploaded files: what is only checked in the first bytes thus never runs
 * as a document with scripts under the app's origin, not even inline. */
export const FOREIGN_FILE_CSP = "sandbox; default-src 'none'";

// An error while serving gets its own response instead of a blanket 404.

type FileError = Error & { status?: number; statusCode?: number; code?: string };

/** Check both `status` and `statusCode`, so that a version change of the
 * library does not silently make this place ineffective. */
function numberFrom(err: unknown): number | null {
  const e = err as FileError | null | undefined;
  const n = e?.status ?? e?.statusCode;
  return typeof n === 'number' && n >= 400 && n <= 599 ? n : null;
}

/** If something has already gone out, the client aborted; a second response
 * would only be an error in the log. */
export function responseOnFileError(res: Response, err: unknown): void {
  if (res.headersSent || res.writableEnded) return;
  const zahl = numberFrom(err);
  // Without a number of its own it almost always means "the file is not there" here.
  if (zahl === null || zahl === 404) {
    res.status(404).send('Datei nicht gefunden');
    return;
  }
  // 416 already carries the Content-Range ("bytes */<length>") the client needs.
  res.sendStatus(zahl);
}

/** With the folder as `root`: with the whole path every file would answer 404
 * as soon as the installation lives under a dot folder. */
export function sendeDatei(res: Response, pfad: string, fertig: (err?: Error) => void): void {
  res.sendFile(path.basename(pfad), { root: path.dirname(pfad) }, fertig);
}

export function deliverFile(res: Response, pfad: string): void {
  sendeDatei(res, pfad, (err?: Error) => {
    if (err) responseOnFileError(res, err);
  });
}
