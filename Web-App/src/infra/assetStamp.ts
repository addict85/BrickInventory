/** Derived from the FILES, not from a number someone has to set:
 * a forgotten number made the browser show old files. */
import fs from 'node:fs';
import path from 'node:path';
import { processWide } from './processWide';

/** Without a deadline a dozen `stat` calls per page view; too long, and a deploy without
 * restart shows old addresses for minutes. */
export const STEMPEL_TTL_MS = 30_000;

const Z = processWide('assetStempel', () => ({ stamps: null as Map<string, string> | null, time: 0 }));

/** `null` instead of a placeholder: a missing file must not shake the addresses of the
 * OTHER assets. */
export function fileStamp(file: string): string | null {
  try {
    const st = fs.statSync(file);
    return Math.round(st.mtimeMs).toString(36) + '-' + st.size.toString(36);
  } catch {
    return null;
  }
}

/** Pure, without state — so that the rule can be checked without a server. */
export function stempleAssets(html: string, wurzel: string): string {
  return html.replace(
    /((?:href|src)=")(\/[^"?]+)\?v=[^"]*(")/g,
    (whole, header: string, filePath: string, tail: string) => {
      // normalize against `..`: a rule that only holds for benign input is none.
      const rein = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
      const stempel = fileStamp(path.join(wurzel, rein));
      return stempel === null ? whole : `${header}${filePath}?v=${stempel}${tail}`;
    },
  );
}

export function stampAssetsCached(html: string, wurzel: string): string {
  const now = Date.now();
  if (Z.stamps === null || now - Z.time > STEMPEL_TTL_MS) {
    Z.stamps = new Map();
    Z.time = now;
  }
  const record = Z.stamps;
  return html.replace(
    /((?:href|src)=")(\/[^"?]+)\?v=[^"]*(")/g,
    (whole, header: string, filePath: string, tail: string) => {
      let stempel = record.get(filePath);
      if (stempel === undefined) {
        const rein = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
        stempel = fileStamp(path.join(wurzel, rein)) ?? '';
        record.set(filePath, stempel);
      }
      return stempel === '' ? whole : `${header}${filePath}?v=${stempel}${tail}`;
    },
  );
}
