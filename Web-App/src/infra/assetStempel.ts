/** Derived from the FILES, not from a number someone has to set:
 * a forgotten number made the browser show old files. */
import fs from 'node:fs';
import path from 'node:path';
import { prozessweit } from './prozessweit';

/** Without a deadline a dozen `stat` calls per page view; too long, and a deploy without
 * restart shows old addresses for minutes. */
export const STEMPEL_TTL_MS = 30_000;

const Z = prozessweit('assetStempel', () => ({ satz: null as Map<string, string> | null, zeit: 0 }));

/** `null` instead of a placeholder: a missing file must not shake the addresses of the
 * OTHER assets. */
export function fileStamp(datei: string): string | null {
  try {
    const st = fs.statSync(datei);
    return Math.round(st.mtimeMs).toString(36) + '-' + st.size.toString(36);
  } catch {
    return null;
  }
}

/** Pure, without state — so that the rule can be checked without a server. */
export function stempleAssets(html: string, wurzel: string): string {
  return html.replace(/((?:href|src)=")(\/[^"?]+)\?v=[^"]*(")/g, (ganz, kopf: string, pfad: string, tail: string) => {
    // normalize against `..`: a rule that only holds for benign input is none.
    const rein = path.normalize(pfad).replace(/^(\.\.(\/|\\|$))+/, '');
    const stempel = fileStamp(path.join(wurzel, rein));
    return stempel === null ? ganz : `${kopf}${pfad}?v=${stempel}${tail}`;
  });
}

export function stempleAssetsGecacht(html: string, wurzel: string): string {
  const jetzt = Date.now();
  if (Z.satz === null || jetzt - Z.zeit > STEMPEL_TTL_MS) {
    Z.satz = new Map();
    Z.zeit = jetzt;
  }
  const satz = Z.satz;
  return html.replace(/((?:href|src)=")(\/[^"?]+)\?v=[^"]*(")/g, (ganz, kopf: string, pfad: string, tail: string) => {
    let stempel = satz.get(pfad);
    if (stempel === undefined) {
      const rein = path.normalize(pfad).replace(/^(\.\.(\/|\\|$))+/, '');
      stempel = fileStamp(path.join(wurzel, rein)) ?? '';
      satz.set(pfad, stempel);
    }
    return stempel === '' ? ganz : `${kopf}${pfad}?v=${stempel}${tail}`;
  });
}
