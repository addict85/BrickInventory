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
  const number = numberFrom(err);
  // Without a number of its own it almost always means "the file is not there" here.
  if (number === null || number === 404) {
    res.status(404).send('Datei nicht gefunden');
    return;
  }
  // 416 already carries the Content-Range ("bytes */<length>") the client needs.
  res.sendStatus(number);
}

/** With the folder as `root`: with the whole path every file would answer 404
 * as soon as the installation lives under a dot folder. */
export function sendFile(res: Response, filePath: string, done: (err?: Error) => void): void {
  res.sendFile(path.basename(filePath), { root: path.dirname(filePath) }, done);
}

export function deliverFile(res: Response, filePath: string): void {
  sendFile(res, filePath, (err?: Error) => {
    if (err) responseOnFileError(res, err);
  });
}
